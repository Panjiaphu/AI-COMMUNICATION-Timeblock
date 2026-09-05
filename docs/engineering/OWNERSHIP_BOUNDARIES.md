# AI-COMMUNICATION-Timeblock ownership boundaries

Status: **CANONICAL PRODUCT-ENGINEERING BOUNDARY**
Workflow version: **1.2**
Decision date: **2026-09-05**

This document prevents cross-repository ownership drift between:

- `Panjiaphu/fumap-bot-life` (Timeblock)
- `Panjiaphu/AI-COMMUNICATION-Timeblock` (Guilua)

## 1. Guilua-owned surface

AI-COMMUNICATION-Timeblock owns the native Group communication runtime and its Guilua-specific UI/runtime behavior, including current Group V3 surfaces such as:

- Group Chat/runtime as defined by the current owner-approved Group scope;
- Group Call;
- Group Video Call;
- Group Radio/PTT;
- Group live translation/plugin behavior;
- Group membership/runtime state owned by Guilua;
- Guilua Group UI/PWA/runtime contracts;
- realtime Group media/signaling/runtime behavior implemented in this repository.

Current source/contract evidence in this repository explicitly states that Native Group V3 is fully owned by AI-COMMUNICATION-Timeblock.

## 2. Timeblock-owned/protected surface

Do not silently migrate or duplicate canonical Timeblock ownership into Guilua.

Timeblock remains the source of truth for its own Direct/legacy capabilities and other Timeblock product surfaces according to current contracts. Examples include Direct 1:1 functionality and Timeblock-side control/data-plane responsibilities that are explicitly retained by current contracts.

Historical Direct/legacy compatibility endpoints or presentation in Guilua do not transfer canonical ownership.

## 3. Cross-repository handoff

A cross-system task must declare:

```text
CROSS_SYSTEM=YES
TIMEBLOCK_WRITE_SCOPE=
GUILUA_WRITE_SCOPE=
TIMEBLOCK_PROTECTED_SCOPE=
GUILUA_PROTECTED_SCOPE=
```

One active write owner per repo/file boundary is mandatory.

If only Guilua must change, do not modify Timeblock merely to create parity. If only Timeblock must change, do not modify Guilua merely to create symmetry.

## 4. Exact pair provenance

When both repositories change, final evidence must bind the tested pair:

```text
TIMEBLOCK_CANDIDATE_SHA=
GUILUA_CANDIDATE_SHA=
PAIR_TESTED_TOGETHER=YES|NO
```

If one candidate changes after pair testing, paired evidence is stale and the affected cross-system final gate must be rerun.

## 5. Direct/legacy compatibility

`docs/timeblock-control-plane-contract.md` is a historical Direct/legacy compatibility record for `/communication`. It must not be read as assigning Native Group V3 ownership back to Timeblock.

Current source notes explicitly separate:

- historical Direct/legacy contract behavior; and
- Native Group V3 owned by AI-COMMUNICATION-Timeblock.

## 6. Protected-boundary escalation

If an executor discovers that completing a Guilua task requires changing a Timeblock-owned surface that was not approved in the task:

```text
OWNERSHIP_ESCALATION_REQUIRED=YES
DISCOVERED_BOUNDARY=
CURRENT_REPOSITORY=Panjiaphu/AI-COMMUNICATION-Timeblock
PAIRED_REPOSITORY=Panjiaphu/fumap-bot-life
REASON=
RECOMMENDED_NEXT_SCOPE=
```

Then STOP for ChatGPT/owner re-planning. Do not silently cross the boundary.

## 7. Group realtime risk floor

Group Call, Group Video, Radio/PTT, realtime translation, auth/session handoff, and cross-system identity/permission flows are critical surfaces. Planning must use the critical risk floor from `CODEX_OPERATING_STANDARD.md` and preserve current tested media/auth contracts unless the task explicitly changes them.
