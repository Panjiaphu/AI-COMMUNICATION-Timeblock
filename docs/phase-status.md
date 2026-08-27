# AI Communication / Timeblock Assistant delivery status

Last updated: 2026-08-27 Asia/Taipei. This is a pushed feature-branch candidate
status, not a protected-main merge, Render deployment or production
verification record.

## Candidate identity

- Repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- Working branch: `codex/timeblock-ai-parity-16a83643`
- Implementation commit: `32be11f43c81deb3f91aa1bca00b393cea2480b5`
- Draft pull request: `https://github.com/Panjiaphu/AI-COMMUNICATION-Timeblock/pull/6`
- Starting committed HEAD: `d1ac5d96854853bc0a1bab5aae295843a981d3bf`
- Canonical UI source: `Panjiaphu/fumap-bot-life@229ea3f53d12c024eaa6d686fdd47cc9326988cf`
- Source lock: `vendor/timeblock-assistant/SOURCE_LOCK.json`
- Runtime network source for vendored UI: `false`

## Parity ledger

| Gate | Status | Evidence and boundary |
|---|---|---|
| `UI_PARITY` | `LOCAL_QA_PASS` | Canonical templates, static assets, runtime asset graph, PWA assets and vi / zh-TW / en resources are present from snapshot `229ea3f`; rendered containment evidence is retained for 1440x900, 1366x768, 1024x1366, 768x1024, 430x932, 393x852, 390x844 and 360x800. |
| BFF compatibility | `LOCAL_QA_PASS` | 120 explicit method/path route specifications; canonical paths remain unchanged upstream; no open/catch-all proxy; focused BFF/parity suite passed 61 tests. |
| `CAPABILITY_PARITY` | `BLOCKED_BY_TIMEBLOCK_CONTRACT_V2` | Production principal/session authentication for canonical handlers still depends on Timeblock Client Contract V2 being merged and deployed. |
| Target QA | `PASS_LOCAL` | Default pytest: 112 passed, 4 skipped, 1 warning; source-lock verifier: 214 source files / 420 destinations; all app runtime JavaScript files passed `node --check`; browser suite evidence remains the previously recorded 16 passes on Chromium 149 and WebKit 26.5 with fake media. |
| Timeblock contract QA | `FOCUSED_PASS_FULL_SUITE_RED` | Contract V2 focused suite: 18 passed at `d4fd397b03257142c7daee169b5d6ef863d76602`. The exact-head local full repository run completed with 793 passed, 79 failed and 3 xfailed in 2229.47 seconds; GitHub run `32939899515` completed with 796 passed, 76 failed and 3 xfailed in 1741.86 seconds. Neither run reported a Contract V2 test failure. Exact-main comparison runs reproduced the Contact V1 failure and the Chromium mobile/desktop `flag=true` failures; an additional PR WebKit image-decode timeout is outside the Contract V2 diff and is recorded as unresolved/flaky rather than hidden. |
| Render Blueprint | `LOCAL_SCHEMA_AND_BUILD_PASS` | One service and 32 environment variables validated with zero targeted errors against the official Render YAML schema. Name and Starter plan match the existing AI service; branch is `main`, auto-deploy is off and health check is `/readyz/`. The exact Render build script, environment gate, source-lock verifier, compile step and `pip check` passed locally. Render CLI validation was unavailable. |
| GitHub feature branch | `FEATURE_BRANCH_PUSHED_DRAFT_PRS` | AI source-sync is pushed in draft PR #6. Timeblock dependency is merged into protected `main` by PR #95 at `229ea3f`; the AI PR remains draft until Timeblock Client Contract V2 is available. |
| Render/live | `READ_ONLY_VERIFIED_UNCHANGED` | No Render mutation is recorded in this batch. The Timeblock service remains on its prior live SHA until an exact `229ea3f` deploy succeeds. AI service `srv-d93hlhtaeets73dohu0g` remains on its prior deploy; `/readyz/` is fail-closed until Timeblock Client Contract V2 is merged and deployed. |

## GitHub comparison evidence

- PR #92 Full Repository QA run `32939899515` checked out exact head
  `d4fd397b03257142c7daee169b5d6ef863d76602`; it remained red on legacy
  repository tests, while the focused Contract V2 suite passed locally.
- Exact-main Contact V1 comparison run `32939572018` failed at
  `f6aad9c52daa212802ca72f87bb9add874ea42f6`.
- Exact-main Mobile Browser QA comparison run `32939569118` failed Chromium
  mobile and desktop `flag=true` jobs at the same main SHA. The PR-only WebKit
  failure was a three-second image-decode fallback timeout in an unchanged
  browser test; it remains an unresolved/flaky CI observation, not a green
  claim.

## Implemented locally

- Vendored the canonical Assistant template inheritance graph, required static
  assets, localization bundles and PWA resources from the exact Timeblock
  snapshot. Guilua does not load the UI from GitHub at runtime.
- Added local template/static/i18n adapters while preserving Timeblock as the
  durable System of Record.
- Preserved the existing `/communication` realtime runtime and session routes.
- Added an explicit same-origin BFF allowlist spanning Assistant media/image
  generation/TTS/context, messaging/contact/attachments/reactions/pin/edit/
  delete/read/block/QR/events, group/direct calls and TURN/ICE, Call V1 live
  translation, Live Translate history/media/TTS, internal messages, push and
  notification preferences.
- The BFF supports GET/POST/PUT/PATCH/DELETE, duplicate query values, raw JSON,
  form, multipart, binary responses and SSE without exposing browser cookies or
  the server API key.
- Admin and scheduler paths remain intentionally outside the allowlist.
- The Timeblock dependency preserves authenticated server-to-server access to
  the capability manifest across its canonical-host redirect while browser
  authorization continues to redirect normally.

## Production dependency

Timeblock remains authoritative for identity, permissions, entitlement, quota,
durable conversations/messages/media, calls, notifications, audit and
retention. Before `CAPABILITY_PARITY` can pass:

1. merge the Timeblock Client Contract V2 session/principal middleware and its
   canonical handler coverage into the intended Timeblock release;
2. deploy that exact Timeblock commit and configure the paired server secret
   and exact origins without exposing credentials to the browser;
3. run the target BFF/security suite, rendered desktop/mobile browser QA and
   cross-service synthetic acceptance against exact deployed identities;
4. verify Render deployment SHA, logs, rollback state and production behavior.

Do not deploy the AI candidate into a known readiness failure. The Timeblock
Contract V2 branch must first be integrated with current protected `main`,
reviewed and released through a separately authorized Timeblock deployment.

Until those gates pass, do not describe this candidate as production capability
parity, merged, deployed, Render-updated or live. `UI_PARITY=LOCAL_QA_PASS` is a
bounded local implementation and rendered-QA statement only. Browser media QA
used fake devices; physical-device and strict-NAT acceptance remain separate.
