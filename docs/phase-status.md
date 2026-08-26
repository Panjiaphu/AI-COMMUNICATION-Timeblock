# AI Communication / Timeblock Assistant delivery status

Last updated: 2026-08-26 Asia/Taipei. This is a local working-tree status, not a
GitHub merge, Render deployment or production verification record.

## Candidate identity

- Repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- Working branch: `codex/timeblock-ai-parity-16a83643`
- Starting committed HEAD: `d1ac5d96854853bc0a1bab5aae295843a981d3bf`
- Canonical UI source: `Panjiaphu/fumap-bot-life@16a83643b77afd20feb6d7b7f7366702d25fd87d`
- Source lock: `vendor/timeblock-assistant/SOURCE_LOCK.json`
- Runtime network source for vendored UI: `false`

## Parity ledger

| Gate | Status | Evidence and boundary |
|---|---|---|
| `UI_PARITY` | `LOCAL_QA_PASS` | Canonical templates, static assets, runtime asset graph, PWA assets and vi / zh-TW / en resources are present from snapshot `16a83643`; rendered containment passed at 1440x900, 1366x768, 1024x1366, 768x1024, 430x932, 393x852, 390x844 and 360x800. |
| BFF compatibility | `LOCAL_QA_PASS` | 120 explicit method/path route specifications; canonical paths remain unchanged upstream; no open/catch-all proxy; focused BFF/parity suite passed 61 tests. |
| `CAPABILITY_PARITY` | `BLOCKED_BY_TIMEBLOCK_CONTRACT_V2` | Production principal/session authentication for canonical handlers still depends on Timeblock Client Contract V2 being merged and deployed. |
| Target QA | `PASS_LOCAL` | Default pytest: 109 passed, 4 skipped, 1 warning; focused parity/BFF: 61 passed; source-lock verifier: 214 source files / 420 destinations; all 59 runtime JavaScript files passed `node --check`; browser suite: 16 passed on Chromium 149 and WebKit 26.5 with fake media. |
| Timeblock contract QA | `FOCUSED_PASS_FULL_SUITE_RED` | Contract V2 focused suite: 17 passed. Current branch full suite: 775 passed, 74 failed, 3 xfailed. A clean `16a83643` sample reproduced 3/3 representative failures, but the 74 failures have not all been individually classified as baseline. |
| Render Blueprint | `LOCAL_SCHEMA_PASS` | One service and 32 environment variables validated with zero targeted errors against the official Render YAML schema. Name and Starter plan match the existing AI service; branch is `main`, auto-deploy is off and health check is `/readyz/`. Render CLI validation was unavailable. |
| GitHub feature branch | `PENDING_COMMIT_PUSH` | Local changes have not yet been represented as a pushed candidate commit by this document. Protected `main` merge is a separate pending gate. |
| Render/live | `READ_ONLY_VERIFIED_UNCHANGED` | AI service `srv-d93hlhtaeets73dohu0g` remains on deploy `dep-d9sa54ijnfac73953mhg`, SHA `d1ac5d96854853bc0a1bab5aae295843a981d3bf`; no mutation was made. Timeblock live SHA `f6aad9c52daa212802ca72f87bb9add874ea42f6` does not contain Contract V2 and its canonical capability URL returns 404, so the candidate `/readyz/` would return 503. |

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
