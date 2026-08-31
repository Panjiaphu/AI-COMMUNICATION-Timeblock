# Group Communication V3 ownership

Status: `ARCHITECTURE_LOCKED`

Design approval: `PASS DESIGN V3`

Approved design commit: `d98a5b4e93a3fa8e89d7573ecd3ed1c12914ee96`

Architecture-lock commit: `0d47316427b8fa67d77d9c0ec9110ca898fb9d2a`

AI-COMMUNICATION Phase 1 base: `3d04d4afad1eb0f233fdf5265029b9fdbae07bb9`

## Native Group authority

AI-COMMUNICATION is the sole owner of V3 Group spaces, memberships,
permissions, messages, reactions, pins, attachments, history, audit,
Call/Video sessions, LiveKit grants, translation, Radio/PTT and distributed
floor state.

Timeblock remains the authority only for identity, authentication, account
status, platform entitlement and billing. Those claims enter through a
short-lived, one-time identity handoff and do not make Timeblock the Group data
owner.

## Prohibited compatibility behavior

- Do not proxy Group create/read/mutate operations to Timeblock.
- Do not require a Timeblock `messaging_call_rooms` row for Group Call/Video.
- Do not request Group LiveKit grants from Timeblock.
- Do not store Group handoff codes in URLs, HTML, logs, localStorage or
  sessionStorage.
- Do not reuse Direct 1:1 routes or media ownership as Group runtime code.
- Do not maintain the Group UI by mirroring Timeblock source-lock files.

## Required native boundaries

- Persistent Group data uses the AI-COMMUNICATION database and reversible
  Alembic migrations.
- Browser Group sessions use an HttpOnly cookie established only after a
  server-to-server handoff redemption.
- Call/Video uses AI-issued participant-scoped LiveKit grants.
- Translation persists FINAL text only; recipient Auto Read remains
  asynchronous and cannot delay FINAL display.
- Radio floor is a distributed, single-owner lease with heartbeat and explicit
  release before downstream work.
- Every write validates active membership and records a Group audit event.

## Release gates

Phase 1–9 permit only local checkpoint commits. Phase 10 owns all tests, builds,
browser QA, migration upgrade/rollback and protected-boundary verification.
Push, PR, merge and deployment remain governed by the owner Prompt 2 gates.
