# AI-COMMUNICATION-Timeblock task specifications

This directory stores owner-approved task specifications for the **Planner -> Spec-in-Git -> Codex Executor -> Owner QA v1.3.1** workflow.

## Canonical instruction order

1. `AGENTS.md`
2. `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md` v1.3.1
3. `docs/engineering/LEGACY_WORKFLOW_BLOCKLIST.md`
4. exact current ownership/security/release docs named by the task spec
5. `docs/qa/<TASK_ID>.md`
6. relevant current source/tests

Do not use `docs/engineering/CODEX_OPERATING_STANDARD.md` as workflow authority; it is a legacy compatibility tombstone.

## Naming

```text
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>.md
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R1.md
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R2.md
```

Do not overwrite materially useful previous revisions.

## Required task-spec sections

A task spec should normally include:

1. task ID / revision;
2. repository / branch / PR;
3. current main SHA;
4. owner-deployed/live SHA when relevant;
5. active PR/head SHA when relevant;
6. approved starting SHA and lineage relationship;
7. owner QA evidence summary;
8. confirmed PASS / FAIL / unverified items;
9. owner-approved product decisions;
10. exact task-specific ownership/boundary docs;
11. exact task-specific release/runtime docs when required;
12. files to inspect/change;
13. protected files/contracts;
14. implementation scope / out of scope;
15. acceptance criteria;
16. focused final-QA matrix;
17. plugin/tool requirements and permissions;
18. final report schema.

Planner commits the docs-only task spec on the exact approved lineage and reports `PLAN_SHA`. Executor freezes a candidate commit before one final QA gate, pushes the exact tested commit, and reports `DEPLOY_TEST_SHA` for owner manual deployment QA.

Never place secrets, huge raw logs, full conversations, or blocked legacy workflow text in task specs.