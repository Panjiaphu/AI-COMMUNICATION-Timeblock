# Group media LiveKit P4 boundary

AI-COMMUNICATION owns Group membership, rooms and server-side provider grants.
The Group LiveKit API key and secret remain server-only on the AI Render
service; the browser receives only a short-lived participant JWT after AI
room authorization succeeds.

Canonical native endpoint:

`POST /api/group/spaces/{space_id}/media/sessions`

Legacy BFF forwarding routes are Direct/compatibility paths and are not the
Group V3 authority.

The native grant accepts only the configured credential-free `wss` LiveKit
URL, audio/video mode, Singapore region, bounded participants and a 300-second
token TTL. JWTs are never logged or persisted.

## Browser media runtime

The Group media client is the sole browser device owner. It creates one
LiveKit room, acquires only requested microphone/camera tracks, publishes local
tracks and renders remote media. Every leave, disconnect, denied permission,
device loss, error and page unload path must stop all tracks, clear media
elements, disconnect the room and reach resource zero.

Real two-account, reconnect, device-permission and resource-zero verification
requires the existing LiveKit project and deployed server-only secrets.
`/readyz` and a synthetic provider call are not product acceptance.
