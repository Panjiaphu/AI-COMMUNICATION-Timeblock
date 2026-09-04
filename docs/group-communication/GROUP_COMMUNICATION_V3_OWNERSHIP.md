# Group Communication V3 ownership

Status: `CANONICAL_ARCHITECTURE_LOCKED`

Design status: `PASS_DESIGN_V3_24_OF_24_OWNER_APPROVED`

Last owner correction: `2026-09-01 Asia/Taipei`

## Sole Group owner

`Panjiaphu/AI-COMMUNICATION-Timeblock` exclusively owns and operates:

- Group spaces, memberships, roles and room-scoped authorization;
- durable member/business invitations and membership acceptance state;
- Group Chat UI, messages, reactions, pins, attachments and history;
- Group Call and Group Video UI, LiveKit grants and media lifecycle;
- Group Radio/PTT UI, durable session/history and Valkey floor lifecycle;
- first-party Chat Translation Plugin and Radio Translation Plugin;
- Group consent, usage, audit, retention and provider execution;
- the canonical Group PostgreSQL data model and migrations.

Plugin means only first-party Chat/Radio translation in this release. It is not
a marketplace and not an arbitrary plugin SDK.

## Timeblock boundary

`Panjiaphu/fumap-bot-life` owns platform login/identity, one localized
`Giao tiếp nhóm` icon/launcher and a short-lived one-time identity handoff.
It does not own any Group capability, Group UI/UX, Group durable data, room
permission, provider execution, history, audit, retention or usage.

The AI service may consume the authenticated identity handoff, but all
Group-specific authorization and records are enforced here. Timeblock legacy
Group tables are frozen/read-only and never override AI PostgreSQL.
Timeblock remains the canonical source for login identity and accepted Direct
connections. AI reads those contracts server-to-server; the browser never
chooses canonical principal fields or the initial Group role.

## UI and handoff

Timeblock opens the generic `/communication` webapp. The AI root exposes
Direct plus Group Chat, Group Call, Group Video, Group Radio and Translation.
Users never need a `?surface=` URL.

Handoff codes are short-lived, one-time and exact origin/audience bound. They
never appear in URLs, HTML, logs, `localStorage` or `sessionStorage`.

Locked Lucide references are `users`, `message-circle`, `phone-call`,
`video`, `radio-tower`, `languages` and `puzzle`.

## Infrastructure

AI PostgreSQL is canonical Group storage. Valkey is ephemeral Radio floor
coordination. LiveKit owns media transport state. OpenAI executes the
first-party translation plugins. Existing keys are retained and never printed
or rotated by this release.

`/readyz` reports dependency/config readiness only. Provider synthetics,
exact-tree QA and two-account production acceptance remain separate gates.

## Protected Direct 1:1

Direct Chat/Call/Video/Translation stays in its existing protected path. Group
work must not rewrite it unless a direct regression is proven.
