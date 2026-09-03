# Guilua Timeblock AI Assistant

Guilua is the standalone Timeblock AI Assistant PWA. Its root surface provides the AI workspace, Timeblock-authoritative messaging entry points, notifications, translation hand-off, and deep links while retaining the existing realtime communication runtime at `/communication`.

Timeblock remains the platform identity source and the authority for the
protected Direct 1:1 compatibility contracts. Group Communication is owned
end to end by this repository.

## Current phase

The canonical Assistant UI snapshot is vendored from
`Panjiaphu/fumap-bot-life@340568bbf54528a6a0ae2eb3c06db1d69441f4cd`.
Its templates, static assets, runtime asset graph and vi / zh-TW / en resources
are present locally. For this candidate, `UI_PARITY=LOCAL_QA_PASS` means the
canonical snapshot and its local runtime adapters passed the bounded local
pytest, JavaScript syntax, Chromium and WebKit gates recorded in
`docs/phase-status.md`; it is not a merge, Render deployment or
production-live claim.

The same-origin BFF registers 120 explicit method/path route specifications for
the canonical Assistant, messaging/contact/events, Call V1, Live Translate,
internal-message and notification/settings APIs. It has no catch-all proxy.
For Direct 1:1 compatibility, Timeblock owns identity, profile and the existing
Client Contract V2 data. For Group, AI-COMMUNICATION owns the UI, membership,
authorization, durable records and provider runtime. The BFF stores only an
opaque browser cookie plus the server-side Timeblock identity credential.

`CAPABILITY_PARITY=BLOCKED_BY_TIMEBLOCK_CONTRACT_V2`: production capability
parity still requires the Timeblock Client Contract V2 principal/session
middleware and endpoints to be merged and deployed on the Timeblock control
plane, followed by paired configuration and end-to-end QA. No Render/live state
is asserted by this repository snapshot.

The root `/` route is the authenticated Timeblock AI Communication PWA. It
must expose Direct and Group navigation without requiring users to know a
`/communication?surface=...` URL. `/communication` remains an internal and
compatibility route; `/ai`, `/translate`, `/notifications`,
`/conversations/<id>`, and `/calls/<id>` remain supported deep links.

For Group Communication V3, AI-COMMUNICATION is the sole product and durable
data owner for membership, authorization, messages, history, media results,
Radio history, translation records, usage, audit and retention. AI PostgreSQL
is canonical; Valkey and LiveKit hold only their bounded ephemeral runtime
state. Timeblock supplies one launcher and a one-time identity handoff only.

The Timeblock Communication Contract V1 remains the compatibility contract for
the existing `/communication` WebRTC runtime. The current Assistant release
boundary is Client Contract V2: authenticated canonical API coverage plus the
`/api/guilua/v2/capabilities` manifest required by `/readyz/`.

The historical Phase 2A compatibility flow uses this production-safe session
boundary:

1. an authenticated Timeblock browser calls its existing `/api/communication/bootstrap` endpoint;
2. Timeblock opens or embeds token-free Guilua `/communication`;
3. Timeblock hands the bootstrap credential to Guilua with exact-origin `postMessage` using `timeblock.communication.handoff.v1`;
4. Guilua keeps the credential in browser memory and opens `/ws/communication/{session_id}` with no secret query parameter;
5. the first WebSocket frame is typed `session.authenticate`;
6. Guilua calls Timeblock authorize/refresh server-to-server and creates runtime participant state only after authorization succeeds.

The Guilua receiver is implemented in this repository. The corresponding Timeblock browser sender remains a cross-repository integration dependency until it is added to `Panjiaphu/fumap-bot-life`.

The current hardening candidate also includes a source-locked local vendor of
the Timeblock Communication presentation layer, a unique `Timeblock Chat` PWA
manifest, and a static-shell-only service worker. A standalone launch never
restores a session credential; it waits for a fresh exact-origin handoff.

The canonical Messaging Core V2 and call/translation UI code is present, but it
is not enabled against fake authority or durable local data. Its same-origin
capability calls fail closed until the Timeblock-owned Client Contract V2 is
available to authenticate the forwarded client session.

## Render architecture

The Direct foundation uses:

- one existing Render Web Service;
- one instance and one Gunicorn/Uvicorn worker;
- one public port for HTTP and WebSocket;
- in-memory room, connection, sequence, and reconnect state;
- WebRTC peer-to-peer media for initial 1:1 calls;
- external async AI providers only when configured.

Group V3 reuses the existing Render PostgreSQL, Key Value/Valkey, LiveKit and
server-side OpenAI resources. It does not add a new paid service. PostgreSQL is
the canonical Group store; Valkey is ephemeral Radio floor coordination and
LiveKit is ephemeral media state.

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
- `/ws/communication/{session_id}` — token-free communication WebSocket; authentication is the first frame.
- `/healthz/` — process liveness only.
- `/readyz/` — dependency/configuration readiness only; it is not product PASS.

For explicit local/test fallback, the browser QA may supply only `session` and `participant` query values. Guilua creates the static `development-session` credential internally. Production configuration rejects this fallback and never reads a session credential from the page URL.

## Render commands

```text
Build Command: bash scripts/build_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /readyz/
```

Required production environment:

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<random secret, at least 32 characters>
PUBLIC_BASE_URL=https://guilua.onrender.com
TIMEBLOCK_API_URL=<Timeblock control-plane API>
TIMEBLOCK_APP_URL=https://timeblock-commercial-pro.onrender.com
TIMEBLOCK_API_KEY=<server credential, at least 32 bytes>
ALLOW_DEVELOPMENT_SESSION_FALLBACK=false
ALLOW_MISSING_BFF_ORIGIN=false
ALLOWED_TIMEBLOCK_HANDOFF_ORIGINS=https://timeblock-commercial-pro.onrender.com,https://fumapgo.com
ALLOWED_WEBSOCKET_ORIGINS=https://guilua.onrender.com
ALLOW_MISSING_WEBSOCKET_ORIGIN=false
WEBSOCKET_AUTH_TIMEOUT_SECONDS=5
MAX_AUTH_EVENT_BYTES=16384
```

Runtime TTL settings are optional and have safe defaults:

```text
CONNECTION_STALE_SECONDS=120
RECONNECT_TOKEN_SECONDS=300
ENDED_SESSION_CACHE_SECONDS=600
IDEMPOTENCY_CACHE_SECONDS=1800
```

## Security boundary

- No Timeblock session token or Guilua reconnect token belongs in a page or WebSocket URL.
- The Timeblock session credential is memory-only in the Guilua browser runtime.
- Browser handoff uses an exact origin allowlist; wildcard origins are not supported.
- WebSocket Origin is validated before the unauthenticated socket is accepted for useful traffic.
- The unauthenticated socket has a bounded authentication timeout and authentication-frame size.
- It receives no room snapshot before successful Timeblock authorization.
- Guilua does not trust browser-supplied workspace, role, membership, entitlement, or quota data.

See `docs/timeblock-control-plane-contract.md` for the exact Contract V1 boundary and sender specification.

## Testing

```bash
pwsh -File scripts/local_full_qa.ps1
```

Historical local QA evidence is not reusable for Group V3 closure. P0-P5 are
implementation-only; P6 is one final QA run bound to the exact staged trees.
Any source change after P6 begins invalidates that evidence.

Hosted browser QA is not a claim of physical iOS/Android validation.

## Production data

Legacy BO, rates, member, wallet, point, treasury, affiliate, referral, and settlement tables are not used by the new runtime. They are not dropped automatically in this refactor. See `docs/legacy-database-retirement.md` for the backup and destructive-migration gate.

## Known limitations

- A Render restart loses in-memory runtime state.
- One worker does not support horizontal scaling.
- P2P calls can fail on strict NAT without TURN.
- Physical-device and strict-NAT validation remain separate gates.
- Provider-backed STT/translation/TTS execution, consent, FINAL results, Group
  usage, audit and retention are AI-COMMUNICATION-owned and still require
  paired live acceptance.
- The local canonical BFF compatibility layer is implemented, but production
  capability parity remains blocked until Timeblock Client Contract V2 is
  merged, configured and deployed; see `docs/phase-status.md`.
