# AI-COMMUNICATION-Timeblock engineering contract

## Highest-precedence engineering workflow

Read these before planning or implementing product-engineering tasks:

1. `docs/engineering/CODEX_OPERATING_STANDARD.md`
2. `docs/engineering/OWNERSHIP_BOUNDARIES.md`
3. `docs/engineering/RELEASE_WORKFLOW.md`
4. `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md`
5. task-specific `docs/qa/<TASK_ID>.md` when one exists

These documents define the owner-approved Timeblock/Guilua workflow. The Planner/Executor lifecycle is version `1.3` and supersedes older long-prompt / long-lived-Codex-thread / direct-main-before-owner-QA instructions wherever they conflict. Existing Guilua security, ownership, plugin, protected-file and release invariants remain authoritative.

## Canonical path

```text
owner task report / QA evidence
-> ChatGPT 5.6 Sol Deep/Extra High Planner analyzes, researches when needed, and writes a Git task spec
-> Planner commits docs-only task spec and reports PLAN_SHA
-> fresh Codex GPT-5.6 Sol High executor by default
-> executor reads canonical docs + task spec + relevant current source/tests only
-> implement all approved production changes
-> write/update test source
-> NO owner QA between implementation phases
-> create/freeze exact local candidate commit
-> ONE final local QA gate against that exact candidate
-> push the same tested candidate to the task branch/PR
-> verify remote PR head == tested candidate == DEPLOY_TEST_SHA
-> report exact SHA and STOP
-> owner manually deploys exact SHA
-> owner manual QA
   -> PASS: verify no drift, merge through PR, report main SHA
   -> FAIL: ChatGPT creates R(n+1) task spec, new PLAN_SHA, and a fresh executor thread
```

## Planner / executor boundary

- Planner/Architect default: ChatGPT GPT-5.6 Sol Deep / Extra High.
- Executor default: a fresh Codex GPT-5.6 Sol High thread.
- GPT-6 Astra High is reserved for a bounded critical blocker with a narrow file/evidence packet, not for carrying the full project history.
- Planner writes plans/task specs and docs-only planning checkpoints; it does not compete for production-code write ownership.
- One task tree has one active write executor; one file has one active write owner.
- Important task context belongs in Git under `docs/qa/<TASK_ID>.md` rather than only in conversation history.
- If executor quota/model availability changes, continue the same task/branch/SHA lineage using the existing HANDOFF_PACKET contract; do not rediscover the project from scratch.

## Core ownership rules

- Native Group V3 runtime belongs to `Panjiaphu/AI-COMMUNICATION-Timeblock`.
- Direct/legacy Timeblock capabilities remain governed by their existing Timeblock contracts and must not be silently migrated into Guilua.
- Cross-repository work must identify one active write owner per repo/file boundary.
- One file has one active write owner.
- Do not force-push, rewrite published history, or bypass protected-branch workflow.

## QA and release discipline

- No QA execution between implementation phases.
- Full repository QA is not automatic; match the final gate to task risk.
- GitHub Actions are not an iterative edit/fail/edit loop.
- `CANDIDATE_SHA`, `TESTED_COMMIT_SHA`, `REMOTE_PR_HEAD_SHA`, and `DEPLOY_TEST_SHA` must identify the same tested code tree before owner QA.
- `PLAN_SHA` is a planning checkpoint and is intentionally distinct from the later deploy candidate SHA.
- Owner physical/manual QA is authoritative and must never be inferred by ChatGPT or Codex.
- Do not automatically deploy Render unless the owner explicitly requests it.

## Plugin/tool discipline

Enable only task-relevant integrations. GitHub is the normal repo/PR/SHA tool. Render is only for runtime/deploy/log/env evidence when material. OpenAI Developers is only for OpenAI API/realtime integration work. Browser tooling is used only when UI/runtime verification is required. Broader plugin permissions require explicit re-planning.

## Context discipline

Planner may consume broad QA evidence, screenshots, architecture research and external platform/API comparisons once. Executor should consume the canonical docs, exact task spec, relevant current source/tests, and exact blocker evidence only.

Prefer current source, current SHA, current contracts, relevant tests, actual logs/screenshots, and exact defect evidence. Do not load historical PR narratives, full old conversations, duplicate prompts, or unrelated Timeblock Dev AI materials unless the task explicitly requires them.
