# Timeblock ↔ Guilua PWA Parity Report

## Current canonical snapshot supersession

The Stage A ledger below is retained as historical UX evidence. The current
candidate vendors the canonical Assistant UI from
`Panjiaphu/fumap-bot-life@e37da9fc398b03546191a7193ecc05c77b21ab84`.
Its current source status is `UI_PARITY=LOCAL_QA_PASS`; production capability
status is `CAPABILITY_PARITY=BLOCKED_BY_TIMEBLOCK_CONTRACT_V2` until the
Timeblock Client Contract V2 is merged and deployed. No Render/live state is
claimed. See `../phase-status.md` for the current gate ledger.

## Historical Stage A ledger

Everything below this heading is retained as dated Stage A evidence only. Its
unsupported-surface, pending-QA and deployment statements do not describe the
current candidate summarized above and in `../phase-status.md`.

### Historical stage

`STATUS=IN_PROGRESS`

This document tracks Stage A only. Timeblock PR #42 is still Draft, so final visual parity and final Timeblock→Guilua end-to-end parity are not claimable yet.

### Source identities

- Guilua main: `28bd691f4ff7e9ba115d425df110d83bf65b5ce4`
- Guilua Phase 2A secure-handoff head: `e751715beb09e5e2c39491f6e6a53c1fe96c7f4d`
- Guilua UX branch: `ux/timeblock-assistant-pwa-parity`
- Timeblock main: `28476fe50d7e02486be190b7e895ce7832382102`
- Timeblock UX PR #42 head: `6a973f6299a2eba956e7c360b88968b3b99e9d33`
- Timeblock UI source stable: `false`

### Implemented in Stage A so far

- replaced the independent Guilua dark-blue call shell with the Timeblock light enterprise visual system;
- introduced the pinned Timeblock core UI tokens directly in Guilua CSS;
- added a compact Timeblock Communication Runtime top bar rather than recreating the entire Timeblock global application;
- redesigned the supported call/video workspace around Timeblock surface, border, typography and spacing language;
- preserved the existing remote video, local preview, call controls, interpreter panel and caption DOM/runtime hooks;
- kept translation presentation explicitly secondary and provider-not-connected;
- added responsive desktop/tablet/mobile/landscape presentation without adding a frontend framework or external UI dependency;
- preserved all existing secure-handoff element IDs and runtime selectors used by the Phase 2A browser code/tests.

### Unsupported / deliberately not fabricated

- direct messaging: `NOT_SUPPORTED`
- group messaging: `NOT_SUPPORTED`
- chat history: `NOT_SUPPORTED`
- unread counts: `NOT_SUPPORTED`
- fake contacts/rooms: `NOT_SUPPORTED`
- translation provider: `FUTURE_PHASE`
- transcript persistence: `FUTURE_PHASE`
- standalone PWA authentication without a fresh Timeblock handoff: `BLOCKED_BY_TIMEBLOCK`

### Security preservation

No authentication or WebRTC backend files have been changed in the current UX workstream.

Expected preserved invariants:

- `TOKEN_IN_LOCAL_STORAGE=false`
- `TOKEN_IN_SESSION_STORAGE=false`
- `TOKEN_IN_URL=false`
- `TOKEN_IN_WEBSOCKET_URL=false`
- `CLIENT_AUTHORITY=false`
- `SERVER_AUTHORITY=true`

These remain subject to exact-head CI/browser regression verification before Stage A completion.

### Visual parity ledger

| Surface | Timeblock reference | Guilua Stage A | Status |
|---|---|---|---|
| Accent | `#0f6858` | `#0f6858` | MATCH |
| Accent soft | `#e7f4ef` | `#e7f4ef` | MATCH |
| Surface | `#ffffff` | `#ffffff` | MATCH |
| Surface subtle | `#f7faf9` | `#f7faf9` | MATCH |
| Border | `#dde7e3` | `#dde7e3` | MATCH |
| Text | `#17211e` | `#17211e` | MATCH |
| Muted text | `#66736e` | `#66736e` | MATCH |
| Call/video workspace | supported runtime | light Timeblock workspace | IMPLEMENTED_PENDING_RENDER_QA |
| Interpreter | supported variation | contextual Timeblock side/bottom panel | IMPLEMENTED_PENDING_RENDER_QA |
| Mobile | immersive communication priority | compact Timeblock workspace | IMPLEMENTED_PENDING_RENDER_QA |
| Landscape | communication-first | compact panel + vertical controls | IMPLEMENTED_PENDING_RENDER_QA |
| Tablet | contextual two-region workspace | media + interpreter | IMPLEMENTED_PENDING_RENDER_QA |
| Desktop | contextual workspace | media + interpreter | IMPLEMENTED_PENDING_RENDER_QA |
| Messaging surfaces | Timeblock supports them | Guilua does not | NOT_SUPPORTED |

### QA status

- functional tests: `PENDING_EXACT_HEAD_CI`
- browser tests: `PENDING_EXACT_HEAD_CI`
- WebRTC tests: `PENDING_EXACT_HEAD_CI`
- privacy tests: `PENDING_EXACT_HEAD_CI`
- accessibility tests: `PENDING_EXACT_HEAD_CI`
- screenshot package: `PENDING_EXACT_HEAD_CI`

The current ChatGPT runtime cannot clone GitHub over the container network, so local repository execution is not being represented as completed evidence. GitHub exact-head workflow results are the required source for Stage A validation.

### Deployment

- `DEPLOY_PERFORMED=false`
- `MAIN_MUTATED=false`
- `PR2_MUTATED=false`
- `FORCE_PUSH=false`

No Render deployment is authorized in this workstream yet.

### Next gate

Create/maintain a stacked Draft PR from the Phase 2A branch, then obtain exact-head GitHub Actions browser/runtime/privacy evidence. If those checks pass while Timeblock PR #42 remains Draft, Stage A should report `STATUS=WAITING_FOR_TIMEBLOCK` rather than claiming final parity.
