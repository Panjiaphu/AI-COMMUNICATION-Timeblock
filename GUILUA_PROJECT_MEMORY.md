# Guilua Project Memory

Last verified update: 2026-07-31 (Asia/Taipei)

## Project identity

- Repository: `Panjiaphu/guilua`
- Baseline/current main SHA: `c6c83c60f190506afec21cfb750ee5acd5e27932`
- Archive branch: `archive/legacy-point-platform-before-communication-runtime` at the same baseline
- Working branch: `refactor/communication-runtime-foundation`
- Validated Communication Runtime code head: `f07f80ceb4d5cc972ed7dd855413f1e49e334fa1`
- Pull request: `#1` (open, draft, mergeable, not merged)
- Render service: `srv-d93hlhtaeets73dohu0g`, Singapore
- Production deployment: unchanged; deployed SHA and health were not verified through Render read access in this closure

## Locked architecture

Guilua is the ephemeral realtime communication runtime for Timeblock: one existing Render Standard Web Service, one instance, one Gunicorn/Uvicorn worker, HTTP and WebSocket on one public port, in-memory runtime state, and WebRTC P2P for initial 1:1 calls.

Do not add Redis, Postgres, workers, cron, persistent disk, a second service, horizontal scaling, SFU/MCU, dedicated TURN, local Whisper/LLM, GPU, or media transcoding during the foundation phase. Timeblock owns durable identity, workspace, permission, entitlement, transcript, usage, billing, audit, and retention data.

## Implemented runtime foundation

- FastAPI app factory and lifespan-managed `RoomManager`.
- `/`, `/communication`, `/healthz/`, and `/ws/communication/{session_id}`.
- `RoomState`, `ParticipantState`, `ConnectionState`, and `ReconnectState`.
- Settings-driven stale, reconnect, ended-room, and idempotency TTLs.
- Event allowlist and typed payload validation.
- Participant/connection/session binding, duplicate and out-of-order protection.
- Per-connection in-memory rate limits.
- Production origin fail-closed policy.
- One-time reconnect token hashing, expiry, rotation, and participant replacement.
- Targeted offer, answer, and ICE forwarding for a maximum of two participants.
- Browser WebSocket, `RTCPeerConnection`, ICE queue, remote-stream assignment, bounded reconnect backoff, and cleanup paths.
- Provisional typed Timeblock boundary: authorize, refresh, glossary, session result, and usage callbacks with idempotency keys.

## Legacy removal

Removed active BO/SLBO, Rapid, rates, crypto dashboard, old admin/member/auth, wallets/points/transfers/treasury, referral/commission, Django `odds`, database models/session, legacy services, templates, tests, and static assets.

`app/core/security.py` was removed because it was a database-backed legacy auth module with no Communication Runtime consumer. Historical Alembic files remain only as schema evidence and are not imported or executed by the runtime. Production tables have not been dropped.

## Browser, WebRTC, and logging closure

Validated code commits:

- `e3df7501a100f8990951c5bae4633fd202db7eec` — responsive geometry, rejected-authorization media cleanup, reconnect peer reset, structured Gunicorn logs, exact-head artifact identity, privacy/completeness gates, and expanded browser evidence.
- `f07f80ceb4d5cc972ed7dd855413f1e49e334fa1` — reconnect browser test now waits for protocol evidence `session.authorized(reconnected=true)` instead of requiring the transient `Reconnected` label.

Closure behavior now includes:

- responsive desktop, tablet, mobile portrait, and mobile landscape geometry assertions;
- interpreter `expanded`, `collapsed`, and `hidden` interaction checks;
- caption, interpreter, local-preview, and call-control non-overlap checks;
- initial WebSocket authorization rejection stops local tracks, closes peers, clears timers, and resets controls;
- reconnect closes the stale peer, rotates connection/reconnect state, renegotiates offer/answer/ICE, and restores decoded remote audio/video;
- third participant is rejected without disrupting the existing call and its local media is stopped;
- end-call cleanup closes WebSockets and peers and ends local/remote tracks;
- application, Uvicorn, and Gunicorn lifecycle logs use one allowlisted JSON object per line;
- WebSocket request targets are sanitized and raw session/reconnect tokens, SDP, and ICE candidates are excluded from artifacts;
- browser artifacts are accepted only when checked-out SHA, deployment version, and expected PR head are identical.

## Exact-head validation evidence

### Communication Runtime workflow

- Commit: `f07f80ceb4d5cc972ed7dd855413f1e49e334fa1`
- GitHub Actions run: `30607269845`
- Job: `91082076396`
- Conclusion: `success`
- Legacy runtime absence gate: passed
- `python -m compileall app`: passed
- `PYTHONPATH=. pytest -q`: `17 passed, 2 skipped, 1 warning in 0.70s`
- Build environment check: passed
- Application import smoke: passed
- Warning: FastAPI/Starlette TestClient deprecation warning; it did not fail the workflow

### Communication Browser QA workflow

- Commit: `f07f80ceb4d5cc972ed7dd855413f1e49e334fa1`
- GitHub Actions run: `30607270158`
- Job: `91082077398`
- Conclusion: `success`
- Exact checkout identity gate: passed
- Browser test JUnit: `12 tests`, `0 failures`, `0 errors`, `0 skipped`
- Playwright: `1.61.0`
- Chromium: `149.0.7827.55`
- WebKit: `26.5`
- Physical device: false
- Fake media: true
- Artifact privacy and completeness gate: passed
- Artifact upload: passed

Artifact:

- ID: `8784077659`
- Name: `communication-browser-qa-f07f80ceb4d5cc972ed7dd855413f1e49e334fa1`
- GitHub artifact digest: `sha256:4a4918c95b07196b88303d223e4f6b1adefa08842449cf21a1bb17262c371907`
- Retention expiry: 2026-08-14

Direct artifact inspection verified:

- `build-identity.json` records expected PR head, checked-out SHA, and deployment version as `f07f80ceb4d5cc972ed7dd855413f1e49e334fa1`;
- all eight required viewport evidence files report no horizontal overflow, every required box inside the viewport, and every tested intersection as false;
- Chromium and WebKit mobile screenshots render the communication surface without visible control/caption/interpreter overlap;
- fake-media permission grant, synthetic permission denial, two-context offer/answer/ICE, reconnect recovery, third-participant rejection, and final cleanup evidence are present;
- reconnect evidence contains one active non-closed peer per participant, one live remote audio track, one live remote video track, decoded video dimensions, hidden placeholder, no duplicate remote track IDs, zero active reconnect timers, and one reconnect-token rotation for the reconnecting participant;
- rejected third-participant evidence contains two ended local tracks, no active peer, no local video tracks, and no active timer;
- `server.log` contains 31 non-empty lines, all valid allowlisted JSON objects, zero plaintext lines, zero privacy-pattern violations, and redacted WebSocket query tokens.

## Production and database impact

- Production database changed: false
- Destructive DDL run: false
- Alembic run: false
- Render deployed or restarted: false
- Render plan changed: false
- Render environment variables changed: false
- Production Render deployed SHA, health, and real traffic: not verified

## Remaining risks and unknowns

- Timeblock endpoint paths and schemas remain `PROVISIONAL_CONTRACT` until supplied or approved by the Timeblock control-plane team.
- In-memory sessions are lost on Render restart.
- WebRTC P2P can fail on strict NAT without TURN.
- Automated QA used hosted Chromium/WebKit with fake media, not physical devices.
- Real-device WebRTC, strict-NAT/TURN, long-call behavior, network handoff, screen lock, and production-call traffic remain unverified.
- STT, translation provider, captions pipeline, glossary fallback, TTS, durable result callbacks, and usage retry orchestration are outside this foundation closure.

## Decision log

### 2026-07-30 — Safe backup

Archive branch retained at the original main SHA because tag creation was not exposed by the connector.

### 2026-07-30 — Non-destructive cleanup

Application code was removed without accessing or mutating the production database. Destructive retirement remains a separate backup-gated migration.

### 2026-07-30 — Final legacy security residue

Deleted `app/core/security.py` rather than allowlisting it or restoring SQLAlchemy/passlib/itsdangerous. Timeblock remains the identity and authorization boundary.

### 2026-07-31 — Browser and WebRTC evidence gate

Added exact-head browser QA with required responsive screenshots, traces, JUnit, reconnect evidence, third-participant cleanup, and privacy-safe structured logs. Workflow success alone is insufficient; artifact completeness and identity must also pass.

### 2026-07-31 — Reconnect assertion semantics

Reconnect completion is proven by `session.authorized` with `reconnected=true`, connection/reconnect-token rotation, participant notification, renewed offer/answer/ICE, and usable decoded remote media. The transient UI label is not treated as the protocol source of truth.

## Current review state

The Communication Runtime foundation is ready for human code review based on exact-head automated evidence. Keep PR #1 as draft until review. Do not merge or deploy as part of this closure task.

## Next action

Perform human code review of PR #1, with particular attention to the provisional Timeblock contract and acceptance of the documented zero-cost operational limitations. Production deployment remains a separate explicitly approved action.
