# Timeblock control-plane contract status

> Historical Contract V1 compatibility record. It remains relevant only to the
> existing `/communication` WebRTC runtime. The current canonical Assistant
> release gate is Timeblock Client Contract V2 plus the authenticated
> `/api/guilua/v2/capabilities` manifest; see `phase-status.md`. All SHA and
> dependency statements below describe the 2026-08-07 V1 snapshot, not current
> production state.
>
> Group V3 exclusion: this contract is Direct/legacy only. It must not assign
> Group membership, messages, results, usage, audit or retention to Timeblock.
> Native Group V3 is fully owned by AI-COMMUNICATION-Timeblock.

Status: `CONTRACT_V1_IMPLEMENTED_AND_CONSUMED`

Verified against Timeblock source repository `Panjiaphu/fumap-bot-life` at main SHA `28476fe50d7e02486be190b7e895ce7832382102` on 2026-08-07.

For this historical Direct/legacy contract, Timeblock remains the source of
identity and its existing Direct data. This sentence does not apply to Group V3.

## Approved Contract V1 endpoints

### Browser bootstrap

`POST /api/communication/bootstrap`

The authenticated Timeblock browser calls this endpoint from an exact approved Timeblock origin. A successful response contains an opaque short-lived `session_token`, immutable `session_id`, `participant_id`, `workspace_id`, `audience`, `expires_at`, `runtime_url`, and a token-free `websocket_url`.

The bootstrap token is a secret. Guilua must never require it in a page URL or WebSocket URL.

### Runtime authorization

`POST /api/communication/sessions/{session_id}/authorize`

Server-to-server request uses `Authorization: Bearer <TIMEBLOCK_API_KEY>` and sends `participant_id` plus `session_token`. Optional `workspace_id`, `issuer`, and `audience` fields are comparison claims only. Guilua binds the response back to the requested session, participant, and supplied workspace claim before creating runtime state.

### Runtime refresh

`POST /api/communication/sessions/{session_id}/refresh`

Uses the live Timeblock session grant and the same server authentication. Guilua uses this during reconnect and still applies immutable session/participant/workspace binding checks.

### Glossary

`POST /api/communication/glossary`

Request is workspace-scoped. Timeblock remains authoritative for glossary visibility and versioning.

### Durable result callback

`POST /api/communication/session-results`

Requires `Idempotency-Key`. Guilua does not become the durable result store.

### Usage callback

`POST /api/communication/usage`

Requires `Idempotency-Key`; usage event IDs are durable deduplication keys on the Timeblock side. Guilua does not become the usage ledger.

## Phase 2A browser handoff

Canonical production flow:

1. Timeblock authenticates the browser user and calls `/api/communication/bootstrap`.
2. Timeblock opens or embeds the token-free Guilua `/communication` page.
3. Timeblock sends a `window.postMessage` message with type `timeblock.communication.handoff.v1` to the Guilua window.
4. Guilua accepts the message only when the sender origin is in `ALLOWED_TIMEBLOCK_HANDOFF_ORIGINS` and the source window matches its opener or parent where applicable.
5. Guilua validates `session_id`, `participant_id`, and `session_token`, then keeps the credential in JavaScript memory only.
6. Guilua opens the token-free WebSocket URL `/ws/communication/{session_id}`.
7. The first WebSocket frame must be typed `session.authenticate`.
8. Guilua calls the Timeblock authorize/refresh endpoint and creates `RoomManager` participant state only after authorization succeeds.
9. Signaling and normal application events are rejected structurally until authorization has completed.

Production must not persist the Timeblock session token to localStorage/sessionStorage and must not place Timeblock or Guilua reconnect credentials in browser URLs.

## WebSocket authentication protocol

The WebSocket HTTP request contains no Timeblock credential. Secret query parameters `token`, `session_token`, and `reconnect_token` are rejected.

The first client frame is:

```json
{
  "event_name": "session.authenticate",
  "event_version": 1,
  "session_id": "123",
  "participant_id": "member:42",
  "trace_id": "uuid-or-trace-id",
  "payload": {
    "session_token": "opaque-timeblock-token",
    "reconnect_token": "optional-guilua-reconnect-token",
    "workspace_id": "optional-comparison-claim",
    "issuer": "optional-comparison-claim",
    "audience": "optional-comparison-claim"
  }
}
```

The unauthenticated socket has a bounded authentication timeout and authentication-frame size limit. It receives no room snapshot before successful authorization.

## Production origins

- Timeblock application origin: `https://timeblock-commercial-pro.onrender.com`
- Canonical Timeblock browser host: `https://fumapgo.com`
- Guilua runtime origin: `https://guilua.onrender.com`
- Guilua WebSocket browser Origin: `https://guilua.onrender.com`

No wildcard origin is permitted.

## Development policy

A static `development-session` credential is permitted only when all explicit non-production fallback conditions are satisfied. Local browser QA may obtain `session` and `participant` from query parameters, but the token itself is not supplied in the URL; the static development credential is created internally by the development-only code path.

Production configuration rejects development fallback.

## Historical Phase 2A cross-repository dependency

At the recorded V1 snapshot, the Guilua Phase 2A branch implemented and tested
the receiving side of the secure handoff, while Timeblock still needed a
browser sender integration that:

- calls its existing `/api/communication/bootstrap` endpoint;
- opens/embeds `runtime_url` without appending secrets;
- posts `timeblock.communication.handoff.v1` to the exact Guilua origin;
- never logs or persists the bootstrap credential.

That sender change belongs in `Panjiaphu/fumap-bot-life` and is intentionally not modified by this Guilua-only PR.

## Rollback

Rollback Guilua by deploying the previous known-good runtime SHA. No Guilua database migration or destructive DDL is part of Phase 2A. Timeblock Contract V1 tables remain additive and independent of this runtime rollback.
