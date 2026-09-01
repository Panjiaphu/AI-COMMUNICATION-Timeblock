# Group V3 Render activation — AI-COMMUNICATION

Status: `CONFIGURATION_CONTRACT_DEFINED_NOT_DEPLOYED`

Service: `srv-d93hlhtaeets73dohu0g`
URL: `https://guilua.onrender.com`

This service is the sole Group product/data/runtime owner. Use the existing
PostgreSQL, Valkey, LiveKit and OpenAI resources; do not provision another
service.

## Required feature keys

- `GROUP_V3_ENABLED=true`
- `GROUP_MEDIA_ENABLED=true`
- `GROUP_RADIO_V3_ENABLED=true`
- `GROUP_TRANSLATION_ENABLED=true`
- `DATABASE_URL` existing PostgreSQL
- `GROUP_MESSAGE_ENCRYPTION_KEY` existing 32-byte secret
- `GROUP_LIVEKIT_URL`, `GROUP_LIVEKIT_API_KEY`, `GROUP_LIVEKIT_API_SECRET`
- `GROUP_RADIO_REDIS_URL` existing private Valkey URL
- `OPENAI_API_KEY` existing server-only key
- exact origin, TTL and provider model keys from `.env.render.example`

`TIMEBLOCK_API_URL` and `TIMEBLOCK_API_KEY` are retained only for platform
identity/Direct compatibility and one-time Group identity handoff redemption.
No Group data API is called on Timeblock.

## Safety gate

Keep all existing key values. Never rotate or print them. Mutate Render only
after retrieving the complete current environment for rollback and recording
the live deployment/SHA. Use merge semantics; do not replace the environment.

`/readyz` is config/dependency readiness, not product PASS. LiveKit and OpenAI
synthetics, exact staged-tree QA and production two-account acceptance are
separate.
