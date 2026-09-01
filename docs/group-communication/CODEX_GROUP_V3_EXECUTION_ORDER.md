# Codex Group Communication V3 execution order

## Owner instruction

This task is an implementation-and-release-candidate task, not an audit-only task.

Codex is authorized to continue working until the Group Communication V3 candidate is complete enough for owner deployment verification.

Do not stop merely because Render environment variables, Redis/Valkey, LiveKit, OpenAI Realtime, database migration, UI wiring, secure handoff, routing, or deployment configuration still require work. Those items are part of the task and should be fixed when repository/account access and existing credentials/resources allow it.

Do not claim PASS because code merely exists. PASS requires the tested candidate to expose and operate the intended user-visible Group runtime.

## Product ownership lock

Timeblock owns:

- authentication and identity;
- member/business authority;
- entitlements/billing;
- Direct Chat 1:1;
- Direct Call 1:1;
- Direct Video Call 1:1;
- Direct 1:1 translation;
- Group launcher;
- secure Group handoff.

Timeblock must not own or execute native Group Chat, Group Call, Group Video, Group Radio/PTT, Group translation, duplicate Group WebSocket, or duplicate Group media runtime.

AI-COMMUNICATION-Timeblock is the only runtime owner for:

- Group Chat;
- Group Call;
- Group Video;
- Group Radio/PTT;
- Group Translation Plugin.

Clicking a Group action in Timeblock must securely hand off the authenticated user to AI-COMMUNICATION-Timeblock.

## Existing lineage

Continue the existing paired V3 work unless technically unrecoverable.

AI-COMMUNICATION-Timeblock:

- PR #14
- branch `codex/group-ownership-v3`

Timeblock:

- PR #117
- branch `codex/group-ownership-v3`

Always fetch `origin` first and record the exact current `origin/main` and PR head SHAs. Rebase/merge current main into the working branch as needed. Do not create duplicate V3 PRs unless the existing PR branches cannot be recovered safely.

## Primary user-visible goal

A real authenticated user in AI-COMMUNICATION-Timeblock must visibly be able to enter and use:

1. Chat nhom;
2. Call nhom;
3. Video nhom;
4. Radio nhom / PTT;
5. Plugin dich nhom.

The current old Messaging Core view is not sufficient. Group frontend assets must actually be routed, loaded, rendered, authorized, and connected to working backend/provider flows.

## AI-COMMUNICATION work scope

Audit and complete all Group V3 backend, frontend, runtime, deployment, migration and test files, including but not limited to:

- `app/group_v3/`;
- `app/static/group-v3/`;
- `app/main.py`;
- `app/core/config.py`;
- `app/db/`;
- `scripts/check_env.py`;
- `scripts/build_render.sh`;
- `scripts/predeploy_render.sh`;
- `scripts/start_render.sh`;
- `render.yaml`;
- Alembic migration containing revision `20260831_0016`;
- templates/routes/bootstrap/navigation that expose the Group UI;
- all related tests.

Do not restrict the implementation to this list if additional consumers are discovered.

## Render and infrastructure authority

The owner authorizes Codex to inspect and modify Render environment variables and deployment configuration required for Group V3.

Codex may:

- update Render environment variables;
- generate application secrets where technically appropriate;
- bind the existing PostgreSQL database;
- bind the existing Redis/Valkey Key Value instance;
- correct Group feature flags;
- correct LiveKit configuration using real existing credentials/resources;
- use the existing server-side OpenAI credential;
- modify build/predeploy/start configuration;
- run required database migrations;
- inspect Render logs and readiness;
- restart/redeploy a candidate when needed for validation.

Never expose secrets in source, commits, PR text, browser storage, URLs, logs, screenshots, or final reports. Do not fabricate provider credentials. Do not purchase or accept a new paid service commitment without separate owner authorization.

A missing configuration is work to investigate and resolve, not by itself a reason to end the task as BLOCKED.

## Required AI runtime configuration

Inspect actual Render values before changing them.

Group core:

- `GROUP_V3_ENABLED=true`
- `GROUP_HANDOFF_AUDIENCE=ai-communication-group-v3`
- valid `DATABASE_URL`
- valid `GROUP_MESSAGE_ENCRYPTION_KEY` decoding to exactly 32 bytes

Group media:

- `GROUP_MEDIA_ENABLED=true`
- `GROUP_LIVEKIT_URL=wss://...`
- real `GROUP_LIVEKIT_API_KEY`
- real `GROUP_LIVEKIT_API_SECRET`

Group Radio:

- `GROUP_RADIO_V3_ENABLED=true`
- use the existing Render Key Value resource if healthy
- bind its Internal Redis/Valkey URL to `GROUP_RADIO_REDIS_URL`
- validate floor lease/heartbeat constraints

Group Translation:

- `GROUP_TRANSLATION_ENABLED=true`
- reuse the existing server-side `OPENAI_API_KEY`
- configure the actual translation/transcription model and Group translation settings expected by source
- never send the permanent OpenAI API key to the browser

## Database requirement

Find the exact Alembic migration containing revision `20260831_0016`.

Verify the actual PostgreSQL migration path used by Render. `predeploy_render.sh` must safely apply the required migration and final schema state must be verified. Disposable SQLite migration tests alone are not sufficient evidence for production readiness.

## Functional requirements

Group Chat must support at least room creation/join, membership authorization, send/receive, history, encrypted storage, attachments, participant state, reconnect/disconnect, unauthorized rejection, and secure-handoff identity binding.

Group Call/Video must support real LiveKit connectivity, participant-scoped grants, join/leave, microphone, mute/unmute, camera, remote participants, reconnect, permission failure, device loss and cleanup.

Group Radio/PTT must support Redis/Valkey connectivity, distributed floor ownership, heartbeat, START/STOP, release, timeout, takeover after release, reconnect and device loss. Only one participant may hold the floor at a time.

Group Translation must support explicit enable/consent, source/target language, OpenAI Realtime session, partial transcript, FINAL transcript, translation, disable, reconnect, cleanup and provider-error handling. Do not transmit participant audio before explicit enable/consent.

## Timeblock paired boundary

The paired Timeblock branch/PR must remain launcher-only for Group V3.

At minimum inspect the Group handoff service, Group launcher JS, Render config, tests and any additional Group launcher/handoff consumers discovered.

When AI Group V3 is healthy, configure the paired Timeblock runtime according to the actual source contract, including `COMMUNICATION_GROUP_V3_ENABLED=true`, correct Group UI/runtime URLs, handoff audience/TTL/session limits and the real `COMMUNICATION_RUNTIME_WS_URL`. Do not invent `COMMUNICATION_GROUP_WS_URL` or guess WebSocket paths.

## Readiness contract

Before declaring the candidate ready, `GET /readyz/` for AI-COMMUNICATION must return HTTP 200 with Contract V3 semantics and schema revision `20260831_0016`, with all required Group capabilities true:

- `group_chat=true`
- `group_media=true`
- `group_radio=true`
- `group_translation=true`

Do not mark the candidate ready while a required capability is false.

## QA policy

Do not use GitHub Actions as the mandatory acceptance gate.

After implementation is complete, run local/focused QA and candidate runtime checks where technically possible.

Required final validation includes:

- Python compile;
- JavaScript syntax;
- focused Group backend tests;
- Group browser/frontend tests;
- migration validation;
- environment validation;
- security/secret scans;
- two-account Group Chat;
- Group Call;
- Group Video;
- Radio/PTT;
- Translation;
- reconnect/device-lost paths;
- secure handoff and invalid/expired/wrong-audience rejection;
- desktop/tablet/mobile;
- VI/EN/zh-TW;
- Direct Chat/Call/Video 1:1 regression;
- existing AI Assistant regression.

Run the repository full suite at the end. If unrelated baseline failures exist, compare baseline and candidate honestly. The acceptance rule is `NEW_FAILURES_INTRODUCED_BY_THIS_WORK=NONE`.

## Do not end early

Do not end the task with only `BLOCKED`, `ENV MISSING`, `LIVEKIT MISSING`, `REDIS MISSING`, `MIGRATION REQUIRED`, `NEEDS DEPLOY`, or `OWNER ACTION REQUIRED` when those items can be resolved with available repository/account access.

Investigate and fix them first, then continue through the remaining phases.

Only a truly inaccessible external dependency or a new paid commitment may remain as a narrowly scoped external action. Complete every other technically achievable part first.

## Git/PR policy

Continue PR #14 and paired Timeblock PR #117 whenever possible.

Commit final implementation and evidence to the PR heads. Do not force-push protected `main`. Do not auto-merge protected `main` as part of this task.

The owner will deploy and verify the exact final tested SHA(s).

## Definition of done

The candidate is ready for owner deployment verification only when the exact tested PR heads satisfy, as applicable:

- `AI_ENV_VALIDATION=PASS`
- `AI_BUILD=PASS`
- `SCHEMA_20260831_0016=PASS`
- `READYZ_HTTP_200=PASS`
- `CONTRACT_V3=PASS`
- `GROUP_CHAT=PASS`
- `GROUP_CALL=PASS`
- `GROUP_VIDEO=PASS`
- `GROUP_RADIO=PASS`
- `GROUP_TRANSLATION=PASS`
- `REDIS_FLOOR_OWNERSHIP=PASS`
- `LIVEKIT_RUNTIME=PASS`
- `OPENAI_REALTIME_GROUP_TRANSLATION=PASS`
- `SECURE_HANDOFF=PASS`
- `INVALID_HANDOFF_DENIED=PASS`
- `DESKTOP=PASS`
- `TABLET=PASS`
- `MOBILE=PASS`
- `VI=PASS`
- `EN=PASS`
- `ZH_TW=PASS`
- `DIRECT_1_TO_1_REGRESSION=PASS`
- `TIMEBLOCK_NATIVE_GROUP_RUNTIME=NONE`
- `TIMEBLOCK_LAUNCHER_TO_AI=PASS`
- `NEW_FAILURES=NONE`

## Final report required from Codex

Return one consolidated report only after implementation and final QA, containing at minimum:

- exact current main SHAs;
- PR numbers/URLs;
- branch names;
- exact final tested PR head SHAs;
- files changed;
- Group UI visibility and each Group capability result;
- migration/schema result;
- Redis/LiveKit/OpenAI Realtime result;
- Render ENV result;
- `/readyz/` status, contract and capabilities;
- secure handoff result;
- desktop/tablet/mobile and VI/EN/zh-TW QA;
- Direct 1:1 regression;
- focused tests;
- full-suite baseline and candidate counts;
- new failures;
- candidate deployment status/SHA if used;
- `MERGED_MAIN=NO`;
- `OWNER_FINAL_DEPLOY=PENDING`;
- exact `PRIMARY_AI_DEPLOY_SHA`;
- exact `PAIRED_TIMEBLOCK_DEPLOY_SHA`;
- `READY_FOR_OWNER_DEPLOY_CHECK=YES/NO`.

Do not return `READY_FOR_OWNER_DEPLOY_CHECK=YES` unless the reported SHAs are the exact tested PR heads.