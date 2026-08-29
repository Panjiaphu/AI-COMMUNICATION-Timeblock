# Group Radio P7–P10 contract

## Ownership

Timeblock remains the system of record for conversation membership, Radio
session status, consent, quota, encrypted final/corrected translation history,
and audit. AI-COMMUNICATION owns only the ephemeral floor lease, provider
sidecar routing, recipient TTS queue, and teardown ledger.

## P7 floor

Each session uses `group-radio:<session_id>`. A room has one active lease. The
lease is idempotent for the same participant/generation, expires after the
configured lease, and is released immediately on `finalize`, `leave`, or
`end`. A burst cannot exceed 30 seconds and a deployment may have at most 20
active Radio rooms.

## P8 translation

The runtime calls the existing Group Translation broker once per distinct
target language. Partial events stay pending and are never persisted or sent
to TTS. Final/corrected events are forwarded without raw audio; the browser
TTS queue is FIFO, deduplicated by generation/segment/target, pauses while the
local participant transmits, and exposes autoplay-blocked state.

## P9 retrieval

History search is always proxied to Timeblock and requires the member's BFF
session. Timeblock decrypts only after membership authorization, filters
final/corrected events, caps the result and records `history.search` audit.

## P10 teardown

The resource ledger invalidates a generation before clearing mic, remote audio,
provider, floor, TTS/STT, timer and listener handles. A successful terminal
state must report `resource_zero=true`; late callbacks cannot register new
resources. This is a contract and automated unit coverage, not physical-device
or production deployment evidence.
