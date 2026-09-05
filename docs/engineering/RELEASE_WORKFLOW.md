# AI-COMMUNICATION-Timeblock Owner-Deploy Release Reference

Status: **ACTIVE SUBORDINATE REFERENCE**
Workflow version: **1.3.1**
Decision date: **2026-09-05**

This file is not a workflow source of truth. The only canonical workflow is:

`docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md` v1.3.1

Use this file only when the current task spec references it.

## Release invariants

```text
ITERATIVE_GITHUB_ACTIONS=NO
OWNER_DEPLOYS_EXACT_CANDIDATE=YES
OWNER_MANUAL_QA_BEFORE_MERGE=YES
PR_CANDIDATE_PATH=YES
FORCE_PUSH=NO
AUTO_DEPLOY=NO
AUTO_MERGE=NO
```

## Release path

```text
APPROVED_STARTING_SHA
-> implement approved scope
-> write/update test source
-> NO QA between implementation phases
-> freeze exact candidate commit
-> ONE final local QA gate against exact candidate
-> if PASS, push same candidate
-> open/update PR
-> verify CANDIDATE_SHA == TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA
-> report exact DEPLOY_TEST_SHA and STOP
-> owner manually deploys exact SHA
-> owner manual QA
   -> PASS: verify PR head/current main drift, merge normally if tested tree is preserved
   -> FAIL: Planner creates R(n+1), new PLAN_SHA, fresh executor
```

## Lineage requirement

Do not assume `main` is the approved starting point. For continuation/corrective work, resolve owner-deployed SHA, active PR head, migration lineage and ancestry first. Do not create planning work from stale main if that would drop deployed migrations, tested Group fixes, or active PR changes.

## Cross-repository release

When Timeblock and Guilua both change, preserve exact tested SHA pairs and record whether the exact pair was tested together where the integration contract requires it.

Historical v1.2 release instructions that conflict with v1.3.1 are blocked by `docs/engineering/LEGACY_WORKFLOW_BLOCKLIST.md`.