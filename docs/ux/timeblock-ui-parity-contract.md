# Timeblock UI Parity Contract — Guilua

> Historical Stage A contract: the current candidate supersedes this source
> lock with canonical snapshot
> `Panjiaphu/fumap-bot-life@229ea3f53d12c024eaa6d686fdd47cc9326988cf`.
> Current status is `UI_PARITY=LOCAL_QA_PASS` for bounded local QA and
> `CAPABILITY_PARITY=BLOCKED_BY_TIMEBLOCK_CONTRACT_V2` for production. This is
> not a Render/live claim; see `../phase-status.md`.

## Historical Stage A ledger

Everything below this heading is retained only as the dated Stage A design
record. Its `NOT_SUPPORTED`, pending-QA and deployment statements do not
describe the current source-locked Assistant candidate.

### Source lock

- GUILUA_REPO: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- GUILUA_MAIN_SHA: `28bd691f4ff7e9ba115d425df110d83bf65b5ce4`
- GUILUA_PHASE2A_BASE_SHA: `e751715beb09e5e2c39491f6e6a53c1fe96c7f4d`
- GUILUA_UX_BRANCH: `ux/timeblock-assistant-pwa-parity`
- TIMEBLOCK_REPO: `Panjiaphu/fumap-bot-life`
- TIMEBLOCK_MAIN_SHA: `28476fe50d7e02486be190b7e895ce7832382102`
- TIMEBLOCK_UI_SOURCE_PR: `#42`
- TIMEBLOCK_UI_SOURCE_BRANCH: `ux/timeblock-enterprise-communication`
- TIMEBLOCK_UI_SOURCE_SHA: `6a973f6299a2eba956e7c360b88968b3b99e9d33`
- TIMEBLOCK_UI_SOURCE_STABLE: `false`

This branch is stacked on the exact validated Phase 2A secure-handoff head. It must not modify PR #2, `main`, Timeblock source, deployment settings, or the secure browser handoff contract.

### Product interpretation

Guilua is the Timeblock Communication Runtime/PWA presentation layer. Parity means visual and interaction parity for communication surfaces that Guilua actually supports. It does not mean copying the complete Timeblock application.

The reference shown in the current Timeblock Assistant uses a light enterprise shell, dark green Timeblock accent, white surfaces, soft green active states, restrained borders and low elevation. The pinned PR #42 CSS defines the same core tokens:

- accent: `#0f6858`
- accent soft: `#e7f4ef`
- surface: `#ffffff`
- surface subtle: `#f7faf9`
- border: `#dde7e3`
- text: `#17211e`
- muted text: `#66736e`

Guilua must use these values instead of its previous unrelated dark-blue visual identity.

### Non-negotiable security boundary

The UX layer must preserve:

- exact-origin `postMessage` handoff;
- memory-only Timeblock session credential;
- token-free page URL;
- token-free WebSocket URL;
- typed `session.authenticate` first WebSocket frame;
- Timeblock server authorization before RoomManager state;
- no client-derived authority.

Required invariants:

- `TOKEN_IN_LOCAL_STORAGE=false`
- `TOKEN_IN_SESSION_STORAGE=false`
- `TOKEN_IN_URL=false`
- `TOKEN_IN_WEBSOCKET_URL=false`
- `ROOM_DATA_BEFORE_AUTH=false`
- `CLIENT_AUTHORITY=false`
- `SERVER_AUTHORITY=true`

### Supported-surface parity matrix

| Surface | Classification | Stage A target |
|---|---|---|
| Design tokens | SUPPORTED | MATCH |
| Typography hierarchy | SUPPORTED | MATCH |
| Spacing/radius/border language | SUPPORTED | MATCH |
| Timeblock runtime shell | SUPPORTED | MATCH |
| Video workspace | SUPPORTED | MATCH |
| Local video preview | SUPPORTED | MATCH |
| Runtime status | SUPPORTED | MATCH |
| Microphone/camera/end controls | SUPPORTED | MATCH |
| Original caption presentation | SUPPORTED | MATCH |
| Translation presentation | SUPPORTED_VARIATION | honest unavailable/provider-not-connected state |
| Interpreter controls | SUPPORTED_VARIATION | Timeblock visual language, existing runtime preserved |
| Media permission failure | SUPPORTED | explicit degraded/error presentation |
| Reconnect/degraded state | SUPPORTED | explicit status presentation |
| Mobile portrait | SUPPORTED | immersive single workspace |
| Landscape | SUPPORTED | compact workspace with reachable controls |
| Tablet | SUPPORTED | primary media + contextual interpreter panel |
| Desktop | SUPPORTED | primary media + contextual interpreter panel |
| Accessibility | SUPPORTED | semantic controls, visible focus, reduced motion |
| PWA standalone secure re-entry | BLOCKED_BY_TIMEBLOCK | do not persist credentials or fake standalone auth |
| Direct messaging | NOT_SUPPORTED | no fake chat UI |
| Group messaging | NOT_SUPPORTED | no fake group UI |
| Transcript persistence | FUTURE_PHASE | no fake backend |
| Translation provider | FUTURE_PHASE | provider is not connected |

### Visual implementation rules

1. Use Timeblock green `#0f6858` as the primary accent.
2. Use white and `#f7faf9` surfaces; no unrelated dark-blue application shell.
3. Keep borders subtle and elevation restrained.
4. Keep controls at least 44px on touch layouts.
5. Keep mobile controls above safe-area/gesture regions.
6. Keep captions readable without obscuring core call controls.
7. Keep original content authoritative; translation is secondary.
8. Do not add fake Timeblock global navigation, contacts, unread counts, groups, messages, rooms, or AI capabilities.
9. Do not add a new framework, webfont, icon package, or backend dependency for visual parity.

### Stage A gate

Stage A may finish with `STATUS=WAITING_FOR_TIMEBLOCK` while Timeblock PR #42 remains Draft.

Required before Stage A can be called implementation-complete:

- supported communication surfaces have no material visual gap against the pinned source;
- Phase 2A secure-handoff behavior is unchanged;
- responsive browser QA passes;
- media/WebRTC/reconnect/hangup regression tests pass;
- privacy/artifact tests pass;
- exact-head CI identifies the tested UX commit;
- real rendered screenshot evidence exists for required viewports/states.

Final `TIMEBLOCK_GUILUA_VISUAL_PARITY=100%` is prohibited while the Timeblock UI source is still changing.
