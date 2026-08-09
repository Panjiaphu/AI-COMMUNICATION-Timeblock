# Guilua / Timeblock Communication delivery status

## Candidate

- Repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- Working branch: `agent/timeblock-chat-pwa-final`
- Base: live PR #3 head `ab52967a060e5510636a879cd71c8e1406760518`
- Timeblock presentation source: `Panjiaphu/fumap-bot-life@1ca83486c8985f2c28d60a767be9b30a68701dae`
- QA policy: Phase 8 only; no test/build/browser command has been executed before Phase 8.

## Completed in this candidate

- Pinned the current Timeblock Communication presentation source in
  `vendor/timeblock-communication/SOURCE_LOCK.json`.
- Added a local-only sync tool. Guilua does not load CSS or JavaScript from
  GitHub at runtime.
- Added a unique `Timeblock Chat` manifest identity and a conservative service
  worker that caches only safe static shell assets.
- Added standalone PWA re-entry state. A fresh PWA launch requires a new
  Timeblock handoff; no credential is restored from browser storage.
- Added vi / zh-TW / en copy for the standalone runtime state and removed the
  previous runtime-level hard-coded presentation strings from the communication
  shell.
- Added exact production handoff settings to the Render manifest and preserved
  fail-closed WebSocket origin validation.
- Converted Guilua QA workflows to manual-only `workflow_dispatch`; no new
  GitHub Actions QA run is intended by this candidate.
- Added local QA entrypoints for the Phase 8 gate.

## Not complete and intentionally not mocked

- Timeblock remains the authority for identity, directory, connections,
  conversations, messages, media, permissions, audit and retention.
- Guilua currently has the secure call/WebRTC runtime, but it does not yet have
  a secure Communication Client Contract for directory and Messaging Core V2
  access. The vendored messaging JavaScript therefore is not enabled as a fake
  data client.
- Timeblock still needs a browser sender that obtains the appropriate one-time
  handoff and an approved client contract for the Guilua chat surface. The
  existing Contract V1 is call-session scoped.
- Translation provider, durable transcript storage, TURN/SFU and physical
  iOS/Android validation remain unverified or future work.

## Release gate

This candidate can be tested as a PWA/runtime hardening batch. It must not be
described as `TIMEBLOCK_COMMUNICATION_UI_PARITY=100%`, production messaging
complete, merged, or deployed until the missing client contract and sender are
implemented and exact-head Phase 8 QA passes.
