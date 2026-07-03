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
PUBLIC_BASE_URL=https://fumap-line-webhook.onrender.com
```

## Admin and Email

Use separate values for login seed and system mailbox:

```text
ADMIN_NOTIFICATION_EMAIL=dautuquy888@gmail.com
ADMIN_LINE_ID=@827sxbki
ADMIN_PHONE=0906938893
ADMIN_SEED_EMAIL=admin@guilua.local
ADMIN_SEED_PASSWORD=<strong admin password, at least 14 characters>
```

`ADMIN_SEED_EMAIL` creates the first admin login only. `ADMIN_NOTIFICATION_EMAIL` is used for admin notifications and email ops.

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

## SLBo Sandbox Env

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
```

Keep all `REAL_*` flags false until legal, licensing, payment, custody, audit and operational controls are complete.

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

## Google AdSense

Create or log in at <https://adsense.google.com/>:

1. Add the Render site URL.
2. Copy the `ca-pub-...` client value to `GOOGLE_ADSENSE_CLIENT`.
3. Create an ad unit and copy the slot id to `GOOGLE_ADSENSE_SLOT`.
4. Copy the publisher id `pub-...` to `GOOGLE_ADSENSE_PUBLISHER_ID`.
5. If Google asks for site verification meta, set `GOOGLE_SITE_VERIFICATION`.

```text
GOOGLE_ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx
GOOGLE_ADSENSE_SLOT=<ad slot id>
GOOGLE_ADSENSE_PUBLISHER_ID=pub-xxxxxxxxxxxxxxxx
GOOGLE_SITE_VERIFICATION=<token>
```

The app injects the AdSense script when `GOOGLE_ADSENSE_CLIENT` is configured and serves `/ads.txt` from `GOOGLE_ADSENSE_PUBLISHER_ID`.

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
