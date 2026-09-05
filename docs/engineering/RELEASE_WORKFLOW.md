# AI-COMMUNICATION-Timeblock owner-deploy release workflow

Status: **OWNER-APPROVED**
Workflow version: **1.2**
Decision date: **2026-09-05**

`docs/engineering/CODEX_OPERATING_STANDARD.md` is the highest-precedence workflow source. This file defines the release/publish subset.

## Default policy

```text
ITERATIVE_GITHUB_ACTIONS=NO
OWNER_DEPLOYS_EXACT_CANDIDATE=YES
OWNER_MANUAL_QA_BEFORE_MERGE=YES
PR_CANDIDATE_PATH=YES
FORCE_PUSH=NO
AUTO_DEPLOY=NO
AUTO_MERGE=NO
```

## Canonical release path

```text
CURRENT origin/main
-> create dedicated task branch/worktree from exact BASE_MAIN_SHA
-> implement all production changes
-> write/update test source
-> NO QA between implementation phases
-> create/freeze local candidate commit
-> run ONE final local QA gate against that exact candidate
-> if PASS, push same candidate commit
-> open/update PR
-> verify REMOTE_PR_HEAD_SHA == CANDIDATE_SHA
-> report DEPLOY_TEST_SHA and STOP
-> OWNER manually deploys DEPLOY_TEST_SHA
-> OWNER manual QA
   -> PASS: re-fetch main, verify no drift/tree change, merge normally, report FINAL_MAIN_SHA
   -> FAIL: ChatGPT re-plan/re-score -> new revision -> new candidate SHA
```

## Candidate invariants

Before owner deployment QA:

```text
CANDIDATE_SHA == TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA
```

If the code changes after final QA, old evidence is stale. Create a new candidate commit and rerun the affected final gate.

Do not amend a failed/tested candidate and pretend the SHA remained valid.

## Required candidate report

```text
STATUS=READY_FOR_OWNER_MANUAL_QA
TASK_ID=
BASE_MAIN_SHA=
CANDIDATE_SHA=
TESTED_COMMIT_SHA=
REMOTE_PR_HEAD_SHA=
PR_NUMBER=
FINAL_LOCAL_QA=PASS
FOCUSED_TESTS=
SECURITY_QA=PASS|NOT_REQUIRED
DIFF_CHECK=PASS
BROWSER_QA=PASS|NOT_REQUIRED
NEW_AFFECTED_FAILURES=NONE
OWNER_MANUAL_QA=PENDING
DEPLOY_TEST_SHA=
NEXT_ACTION=OWNER_DEPLOY_EXACT_SHA_AND_REPORT_QA
```

After this report, the executor must STOP. No cleanup commit, extra push, merge, or automatic deployment.

## Owner QA PASS

Verify:

1. `DEPLOYED_SHA == DEPLOY_TEST_SHA`;
2. PR head still equals QA SHA;
3. current `main` does not create a different integrated tested tree;
4. merge path is normal and non-force.

Then merge and report:

```text
STATUS=MERGED_AFTER_OWNER_QA_PASS
OWNER_MANUAL_QA=PASS
QA_SHA=
PR_NUMBER=
MERGE_SHA=
FINAL_MAIN_SHA=
TESTED_TREE_PRESERVED=YES|NO
FORCE_PUSH=NO
```

If main drift changes the integrated tree, create a new integration candidate and require owner QA again.

## Owner QA FAIL

Do not silently edit the published candidate. Verify the deployed SHA, analyze evidence, re-score scope/model/plugins, and create `TASK_ID-R1` or later revision with a new candidate SHA.

## Cross-repository release

When Timeblock and Guilua both change, report and preserve the exact tested pair:

```text
TIMEBLOCK_CANDIDATE_SHA=
GUILUA_CANDIDATE_SHA=
PAIR_TESTED_TOGETHER=YES|NO
```

Do not merge one side based on pair QA if the other side changed after testing in a way that affects the contract.

## GitHub Actions

Hosted Actions are not the iterative development loop. Use them only if repository policy requires them, the owner requests independent hosted evidence, or the task specifically changes the workflow.

Local final QA, candidate push, owner deployment QA, merge, and production verification are separate facts.
