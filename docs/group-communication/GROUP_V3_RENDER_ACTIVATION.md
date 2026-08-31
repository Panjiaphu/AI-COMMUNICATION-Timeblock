# Group Communication V3 Render activation

Status: `READY_FOR_OWNER_DEPLOY_AFTER_INFRA_CONFIG`

This runbook activates the approved native Group Chat, Call, Video, Radio and
translation plugin. It does not change Direct Chat/Call/Video/Translation 1:1.

## Required infrastructure

Before deploying, confirm all three dependencies without printing secrets:

1. A durable PostgreSQL database reachable by AI-COMMUNICATION through
   `DATABASE_URL`.
2. A Redis-compatible Render Key Value/Valkey instance reachable over its
   private URL through `GROUP_RADIO_REDIS_URL`.
3. A LiveKit project in Singapore with a credential-free WSS URL and server
   API credentials.

The existing AI-COMMUNICATION `OPENAI_API_KEY` must be reused. Do not create or
rotate an OpenAI key for Group V3.

## AI-COMMUNICATION service

Keep branch `main`, auto-deploy off, Starter plan and `/readyz/`. Apply the
Blueprint or reconcile these keys in service `srv-d93hlhtaeets73dohu0g`:

```text
GROUP_V3_ENABLED=true
GROUP_HANDOFF_AUDIENCE=ai-communication-group-v3
DATABASE_URL=<existing durable PostgreSQL URL>
GROUP_MESSAGE_ENCRYPTION_KEY=<exactly 32 decoded bytes>
GROUP_MEDIA_ENABLED=true
GROUP_LIVEKIT_URL=wss://<LiveKit host>
GROUP_LIVEKIT_API_KEY=<configured secret>
GROUP_LIVEKIT_API_SECRET=<configured secret>
GROUP_LIVEKIT_REGION=Singapore
GROUP_LIVEKIT_TOKEN_TTL_SECONDS=300
GROUP_RADIO_V3_ENABLED=true
GROUP_RADIO_REDIS_URL=<private Render Key Value URL>
GROUP_RADIO_REDIS_NAMESPACE=ai-communication:group-radio:v3
GROUP_RADIO_FLOOR_LEASE_SECONDS=15
GROUP_RADIO_HEARTBEAT_SECONDS=5
GROUP_RADIO_DEVICE_LOST_SECONDS=10
GROUP_RADIO_MAX_BURST_SECONDS=30
GROUP_RADIO_MAX_ROOMS=20
GROUP_TRANSLATION_ENABLED=true
OPENAI_API_KEY=<keep existing configured value>
```

The service must use:

```text
Build Command: bash scripts/build_render.sh
Pre-Deploy Command: bash scripts/predeploy_render.sh
Start Command: bash scripts/start_render.sh
Health Check Path: /readyz/
```

Deploy AI-COMMUNICATION first. Do not enable the Timeblock launcher until the
exact candidate returns HTTP 200 from `/readyz/` with:

```json
{
  "authority": "ai-communication",
  "contract_version": "3",
  "identity_authority": "timeblock",
  "identity_contract_version": "2",
  "schema_revision": "20260831_0016",
  "capabilities": {
    "group_chat": true,
    "group_media": true,
    "group_radio": true,
    "group_translation": true
  }
}
```

## Timeblock launcher service

After AI readiness passes, set these values on
`srv-d932simrnols73873c7g` and deploy the approved Timeblock candidate:

```text
COMMUNICATION_GROUP_V3_ENABLED=true
COMMUNICATION_GROUP_UI_URL=https://guilua.onrender.com/communication
COMMUNICATION_RUNTIME_URL=https://guilua.onrender.com
COMMUNICATION_GROUP_HANDOFF_AUDIENCE=ai-communication-group-v3
COMMUNICATION_GROUP_HANDOFF_TTL_SECONDS=90
COMMUNICATION_GROUP_HANDOFF_MAX_ACTIVE=8
COMMUNICATION_GROUP_SESSION_TTL_SECONDS=3600
```

Do not change the shared Timeblock/AI server credential during this release.

## Owner acceptance

Use two distinct authenticated accounts and check desktop plus mobile:

- launch Group Chat and exchange real messages in both directions;
- create/join/leave Group Call and Video; verify RINGING does not request media;
- open the translation plugin, grant consent, receive FINAL text, then verify
  Auto Read through a selected private output;
- create/join Group Radio, acquire one floor, observe busy for the second user,
  STOP and verify floor release before FINALIZING/FINAL;
- simulate device loss and verify no private audio is sent to the speaker;
- verify LEAVE does not END FOR ALL and Direct 1:1 still works unchanged.

## Rollback

1. Set `COMMUNICATION_GROUP_V3_ENABLED=false` on Timeblock first.
2. Set the four AI Group feature flags to `false` or redeploy the recorded
   previous known-good AI SHA.
3. Keep the PostgreSQL migration at `20260831_0016`; do not downgrade or delete
   Group tables.
4. Do not rotate or delete provider credentials as part of application
   rollback.
