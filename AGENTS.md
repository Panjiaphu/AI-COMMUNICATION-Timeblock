# AI-COMMUNICATION-Timeblock engineering contract

This repository owns the native Group communication runtime defined by its current ownership contracts. Preserve current Group/Direct boundaries, security controls, migrations, runtime contracts, and protected release lineage.

## Single canonical engineering workflow

For every normal product-engineering task, read in this order:

1. `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md` — **v1.3.1, single canonical workflow**
2. `docs/engineering/LEGACY_WORKFLOW_BLOCKLIST.md`
3. the exact current ownership/security/release documents named by the task spec
4. `docs/qa/<TASK_ID>.md`
5. relevant current source/tests

`docs/engineering/CODEX_OPERATING_STANDARD.md` is a legacy compatibility tombstone and must not be used as execution authority.

Do not execute v1.1/v1.2/v1.3 workflow revisions, historical direct-main instructions, old model-score routing, or stale PR/conversation workflow instructions.

## Canonical path

```text
owner task / QA evidence
-> ChatGPT GPT-5.6 Sol Deep / Extra High Planner
-> resolve exact current lineage first
-> write docs/qa/<TASK_ID>.md
-> docs-only PLAN_SHA on approved lineage
-> fresh Codex GPT-5.6 Sol High executor by default
-> implement all approved production changes
-> write/update test source
-> NO QA between implementation phases
-> freeze exact candidate commit
-> ONE final local QA gate against exact candidate
-> push same tested candidate / update PR
-> CANDIDATE_SHA == TESTED_COMMIT_SHA == REMOTE_PR_HEAD_SHA == DEPLOY_TEST_SHA
-> report exact SHA and STOP
-> owner manually deploys exact SHA
-> owner manual QA
   -> PASS: verify no drift, merge normally, report main SHA
   -> FAIL: Planner creates R(n+1), new PLAN_SHA, fresh executor
```

## Lineage gate

Never assume `main` is the correct starting point. Before planning or writing code, resolve current main, owner-deployed/live SHA, active PR/head, ancestry/divergence, migration lineage, and exact owner-approved continuation SHA. Never create a docs-only plan from stale main when that would drop already-deployed migrations, tested Group fixes, or active PR work.

## Planner / executor boundary

- Planner default: ChatGPT GPT-5.6 Sol Deep / Extra High.
- Executor default: fresh Codex GPT-5.6 Sol High.
- GPT-6 Astra High: bounded critical blocker specialist only.
- Cheaper executor model: allowed only when the current task spec explicitly authorizes a low-risk mechanical downgrade.
- One task tree = one active write executor.
- One file = one active write owner.
- Planner owns analysis/spec; executor owns production implementation.
- If executor quota changes, preserve branch/SHA/task lineage with a compact handoff instead of rediscovering the project.

## Core ownership

- Native Group V3 runtime belongs to this repository.
- Direct/legacy Timeblock capabilities remain protected by their current Timeblock contracts and must not be silently migrated here.
- Cross-repository work must identify one write owner per repository/file boundary and preserve exact tested SHA pairs where integration requires it.

## QA and release discipline

- No QA execution between implementation phases.
- Freeze candidate commit before final QA.
- Final QA must test that exact candidate tree.
- Full repository QA is not automatic; match verification to task risk.
- GitHub Actions are not an iterative edit/fail/edit loop.
- Do not automatically deploy Render.
- Do not merge main before owner QA PASS.
- Never force-push or rewrite published history.
- Never claim owner/device/manual QA without owner evidence.

## Plugin/tool discipline

Use only task-relevant tools under least privilege. GitHub is normal for repo/PR/SHA work. Render is only for material runtime/deploy/log/env evidence. OpenAI Developers is only for OpenAI/realtime integration. Browser/database/Drive/Slack/Cloudflare tooling is enabled only when the task actually requires it.

## Context discipline

Prefer current source, current SHA, current ownership contracts, task spec, relevant tests and concrete evidence. Do not load old conversations, historical PR narratives, archived workflow versions, or unrelated Timeblock Dev AI material into normal task execution.

## Reporting

Report base/start, PLAN, candidate, tested, PR-head, deploy, paired-repo and final-main SHA values as separate facts. Current v1.3.1 workflow is the only execution authority.