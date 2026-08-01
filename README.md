# Guilua Communication Runtime

Guilua is the realtime communication runtime for Timeblock. It provides the browser/PWA surface, WebSocket session events, WebRTC signaling, participant lifecycle, reconnect foundations, translated-caption delivery, and runtime telemetry.

Timeblock remains the Control Plane and durable System of Record for identity, workspace membership, permission, entitlement, quota, glossary master, transcript, usage ledger, billing, audit, and retention.

## Zero-cost Render architecture

The foundation phase intentionally uses:

- one existing Render Standard Web Service;
- one instance and one Gunicorn/Uvicorn worker;
- one public port for HTTP and WebSocket;
- in-memory room, connection, sequence, and reconnect state;
- WebRTC peer-to-peer media for initial 1:1 calls;
- external async AI providers when configured.

It does not add Redis, Postgres, a background worker, cron service, private service, second web service, persistent disk, horizontal scaling, SFU, TURN, local Whisper, local LLM, GPU runtime, or media transcoding.

## Local run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open:

- `/` — Timeblock AI Communication landing page.
- `/communication` — responsive call/interpreter shell.
- `/ws/communication/{session_id}` — communication WebSocket.
- `/healthz/` — runtime health.

Development WebSocket sessions use the explicit mock token `development-session` until the Timeblock authorization contract is configured.

## Render commands

```text
Build Command: bash scripts/build_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /healthz/
```

Required production environment:

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<random secret, at least 32 characters>
PUBLIC_BASE_URL=https://guilua.onrender.com
TIMEBLOCK_API_URL=<Timeblock control-plane API>
TIMEBLOCK_API_KEY=<server credential>
ALLOWED_WEBSOCKET_ORIGINS=https://guilua.onrender.com
```

Runtime TTL settings are optional and have safe defaults:

```text
CONNECTION_STALE_SECONDS=120
RECONNECT_TOKEN_SECONDS=300
ENDED_SESSION_CACHE_SECONDS=600
IDEMPOTENCY_CACHE_SECONDS=1800
```

## Testing

```bash
python -m compileall app
PYTHONPATH=. pytest -q
```

The active test suite verifies the health endpoint, communication pages, removal of legacy routes, WebSocket authorization, heartbeat acknowledgement, duplicate-event rejection, and sequence validation.

## Production data

Legacy BO, rates, member, wallet, point, treasury, affiliate, referral, and settlement tables are not used by the new runtime. They are not dropped automatically in this refactor. See `docs/legacy-database-retirement.md` for the backup and destructive-migration gate.

## Known foundation limitations

- A Render restart loses in-memory runtime state.
- One worker does not support horizontal scaling.
- P2P calls can fail on strict NAT without TURN.
- Production sessions require real Timeblock API contracts and credentials.
- Speech, translation, and TTS providers are interfaces to be added after provider selection.
