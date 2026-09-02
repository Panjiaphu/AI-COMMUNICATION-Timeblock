---
name: ai-communication-group-runtime
description: Build and release the sole Group Communication product, data and runtime in AI-COMMUNICATION-Timeblock.
---

# AI-COMMUNICATION Group runtime skill

Use this skill for Group Chat, Group Call, Group Video, Group Radio, Chat
Translation Plugin or Radio Translation Plugin.

## Mandatory ownership rule

This repository exclusively owns all Group UI/UX, spaces, membership, roles,
room authorization, durable messages/history, media results, Radio history,
translation records, usage, audit, retention and provider execution.

Timeblock supplies only one launcher and a one-time authenticated identity
handoff. Never proxy Group durable reads/writes to Timeblock and never describe
AI PostgreSQL Group tables as cache/shadow.

## Required workflow

1. Read `docs/group-communication/GROUP_COMMUNICATION_V3_OWNERSHIP.md`.
2. Reverify PR #14 exact head/base and current Render live SHA.
3. Keep Group APIs local, transactional and idempotent.
4. Keep secrets server-only and retain existing key values.
5. Use existing PostgreSQL, Valkey, LiveKit and OpenAI resources.
6. Preserve Direct 1:1.
7. Run ownership, migration, focused/full, browser and resource-zero gates.
8. Stage once, record `git write-tree`, commit, and prove
   `HEAD^{tree}` equals the tested tree before reporting a candidate.

Plugin means first-party Chat/Radio translation only; no marketplace or SDK.
