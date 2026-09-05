# AI-COMMUNICATION-Timeblock ChatGPT + Codex Operating Standard v1.2

Status: **OWNER-APPROVED CANONICAL WORKFLOW**
Decision date: **2026-09-05**
Workflow version: **1.2**

This is the highest-precedence source for normal Guilua product-engineering task planning and execution.

## 1. Operating model

Primary planning brain:

```text
ChatGPT 5.6 Sol Deep / Sol Pro
```

Preferred executor:

```text
Codex, while a suitable authorized model/quota is available
```

Fallback executor:

```text
ChatGPT 5.6 Sol Deep
```

The executor may change during a task, but the task/branch/SHA lineage must not restart.

## 2. Canonical workflow

```text
OWNER REPORTS TASK
-> CHATGPT PLANS / SCORES / ROUTES
-> SELECT FAST / STANDARD / CRITICAL LANE
-> SELECT CODEX MODEL AND ONLY REQUIRED PLUGINS
-> EXECUTOR INSPECTS RELEVANT SOURCE
-> IMPLEMENT ALL PRODUCTION CHANGES
-> WRITE/UPDATE TEST SOURCE
-> NO QA BETWEEN IMPLEMENTATION PHASES
-> STATIC COMPLETENESS CHECK
-> CREATE/FREEZE LOCAL CANDIDATE COMMIT
-> ONE FINAL LOCAL QA GATE AGAINST THAT CANDIDATE
-> IF PASS: PUSH SAME COMMIT / OPEN OR UPDATE PR
-> VERIFY REMOTE PR HEAD == TESTED CANDIDATE
-> REPORT EXACT SHA
-> STOP
-> OWNER DEPLOYS EXACT SHA
-> OWNER MANUAL QA
   -> PASS: verify no drift and merge through PR path
   -> FAIL: ChatGPT re-plan/re-score -> R1/R2
```

## 3. Workflow lanes

### FAST
Use for i18n, copy, docs, small CSS/icon changes, cache/version strings, narrow assertions, and other mechanical changes.

Final QA: smallest focused syntax/unit/diff gate justified by the task.

### STANDARD
Use for scoped UI components, dashboard/API behavior, PWA fixes, normal backend features, and localized state changes.

Final QA: focused regression plus required browser/integration checks.

### CRITICAL
Use for Group Call/Video/WebRTC, Radio/PTT realtime lifecycle, auth/session/handoff, security, database migration, production infrastructure, cross-repository ownership, and materially unknown production defects.

Final QA: affected subsystem regression, required cross-system contracts, relevant browser/runtime verification, and baseline comparison only when justified.

## 4. Task scoring and model routing

Score 0-3:

- CHANGE_SURFACE
- ARCHITECTURE_COUPLING
- PRODUCTION_CRITICALITY
- ROOT_CAUSE_UNCERTAINTY
- VERIFICATION_COMPLEXITY
- CONTEXT_REQUIREMENT

Base routing:

```text
0-4   -> GPT-5.6 Luna
5-8   -> GPT-5.6 Terra
9-13  -> GPT-5.6 Sol
14-18 -> GPT-6 Astra
```

Risk floor: realtime media/WebRTC, call lifecycle, auth/session/handoff, security, database migration, production infrastructure, or cross-repository architecture require at least Sol. Multiple interacting critical domains or materially unknown critical root cause normally require Astra.

Use the cheapest safe model. Do not use an expensive model merely because the task is long.

## 5. Executor count and ownership

Default: one active write executor for a task tree.

Use multiple executors only when write scopes are cleanly separable by repository/file ownership. Never allow concurrent write ownership of the same file.

Three accounts are an execution-capacity pool, not three parallel implementations of the same task.

## 6. Quota-aware HANDOFF_PACKET

When Codex quota/model availability changes, or work moves Codex -> ChatGPT Sol, the current executor must produce a compact handoff instead of forcing rediscovery.

```text
HANDOFF_PACKET_VERSION=1
TASK_ID=
TASK_REVISION=
REPOSITORY=Panjiaphu/AI-COMMUNICATION-Timeblock
BASE_MAIN_SHA=
BRANCH=
CURRENT_HEAD_SHA=
PR_NUMBER=
CURRENT_PHASE=
IMPLEMENTATION_STATUS=
FILES_CHANGED=
FILES_REMAINING=
PROTECTED_FILES=
OUT_OF_SCOPE=
DECISIONS_LOCKED=
KNOWN_DEFECTS_OR_BLOCKERS=
TEST_SOURCE_WRITTEN=
QA_EXECUTED=
LAST_FINAL_QA_RESULT=
NEXT_EXACT_ACTION=
REQUIRED_PLUGINS=
PAIRED_REPOSITORY=
PAIRED_SHA=
```

The next executor verifies branch/HEAD/diff and continues. It must not re-read unrelated history unless current source conflicts with the handoff.

## 7. Plugin/tool router

Before execution, ChatGPT reports:

```text
REQUIRED_PLUGINS=
OPTIONAL_PLUGINS=
PLUGIN_NOT_REQUIRED=
PLUGIN_PERMISSION_SCOPE=
WHY_EACH_PLUGIN=
```

Typical routing:

- GitHub: repo, branch, diff, PR, exact SHA.
- Render: only when Guilua runtime/deploy/log/env evidence is material.
- OpenAI Developers: only for OpenAI API/realtime translation/provider integration.
- Browser/local Playwright/Chromium: only for UI/runtime verification, and only in final QA.
- Database-specific tools: only if the actual Guilua task touches that database.
- Drive/Slack: only when authoritative evidence lives there.

Least privilege is mandatory. If broader plugin access becomes necessary, stop and request re-planning.

## 8. Context discipline

Targets:

```text
FAST      <30K relevant context
STANDARD  <80K
COMPLEX   <150K
CRITICAL  prefer <250K
```

Prefer current source, current SHA, relevant ownership/contract docs, relevant tests, logs/screenshots, and exact defect evidence. Avoid broad historical PR review and unrelated project memory.

## 9. Implementation phases

### Phase 0 - lineage only when needed
Resolve exact main/start SHA, branch/PR, paired repo SHA, and runtime SHA only if material.

### Phase 1 - inspect
Read relevant source/contracts/tests/protected boundaries. **NO QA.**

### Phase 2 - implement
Complete all production changes. **NO QA.**

### Phase 3 - write/update tests
Author regression test source. **DO NOT EXECUTE.**

### Phase 4 - completeness
Static scope/protected-boundary review only. **NO QA.**

### Phase 5 - candidate freeze
Create a local candidate commit before final QA. This candidate identifies the code tree that will be tested.

### Phase 6 - one final QA gate
Run the smallest complete verification set justified by the workflow lane against the exact candidate tree.

If QA finds a defect, create a new candidate commit after the fix and rerun only the affected final gate. Do not amend a failed candidate and reuse old evidence.

## 10. Exact candidate handoff

After PASS:

```text
STATUS=READY_FOR_OWNER_MANUAL_QA
TASK_ID=
BASE_MAIN_SHA=
BRANCH=
PR_NUMBER=
TESTED_COMMIT_SHA=
REMOTE_PR_HEAD_SHA=
TESTED_TREE_SHA=
FILES_CHANGED=
PROTECTED_FILES_UNCHANGED=
FINAL_LOCAL_QA=
NEW_AFFECTED_FAILURES=NONE
OWNER_MANUAL_QA=PENDING
DEPLOY_TEST_SHA=
NEXT_ACTION=OWNER_DEPLOY_EXACT_SHA_AND_REPORT_QA
```

Mandatory invariant:

```text
TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA
```

Then STOP. No cleanup commit, amend, extra push, automatic deployment, or merge.

## 11. Owner QA

Owner reports:

```text
TASK_ID=
DEPLOYED_SHA=
QA_STATUS=PASS|FAIL
ENVIRONMENT=
PASS_ITEMS=
FAIL_ITEMS=
EVIDENCE=
NOTES=
```

ChatGPT must verify `DEPLOYED_SHA == DEPLOY_TEST_SHA` before accepting QA.

PASS: verify PR head, current main drift, and tested-tree preservation; merge normally and report final main SHA.

FAIL: analyze evidence, re-score model/plugins/scope, create `TASK_ID-R1` or later revision, and issue the smallest corrective task.

## 12. Cross-repository pair

When Timeblock and Guilua are both changed:

```text
TIMEBLOCK_CANDIDATE_SHA=
GUILUA_CANDIDATE_SHA=
PAIR_TESTED_TOGETHER=YES|NO
```

Do not claim a cross-system PASS unless the exact pair was tested together where the contract requires it. Each repo keeps its own write owner and protected boundaries.

## 13. Cost discipline

Optimize for first-pass owner QA success, not merely cheapest token price.

Track when useful:

```text
TASK_ID=
WORKFLOW_LANE=
PLANNER=
EXECUTOR=
CODEX_MODEL=
EXECUTOR_HANDOFFS=
CORRECTIVE_REVISIONS=
OWNER_QA_FIRST_PASS=YES|NO
```

Avoid duplicate agent discovery, parallel duplicate implementations, repeated full-suite testing, verbose logs, and unrelated audits.

## 14. Completion

A task is CLOSED only when:

```text
CODE_COMPLETE=YES
FINAL_LOCAL_QA=PASS
EXACT_SHA_HANDED_OFF=YES
OWNER_DEPLOYED_EXACT_SHA=YES
OWNER_MANUAL_QA=PASS
MERGED_TO_MAIN=YES
TESTED_TREE_PRESERVED=YES
```
