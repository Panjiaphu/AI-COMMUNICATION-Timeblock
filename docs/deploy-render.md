# Render Deploy Guide

## Commands

```text
Build Command: bash scripts/build_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /healthz/
```

## Minimum Production Env

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<random secret, at least 32 characters>
USE_SQLITE=true
SESSION_COOKIE_SECURE=true
RUN_MIGRATIONS_DURING_BUILD=false
PUBLIC_BASE_URL=https://guilua.onrender.com
```

## Admin and Email

This deployment does not use admin seed env variables. Create or update an admin login from Render Shell or a connected local database with:

```bash
python scripts/create_admin.py --email <admin-email> --password "<strong-password>"
```

System mailbox:

```text
ADMIN_NOTIFICATION_EMAIL=dautuquy888@gmail.com
ADMIN_LINE_ID=@827sxbki
```

`ADMIN_NOTIFICATION_EMAIL` is used for admin notifications and email ops. It is not the admin login seed.

Remove these deprecated variables from Render if they still exist:

```text
ADMIN_SEED_EMAIL
ADMIN_SEED_PASSWORD
```

Gmail SMTP:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=dautuquy888@gmail.com
SMTP_PASSWORD=<google app password>
SMTP_FROM_EMAIL=dautuquy888@gmail.com
SMTP_USE_TLS=true
EMAIL_WEBHOOK_API_KEY=<secret string>
```

Do not use the Gmail login password. In Google Account, enable 2-Step Verification, open Security > App passwords, create an app password for Mail, then paste that generated value into `SMTP_PASSWORD`.

## SLBo Runtime Guard Env

```text
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
MEMBER_INITIAL_POINT_BALANCE=1000
```

Keep all `REAL_*` flags false for this internal-point deployment. These are backend guardrails and are not shown in the public UI.

## Market Data

```text
CRYPTO_MARKET_LIVE_ENABLED=true
CRYPTO_MARKET_CACHE_SECONDS=180
CRYPTO_MARKET_TIMEOUT_SECONDS=2.5
COINGECKO_API_URL=https://api.coingecko.com/api/v3/simple/price
COINGECKO_API_KEY=
BINANCE_API_URL=https://api.binance.com/api/v3/ticker/24hr
```

How to get keys:

- Binance public prices: no API key is needed for the public ticker endpoint used by this app.
- CoinGecko: go to CoinGecko API, create a Demo API key, then set `COINGECKO_API_KEY`. It is optional but helps quota.

## Ads

This deployment does not use Google AdSense. Do not set `GOOGLE_ADSENSE_*` variables for this service. `/ads.txt` is intentionally disabled.

## Database

SQLite is acceptable for quick Render smoke/demo:

```text
USE_SQLITE=true
```

For durable production-like data, create Render PostgreSQL and set:

```text
USE_SQLITE=false
DATABASE_URL=<internal PostgreSQL connection string>
RUN_MIGRATIONS_DURING_BUILD=false
```

`scripts/start_render.sh` runs `alembic upgrade head` on startup.

## Apply Env by Render API

Create an API key in Render Account Settings, then run locally:

```powershell
$env:RENDER_API_KEY="<render api key>"
.\scripts\render_apply_env.ps1 -ServiceId "srv-d93hlhtaeets73dohu0g" -EnvFile ".env.render" -RemoveDeprecated -TriggerDeploy
```

The helper uses Render API endpoints to add/update service env vars, remove deprecated ad/phone vars, and trigger a deploy. Without `RENDER_API_KEY` or `RENDER_API_TOKEN`, use Dashboard > Environment > Add from .env, then choose **Save, rebuild, and deploy**.

SSH is only for debug shell access:

```bash
ssh srv-d93hlhtaeets73dohu0g@ssh.oregon.render.com
```

Do not rely on SSH `export` commands for production env. They are temporary.
