# Timeblock ChatGPT -> Codex Planner/Executor Standard v1.3.1

Status: **OWNER-APPROVED SINGLE CANONICAL WORKFLOW**
Decision date: **2026-09-05**
Workflow version: **1.3.1**

This file is the single highest-precedence workflow for normal Timeblock and AI-COMMUNICATION-Timeblock engineering tasks.

## 0. Precedence and legacy block

Execution precedence is:

1. `AGENTS.md`
2. this file: `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md`
3. repository-specific ownership/security/release contracts explicitly referenced by the task spec
4. `docs/qa/<TASK_ID>.md`
5. relevant current source/tests

No v1.1, v1.2, v1.3, historical direct-main, long-lived-thread, Timeblock Dev AI, Qwen/OpenCode, or old model-routing workflow may be used to plan or execute a normal task. See `docs/engineering/LEGACY_WORKFLOW_BLOCKLIST.md`.

If any old file, Git-history revision, prompt, memory, PR comment, or archived skill conflicts with v1.3.1, ignore the old workflow instruction. Product/security/ownership facts remain valid only when the current repository explicitly declares them current.

## 1. Canonical architecture

```text
OWNER TASK / QA EVIDENCE
-> ChatGPT GPT-5.6 Sol Deep / Extra High Planner
-> resolve exact current lineage first
-> inspect only authoritative current evidence/source
-> write docs/qa/<TASK_ID>.md
-> docs-only PLAN_SHA on the approved task lineage
-> fresh Codex GPT-5.6 Sol High executor by default
-> implement approved scope end-to-end
-> write/update test source
-> static completeness review
-> freeze exact candidate commit
-> ONE final local QA gate against that exact candidate
-> push same tested commit / update PR
-> CANDIDATE_SHA == TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA
-> STOP
-> owner manually deploys DEPLOY_TEST_SHA
-> owner manual QA
   -> PASS: verify SHA/head/main drift, merge normally, report main SHA
   -> FAIL: collect evidence, create R(n+1), new PLAN_SHA, fresh executor
```

## 2. Fixed roles and models

Default Planner / Architect:

```text
ChatGPT GPT-5.6 Sol Deep / Extra High
```

Default Executor:

```text
Fresh Codex GPT-5.6 Sol High
```

Bounded escalation specialist only:

```text
Fresh GPT-6 Astra High
```

Astra is not the default long-running executor. Luna/Terra or another cheaper model may be used only when the Planner explicitly records that downgrade in the current task spec for a mechanical, low-risk task. Old score tables never auto-route a task.

One task tree has one active write executor. One file has one active write owner.

If Codex quota changes, preserve the same branch/SHA/task lineage with a compact handoff; do not rediscover the project from scratch. ChatGPT Sol Deep may act as fallback executor if the owner chooses.

## 3. Lineage-first planning gate

Before creating or updating a task spec, the Planner must establish:

```text
REPOSITORY=
CURRENT_MAIN_SHA=
OWNER_DEPLOYED_SHA=
ACTIVE_PR=
ACTIVE_PR_HEAD_SHA=
APPROVED_STARTING_SHA=
LINEAGE_RELATION=
```

Rules:

- Do not assume `main` is the correct starting point.
- If owner-deployed/live or active-PR lineage is newer than, ahead of, or diverged from `main`, inspect ancestry and use the exact owner-approved continuation lineage.
- Never create a docs-only `PLAN_SHA` from stale `main` when doing so would drop migrations, runtime fixes, or tested code already present in the active lineage.
- For cross-repository work, record both exact starting SHAs.

## 4. Git is the task source of truth

Important task specs belong under:

```text
docs/qa/TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>.md
```

Corrective revisions use `-R1`, `-R2`, etc.

A task spec should contain as applicable:

- exact repository/branch/PR/start SHA;
- owner evidence and confirmed PASS/FAIL items;
- product decisions and architecture invariants;
- exact task-specific ownership/boundary document paths;
- exact task-specific release/runtime document paths when needed;
- files to inspect/change;
- protected files/contracts;
- implementation scope and out-of-scope;
- acceptance criteria;
- focused final-QA matrix;
- required plugins/tools and permission scope;
- final report schema.

Do not put secrets, huge raw logs, full conversations, or unrelated history in task specs.

## 5. PLAN_SHA contract

The Planner commits only planning/task documentation to the exact approved task lineage and reports:

```text
PLAN_SHA=<40-char SHA>
```

`PLAN_SHA` identifies the exact task-spec revision. It is not the later deploy candidate.

If the branch moves after `PLAN_SHA`, the executor must verify ancestry and confirm the new head does not invalidate the task spec before continuing.

## 6. Short executor prompt

Prefer a short prompt that names:

```text
Repository:
PR:
Branch:
EXACT STARTING SHA: <PLAN_SHA or approved continuation SHA>
TASK SPEC: docs/qa/<TASK_ID>.md
```

Then instruct the executor:

1. read `AGENTS.md`;
2. read this v1.3.1 standard;
3. read only the exact ownership/security/release docs declared by the task spec;
4. read the task spec;
5. inspect only relevant current source/tests;
6. do not redo Planner research or historical PR archaeology;
7. implement the full approved scope;
8. do not execute QA between implementation phases;
9. freeze candidate before final QA;
10. run one final gate against the exact frozen candidate;
11. push the same tested commit;
12. report exact `DEPLOY_TEST_SHA` and STOP;
13. do not deploy or merge before owner QA PASS.

## 7. Plugin/tool discipline

Use least privilege. The Planner records:

```text
REQUIRED_PLUGINS=
OPTIONAL_PLUGINS=
PLUGIN_NOT_REQUIRED=
PLUGIN_PERMISSION_SCOPE=
```

Typical routing:

- GitHub: repository, branch, PR, diff, SHA, merge lineage.
- Render: only when live deploy/log/env/runtime evidence is material; no automatic deploy unless owner explicitly commands it.
- OpenAI Developers: only for OpenAI API/realtime/Agents/Apps integration work.
- Supabase/database tooling: only when that actual database is in scope.
- Drive/Slack: only when they contain authoritative task evidence.
- Local Playwright/Chromium: deterministic UI verification in the final QA phase.
- Cloudflare: approved CLI/API/browser/manual evidence; do not invent a plugin.

A newly required external permission triggers re-planning rather than silent permission expansion.

## 8. Phase discipline

```text
PHASE 0 — resolve exact lineage if needed; NO QA
PHASE 1 — inspect relevant source/contracts/tests; NO QA
PHASE 2 — implement all production changes; NO QA
PHASE 3 — write/update regression test source; DO NOT EXECUTE
PHASE 4 — static completeness/protected-boundary review; NO QA
PHASE 5 — create/freeze local candidate commit
PHASE 6 — ONE final local QA gate against exact candidate
PHASE 7 — push exact same candidate / update PR
PHASE 8 — report exact SHA and STOP
```

Full repository QA is not automatic. Use the smallest complete final gate justified by risk. Hosted GitHub Actions are not an iterative edit/fail/edit substitute for deterministic local final QA.

If final QA fails, fix the defect, create a new candidate commit, and rerun only the affected final gate. Do not reuse a failed candidate's evidence.

## 9. Candidate SHA contract

Before owner deployment QA:

```text
CANDIDATE_SHA
== TESTED_COMMIT_SHA
== REMOTE_PR_HEAD_SHA
== DEPLOY_TEST_SHA
```

If these differ:

```text
READY_FOR_OWNER_MANUAL_QA=NO
```

After reporting `DEPLOY_TEST_SHA`, no cleanup commit, amend, extra push, deploy, or merge is allowed without creating a new candidate and invalidating prior QA evidence.

## 10. Owner QA

Owner deploys exactly `DEPLOY_TEST_SHA` and reports PASS or FAIL with evidence.

Before accepting QA, ChatGPT verifies:

```text
DEPLOYED_SHA == DEPLOY_TEST_SHA
```

PASS path:

- verify PR head still equals QA SHA;
- refetch current main;
- verify merge will preserve the tested tree/contract;
- if safe, merge normally and report final main SHA;
- if integration changes the tested tree, create a new integration candidate and require owner QA again.

FAIL path:

- verify deployed SHA;
- analyze evidence;
- create `TASK_ID-R(n+1)`;
- create a new docs-only `PLAN_SHA` on the correct continuation lineage;
- start a fresh executor thread.

## 11. Cross-repository tasks

When both repositories change, record:

```text
TIMEBLOCK_PLAN_SHA=
GUILUA_PLAN_SHA=
TIMEBLOCK_DEPLOY_TEST_SHA=
GUILUA_DEPLOY_TEST_SHA=
PAIR_TESTED_TOGETHER=YES|NO
```

Keep one active write owner per repository/file boundary. Do not claim a cross-system PASS unless the exact required SHA pair was tested together where the contract requires it.

## 12. Completion definition

A production task is closed only when:

```text
PLAN_COMMITTED=YES
CODE_COMPLETE=YES
CANDIDATE_FROZEN=YES
FINAL_LOCAL_QA=PASS
EXACT_SHA_HANDED_OFF=YES
OWNER_DEPLOYED_EXACT_SHA=YES
OWNER_MANUAL_QA=PASS
MERGED_TO_MAIN=YES
TESTED_TREE_PRESERVED=YES
```

## 13. Canonical shorthand

When the owner says:

> Planner -> Spec-in-Git -> Codex Executor -> Owner QA

it means this **v1.3.1** workflow only. Do not load, execute, or revive older workflow versions.