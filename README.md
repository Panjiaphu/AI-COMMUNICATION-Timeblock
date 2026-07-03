# Guilua SLBo Sandbox

FastAPI + Jinja2 webapp for a commercial sandbox prototype:

- Public Home, BO Trading, Northern Rapid Number Draw, Member portal.
- Admin dashboard for rates, members, affiliate/referral, firewall, email ops and SLBo sandbox operations.
- Internal point wallet (`SLB_POINT`), platform treasury, BO order ledger and rapid number entry ledger.
- Three UI languages for the main shell: Vietnamese, Traditional Chinese and English.
- Coin market data uses CoinGecko and Binance in parallel with fallback data.
- Google AdSense hooks are available by environment variables.

This project is an enterprise sandbox / non-production prototype. It must not process real money, real USDT, private keys, or live settlement before legal, licensing, operational and security audit work is complete.

## Local Run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Create or update an admin account:

```bash
python scripts/create_admin.py --email admin@guilua.local --password "<strong-admin-password>"
```

## Render Commands

```text
Build Command: bash scripts/build_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /healthz/
```

## Required Render Env

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<random secret, at least 32 characters>
USE_SQLITE=true
SESSION_COOKIE_SECURE=true
RUN_MIGRATIONS_DURING_BUILD=false
PUBLIC_BASE_URL=https://fumap-line-webhook.onrender.com

ADMIN_NOTIFICATION_EMAIL=dautuquy888@gmail.com
ADMIN_LINE_ID=@827sxbki
ADMIN_PHONE=0906938893
ADMIN_SEED_EMAIL=admin@guilua.local
ADMIN_SEED_PASSWORD=<strong password, at least 14 characters>

MEMBER_REGISTRATION_ENABLED=true
MEMBER_PORTAL_ENABLED=true
APP_MODE=sandbox
REAL_MONEY_ENABLED=false
REAL_CRYPTO_WITHDRAW_ENABLED=false
LIVE_SETTLEMENT_ENABLED=false
SLBO_POINT_CURRENCY=SLB_POINT
BO_TRADE_OPEN_SECONDS=30
BO_RESULT_WAIT_SECONDS=15
BO_PAYOUT_RATIO=1.95
RAPID_SESSION_SECONDS=120
RAPID_ENTRY_OPEN_SECONDS=105
RAPID_RESULT_WAIT_SECONDS=15
PLATFORM_TREASURY_INITIAL_BALANCE=1000000
PLATFORM_TREASURY_RESERVE_FLOOR=0

CRYPTO_MARKET_LIVE_ENABLED=true
CRYPTO_MARKET_CACHE_SECONDS=180
CRYPTO_MARKET_TIMEOUT_SECONDS=2.5
COINGECKO_API_URL=https://api.coingecko.com/api/v3/simple/price
COINGECKO_API_KEY=
BINANCE_API_URL=https://api.binance.com/api/v3/ticker/24hr

GOOGLE_ADSENSE_CLIENT=
GOOGLE_ADSENSE_SLOT=
GOOGLE_ADSENSE_PUBLISHER_ID=
GOOGLE_SITE_VERIFICATION=

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=dautuquy888@gmail.com
SMTP_PASSWORD=<gmail app password, not gmail login password>
SMTP_FROM_EMAIL=dautuquy888@gmail.com
SMTP_USE_TLS=true
EMAIL_WEBHOOK_API_KEY=<secret for inbound email webhook>
```

`ADMIN_SEED_EMAIL` is only the first admin login seed. `ADMIN_NOTIFICATION_EMAIL` is the system/admin operations mailbox. They can and should be separate.

## API Keys

- Binance public ticker endpoint does not need an API key.
- CoinGecko works without a key for light demo traffic. For better quota, create a CoinGecko demo API key and set `COINGECKO_API_KEY`.
- Google AdSense: create the site at <https://adsense.google.com/>, then set `GOOGLE_ADSENSE_CLIENT=ca-pub-...`, `GOOGLE_ADSENSE_SLOT`, `GOOGLE_ADSENSE_PUBLISHER_ID=pub-...`, and `GOOGLE_SITE_VERIFICATION` if Google asks for meta verification.
- Gmail SMTP: enable 2-Step Verification, create a Google App Password, and put that app password in `SMTP_PASSWORD`. Do not use or commit the Gmail login password.

## Current Sandbox Limits

- BO and Rapid settlement are synchronous sandbox simulations for demo UX.
- Account-level target win rate, exposure balancing, max liability guard and background timed settlement are not complete enterprise engines yet.
- Loss-deposit referral commission is automatic only after a downline member's realized loss reaches all approved deposited points.
- Real deposits, withdrawals, crypto transfer, KYC/AML, payment gateway and production gambling/financial compliance are not included.
