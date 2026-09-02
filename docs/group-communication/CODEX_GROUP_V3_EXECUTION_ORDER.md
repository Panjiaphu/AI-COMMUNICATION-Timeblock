# Codex execution order — AI-COMMUNICATION Group V3

Canonical source:
`docs/group-communication/GROUP_COMMUNICATION_V3_OWNERSHIP.md`.

## P0 — Lock ownership and design

- AI-COMMUNICATION is the sole Group product, UI, data and runtime owner.
- Timeblock is launcher plus identity handoff only.
- Rewrite memory, skill, workflow and contracts that claim otherwise.
- Keep the owner-approved V3 design lock at 24/24.

## P1 — Exact source identity

Continue PR #14 from its exact head. Preserve unrelated work and record base,
head, diff, staged tree and rollback identity.

## P2 — Entry and authorization

The root application exposes Direct and Group navigation. A Timeblock identity
handoff may bootstrap login, but AI creates and enforces Group-specific
membership, scopes and room authorization. The user never needs a surface URL.

## P3 — Canonical data

AI PostgreSQL is the Group System of Record. Writes for spaces, membership,
messages, attachments, pins, reactions, media results, Radio history, plugin
records, usage, audit and retention are local, transactional and idempotent.
No Group durable write is proxied to Timeblock.

## P4 — Six capabilities

Complete Group Chat, Call, Video, Radio, Chat Translation Plugin and Radio
Translation Plugin. Direct 1:1 remains protected.

## P5 — Readiness

Use the existing PostgreSQL, Valkey, LiveKit and OpenAI resources. Keep
`/readyz` limited to config/dependency readiness and keep provider synthetics
separate. Do not add a service.

## P6 — Exact staged-tree QA

Run compile, migrations, security, secret scan, focused/full tests, two-account
browser/device/locales/reconnect/permission/resource-zero and Direct regression.
Any byte changed after QA starts invalidates all results.

## P7 — Publish

Push only the existing PR #14 branch. Report candidate SHA and tested tree.
Do not merge or deploy automatically.
