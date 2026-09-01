# Group Radio V3 — Render Key Value contract

Owner: `Panjiaphu/AI-COMMUNICATION-Timeblock`

Valkey stores only ephemeral Radio floor leases, heartbeats, reconnect/device
loss state and bounded idempotency coordination. AI PostgreSQL remains canonical
for Radio rooms, participants, bursts, results, history, audit and retention.

Required keys:

- `GROUP_RADIO_V3_ENABLED=true`
- `GROUP_RADIO_REDIS_URL=<existing private Valkey URL>`
- `GROUP_RADIO_REDIS_NAMESPACE=ai-communication:group-radio:v3`
- `GROUP_RADIO_FLOOR_LEASE_SECONDS=15`
- `GROUP_RADIO_HEARTBEAT_SECONDS=5`
- `GROUP_RADIO_DEVICE_LOST_SECONDS=10`
- `GROUP_RADIO_MAX_BURST_SECONDS=30`
- `GROUP_RADIO_MAX_ROOMS=20`

Do not expose the Valkey URL to browsers or Timeblock. Do not add a second
Valkey instance. Existing secret values are retained.
