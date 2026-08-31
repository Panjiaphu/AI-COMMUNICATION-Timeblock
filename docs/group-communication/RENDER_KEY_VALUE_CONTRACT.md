# Group Radio V3 — Render Key Value contract

This phase adds only the application contract. It does not provision or mutate a live Render resource.

- Runtime: Render Key Value / Valkey 8, Redis protocol compatible.
- Connection: internal `connectionString` supplied as `GROUP_RADIO_REDIS_URL`.
- External access: disabled (`ipAllowList: []`) when the owner provisions the instance.
- Memory policy: `noeviction`; an active floor lease must never disappear due to cache eviction.
- Region: the same Render private-network region as AI-COMMUNICATION.
- Key namespace: `ai-communication:group-radio:v3`.
- Durability: PostgreSQL owns session/burst/history; Valkey owns only short-lived distributed floor leases.
- Secrets: the connection string remains a Render secret and must not appear in URLs, HTML, logs or browser storage.

Activation remains gated by `GROUP_RADIO_V3_ENABLED=false` and owner-controlled Render configuration.
