# Timeblock ChatGPT -> Codex Planner/Executor Standard v1.3

Status: **OWNER-APPROVED CANONICAL WORKFLOW**  
Decision date: **2026-09-05**  
Workflow version: **1.3**

This document standardizes how ChatGPT planning, task specifications, Codex execution, candidate QA, owner QA, corrective revisions, and merge decisions are coordinated across Timeblock and AI-COMMUNICATION-Timeblock.

It is intentionally repo-neutral. Repository-specific ownership and release rules remain authoritative in each repository's `AGENTS.md`, `CODEX_OPERATING_STANDARD.md`, ownership boundaries, and release workflow.

If an older workflow conflicts specifically with the Planner -> Spec-in-Git -> Executor lifecycle defined here, **this v1.3 document wins for that lifecycle**. Existing security, ownership, plugin, protected-file, and release invariants remain in force.

## 1. Canonical operating architecture

```text
OWNER QA EVIDENCE / NEW TASK
        |
        v
CHATGPT GPT-5.6 SOL DEEP / EXTRA HIGH
PLANNER / ARCHITECT
        |
        +-> inspect current source / SHA / authoritative evidence
        +-> web research only when it materially improves the plan
        +-> classify PASS / FAIL / unverified risk
        +-> define architecture, boundaries and acceptance criteria
        |
        v
TASK SPEC IN GIT
        |
        v
DOCS-ONLY PLAN COMMIT
        |
        v
PLAN_SHA
        |
        v
SHORT EXECUTOR PROMPT
        |
        v
FRESH CODEX THREAD
GPT-5.6 SOL HIGH BY DEFAULT
        |
        v
IMPLEMENTATION
        |
        v
FREEZE CANDIDATE
        |
        v
ONE FINAL QA GATE
        |
        v
PUSH SAME TESTED CANDIDATE / UPDATE PR
        |
        v
DEPLOY_TEST_SHA
        |
        v
STOP
        |
        v
OWNER MANUAL DEPLOY + PHYSICAL QA
        |
   +----+----+
   |         |
 PASS       FAIL
   |         |
   v         v
MERGE      EVIDENCE
READY        |
             v
      CHATGPT PLANNER
             |
             v
           R(n+1)
```

## 2. Fixed roles

### 2.1 Planner / Architect

Owner default:

```text
ChatGPT GPT-5.6 Sol Deep / Extra High
```

Planner responsibilities:

- analyze owner QA evidence;
- inspect the current repository state and exact SHA lineage;
- research external platform/API behavior only when needed;
- classify confirmed defects, confirmed passes, and unverified risks;
- define product decisions, architecture, ownership boundaries, protected contracts, scope and acceptance criteria;
- write or update the task specification in Git;
- create a **docs-only** planning commit and report `PLAN_SHA`;
- produce a short Codex executor prompt that points to the canonical docs and exact task spec.

Planner must not implement production features, mutate runtime behavior, deploy production, or compete with the executor for production-code write ownership.

### 2.2 Executor

Owner default:

```text
Fresh Codex thread
GPT-5.6 Sol High
```

Executor responsibilities:

- start from the exact `PLAN_SHA` or exact owner-approved continuation SHA;
- read only canonical engineering docs, the task spec, relevant source and relevant tests;
- implement the approved scope end-to-end;
- write/update test source;
- freeze a candidate before final QA;
- run one final QA gate appropriate to risk;
- push the exact tested candidate to the task branch/PR;
- verify remote PR head equals the tested candidate;
- report `DEPLOY_TEST_SHA` and stop.

### 2.3 Escalation specialist

Use only for a bounded critical blocker that the normal executor cannot resolve safely.

Owner default:

```text
Fresh GPT-6 Astra High thread
```

Give the escalation specialist only:

- the exact invariant/problem;
- the current SHA;
- the smallest relevant file set, normally 2-4 files;
- one failing test or concrete runtime evidence;
- expected behavior.

Do not send the full project history, all QA images, or a giant task narrative to Astra. After the blocker is resolved, return the solution to the sole executor and close the specialist thread.

### 2.4 Owner

The owner:

- manually deploys the exact `DEPLOY_TEST_SHA`;
- performs desktop/mobile/device/multi-account/manual QA as appropriate;
- decides PASS or FAIL;
- provides evidence for failures;
- authorizes merge only after PASS.

## 3. Git is the task source of truth

Important plans must not live only in ChatGPT/Codex conversation history.

Task specifications belong under:

```text
docs/qa/<TASK_ID>.md
```

Recommended task ID convention:

```text
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R1
TB-<SUBSYSTEM>-<YYYYMMDD>-<NNN>-R2
```

A task specification should contain, when applicable:

1. task ID and revision;
2. repository / branch / PR;
3. starting SHA / owner-deployed SHA;
4. owner QA evidence summary;
5. confirmed PASS items;
6. confirmed FAIL items;
7. unverified risks;
8. owner-approved product decisions;
9. architecture and invariants;
10. file ownership / expected files to change;
11. protected files / protected contracts;
12. implementation scope;
13. out of scope;
14. acceptance criteria;
15. focused test matrix;
16. release / SHA workflow;
17. final report schema.

Do not paste raw secret material, unrestricted logs, or unnecessarily large conversation transcripts into task specs.

## 4. PLAN_SHA contract

Planner commits only the task documentation for the planning checkpoint.

Example:

```text
docs(group): add Group V3 R2 execution specification
```

The resulting full commit SHA is:

```text
PLAN_SHA=<40-character SHA>
```

`PLAN_SHA` identifies the exact task-spec version the executor must follow.

The executor must not silently begin from an older SHA. If the branch advanced legitimately after `PLAN_SHA`, it must verify ancestry and that the new changes do not invalidate the task spec before continuing.

For an existing corrective PR, the task spec normally goes into the same branch/PR so lineage remains explicit. For a repository-wide workflow-standard change, use a dedicated docs branch/PR.

## 5. Standard short executor prompt

The Planner should prefer a compact prompt like:

```text
Repository:
<repo>

PR:
<pr>

Branch:
<branch>

EXACT STARTING SHA:
<PLAN_SHA>

You are the sole implementation executor.

Read in this order:
1. AGENTS.md
2. the repository CODEX_OPERATING_STANDARD.md
3. the repository ownership-boundary document
4. the repository release-workflow document
5. docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md
6. docs/qa/<TASK_ID>.md

The task spec is already researched and owner-approved.
Do not redo product research.
Do not inspect unrelated repository history.
Do not expand scope.
Do not request/create/rotate production secrets unless the task explicitly requires secret administration.

Execute the task end-to-end.
One active write executor only.
No owner QA between implementation phases.
Freeze the candidate before final QA.
Run one final QA gate.
Push the exact tested commit to the existing task PR.

Do not deploy production.
Do not merge main.
Do not modify protected contracts outside the task spec.

At completion require:
CANDIDATE_SHA == TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA

Report the task-spec final report and STOP.
OWNER will deploy DEPLOY_TEST_SHA manually and decide PASS/FAIL.
```

The task spec carries the detail. The executor prompt should not repeat a 1,000-line plan that is already in Git.

## 6. One task tree = one active write executor

Mandatory default:

```text
ONE TASK TREE = ONE ACTIVE WRITE EXECUTOR
ONE FILE = ONE ACTIVE WRITE OWNER
```

Do not run separate UI, plugin, radio, backend or migration coding agents concurrently when their write scopes overlap.

A second agent may be used as a read-only reviewer or bounded specialist, but it must not push competing production-code changes to the same task tree.

Cross-repository work may have one write owner per repository if scopes are truly separated, with an explicit integration contract and exact tested SHA pair.

## 7. Context and token discipline

Planner pays the research/context cost once. Executor should not rediscover the same information.

Planner may consume:

- screenshots and QA evidence;
- platform comparisons;
- API/web research;
- broad source/architecture inspection needed to make the plan.

Executor should consume primarily:

- current canonical engineering docs;
- current task spec;
- relevant current source;
- relevant tests;
- exact blocker/runtime evidence.

Avoid sending the executor:

- entire old conversations;
- all historical PR narratives;
- duplicate prompts;
- unrelated files;
- broad web research already summarized in the task spec.

Convert visual evidence into structured entries where possible:

```text
EVIDENCE-07
Viewport: iPhone portrait
Observed: top controls overlap safe area
Expected: safe-area inset plus interactive gutter
Affected surface: Group Video mobile shell
Severity: P1
```

Attach the original screenshot only when visual geometry itself is necessary for implementation or acceptance.

## 8. Task lifecycle and revisions

Canonical state flow:

```text
PLANNING
-> PLAN_COMMITTED
-> IMPLEMENTING
-> CANDIDATE_FROZEN
-> FINAL_QA
-> OWNER_QA_PENDING
-> OWNER_PASS
-> MERGE_READY
-> MERGED
```

Failure path:

```text
OWNER_QA_FAIL
-> EVIDENCE_COLLECTED
-> R(n+1)_PLANNING
-> NEW TASK SPEC REVISION
-> NEW PLAN_SHA
-> FRESH EXECUTOR THREAD
```

Do not overwrite the history of an older revision. Preserve R1/R2/R3 task docs when they are materially useful evidence.

## 9. Candidate and SHA contract

Planner checkpoint:

```text
PLAN_SHA
```

Executor candidate:

```text
CANDIDATE_SHA
```

QA identity:

```text
TESTED_COMMIT_SHA
TESTED_TREE_SHA
```

Remote handoff:

```text
REMOTE_PR_HEAD_SHA
DEPLOY_TEST_SHA
```

Mandatory release invariant:

```text
CANDIDATE_SHA
== TESTED_COMMIT_SHA
== REMOTE_PR_HEAD_SHA
== DEPLOY_TEST_SHA
```

If they differ:

```text
READY_FOR_OWNER_MANUAL_QA=NO
```

After reporting the deploy SHA, the executor must not amend, add cleanup commits, push extra changes, deploy, or merge.

## 10. QA architecture

Do not perform owner QA between implementation phases.

Canonical executor sequence:

```text
IMPLEMENT COMPLETE APPROVED SCOPE
-> WRITE/UPDATE TEST SOURCE
-> STATIC COMPLETENESS REVIEW
-> FREEZE CANDIDATE COMMIT
-> ONE FINAL QA GATE
-> PUSH EXACT TESTED COMMIT
```

The final gate should be the smallest complete verification set justified by risk:

- syntax / lint where relevant;
- focused backend/frontend regression;
- browser verification for affected UI;
- migration validation when schema changes;
- protected-boundary regression where required;
- repository-wide suite only when genuinely justified by cross-cutting risk.

Hosted CI is not an iterative edit/fail/edit substitute for deterministic local candidate QA unless repository policy explicitly requires hosted evidence.

## 11. READY_FOR_OWNER_QA is not READY_FOR_PRODUCTION

A candidate may correctly report:

```text
READY_FOR_OWNER_MANUAL_QA=YES
READY_FOR_PRODUCTION=NO
OWNER_MANUAL_QA=PENDING
```

That is the normal state before the owner deploys the candidate.

Physical-device, real-provider, multi-account or production-environment checks that can only occur after deployment are owner-QA responsibilities unless the task spec explicitly assigns a safe equivalent environment to the executor.

## 12. Owner QA FAIL path

When owner QA fails, do not immediately send the old executor a patch request.

Use:

```text
1. collect evidence;
2. verify deployed SHA;
3. Planner analyzes source + evidence;
4. classify confirmed defect vs unverified risk;
5. re-evaluate architecture/model/tool needs;
6. create R(n+1) task spec;
7. docs-only commit -> new PLAN_SHA;
8. start a fresh executor thread.
```

This prevents accumulation of ad-hoc patches and stale conversation context.

## 13. Owner QA PASS path

Only after owner PASS:

1. verify deployed SHA equals `DEPLOY_TEST_SHA`;
2. verify PR head has not drifted;
3. inspect current main for drift;
4. ensure the merge path preserves the tested tree or build a new integration candidate if it does not;
5. merge normally through the PR path;
6. verify and report final main SHA.

Never force-push protected history to manufacture a match.

## 14. Cross-repository tasks

When Timeblock and AI-COMMUNICATION-Timeblock both change:

```text
TIMEBLOCK_PLAN_SHA=
GUILUA_PLAN_SHA=
TIMEBLOCK_DEPLOY_TEST_SHA=
GUILUA_DEPLOY_TEST_SHA=
PAIR_TESTED_TOGETHER=YES|NO
```

Each repository keeps one active write owner. Do not claim a cross-system PASS unless the exact required SHA pair was tested together where the contract requires it.

## 15. Completion definition

A production task is CLOSED only when:

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

## 16. Canonical shorthand

The owner may say:

> Planner -> Spec-in-Git -> Codex Executor -> Owner QA

This means:

```text
PLANNER = ChatGPT GPT-5.6 Sol Deep / Extra High
SPEC = docs/qa/<TASK_ID>.md
PLAN_SHA = docs-only Git checkpoint
EXECUTOR = fresh Codex GPT-5.6 Sol High by default
ESCALATION = bounded fresh GPT-6 Astra High specialist only when needed
QA = one final executor QA gate
HANDOFF = exact DEPLOY_TEST_SHA
OWNER = manual deploy + physical/manual QA
MERGE = only after owner PASS
```

This is the canonical Planner/Executor workflow for Timeblock engineering v1.3.
