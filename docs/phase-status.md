# AI Communication / Timeblock Assistant delivery status

Last updated: 2026-08-27 Asia/Taipei. This ledger records the protected-main
merge, exact Render deploys and the remaining physical-device QA boundary.

## Candidate identity

- Repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- Protected main merge: `fb18f661b8a8b3ce1f43c0164569da05c11a0b6f`
- Source-sync commit: `1c002a327af97b83bfc4c20acf4a9db675443a95`
- Pull request: `https://github.com/Panjiaphu/AI-COMMUNICATION-Timeblock/pull/6` (merged)
- Canonical UI source: `Panjiaphu/fumap-bot-life@e37da9fc398b03546191a7193ecc05c77b21ab84`
- Source lock: `vendor/timeblock-assistant/SOURCE_LOCK.json`
- Runtime network source for vendored UI: `false`

## Parity ledger

| Gate | Status | Evidence and boundary |
|---|---|---|
| `UI_PARITY` | `LOCAL_QA_PASS` | Canonical templates, static assets, runtime asset graph, PWA assets and vi / zh-TW / en resources are present from snapshot `e37da9f`; rendered containment evidence is retained for 1440x900, 1366x768, 1024x1366, 768x1024, 430x932, 393x852, 390x844 and 360x800. |
| BFF compatibility | `LOCAL_QA_PASS` | 120 explicit method/path route specifications; canonical paths remain unchanged upstream; no open/catch-all proxy; focused BFF/parity suite passed 61 tests. |
| `CAPABILITY_PARITY` | `CONTRACT_V2_LIVE` | AI `/readyz/` returns `200` with `authority=timeblock` and `contract_version=2` against the deployed Timeblock contract. Authenticated media/call flows still require physical-device and two-account QA. |
| Target QA | `PASS_LOCAL` | Default pytest: 112 passed, 4 skipped, 1 warning; source-lock verifier: 214 source files / 420 destinations; all app runtime JavaScript files passed `node --check`; browser suite evidence remains the previously recorded 16 passes on Chromium 149 and WebKit 26.5 with fake media. |
| Timeblock contract QA | `FOCUSED_PASS_BASELINE_PENDING` | PR #96 focused Contract V2 suite passed (18 local tests plus required Auth/Bootstrap/Replay/Security/Call/Mobile/Contact/Multi-Image/Runtime checks). The non-required Full Repository QA run `33047766392` remains in progress; historical baseline runs were red on unrelated legacy tests and are not called all-green. |
| Render Blueprint | `LOCAL_SCHEMA_AND_BUILD_PASS` | One service and 32 environment variables validated with zero targeted errors against the official Render YAML schema. Name and Starter plan match the existing AI service; branch is `main`, auto-deploy is off and health check is `/readyz/`. The exact Render build script, environment gate, source-lock verifier, compile step and `pip check` passed locally. Render CLI validation was unavailable. |
| GitHub protected main | `MERGED` | Timeblock PR #96 merged at `e37da9fc398b03546191a7193ecc05c77b21ab84`; AI PR #6 merged at `fb18f661b8a8b3ce1f43c0164569da05c11a0b6f`. Realtime Translation V1 SHA `55e5b618…` remains an ancestor of Timeblock main. |
| Render/live | `TIMEBLOCK_AND_AI_DEPLOYED` | Timeblock `srv-d932simrnols73873c7g` deploy `dep-da7u8dpsrm7s73divceg` is `Live` at `e37da9f`; `/healthz` returns `200` and `/assistant` returns the scoped camera/microphone/geolocation policy. AI `srv-d93hlhtaeets73dohu0g` deploy `dep-da7ud1m7bikc738kci2g` is `Live` at `fb18f66`; the environment-version refresh deploy `dep-da7uf1m7bikc738khogg` also succeeded. AI `/healthz/` and `/readyz/` return `200`. |

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
- Added local template/static/i18n adapters. That historical statement applies
  to Direct/client compatibility only; AI PostgreSQL is canonical for Group V3.
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

## Remaining production follow-up

For Direct/client compatibility, Timeblock remains authoritative for identity
and its existing Direct data. For Group V3, AI-COMMUNICATION owns membership,
authorization, durable messages/media results, Radio/translation history,
usage, audit and retention. Remaining work:

1. Run authenticated two-account checks for messaging, attachments, location,
   recorder and Call V1 on a physical iPhone/Android device.
2. Wait for the non-required Full Repository QA workflow to finish and keep its
   unrelated legacy failures separate from the focused release gates.
3. Recheck the Render `deployment_version` metadata field if a single release
   identity is required; Dashboard source identity and readiness are already
   verified against the exact commits above.

Browser media QA used fake devices; physical-device and strict-NAT acceptance
remain separate from this release evidence.
