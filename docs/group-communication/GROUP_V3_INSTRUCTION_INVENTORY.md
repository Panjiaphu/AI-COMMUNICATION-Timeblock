# Group V3 instruction inventory — AI-COMMUNICATION

Canonical owner correction: `2026-09-01 Asia/Taipei`.

| Path | Action | Rule |
|---|---|---|
| `GROUP_COMMUNICATION_V3_OWNERSHIP.md` | KEEP | Sole AI Group ownership. |
| `CODEX_GROUP_V3_EXECUTION_ORDER.md` | KEEP | Canonical P0-P7. |
| `GROUP_COMMUNICATION_V3_MIGRATION_INVENTORY.md` | KEEP | AI PostgreSQL canonical. |
| `GROUP_V3_RENDER_ACTIVATION.md` | REWRITE | AI-only Group runtime env contract. |
| `RENDER_KEY_VALUE_CONTRACT.md` | KEEP | Valkey floor coordination only. |
| `docs/skills/ai-communication-group-runtime/**` | KEEP | Repository skill and memory. |
| `.github/workflows/group-runtime-ownership-qa.yml` | KEEP | Prevents Timeblock Group proxy ownership. |
| `docs/timeblock-control-plane-contract.md` | ARCHIVE_FOR_GROUP | Direct/legacy identity reference only. |
| `docs/GROUP_MEDIA_LIVEKIT_P4.md` | REWRITE | AI signs/owns Group media grants. |
| `docs/phase-status.md` | REWRITE | Must not call AI Group data a cache. |

Any instruction saying Timeblock owns Group membership, messages, history,
audit, retention or provider results is `ARCHIVED_DO_NOT_EXECUTE` for Group
V3.
