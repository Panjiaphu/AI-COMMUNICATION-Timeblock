# Guilua Project Memory

Last verified update: 2026-07-30 (Asia/Taipei)

## Project identity

- Repository: `Panjiaphu/guilua`
- Baseline/current main SHA: `c6c83c60f190506afec21cfb750ee5acd5e27932`
- Archive branch: `archive/legacy-point-platform-before-communication-runtime`
- Working branch: `refactor/communication-runtime-foundation`
- Pull request: `#1` (open, draft, not merged)
- Render service: `srv-d93hlhtaeets73dohu0g`, Singapore
- Production deployment: unchanged and not verified through Render read access in this task

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

On 2026-07-30, `app/core/security.py` was also removed. It was a database-backed legacy auth module containing SQLAlchemy `Session`, `SessionLocal`, `User`, local login/logout, member/admin guards, password reset, email verification, admin bootstrap, and admin seed logic. It had no Communication Runtime consumer and referenced already-removed modules.

Historical Alembic files remain only as schema evidence and are not imported or executed by the runtime. Production tables have not been dropped.

## Validation evidence

### Historical reconstructed snapshot

`RECONSTRUCTED_SNAPSHOT_ONLY`: earlier local validation passed, but it is not the authoritative branch-ready evidence.

### Previous remote failures

- Run `30551878607`: full pytest collection failed because the legacy Django `odds` application remained.
- Run `30555948795`, job `90916310474`: legacy absence gate failed on `from sqlalchemy` in `app/core/security.py`; later steps were skipped.

### Remote code-head validation

Code head: `5031e02119cca5d2cd0a16fb7d7f2f014f0e46b3`

GitHub Actions run `30556647794`, job `90918702803`:

- legacy absence gate: passed;
- `python -m compileall app`: passed;
- `PYTHONPATH=. pytest -q`: `7 passed, 1 warning in 0.49s`;
- `python scripts/check_env.py --phase build`: passed;
- application import smoke: passed;
- workflow conclusion: `success`.

The warning is a Starlette/FastAPI TestClient deprecation warning and did not fail the workflow.

## Browser and WebRTC QA

- Browser plugin: not available in this session.
- Playwright Python package exists, but no Chromium executable is installed in the runtime.
- No browser dependency was installed because the closure instructions prohibit adding new browser dependencies without approval.
- Rendered browser QA: `NOT AVAILABLE`.
- Automated two-context WebRTC smoke: `NOT AVAILABLE`.
- Real-device WebRTC, strict NAT, TURN, and production-call QA: not verified.

## Production and database impact

- Production database changed: false.
- Destructive DDL run: false.
- Alembic run: false.
- Render deployed: false.
- Render plan changed: false.
- Production Render deployed SHA and health: not verified due lack of read-only Render connector/access.

## Remaining risks

- Timeblock endpoints remain provisional until the real contract is supplied.
- In-memory sessions are lost on Render restart.
- P2P can fail on strict NAT without TURN.
- Browser interaction and two-context WebRTC still require a browser-capable environment.
- STT, translation provider, captions pipeline, and TTS are outside this closure round.

## Decision log

### 2026-07-30 — Safe backup

Archive branch retained at the original main SHA because tag creation was not exposed by the connector.

### 2026-07-30 — Non-destructive cleanup

Application code was removed without accessing or mutating the production database. Destructive retirement remains a separate backup-gated migration.

### 2026-07-30 — Final legacy security residue

Deleted `app/core/security.py` rather than allowlisting it or restoring SQLAlchemy/passlib/itsdangerous. Timeblock remains the identity and authorization boundary.

### 2026-07-30 — CI closure evidence

GitHub Actions run `30556647794` validated the code head successfully. This memory update is documentation-only and triggers a final exact-head workflow before PR status is reported.
