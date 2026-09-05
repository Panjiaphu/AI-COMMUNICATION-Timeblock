# AI-COMMUNICATION-Timeblock engineering contract

## Highest-precedence engineering workflow

Read these before planning or implementing product-engineering tasks:

1. `docs/engineering/CODEX_OPERATING_STANDARD.md`
2. `docs/engineering/OWNERSHIP_BOUNDARIES.md`
3. `docs/engineering/RELEASE_WORKFLOW.md`

These documents define the owner-approved Timeblock/Guilua workflow version `1.2` for ChatGPT planning, Codex execution, executor handoff, plugin/tool routing, final-only QA, exact-SHA handoff, owner deployment QA, corrective work, and merge behavior.

If an older workflow document conflicts with these files, the v1.2 engineering documents above win for normal product-engineering tasks.

## Canonical path

```text
owner task report
-> ChatGPT 5.6 Sol Deep/Pro plans, scores, selects workflow lane/model/plugins
-> Codex is preferred executor while suitable quota/model is available
-> if executor changes, continue through HANDOFF_PACKET on the same task/branch/lineage
-> inspect only relevant source
-> implement all production changes
-> write/update test source
-> NO QA between implementation phases
-> create/freeze local candidate commit
-> ONE final local QA gate against that exact candidate
-> push same candidate to dedicated branch/PR
-> report exact tested SHA and STOP
-> owner manually deploys exact SHA
-> owner manual QA
   -> PASS: verify no drift, merge through PR, report main SHA
   -> FAIL: ChatGPT re-plans/re-scores and issues R1/R2 corrective work
```

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
- Candidate SHA, PR head SHA, and deploy test SHA must identify the same tested code tree.
- Owner physical/manual QA is authoritative and must never be inferred by ChatGPT or Codex.
- Do not automatically deploy Render unless the owner explicitly requests it.

## Plugin/tool discipline

Enable only task-relevant integrations. GitHub is the normal repo/PR/SHA tool. Render is only for runtime/deploy/log/env evidence when material. OpenAI Developers is only for OpenAI API/realtime integration work. Browser tooling is used only when UI/runtime verification is required. Broader plugin permissions require explicit re-planning.

## Context discipline

Prefer current source, current SHA, current contracts, relevant tests, actual logs/screenshots, and exact defect evidence. Do not load historical PR narratives or unrelated Timeblock Dev AI materials unless the task explicitly requires them.
