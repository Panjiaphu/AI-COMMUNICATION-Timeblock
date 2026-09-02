# Project memory — AI Group runtime

Last verified: `2026-09-01 Asia/Taipei`

This memory supersedes all older Group ownership notes.

- AI-COMMUNICATION-Timeblock is the sole owner of all six Group capabilities.
- AI PostgreSQL is canonical for Group data, history, audit, retention and usage.
- Valkey is ephemeral Radio floor state; LiveKit is media state.
- Timeblock is only login/identity, one launcher and one-time identity handoff.
- No AI Group data API may proxy to Timeblock.
- Direct 1:1 is protected.
- Design V3 is owner approved 24/24; this is not product QA PASS.
- Existing secrets/keys are retained and never printed or rotated.
- Render environment mutation requires a complete rollback snapshot.

Reverify repository, PR, staged tree, Render deployment and environment on every run.
