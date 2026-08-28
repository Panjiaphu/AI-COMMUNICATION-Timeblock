# P5 Group Voice Translation — AI-COMMUNICATION workplan

This is the AI-COMMUNICATION execution companion to Timeblock's canonical
`GROUP_VOICE_TRANSLATION_P5_WORKPLAN.md`. It is a plan only: the provider flag
remains off and no secret or deployment is changed by this document.

## Runtime boundary

Timeblock authorizes membership, consent, language plan, quota, billing and
durable final/corrected history. AI-COMMUNICATION owns only ephemeral provider
sessions, per-speaker/target sidecars, reconnect state and recipient playback.
The browser never receives `OPENAI_API_KEY`, and raw audio never goes to
Timeblock history.

## Candidate baseline

- Candidate SHA: `86cd1abad298f5c6897c21bfc2ff80a5a62b3e4c`.
- Current candidate has the broker, LiveKit remote audio-track handoff,
  transcript deltas, final event forwarding and encrypted-history boundary.
- `GROUP_TRANSLATION_ENABLED=false` remains the safe default.

## Work items

1. **Quota gate** — require a Timeblock session response that contains consent,
   target plan, remaining target-minute credits, reserve ID and spend-cap state
   before calling `/v1/realtime/translations/client_secrets`.
2. **Usage meter** — report source audio seconds, target-language count,
   provider request ID, generation, segment ID and an idempotency key. Never
   log the client secret, SDP or audio.
3. **Reconnect guard** — bound retries by generation and reserve ID; close the
   old sidecar before opening a replacement so a reconnect cannot double-charge.
4. **Recipient TTS queue** — add a browser-owned final-event queue with FIFO,
   one active audio item, dedupe, interruption, transmit suppression,
   autoplay-blocked state and terminal cancellation.
5. **History reconciliation** — forward only final/corrected events and settle
   usage exactly once; partials remain ephemeral.
6. **Observability** — expose redacted counters for active sidecars, target
   minutes, provider failures, queue depth, TTS active items and cleanup zero.

## TTS queue contract

```text
FINAL event -> relevance/consent check -> enqueue
TRANSMIT or user stop -> pause + clear active item
LEAVE/END/generation change -> cancel provider + clear queue + zero resources
```

The queue must never create a second microphone/camera owner, never play a
partial transcript, and never continue after the room/session generation is
terminal. If browser autoplay is blocked, show an explicit user action rather
than retrying indefinitely.

## Tests before enabling the provider

- non-member, revoked consent, zero quota and spend-cap denial;
- reserve/release/settle idempotency across retry and reconnect;
- one request per active speaker/target language, never per recipient;
- final/corrected history and duplicate suppression;
- TTS FIFO, interruption, transmit suppression, autoplay block and cleanup;
- two-user and multi-user fake-provider integration;
- browser privacy scan and JavaScript syntax checks;
- deployed OpenAI smoke, physical audio/reconnect/leave-end and resource-zero
  evidence on the exact merged/live SHA.

Do not mark P5 production complete until Timeblock confirms quota/consent/audit
and exact live-SHA evidence. Radio floor/Radio translation remain P7/P8.

## Runtime implementation status

The P5 branch now includes the recipient-side FIFO TTS queue. It accepts final
translated output only, deduplicates by generation/segment/target, plays one
recipient stream at a time, pauses while the recipient transmits, reports an
autoplay-blocked state for a user-gesture retry, and releases audio resources on
leave/end. The browser forwards the Timeblock reservation and source duration
with final events; failed sidecars release unused reservations. The router
proxies explicit consent and reservation release, and provider responses expose
only safe request-id/expiry metadata. Partial transcripts remain ephemeral; no
raw audio, SDP, API key, or transcript text is written to audit logs.
