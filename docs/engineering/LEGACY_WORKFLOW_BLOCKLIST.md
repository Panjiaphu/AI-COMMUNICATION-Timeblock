# Legacy workflow blocklist

Status: **ACTIVE BLOCKLIST**
Canonical workflow: **v1.3.1**

For normal AI-COMMUNICATION-Timeblock engineering tasks, ChatGPT and Codex must not plan or execute from any older workflow version or historical instruction that conflicts with v1.3.1.

Blocked workflow classes include:

- `CODEX_OPERATING_STANDARD` v1.2 content and its historical revisions;
- Planner/Executor v1.3 historical revisions when they differ from current v1.3.1;
- direct-main-before-owner-QA instructions;
- long-lived-Codex-thread / ad-hoc patch-loop instructions;
- old automatic Luna/Terra/Sol/Astra score routing as the default policy;
- iterative hosted-CI edit/fail/edit loops;
- stale PR comments, conversation prompts, memories, archived skills or Git-history versions that conflict with the current repository instructions.

Allowed use of old material is limited to historical investigation. It must never become the execution authority.

Current execution order:

1. `AGENTS.md`
2. `docs/engineering/CHATGPT_CODEX_PLANNER_EXECUTOR_STANDARD.md` v1.3.1
3. exact current ownership/security/release docs named by the task spec
4. `docs/qa/<TASK_ID>.md`
5. relevant current source/tests

If instruction versions are ambiguous, STOP and resolve against current `main`/approved task lineage before editing production code.