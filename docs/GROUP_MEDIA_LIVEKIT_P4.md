# Group media LiveKit P4 boundary

AI-COMMUNICATION does not own membership, rooms, or provider credentials.
Timeblock remains the authority and the only service that signs the LiveKit
participant JWT.

The canonical BFF route is already allowlisted:

`POST /api/messaging/call-rooms/{room_id}/media/session`

The BFF forwards the opaque Timeblock client session in
`X-Timeblock-Client-Session`; browser cookies and the Timeblock server API key
never cross into application JavaScript. The response is validated in memory
with `parse_group_media_session()` before the Group-only LiveKit client
consumes it.

The parser accepts only the approved `livekit-cloud` provider, `ws`/`wss`
server URL, `audio`/`video`, Singapore region, 8 participants, a 300-second
token TTL, a 3,600-second room window, and explicit recording/raw-media
storage disabled flags. It never persists or logs the JWT.

## Browser media runtime

`app/static/group-ui/livekit_group_session.js` is the sole Group-media device
owner. It receives a validated, in-memory session only after the Timeblock
room join succeeds, creates one LiveKit `Room`, calls `getUserMedia()` only for
the selected `audio` or `video` mode, publishes local tracks, and renders
remote media. The client SDK is pinned to LiveKit `2.21.0` with SRI in
`communication.html`.

Leaving, rejection, disconnect, failed connection, and page unload all run
the same terminal cleanup: stop every local `MediaStreamTrack`, clear media
elements, disconnect the room, and best-effort notify Timeblock of the leave.
No media token is logged, persisted, or exposed to the surrounding Group UI.

The browser implementation is static-test covered; real two-user,
multi-user, reconnect, device-permission, and resource-zero verification
still require a provisioned LiveKit Cloud project and deployed Render secrets.
