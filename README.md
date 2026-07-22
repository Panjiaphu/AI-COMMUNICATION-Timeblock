# Guilua Point Platform

FastAPI + Jinja2 webapp for a commercial internal-point platform:

- Public Home, BO Trading, Northern Rapid Number Draw, Member portal.
- Admin dashboard for rates, members, affiliate/referral, firewall, email ops and SLBo operations.
- Internal point wallet (`SLB_POINT`), platform treasury, BO order ledger and rapid number entry ledger.
- Member wallet requests for point top-up/withdrawal review and member-to-member point transfer.
- Three UI languages for the main shell: Vietnamese, Traditional Chinese and English.
- Coin market data uses CoinGecko and Binance in parallel with fallback data.

Runtime guard flags keep real-money, real-crypto and live external settlement disabled. The public UI uses customer-facing product language and does not expose low-level environment flags.

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
PUBLIC_BASE_URL=https://guilua.onrender.com

ADMIN_NOTIFICATION_EMAIL=dautuquy888@gmail.com
ADMIN_LINE_ID=@827sxbki

MEMBER_REGISTRATION_ENABLED=true
MEMBER_PORTAL_ENABLED=true
BO_PUBLIC_ENABLED=false
APP_MODE=sandbox
REAL_MONEY_ENABLED=false
REAL_CRYPTO_WITHDRAW_ENABLED=false
LIVE_SETTLEMENT_ENABLED=false
SLBO_POINT_CURRENCY=SLB_POINT
BO_TRADE_OPEN_SECONDS=30
BO_RESULT_WAIT_SECONDS=30
BO_PAYOUT_RATIO=1.95
RAPID_SESSION_SECONDS=120
RAPID_ENTRY_OPEN_SECONDS=105
RAPID_RESULT_WAIT_SECONDS=15
PLATFORM_TREASURY_INITIAL_BALANCE=1000000
PLATFORM_TREASURY_RESERVE_FLOOR=0
MEMBER_INITIAL_POINT_BALANCE=1000

CRYPTO_MARKET_LIVE_ENABLED=true
CRYPTO_MARKET_CACHE_SECONDS=180
CRYPTO_MARKET_TIMEOUT_SECONDS=2.5
COINGECKO_API_URL=https://api.coingecko.com/api/v3/simple/price
COINGECKO_API_KEY=
BINANCE_API_URL=https://api.binance.com/api/v3/ticker/24hr

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=dautuquy888@gmail.com
SMTP_PASSWORD=<gmail app password, not gmail login password>
SMTP_FROM_EMAIL=dautuquy888@gmail.com
SMTP_USE_TLS=true
EMAIL_WEBHOOK_API_KEY=<secret for inbound email webhook>
```

This deployment does not require admin seed env variables. Create or update an admin account with `python scripts/create_admin.py --email <admin-email> --password "<strong-password>"`. `ADMIN_NOTIFICATION_EMAIL` is only the system/admin operations mailbox.

If Render still has old `ADMIN_SEED_EMAIL` or `ADMIN_SEED_PASSWORD` variables, delete them. The app ignores seed env and uses `scripts/create_admin.py` for admin accounts.

If you want Render to create/update an admin on startup, set:

```text
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_BOOTSTRAP_EMAIL=dautuquy888@gmail.com
ADMIN_BOOTSTRAP_PASSWORD=<strong admin password, at least 14 chars>
```

## API Keys

- Binance public ticker endpoint does not need an API key.
- CoinGecko works without a key for light demo traffic. For better quota, create a CoinGecko demo API key and set `COINGECKO_API_KEY`.
- Gmail SMTP: enable 2-Step Verification, create a Google App Password, and put that app password in `SMTP_PASSWORD`. Do not use or commit the Gmail login password.

## Current Runtime Limits

- BO and Rapid settlement are synchronous internal-point flows for demo UX.
- Account-level target win rate, exposure balancing, max liability guard and background timed settlement are not complete enterprise engines yet.
- Loss-deposit referral commission is automatic only after a downline member's realized loss reaches all approved deposited points.
- Real deposits, withdrawals, crypto transfer, KYC/AML, payment gateway and production gambling/financial compliance are not included.

## Render API Helper

If you have a Render API key, put it only in your local shell and run:

```powershell
$env:RENDER_API_KEY="<render api key>"
.\scripts\render_apply_env.ps1 -ServiceId "srv-d93hlhtaeets73dohu0g" -EnvFile ".env.render" -RemoveDeprecated -TriggerDeploy
```

Render SSH is useful for debugging a running service:

```bash
ssh srv-d93hlhtaeets73dohu0g@ssh.oregon.render.com
```

Persistent environment variables must be set in the Render Dashboard or via the Render API. SSH shell exports are temporary and will not survive deploys.
