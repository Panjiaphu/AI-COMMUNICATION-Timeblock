from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from io import BytesIO
import os
import subprocess
import sys
import unittest

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import BASE_DIR, get_settings
from app.core.security import create_email_token, hash_password
from app.db.session import Base
from app.db.session import SessionLocal
from app.main import app
from app.models import (
    ContentPost,
    ContentPostType,
    EmailNotification,
    EmailReply,
    InternalWallet,
    PointLedgerEntry,
    PointTransfer,
    RapidResultBoard,
    ReferralCommission,
    ReferralCommissionStatus,
    ReferralCommissionType,
    SandboxRequestType,
    SandboxTransaction,
    SecurityEvent,
    ServiceRequest,
    TransactionRequest,
    TransactionType,
    User,
)
from app.services.commercial import create_agent_key
from app.services.email import record_email_reply
from app.services import crypto_market
from app.services.crypto_market import clear_crypto_market_cache
from app.services.ip_provider import provision_ip_service
from app.services.member_services import create_ip_service_request
from app.services.rates import ensure_default_rates
from app.services.referrals import create_referral_commissions, ensure_user_referral_identity
from app.services.slbo import (
    approve_deposit,
    approve_wallet_request,
    complete_point_transfer,
    create_wallet_request,
    get_recent_rapid_result_boards,
    record_member_loss,
    transfer_points,
)
from app.services.transactions import create_transaction


def _delete_wallet_test_user(db, user_id: int) -> None:
    db.query(PointTransfer).filter(PointTransfer.sender_user_id == user_id).delete(synchronize_session=False)
    db.query(PointTransfer).filter(PointTransfer.receiver_user_id == user_id).delete(synchronize_session=False)
    db.query(PointLedgerEntry).filter(PointLedgerEntry.user_id == user_id).delete(synchronize_session=False)
    db.query(SandboxTransaction).filter(SandboxTransaction.user_id == user_id).delete(synchronize_session=False)
    db.query(EmailNotification).filter(EmailNotification.user_id == user_id).delete(synchronize_session=False)
    db.query(InternalWallet).filter(InternalWallet.user_id == user_id).delete(synchronize_session=False)
    user = db.get(User, user_id)
    if user:
        db.delete(user)


class FastApiSmokeTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_healthz_ok(self):
        response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_home_renders_bilingual_shell(self):
        response = self.client.get("/?lang=zh-TW")
        self.assertEqual(response.status_code, 200)
        self.assertIn("TWD / VND", response.text)
        self.assertIn("USDT / TWD", response.text)
        self.assertIn("zh-TW", response.text)
        self.assertIn("/bo?lang=zh-TW", response.text)
        self.assertIn("/rapid?lang=zh-TW", response.text)
        self.assertIn("/member/transactions/send-home", response.text)
        self.assertIn("/member/transactions/buy-usdt", response.text)
        self.assertIn("/member/transactions/sell-usdt", response.text)
        self.assertNotIn("/jobs?lang=zh-TW", response.text)
        self.assertNotIn("/shop?lang=zh-TW", response.text)
        self.assertNotIn("/utilities?lang=zh-TW", response.text)

    def test_home_renders_rate_reference_mode(self):
        response = self.client.get("/?lang=vi")
        self.assertEqual(response.status_code, 200)
        self.assertIn("TWD / VND", response.text)
        self.assertIn("USDT / TWD", response.text)
        self.assertIn("rate-buy-sell", response.text)
        self.assertNotIn("APP_MODE", response.text)
        self.assertNotIn("REAL_MONEY_ENABLED", response.text)
        self.assertIn("/member/transactions/send-home", response.text)
        self.assertIn("/member/transactions/buy-usdt", response.text)
        self.assertIn("/member/transactions/sell-usdt", response.text)
        self.assertNotIn("/jobs?lang=vi", response.text)
        self.assertNotIn("/shop?lang=vi", response.text)
        self.assertNotIn("/utilities?lang=vi", response.text)

    def test_admin_dashboard_keeps_manual_rate_form(self):
        email = f"rate-admin-{os.getpid()}@example.com"
        password = "RateAdmin!2026"
        with SessionLocal() as db:
            old_user = db.query(User).filter(User.email == email).first()
            if old_user:
                db.delete(old_user)
                db.commit()
            admin = User(
                email=email,
                password_hash=hash_password(password),
                full_name="Rate Admin",
                locale="vi",
                is_admin=True,
                is_email_verified=True,
            )
            ensure_user_referral_identity(db, admin)
            db.add(admin)
            db.commit()
            admin_id = admin.id

        login_page = self.client.get("/login?lang=vi")
        token = login_page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        login = self.client.post(
            "/login?lang=vi",
            data={"csrf_token": token, "email": email, "password": password, "next_url": "/admin"},
        )
        self.assertEqual(login.status_code, 200)

        page = self.client.get("/admin?lang=vi")
        self.assertEqual(page.status_code, 200)
        self.assertIn('action="/admin/rates"', page.text)
        self.assertIn('name="buy_rate"', page.text)
        self.assertIn('name="sell_rate"', page.text)

        with SessionLocal() as db:
            db.query(SecurityEvent).filter(SecurityEvent.user_id == admin_id).delete()
            db.delete(db.get(User, admin_id))
            db.commit()

    def test_register_is_open(self):
        response = self.client.get("/register?lang=vi")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Đăng ký", response.text)
        self.assertIn('action="/register"', response.text)

    def test_register_with_referral_code_assigns_sponsor_and_uid(self):
        suffix = os.getpid()
        sponsor_email = f"ref-sponsor-{suffix}@example.com"
        member_email = f"ref-member-{suffix}@example.com"
        password = "MemberReferral!2026"
        with SessionLocal() as db:
            for existing in db.query(User).filter(User.email.in_([sponsor_email, member_email])).all():
                db.query(EmailNotification).filter(EmailNotification.user_id == existing.id).delete()
                db.delete(existing)
            sponsor = User(
                email=sponsor_email,
                password_hash=hash_password(password),
                full_name="Referral Sponsor",
                locale="vi",
                is_active=True,
                is_email_verified=True,
            )
            ensure_user_referral_identity(db, sponsor)
            db.add(sponsor)
            db.commit()
            db.refresh(sponsor)
            sponsor_id = sponsor.id
            sponsor_code = sponsor.referral_code

        page = self.client.get(f"/register?lang=vi&ref={sponsor_code}")
        self.assertEqual(page.status_code, 200)
        self.assertIn(sponsor_code, page.text)
        token = page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        response = self.client.post(
            "/register?lang=vi",
            data={
                "csrf_token": token,
                "email": member_email,
                "password": password,
                "full_name": "Referral Member",
                "locale": "vi",
                "referral_code": sponsor_code,
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("verify_email=1", response.headers["location"])

        with SessionLocal() as db:
            member = db.query(User).filter(User.email == member_email).first()
            self.assertIsNotNone(member)
            self.assertEqual(member.referred_by_user_id, sponsor_id)
            self.assertTrue(member.uid.startswith("GL"))
            self.assertTrue(member.referral_code.startswith("RF"))
            self.assertFalse(member.is_email_verified)

        login_page = self.client.get("/login?lang=vi")
        login_token = login_page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        blocked = self.client.post(
            "/login?lang=vi",
            data={"csrf_token": login_token, "email": member_email, "password": password, "next_url": "/member"},
        )
        self.assertEqual(blocked.status_code, 200)

        verify = self.client.get(f"/verify-email?token={create_email_token(member_email)}", follow_redirects=False)
        self.assertEqual(verify.status_code, 303)
        self.assertIn("/login?verified=1", verify.headers["location"])

        login_page = self.client.get("/login?lang=vi")
        login_token = login_page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        allowed = self.client.post(
            "/login?lang=vi",
            data={"csrf_token": login_token, "email": member_email, "password": password, "next_url": "/member"},
            follow_redirects=False,
        )
        self.assertEqual(allowed.status_code, 303)
        self.assertEqual(allowed.headers["location"], "/member")

        with SessionLocal() as db:
            member = db.query(User).filter(User.email == member_email).first()
            db.query(EmailNotification).filter(EmailNotification.user_id == member.id).delete()
            db.delete(member)
            db.delete(db.get(User, sponsor_id))
            db.commit()

    def test_forgot_password_form_and_generic_response(self):
        response = self.client.get("/forgot-password?lang=vi")
        self.assertEqual(response.status_code, 200)
        self.assertIn('action="/forgot-password"', response.text)
        token_marker = 'name="csrf_token" value="'
        token = response.text.split(token_marker, 1)[1].split('"', 1)[0]
        submit = self.client.post(
            "/forgot-password?lang=vi",
            data={"csrf_token": token, "email": "nobody@example.com"},
        )
        self.assertEqual(submit.status_code, 200)
        self.assertIn("Nếu email tồn tại", submit.text)

    def test_crypto_dashboard_renders_with_fallback_data(self):
        old_live = os.environ.get("CRYPTO_MARKET_LIVE_ENABLED")
        os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = "false"
        get_settings.cache_clear()
        clear_crypto_market_cache()
        try:
            response = self.client.get("/crypto?lang=vi")
        finally:
            if old_live is None:
                os.environ.pop("CRYPTO_MARKET_LIVE_ENABLED", None)
            else:
                os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = old_live
            get_settings.cache_clear()
            clear_crypto_market_cache()
        self.assertEqual(response.status_code, 200)
        self.assertIn("Bảng tham khảo crypto", response.text)
        self.assertIn("Bảng chỉ số vĩ mô", response.text)
        self.assertIn("Bảng 12 nhóm coin", response.text)
        self.assertIn("TradingView", response.text)
        self.assertIn("CRYPTOCAP:BTC.D", response.text)
        self.assertIn("CoinGecko + Binance", response.text)
        self.assertNotIn("Google AdSense", response.text)

    def test_crypto_analysis_public_empty_page_renders(self):
        response = self.client.get("/crypto/analysis?lang=vi")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Phân tích crypto", response.text)

    def test_slbo_public_rooms_render(self):
        bo = self.client.get("/bo?lang=en")
        self.assertEqual(bo.status_code, 200)
        self.assertIn("synced system chart", bo.text)
        self.assertIn("TradingView", bo.text)
        self.assertIn("boSystemChart", bo.text)
        self.assertIn("BUY", bo.text)
        self.assertIn("Max 1000 points", bo.text)
        self.assertIn('data-interval="1S"', bo.text)
        self.assertIn("boTradingView", bo.text)
        self.assertIn("tradingview-widget-container", bo.text)
        self.assertNotIn("bo-side-rail", bo.text)
        self.assertNotIn("bo-right-rail", bo.text)
        self.assertIn("data-bo-last-result", bo.text)
        self.assertIn("data-bo-session-history", bo.text)

        rapid = self.client.get("/rapid?lang=vi")
        self.assertEqual(rapid.status_code, 200)
        self.assertIn("rapid-prize-row", rapid.text)
        self.assertIn('data-play-tab="bao_lo_3"', rapid.text)
        self.assertIn("rapidNumberGrid", rapid.text)
        self.assertIn("rapid-recent-results", rapid.text)
        self.assertIn("data-rapid-ticket-session", rapid.text)
        self.assertIn("27", rapid.text)

        market = self.client.get("/api/slbo/market")
        self.assertEqual(market.status_code, 200)
        payload = market.json()
        self.assertTrue(any(item["code"] == "BTC" for item in payload["assets"]))

        state = self.client.get("/api/slbo/room-state?lang=vi")
        self.assertEqual(state.status_code, 200)
        state_payload = state.json()
        self.assertIn("bo_clock", state_payload)
        self.assertIn("rapid_clock", state_payload)
        self.assertIn("BTC", state_payload["bo_results_by_asset"])
        self.assertGreaterEqual(len(state_payload["rapid_results"]), 5)

        chart = self.client.get("/api/slbo/bo-chart?asset=BTC&interval=1S&limit=40")
        self.assertEqual(chart.status_code, 200)
        chart_payload = chart.json()
        self.assertEqual(chart_payload["asset"], "BTC")
        self.assertEqual(chart_payload["interval"], "1S")
        self.assertGreaterEqual(len(chart_payload["candles"]), 20)
        self.assertIn("recent_results", chart_payload)

    def test_rapid_recent_result_boards_persist(self):
        with SessionLocal() as db:
            db.query(RapidResultBoard).delete(synchronize_session=False)
            boards = get_recent_rapid_result_boards(db, 5)
            db.commit()
            stored_count = db.query(RapidResultBoard).count()
        self.assertEqual(len(boards), 5)
        self.assertGreaterEqual(stored_count, 5)

    def test_slbo_room_state_handles_concurrent_polling(self):
        def hit_room_state(_index):
            with TestClient(app) as client:
                response = client.get("/api/slbo/room-state?lang=vi")
                return response.status_code, response.json()["rapid_clock"]["session_code"], len(response.json()["rapid_results"])

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(hit_room_state, range(6)))

        self.assertTrue(all(status == 200 for status, _session_code, _count in results))
        self.assertTrue(all(count >= 5 for _status, _session_code, count in results))

    def test_member_point_transfer_and_wallet_request_flow(self):
        suffix = os.getpid()
        admin_email = f"wallet-admin-{suffix}@example.com"
        sender_email = f"wallet-sender-{suffix}@example.com"
        receiver_email = f"wallet-receiver-{suffix}@example.com"
        password = "WalletFlow!2026"
        created_user_ids: list[int] = []
        with SessionLocal() as db:
            for existing in db.query(User).filter(User.email.in_([admin_email, sender_email, receiver_email])).all():
                _delete_wallet_test_user(db, existing.id)
            admin = User(
                email=admin_email,
                password_hash=hash_password(password),
                full_name="Wallet Admin",
                locale="vi",
                is_admin=True,
                is_active=True,
                is_email_verified=True,
            )
            sender = User(
                email=sender_email,
                password_hash=hash_password(password),
                full_name="Wallet Sender",
                locale="vi",
                is_active=True,
                is_email_verified=True,
            )
            receiver = User(
                email=receiver_email,
                password_hash=hash_password(password),
                full_name="Wallet Receiver",
                locale="vi",
                is_active=True,
                is_email_verified=True,
            )
            for user in (admin, sender, receiver):
                ensure_user_referral_identity(db, user)
                db.add(user)
            db.commit()
            db.refresh(admin)
            db.refresh(sender)
            db.refresh(receiver)
            created_user_ids = [admin.id, sender.id, receiver.id]

            approve_deposit(db, user=sender, amount=Decimal("500"), admin=admin, note="seed points")
            transfer = transfer_points(
                db,
                sender=sender,
                recipient_identifier=receiver.uid,
                amount=Decimal("125"),
                memo="member transfer",
            )
            self.assertTrue(transfer.reference_code.startswith("PT"))
            self.assertEqual("pending_receiver_confirmation", transfer.status)

            sender_wallet = db.query(InternalWallet).filter(InternalWallet.user_id == sender.id).first()
            receiver_wallet = db.query(InternalWallet).filter(InternalWallet.user_id == receiver.id).first()
            self.assertEqual(Decimal("500.0000"), sender_wallet.available_balance)
            self.assertEqual(Decimal("0.0000"), receiver_wallet.available_balance)

            complete_point_transfer(db, transfer=transfer, actor=receiver)
            db.refresh(sender_wallet)
            db.refresh(receiver_wallet)
            self.assertEqual(Decimal("375.0000"), sender_wallet.available_balance)
            self.assertEqual(Decimal("125.0000"), receiver_wallet.available_balance)

            request = create_wallet_request(
                db,
                user=sender,
                request_type=SandboxRequestType.WITHDRAW,
                amount=Decimal("50"),
                transfer_channel="ops desk",
                account_name="Wallet Sender",
                account_identifier="WD-001",
            )
            approve_wallet_request(db, item=request, admin=admin, note="approved")
            db.refresh(sender_wallet)
            self.assertEqual(Decimal("325.0000"), sender_wallet.available_balance)
            self.assertEqual(Decimal("50.0000"), sender_wallet.total_withdraw)

            for user_id in created_user_ids:
                _delete_wallet_test_user(db, user_id)
            db.commit()

    def test_ads_txt_without_adsense_configuration(self):
        response = self.client.get("/ads.txt")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Ads disabled", response.text)

    def test_crypto_market_keeps_binance_when_coingecko_fails(self):
        old_live = os.environ.get("CRYPTO_MARKET_LIVE_ENABLED")
        os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = "true"
        get_settings.cache_clear()
        clear_crypto_market_cache()
        original_coingecko = crypto_market._fetch_coingecko
        original_binance = crypto_market._fetch_binance
        crypto_market._fetch_coingecko = lambda settings: (_ for _ in ()).throw(RuntimeError("down"))
        crypto_market._fetch_binance = lambda settings: {
            "BTCUSDT": {"lastPrice": "70000", "priceChangePercent": "1.25", "quoteVolume": "999"}
        }
        try:
            snapshot = crypto_market.get_crypto_market_snapshot(force_refresh=True)
        finally:
            crypto_market._fetch_coingecko = original_coingecko
            crypto_market._fetch_binance = original_binance
            if old_live is None:
                os.environ.pop("CRYPTO_MARKET_LIVE_ENABLED", None)
            else:
                os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = old_live
            get_settings.cache_clear()
            clear_crypto_market_cache()
        self.assertEqual(snapshot["coin_map"]["BTC"]["price"], 70000.0)
        self.assertEqual(snapshot["coin_map"]["BTC"]["source"], "Binance")

    def test_crypto_market_keeps_coingecko_when_binance_fails(self):
        old_live = os.environ.get("CRYPTO_MARKET_LIVE_ENABLED")
        os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = "true"
        get_settings.cache_clear()
        clear_crypto_market_cache()
        original_coingecko = crypto_market._fetch_coingecko
        original_binance = crypto_market._fetch_binance
        crypto_market._fetch_coingecko = lambda settings: {
            "bitcoin": {"usd": 71000, "usd_24h_change": 2.5, "usd_market_cap": 1, "usd_24h_vol": 2}
        }
        crypto_market._fetch_binance = lambda settings: (_ for _ in ()).throw(RuntimeError("down"))
        try:
            snapshot = crypto_market.get_crypto_market_snapshot(force_refresh=True)
        finally:
            crypto_market._fetch_coingecko = original_coingecko
            crypto_market._fetch_binance = original_binance
            if old_live is None:
                os.environ.pop("CRYPTO_MARKET_LIVE_ENABLED", None)
            else:
                os.environ["CRYPTO_MARKET_LIVE_ENABLED"] = old_live
            get_settings.cache_clear()
            clear_crypto_market_cache()
        self.assertEqual(snapshot["coin_map"]["BTC"]["price"], 71000.0)
        self.assertEqual(snapshot["coin_map"]["BTC"]["source"], "CoinGecko")

    def test_commercial_public_pages_render(self):
        for path, marker in [
            ("/jobs?lang=vi", "Tìm việc làm"),
            ("/shop?lang=vi", "Shop Shopee"),
            ("/utilities?lang=vi", "Tiện ích miễn phí"),
            ("/utilities/qr?lang=vi", "Tạo mã QR"),
            ("/utilities/shortlink?lang=vi", "Tạo shortlink"),
            ("/utilities/ping?lang=vi", "Ping website"),
            ("/utilities/free-vpn?lang=vi", "Free VPN"),
            ("/advertising?lang=vi", "Liên hệ quảng cáo"),
            ("/build-idea?lang=vi", "Ý tưởng website"),
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn(marker, response.text)

    def test_shortlink_rejects_localhost(self):
        response = self.client.post(
            "/utilities/shortlink?lang=vi",
            data={"target_url": "http://127.0.0.1:8000/admin"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("not allowed", response.text)

    def test_shortlink_accepts_custom_code(self):
        custom_code = f"guilua-test-{os.getpid()}"
        response = self.client.post(
            "/utilities/shortlink?lang=vi",
            data={"target_url": "https://example.com", "custom_code": custom_code},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(f"/s/{custom_code}", response.text)

    def test_qr_generator_returns_svg_data_url(self):
        response = self.client.post("/utilities/qr?lang=vi", data={"payload": "https://example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("data:image/svg+xml;base64", response.text)

    def test_ai_agent_requires_key(self):
        response = self.client.post(
            "/api/agent/posts/job",
            json={"title": "Test Job", "summary": "A", "content": "B"},
        )
        self.assertEqual(response.status_code, 401)

    def test_ai_agent_creates_draft_job_post(self):
        with SessionLocal() as db:
            key, raw_key = create_agent_key(db, "Smoke Agent", ["job"], can_auto_publish=False)
            key_id = key.id
        response = self.client.post(
            "/api/agent/posts/job",
            headers={"Authorization": f"Bearer {raw_key}"},
            json={
                "title": "Taiwan Factory Assistant Smoke",
                "summary": "Smoke summary",
                "content": "Smoke content",
                "target_url": "https://example.com/job",
                "platform": "website",
                "status": "published",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "draft")
        with SessionLocal() as db:
            post = db.get(ContentPost, payload["post_id"])
            self.assertIsNotNone(post)
            self.assertEqual(post.source.value, "ai_agent")
            db.delete(post)
            db.delete(db.get(type(key), key_id))
            db.commit()

    def test_ai_agent_creates_crypto_analysis_post(self):
        with SessionLocal() as db:
            key, raw_key = create_agent_key(db, "Crypto Agent", ["crypto_analysis"], can_auto_publish=False)
            key_id = key.id
        response = self.client.post(
            "/api/agent/posts/crypto_analysis",
            headers={"Authorization": f"Bearer {raw_key}"},
            json={
                "title": "BTC Session Smoke Analysis",
                "summary": "Smoke crypto analysis",
                "content": "Market structure and tokenomics notes.",
                "status": "published",
                "tags": ["BTC", "ETH"],
                "market_session": "Asia",
                "market_bias": "neutral",
                "risk_level": "medium",
                "tradingview_symbol": "BINANCE:BTCUSDT",
                "tradingview_url": "https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT",
                "analysis_category": "session_report",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "draft")
        with SessionLocal() as db:
            post = db.get(ContentPost, payload["post_id"])
            self.assertIsNotNone(post)
            self.assertEqual(post.post_type, ContentPostType.CRYPTO_ANALYSIS)
            self.assertEqual(post.market_session, "Asia")
            self.assertEqual(post.tradingview_symbol, "BINANCE:BTCUSDT")
            db.delete(post)
            db.delete(db.get(type(key), key_id))
            db.commit()

    def test_admin_post_upload_compresses_image_to_webp(self):
        email = f"admin-upload-{os.getpid()}@example.com"
        password = "AdminUpload!2026"
        with SessionLocal() as db:
            old_user = db.query(User).filter(User.email == email).first()
            if old_user:
                db.delete(old_user)
                db.commit()
            admin = User(
                email=email,
                password_hash=hash_password(password),
                full_name="Upload Admin",
                locale="vi",
                is_admin=True,
                is_email_verified=True,
            )
            ensure_user_referral_identity(db, admin)
            db.add(admin)
            db.commit()
            admin_id = admin.id

        login_page = self.client.get("/login?lang=vi")
        token = login_page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        login = self.client.post(
            "/login?lang=vi",
            data={"csrf_token": token, "email": email, "password": password, "next_url": "/admin"},
        )
        self.assertEqual(login.status_code, 200)

        form_page = self.client.get("/admin/posts/jobs/new?lang=vi")
        self.assertEqual(form_page.status_code, 200)
        token = form_page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
        image_buffer = BytesIO()
        Image.new("RGB", (640, 360), "#00d09c").save(image_buffer, format="PNG")
        response = self.client.post(
            "/admin/posts/jobs",
            data={
                "csrf_token": token,
                "title": "Upload Smoke Job Post",
                "summary": "Upload smoke summary",
                "content": "Upload smoke content",
                "target_url": "https://example.com/job",
                "platform": "website",
                "locale": "vi",
                "status": "published",
                "tags": "upload, smoke",
                "sort_order": "1",
            },
            files={"image_file": ("cover.png", image_buffer.getvalue(), "image/png")},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)

        settings = get_settings()
        with SessionLocal() as db:
            post = db.query(ContentPost).filter(ContentPost.title == "Upload Smoke Job Post").first()
            self.assertIsNotNone(post)
            self.assertTrue(post.image_url.endswith(".webp"))
            self.assertIn("/static/uploads/posts/jobs/", post.image_url)
            relative_url = post.image_url.replace(settings.public_base_url.rstrip(), "")
            saved_path = BASE_DIR / "app" / relative_url.lstrip("/")
            self.assertTrue(saved_path.exists())
            saved_path.unlink(missing_ok=True)
            db.delete(post)
            db.query(SecurityEvent).filter(SecurityEvent.user_id == admin_id).delete()
            db.delete(db.get(User, admin_id))
            db.commit()

    def test_security_firewall_env_blocklist_logs_event(self):
        old_blocklist = os.environ.get("SECURITY_IP_BLOCKLIST")
        os.environ["SECURITY_IP_BLOCKLIST"] = "203.0.113.250"
        get_settings.cache_clear()
        try:
            response = self.client.get("/", headers={"X-Forwarded-For": "203.0.113.250"})
            self.assertEqual(response.status_code, 403)
            with SessionLocal() as db:
                event = (
                    db.query(SecurityEvent)
                    .filter(SecurityEvent.ip_address == "203.0.113.250", SecurityEvent.event_type == "request_blocked")
                    .order_by(SecurityEvent.created_at.desc())
                    .first()
                )
                self.assertIsNotNone(event)
        finally:
            if old_blocklist is None:
                os.environ.pop("SECURITY_IP_BLOCKLIST", None)
            else:
                os.environ["SECURITY_IP_BLOCKLIST"] = old_blocklist
            get_settings.cache_clear()

    def test_email_webhook_requires_configuration(self):
        response = self.client.post(
            "/webhooks/email-reply",
            json={"from": "member@example.com", "text": "Xin chào"},
        )
        self.assertEqual(response.status_code, 503)

    def test_member_services_requires_login_when_open(self):
        response = self.client.get("/member/services?lang=vi", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn("/login", response.headers["location"])

    def test_transaction_form_requires_login_when_open(self):
        response = self.client.get("/member/transactions/send-home?lang=vi", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn("/login", response.headers["location"])

    def test_ip_connector_download_requires_login_when_open(self):
        response = self.client.get("/member/services/ip-switch/download", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn("/login", response.headers["location"])

    def test_record_email_reply_queues_admin_notification(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(bind=engine)

        with TestingSession() as db:
            reply = record_email_reply(
                db,
                sender="member@example.com",
                recipient="support@guilua.local",
                subject="Re: GL test",
                body="Tôi đã bổ sung thông tin.",
            )

            self.assertEqual(reply.sender, "member@example.com")
            self.assertEqual(db.query(EmailReply).count(), 1)
            self.assertEqual(db.query(EmailNotification).filter_by(event_type="inbound_email_reply").count(), 1)

    def test_create_ip_service_request_queues_notifications(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(bind=engine)

        with TestingSession() as db:
            user = User(
                email="service-member@example.com",
                password_hash="hash",
                full_name="Service Member",
                locale="vi",
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            item = create_ip_service_request(
                db,
                user=user,
                target_region="random",
                protocol="vpn",
                duration_hours=48,
                device_label="Laptop",
                current_ip="203.0.113.10",
                member_note="Cần IP ổn định",
            )

            self.assertTrue(item.reference_code.startswith("GS"))
            self.assertEqual(item.target_region, "random")
            self.assertEqual(db.query(ServiceRequest).count(), 1)
            self.assertEqual(db.query(EmailNotification).filter_by(event_type="member_service_created").count(), 1)
            self.assertEqual(db.query(EmailNotification).filter_by(event_type="admin_service_created").count(), 1)

    def test_create_transaction_stores_admin_details(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(bind=engine)

        with TestingSession() as db:
            ensure_default_rates(db)
            user = User(
                email="trade-member@example.com",
                password_hash="hash",
                full_name="Trade Member",
                locale="vi",
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            item = create_transaction(
                db,
                user=user,
                request_type=TransactionType.BUY_USDT,
                amount_twd=Decimal("10000"),
                amount_usdt=None,
                contact_phone="0900000000",
                contact_line="@member",
                usdt_network="TRC20",
                wallet_address="TXYZ123",
                member_note="Cần xử lý nhanh",
            )

            self.assertTrue(item.reference_code.startswith("GL"))
            self.assertEqual(item.usdt_network, "TRC20")
            self.assertEqual(item.wallet_address, "TXYZ123")
            self.assertEqual(item.contact_phone, "0900000000")
            self.assertEqual(db.query(TransactionRequest).count(), 1)

    def test_referral_commission_ledger_allocates_three_levels(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(bind=engine)

        with TestingSession() as db:
            level3 = User(
                email="level3@example.com",
                password_hash="hash",
                uid="GLLEVEL3",
                referral_code="RFLEVEL3",
                is_active=True,
            )
            level2 = User(
                email="level2@example.com",
                password_hash="hash",
                uid="GLLEVEL2",
                referral_code="RFLEVEL2",
                is_active=True,
                sponsor=level3,
            )
            level1 = User(
                email="level1@example.com",
                password_hash="hash",
                uid="GLLEVEL1",
                referral_code="RFLEVEL1",
                is_active=True,
                sponsor=level2,
            )
            source = User(
                email="source@example.com",
                password_hash="hash",
                uid="GLSOURCE",
                referral_code="RFSOURCE",
                is_active=True,
                sponsor=level1,
            )
            admin = User(
                email="admin@example.com",
                password_hash="hash",
                uid="GLADMIN",
                referral_code="RFADMIN",
                is_active=True,
                is_admin=True,
            )
            db.add_all([level3, level2, level1, source, admin])
            db.commit()
            db.refresh(source)
            db.refresh(admin)

            created = create_referral_commissions(
                db,
                source_user=source,
                commission_type=ReferralCommissionType.ACTIVITY,
                base_amount=Decimal("1000"),
                currency="POINT",
                reference_type="smoke",
                reference_id="T001",
                created_by=admin,
                status=ReferralCommissionStatus.APPROVED,
            )
            self.assertEqual(len(created), 3)
            rows = db.query(ReferralCommission).order_by(ReferralCommission.level.asc()).all()
            self.assertEqual([row.level for row in rows], [1, 2, 3])
            self.assertEqual([Decimal(row.amount) for row in rows], [Decimal("10.0000"), Decimal("20.0000"), Decimal("30.0000")])
            self.assertEqual(rows[0].beneficiary.email, "level1@example.com")
            self.assertEqual(rows[1].beneficiary.email, "level2@example.com")
            self.assertEqual(rows[2].beneficiary.email, "level3@example.com")

    def test_loss_deposit_commission_waits_until_downline_loses_all_approved_deposit(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(bind=engine)

        with TestingSession() as db:
            level3 = User(email="loss-l3@example.com", password_hash="hash", uid="GLL3", referral_code="RFL3", is_active=True)
            level2 = User(
                email="loss-l2@example.com",
                password_hash="hash",
                uid="GLL2",
                referral_code="RFL2",
                is_active=True,
                sponsor=level3,
            )
            level1 = User(
                email="loss-l1@example.com",
                password_hash="hash",
                uid="GLL1",
                referral_code="RFL1",
                is_active=True,
                sponsor=level2,
            )
            source = User(
                email="loss-source@example.com",
                password_hash="hash",
                uid="GLLOSSSRC",
                referral_code="RFLOSSSRC",
                is_active=True,
                sponsor=level1,
            )
            admin = User(
                email="loss-admin@example.com",
                password_hash="hash",
                uid="GLLOSSADM",
                referral_code="RFLOSSADM",
                is_active=True,
                is_admin=True,
            )
            db.add_all([level3, level2, level1, source, admin])
            db.commit()
            db.refresh(source)
            db.refresh(admin)

            approve_deposit(db, user=source, amount=Decimal("100"), admin=admin)
            partial = record_member_loss(db, user=source, amount=Decimal("40"), reference_id="partial")
            self.assertEqual(partial, [])
            self.assertEqual(
                db.query(ReferralCommission)
                .filter(ReferralCommission.commission_type == ReferralCommissionType.LOSS_DEPOSIT)
                .count(),
                0,
            )

            created = record_member_loss(db, user=source, amount=Decimal("60"), reference_id="full")
            self.assertEqual(len(created), 3)
            rows = (
                db.query(ReferralCommission)
                .filter(ReferralCommission.commission_type == ReferralCommissionType.LOSS_DEPOSIT)
                .order_by(ReferralCommission.level.asc())
                .all()
            )
            self.assertEqual([Decimal(row.amount) for row in rows], [Decimal("1.0000"), Decimal("2.0000"), Decimal("3.0000")])

            duplicate = record_member_loss(db, user=source, amount=Decimal("1"), reference_id="extra")
            self.assertEqual(duplicate, [])
            self.assertEqual(
                db.query(ReferralCommission)
                .filter(ReferralCommission.commission_type == ReferralCommissionType.LOSS_DEPOSIT)
                .count(),
                3,
            )

    def test_ip_provider_returns_not_configured_without_env(self):
        old_url = os.environ.pop("IP_SERVICE_PROVIDER_URL", None)
        old_key = os.environ.pop("IP_SERVICE_PROVIDER_API_KEY", None)
        get_settings.cache_clear()
        item = ServiceRequest(
            reference_code="GSDEMO",
            service_type="ip_switch",
            target_region="taiwan",
            protocol="vpn",
            duration_hours=24,
            device_label="Laptop",
            current_ip="203.0.113.10",
            member_note="",
        )
        try:
            result = provision_ip_service(item)
            self.assertFalse(result.configured)
            self.assertFalse(result.success)
        finally:
            if old_url is not None:
                os.environ["IP_SERVICE_PROVIDER_URL"] = old_url
            if old_key is not None:
                os.environ["IP_SERVICE_PROVIDER_API_KEY"] = old_key
            get_settings.cache_clear()

    def test_runtime_env_check_allows_missing_admin_seed_password(self):
        env = {
            **os.environ,
            "APP_ENV": "production",
            "DEBUG": "false",
            "SECRET_KEY": "x" * 40,
            "USE_SQLITE": "true",
            "RUN_MIGRATIONS_DURING_BUILD": "false",
        }
        env.pop("ADMIN_SEED_EMAIL", None)
        env.pop("ADMIN_SEED_PASSWORD", None)
        result = subprocess.run(
            [sys.executable, "scripts/check_env.py", "--phase", "build"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Environment check passed.", result.stdout)

    def test_runtime_env_check_ignores_deprecated_admin_seed_password(self):
        env = {
            **os.environ,
            "APP_ENV": "production",
            "DEBUG": "false",
            "SECRET_KEY": "x" * 40,
            "USE_SQLITE": "true",
            "ADMIN_SEED_PASSWORD": "pp11223344",
        }
        result = subprocess.run(
            [sys.executable, "scripts/check_env.py", "--phase", "runtime"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are ignored", result.stdout)

    def test_runtime_env_check_validates_admin_bootstrap(self):
        env = {
            **os.environ,
            "APP_ENV": "production",
            "DEBUG": "false",
            "SECRET_KEY": "x" * 40,
            "USE_SQLITE": "true",
            "ADMIN_BOOTSTRAP_ENABLED": "true",
            "ADMIN_BOOTSTRAP_EMAIL": "dautuquy888@gmail.com",
            "ADMIN_BOOTSTRAP_PASSWORD": "short",
        }
        result = subprocess.run(
            [sys.executable, "scripts/check_env.py", "--phase", "runtime"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("ADMIN_BOOTSTRAP_PASSWORD must be at least 14 characters", result.stderr)


if __name__ == "__main__":
    unittest.main()
