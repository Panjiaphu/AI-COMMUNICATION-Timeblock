# Group Communication V3 migration inventory — AI-COMMUNICATION

Status: `AI_GROUP_POSTGRES_CANONICAL`

AI PostgreSQL owns canonical Group records for:

- spaces, membership, roles and room authorization;
- messages, attachments, reactions, pins and history;
- Call/Video runtime results and lifecycle evidence;
- Radio sessions, participants, bursts and history;
- Chat/Radio translation profiles, consent, reservations, results and usage;
- audit and retention state.

The current schema must be audited non-destructively before production
activation. Existing rows are not deleted or downgraded.

Timeblock Group tables are legacy frozen records only. They are not queried as
a Group product authority and AI Group writes must never be forwarded to
`/api/communication/group/runtime/v3/*` on Timeblock.

Valkey remains ephemeral floor/reconnect coordination. LiveKit remains
ephemeral media state. Neither replaces PostgreSQL canonical records.

Direct 1:1 tables and routes are outside this migration and remain protected.
