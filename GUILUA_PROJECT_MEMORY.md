# Guilua Project Memory

Last verified update: 2026-07-31 (Asia/Taipei)

## Project identity

- Canonical repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`.
- Legacy alias: `Panjiaphu/guilua`.
- Baseline/current main SHA: `c6c83c60f190506afec21cfb750ee5acd5e27932`.
- Foundation branch: `refactor/communication-runtime-foundation`.
- Pull request: `#1`, open, draft, mergeable, not merged.
- P1 remediation starting head: `201c7b1e291ca4f80aab6b7c95983ba7c9b09ee4`.
- Technical self-audit review ID: `4828674968`.
- Render service: `srv-d93hlhtaeets73dohu0g`, Singapore.

## Locked architecture

Guilua is the ephemeral realtime Communication Runtime for Timeblock. Timeblock remains the identity, workspace, authorization, entitlement, glossary, durable result, usage, billing, audit, and retention authority.

Preserve one existing Render Standard Web Service, one instance, one Gunicorn/Uvicorn worker, HTTP and WebSocket on one public port, in-memory runtime state, and WebRTC P2P for initial 1:1 calls. Do not add Redis, Postgres, workers, cron, persistent disk, a second service, horizontal scaling, SFU/MCU, dedicated TURN, local AI, GPU, or media transcoding in the foundation phase.

## Foundation history

The foundation removed active BO/SLBO, Rapid, rates, crypto dashboard, old admin/member/auth, wallets, points, transfers, treasury, referral, commission, Django odds, database models/session, legacy services, templates, tests, and static assets without dropping production tables.

The pre-remediation exact-head evidence for `201c7b1e291ca4f80aab6b7c95983ba7c9b09ee4` is historical after source changes:

- Runtime run/job: `30607539178 / 91082917263`, success.
- Browser run/job: `30607539138 / 91082917754`, success.
- Artifact: `8784174718`.
- Digest: `sha256:f96b2deca1362705f05df2db9261bd3776f2d4e9e2e0e09f68192baf84b21501`.
- JUnit: 12 tests, 0 failures/errors/skips.
- Hosted Chromium/WebKit with fake media; physical device false.

These runs are `HISTORICAL — NOT NEW-HEAD EVIDENCE`.

## 2026-07-31 P1 technical self-audit

Review `4828674968` identified four P1 findings:

1. Development authorization fallback could run under production-classified `DEBUG=false` settings.
2. Timeblock authorize/refresh responses were not rebound to requested session and participant identity.
3. Reconnect exhaustion changed only visual status and left media/peer/socket state active.
4. One-sided `session.ended` did not terminally clean the remaining participant.

## P1 remediation behavior

The remediation commit is pending exact-head CI and must not be described as verified until both workflows finish.

- Added explicit `ALLOW_DEVELOPMENT_SESSION_FALLBACK`, default false.
- Fallback requires non-production classification, development/test environment, explicit opt-in, and absent Timeblock API URL.
- Production-classified settings reject fallback opt-in.
- Timeblock authorization responses fail closed with `authorization_boundary_mismatch` when session or participant differs from the request.
- Existing RoomManager room/workspace boundary checks remain authoritative on reconnect.
- Reconnect exhaustion now uses terminal cleanup: no seventh retry, socket/peer/timers/tracks cleared, controls recovered, Start re-enabled.
- Server broadcasts a server-owned `session.ended` event before sender disconnect.
- Remote participant performs terminal cleanup without echoing `session.ended`.

## Files in remediation scope

- `app/core/config.py`
- `app/integrations/timeblock/client.py`
- `app/communication/router.py`
- `app/static/communication.js`
- `scripts/check_env.py`
- `scripts/check_browser_artifacts.py`
- `.env.example`
- `.env.render.example`
- `.github/workflows/communication-browser-qa.yml`
- `tests/test_communication_runtime.py`
- `tests/test_p1_remediation.py`
- `tests/browser/support.py`
- `tests/browser/test_p1_remediation.py`
- `GUILUA_PROJECT_MEMORY.md`

## Remediation tests

Runtime/default suite adds coverage for explicit fallback, production-classified fallback rejection, session/participant response mismatch, room/workspace mismatch on refresh, no residual manager state after rejected authorization, terminal event delivery, ended-room join rejection, and leave-versus-end behavior.

Browser suite adds deterministic reconnect exhaustion cleanup/restart evidence and one-sided remote hangup cleanup evidence while retaining existing responsive geometry, interpreter states, successful reconnect, third-participant rejection, media permission, logging, and privacy gates.

## Current gates

- P1 remediation source: `IMPLEMENTED — CI PENDING`.
- New exact-head Runtime CI: `PENDING`.
- New exact-head Browser QA: `PENDING`.
- Contract V1: `BLOCKED`.
- External independent review: `REQUIRED`.
- Unified UI implementation: `NOT AUTHORIZED`.
- Physical-device QA: `NOT VERIFIED`.
- Production deployment: `NOT AUTHORIZED`.

## Production and database impact

- Render deployed or restarted: false.
- Render environment changed: false.
- Production database accessed or changed: false.
- Migrations or DDL run: false.
- Infrastructure model changed: false.

## Next action

Complete exact-head Runtime and Browser QA on the remediation head. If both pass, request an external reviewer other than `Panjiaphu` to review that exact head. Contract V1 freeze remains a separate later task.

```text
DO NOT MERGE
DO NOT DEPLOY
KEEP PR AS DRAFT
```
