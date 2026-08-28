# P5 Group Voice Translation Runtime

P5 is the next implementation phase after P4 LiveKit media. Timeblock owns
membership, language profiles and encrypted durable final/corrected events;
AI-COMMUNICATION owns ephemeral translation sidecars and recipient playback.

The browser never receives `OPENAI_API_KEY`. It requests a short-lived secret
from `/api/group-translation/session`; the broker first asks Timeblock for a
membership-bound translation plan, then calls OpenAI's
`/v1/realtime/translations/client_secrets`. The browser reuses a LiveKit remote
audio `MediaStreamTrack`, creates one WebRTC sidecar per target language, and
posts only transcript/translation events back to `/api/group-translation/events`.

`GROUP_TRANSLATION_ENABLED=false` is the safe default. Enabling it requires
the server-only `OPENAI_API_KEY` and a deployed P4 LiveKit session. Raw audio is
not uploaded to Timeblock and no recording is created by this integration.

Release evidence must still include exact merged/live SHAs, OpenAI provider
response, two-user/multi-user language quality, reconnect, leave/end cleanup,
recipient playback behavior and resource-zero checks.
