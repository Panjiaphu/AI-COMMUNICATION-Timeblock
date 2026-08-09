# Guilua / Timeblock Communication delivery status

## Candidate

- Repository: `Panjiaphu/AI-COMMUNICATION-Timeblock`
- Working branch: `agent/guilua-full-assistant-pwa`
- Base: Guilua PR #4 hardening head `269f090a245766287d687214d93b61ea8469a690`
- Timeblock presentation source: `Panjiaphu/fumap-bot-life@3c18c1f115dabc5b654c806a8911c40c9bdbeb18`
- QA policy: Phase 8 only; no test/build/browser command has been executed before Phase 8.

## Completed in this candidate

- Pinned the current Timeblock Communication presentation source in
  `vendor/timeblock-communication/SOURCE_LOCK.json`.
- Added a local-only sync tool. Guilua does not load CSS or JavaScript from
  GitHub at runtime.
- Added a unique `Timeblock AI Assistant` manifest identity and a conservative service
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
- Added a source-locked Timeblock Assistant inventory at
  `vendor/timeblock-assistant/SOURCE_LOCK.json`.
- Added the first Timeblock Client Contract V2 authorization code, server
  session, capability and server-owned Assistant/messaging surfaces.
- Added the Guilua same-origin BFF session flow and a root Assistant shell that
  calls Guilua BFF routes only.

## Not complete and intentionally not mocked

- Timeblock remains the authority for identity, directory, connections,
  conversations, messages, media, permissions, audit and retention.
- The V2 contract currently connects text Assistant, provider-backed text
  translation, read-only network views, text direct conversations and text
  messages. Multipart Assistant media, private messaging attachments, push
  subscription management and full call action proxying remain follow-up
  surfaces; the existing `/communication` WebRTC runtime remains available
  through its compatibility route.
- Timeblock's browser sender and Guilua's standalone callback are implemented
  as a server-authorized code flow, but cross-Render configuration and paired
  deployment have not been performed.
- Translation provider, durable transcript storage, TURN/SFU and physical
  iOS/Android validation remain unverified or future work.

## Release gate

This candidate must not be described as `TIMEBLOCK_GUILUA_ASSISTANT_PARITY=100%`,
production messaging/media complete, merged, or deployed until the remaining
contract surfaces and exact-head Phase 10 local QA pass.
