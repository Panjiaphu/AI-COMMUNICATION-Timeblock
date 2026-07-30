# Guilua Project Memory

Last verified update: 2026-07-30 (Asia/Taipei)

## Project identity

- Repository: `Panjiaphu/guilua`
- Baseline main SHA: `c6c83c60f190506afec21cfb750ee5acd5e27932`
- Backup branch: `archive/legacy-point-platform-before-communication-runtime`
- Working branch: `refactor/communication-runtime-foundation`
- Render service: `srv-d93hlhtaeets73dohu0g`
- Render region: Singapore
- Production deployment: unchanged by this branch

## Locked architecture

Guilua is the ephemeral realtime communication runtime for Timeblock.

Foundation constraints:

- one existing Render Standard Web Service;
- one instance and one Gunicorn/Uvicorn worker;
- HTTP and WebSocket on one public port;
- in-memory room, connection, sequence, idempotency, and reconnect state;
- WebRTC P2P for initial 1:1 media;
- no Redis, new Postgres, background worker, cron, persistent disk, private service, second web service, horizontal scaling, SFU, dedicated TURN, local Whisper/LLM, GPU, or transcoding.

Timeblock owns identity, workspace, membership, permission, entitlement, quota, glossary master, durable transcript, official usage, billing, audit, and retention.

## Verified changes on the working branch

### Runtime foundation

- Replaced the old application entrypoint with FastAPI lifespan and in-memory cleanup.
- Added `/`, `/communication`, `/healthz/`, and `/ws/communication/{session_id}`.
- Added versioned event envelopes and room/connection state.
- Added duplicate-event, out-of-order sequence, participant binding, origin, heartbeat, and stale-connection foundations.
- Added an explicit `TimeblockClient` authorization and result-callback boundary.
- Development mock authorization accepts only `development-session` when no Timeblock API is configured.
- Added responsive Timeblock landing and communication call shell.
- Added interpreter panel states `hidden`, `collapsed`, and `expanded`.
- Added microphone/camera permission handling and media-track cleanup.

### Legacy runtime removal

Removed router files for BO/SLBO, Rapid, member, point transfer, legacy auth, admin dashboards, member verification, rates/public content, content agent, and old webhooks.

Removed the principal BO, Rapid, and crypto templates.

Removed legacy application database models and SQLAlchemy session runtime.

Removed core SLBO, delayed settlement, direct transfer, settlement guard, and exchange-rate services.

Removed SQLAlchemy, Alembic, PostgreSQL, Django, Pillow, QR, password, and multipart dependencies from the active runtime requirements.

### Render

- Retained one Standard web service.
- Start command now explicitly uses one Gunicorn/Uvicorn worker.
- Build and startup no longer execute Alembic or database migration logic.
- Render blueprint contains only Communication Runtime and Timeblock settings.

## Validation evidence

A reconstructed snapshot of the authored runtime was validated in the available container because direct GitHub clone was blocked by DNS.

Commands:

```text
python -m compileall app
PYTHONPATH=. pytest -q
```

Results:

- compileall: passed
- pytest: 4 passed

Covered: health, new UI, legacy 404 routes, WebSocket authorization, heartbeat acknowledgement, duplicate-event rejection.

Limitation: this validates the new runtime files, not every unmodified historical file still present in the remote repository.

## Production database impact

No production database connection, migration, table drop, enum drop, or data mutation was performed.

Historical Alembic migrations remain as schema evidence. Destructive retirement requires a verified backup and separate approved migration. See `docs/legacy-database-retirement.md`.

## Known incomplete cleanup

Repository-wide physical deletion is not complete yet. Inactive historical files may still remain under:

- `app/services/` legacy SLBO/referral/commercial/security helpers;
- `app/templates/admin/`, `app/templates/member/`, and `app/templates/auth/`;
- legacy static BO assets;
- historical Alembic migrations;
- the old `odds/` Django application;
- old deployment/helper scripts and documentation not imported by the runtime.

These files are not registered or imported by `app.main`, but they must be classified and deleted or retained as archive evidence before declaring the repository fully clean.

## Risks and unknowns

- Timeblock authorization and result callback paths are provisional until the real contract is supplied.
- Speech-to-text, translation, captions, and TTS provider implementations are not added yet.
- A Render restart loses in-memory room state.
- P2P can fail on strict NAT without TURN.
- Browser end-to-end WebRTC signaling has not yet been exercised between two real devices.
- Production Render environment and deployed SHA have not been changed or verified through SSH in this task.

## Decision log

### 2026-07-30 — Safe backup

Created an archive branch at the original main SHA because the available GitHub connector does not expose tag creation.

### 2026-07-30 — Foundation refactor

Removed all legacy router registration and import-time database behavior before physical deletion of production schema.

### 2026-07-30 — Non-destructive database policy

Kept historical migrations and production tables untouched. Destructive cleanup is deferred to a separate backup-gated migration.
