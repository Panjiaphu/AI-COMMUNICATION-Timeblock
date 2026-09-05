# AI-COMMUNICATION-Timeblock task specifications

This directory stores owner-approved task specifications used by the Planner -> Spec-in-Git -> Codex Executor -> Owner QA workflow.

Canonical operating documents:

- `AGENTS.md`
- `docs/engineering/CODEX_OPERATING_STANDARD.md`
- `docs/engineering/OWNERSHIP_BOUNDARIES.md`
- `docs/engineering/RELEASE_WORKFLOW.md`
- `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md`

## Naming

Use:

```text
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>.md
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R1.md
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R2.md
```

Do not overwrite a materially useful previous revision.

## Required task-spec sections

A task spec should normally include:

1. task ID / revision;
2. repository / branch / PR;
3. starting SHA / owner-deployed SHA;
4. owner QA evidence summary;
5. confirmed PASS;
6. confirmed FAIL;
7. unverified risks;
8. owner-approved product decisions;
9. architecture / invariants;
10. file ownership and expected files to change;
11. protected files / contracts;
12. implementation scope;
13. out of scope;
14. acceptance criteria;
15. focused test matrix;
16. release/SHA workflow;
17. final report schema.

Planner commits the task spec as a docs-only checkpoint and reports the resulting `PLAN_SHA`. The executor begins from that exact planning lineage, implements the task, freezes a candidate, runs one final QA gate, pushes the exact tested candidate, and reports `DEPLOY_TEST_SHA` for owner deployment QA.

Never place secrets or unnecessarily large raw conversation transcripts in this directory.
