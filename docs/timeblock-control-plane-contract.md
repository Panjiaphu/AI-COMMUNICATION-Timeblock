# Timeblock control-plane contract status

Status: `PROVISIONAL_CONTRACT`

Guilua is an ephemeral Communication Runtime. Timeblock remains the source of truth for identity, workspace membership, participant authorization, entitlement, glossary master data, durable results, usage, billing, audit, and retention.

No endpoint below is considered approved until the Timeblock team supplies a source contract or explicitly approves the path and schema. Guilua must continue to fail closed in production when `TIMEBLOCK_API_URL` or `TIMEBLOCK_API_KEY` is missing.

## Implemented adapter

### `authorize_session`

- Current method: `POST`
- Provisional path: `/api/communication/sessions/{session_id}/authorize`
- Request: `{ "participant_id": string, "session_token": string }`
- Response: `AuthorizedSession`
- Idempotency: not currently supplied by the adapter
- Fail-closed behavior: missing configuration, invalid response, timeout, or HTTP failure rejects the WebSocket authorization
- Status: `IMPLEMENTED_ADAPTER`, `PROVISIONAL_PATH`, `REQUIRED_TIMEBLOCK_CONFIRMATION`

### `refresh_session`

- Current method: `POST`
- Provisional path: `/api/communication/sessions/{session_id}/refresh`
- Request: `{ "participant_id": string, "session_token": string }`
- Response: `AuthorizedSession`
- Idempotency: not currently supplied by the adapter
- Fail-closed behavior: missing configuration, invalid response, timeout, or HTTP failure rejects reconnect authorization
- Status: `IMPLEMENTED_ADAPTER`, `PROVISIONAL_PATH`, `REQUIRED_TIMEBLOCK_CONFIRMATION`

### `fetch_glossary`

- Current method: `POST`
- Provisional path: `/api/communication/glossary`
- Request: `{ "workspace_id": string, "version": string | null }`
- Response: provider-defined JSON glossary payload
- Idempotency: read operation; no idempotency key is currently supplied
- Fail-closed behavior: request failure raises `timeblock_request_failed`; translation integration must decide whether a default glossary fallback is permitted
- Status: `IMPLEMENTED_ADAPTER`, `PROVISIONAL_PATH`, `REQUIRED_TIMEBLOCK_CONFIRMATION`

### `submit_session_result`

- Current method: `POST`
- Provisional path: `/api/communication/session-results`
- Request: caller-supplied session-result JSON
- Response: empty or provider-defined JSON, ignored by the adapter
- Idempotency: `Idempotency-Key` header; caller key is preferred, otherwise a UUID is generated
- Fail-closed behavior: HTTP failure raises `timeblock_request_failed`; durable retry orchestration is not implemented in the zero-cost foundation
- Status: `IMPLEMENTED_ADAPTER`, `PROVISIONAL_PATH`, `REQUIRED_TIMEBLOCK_CONFIRMATION`

### `submit_usage`

- Current method: `POST`
- Provisional path: `/api/communication/usage`
- Request: `{ "events": list[object] }`
- Response: empty or provider-defined JSON, ignored by the adapter
- Idempotency: `Idempotency-Key` header; caller key is preferred, otherwise a UUID is generated
- Fail-closed behavior: HTTP failure raises `timeblock_request_failed`; Guilua does not become the durable usage ledger
- Status: `IMPLEMENTED_ADAPTER`, `PROVISIONAL_PATH`, `REQUIRED_TIMEBLOCK_CONFIRMATION`

## Required Timeblock confirmation

Timeblock must confirm:

1. endpoint paths and HTTP methods;
2. session-token format and expiry;
3. participant, room, workspace, role, permission, entitlement, and quota fields;
4. authorization and reconnect response status codes;
5. glossary versioning and fallback policy;
6. session-result and usage schemas;
7. idempotency-key retention and conflict behavior;
8. retry, timeout, and partial-failure behavior;
9. audit and retention requirements;
10. whether any server-to-server request signing is required beyond the bearer API key.

Do not change the provisional paths by inference. Update this document and the adapter only from an approved Timeblock contract.
