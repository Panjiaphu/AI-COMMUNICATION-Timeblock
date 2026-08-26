# AI-COMMUNICATION Render release guide

## Release boundary

This guide applies only to the existing AI-COMMUNICATION Web Service
`srv-d93hlhtaeets73dohu0g` (`https://guilua.onrender.com`). It does not
authorize a Timeblock deployment, a paid-plan change, or a database mutation.
The Blueprint service name must remain exactly `AI-COMMUNICATION-Timeblock` so
it cannot be mistaken for a request to create a second `guilua` service.

The AI service is deliberately fail-closed. Do not trigger a deployment while
the live Timeblock control plane cannot return the authenticated Client
Contract V2 capability manifest at `/api/guilua/v2/capabilities`; the AI
`/readyz/` endpoint will return 503 and Render will reject the candidate.

## Service commands

```text
Build Command: bash scripts/build_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /readyz/
Auto deploy: off
Plan: starter
```

The build verifies the production environment, the 214-source /
420-destination canonical source lock, and Python compilation before Render can
start the process. `/healthz/` is process liveness only; `/readyz/` is the
release gate and requires Timeblock Client Contract V2.

Render supplies `RENDER_GIT_COMMIT` automatically at runtime. The application
uses it as `deployment_version`, and the production environment gate rejects a
missing or non-hexadecimal deploy identity. Do not manually pin
`RENDER_GIT_COMMIT`; for a non-Render production runtime, set
`DEPLOYMENT_VERSION` to the exact deployed commit SHA instead.

## Required production environment

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<random secret, at least 32 characters>
PUBLIC_BASE_URL=https://guilua.onrender.com
TIMEBLOCK_APP_URL=https://timeblock-commercial-pro.onrender.com
TIMEBLOCK_API_URL=https://timeblock-commercial-pro.onrender.com
TIMEBLOCK_API_KEY=<shared server credential, at least 32 bytes>
GUILUA_CLIENT_ID=guilua
GUILUA_SESSION_COOKIE=guilua_session
GUILUA_PENDING_AUTHORIZATION_COOKIE=guilua_auth_nonce
GUILUA_SESSION_TTL_SECONDS=14400
GUILUA_PENDING_AUTHORIZATION_TTL_SECONDS=120
GUILUA_SESSION_MAX_ENTRIES=10000
GUILUA_PENDING_AUTHORIZATION_MAX_ENTRIES=2000
GUILUA_AUTHORIZATION_START_RATE_LIMIT_COUNT=12
GUILUA_AUTHORIZATION_START_RATE_LIMIT_WINDOW_SECONDS=60
TIMEBLOCK_TIMEOUT_SECONDS=5
TIMEBLOCK_PROXY_TIMEOUT_SECONDS=120
ALLOW_DEVELOPMENT_SESSION_FALLBACK=false
ALLOW_MISSING_BFF_ORIGIN=false
MESSAGING_REALTIME_ENABLED=true
MESSAGING_MAILBOX_LOCK_ENABLED=true
MESSAGING_ADVANCED_ATTACHMENTS_ENABLED=true
ALLOWED_TIMEBLOCK_HANDOFF_ORIGINS=https://timeblock-commercial-pro.onrender.com,https://fumapgo.com
ALLOWED_WEBSOCKET_ORIGINS=https://guilua.onrender.com
ALLOW_MISSING_WEBSOCKET_ORIGIN=false
WEBSOCKET_AUTH_TIMEOUT_SECONDS=5
MAX_AUTH_EVENT_BYTES=16384
CONNECTION_STALE_SECONDS=120
RECONNECT_TOKEN_SECONDS=300
ENDED_SESSION_CACHE_SECONDS=600
IDEMPOTENCY_CACHE_SECONDS=1800
```

`SECRET_KEY` and `TIMEBLOCK_API_KEY` are secret values. Record only whether
they are configured; never copy their values into logs, commits, PRs, or
reports. The shared API key must be configured on both services before paired
acceptance.

Legacy admin, SMTP, SLBo/BO, market-data, wallet, member, SQLite/Postgres and
Alembic variables are not part of this runtime. Remove them from this service
rather than carrying them into the Assistant release.

## Exact-release procedure

1. Record the current AI service configuration, environment key names, deploy
   ID, live commit SHA and previous known-good deploy for rollback.
2. Confirm the candidate is committed, pushed, reviewed through protected
   `main`, and identify the exact commit Render must build.
3. Confirm the live Timeblock service exposes Client Contract V2 with
   `contract_version=2` and `authority=timeblock` using server-side
   authentication. Do not expose the key in a browser request.
4. Reconcile the required environment variables without printing secret
   values. Keep auto-deploy off and keep the existing Starter plan unless the
   user separately authorizes a paid-plan change.
5. Trigger a manual deploy for the exact approved AI commit only.
6. Verify the Render deploy ID and deployed commit SHA, then inspect build and
   runtime logs for source-lock, environment, startup, dependency and health
   failures.
7. Verify `/healthz/` returns process liveness and `/readyz/` returns 200 with
   Contract V2 and reports the same SHA as Render's deployed commit. Then run
   authenticated desktop/mobile Assistant, messaging, notification,
   translation and call smoke checks against the exact deploy.

## Rollback

If the exact candidate fails, redeploy the recorded previous known-good AI SHA
and restore only the environment snapshot captured before release. This
Assistant release has no database migration or persistent-disk mutation.
Rollback of AI-COMMUNICATION does not authorize rolling back Timeblock.
