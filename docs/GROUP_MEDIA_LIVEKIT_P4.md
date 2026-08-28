# Group media LiveKit P4 boundary

AI-COMMUNICATION does not own membership, rooms, or provider credentials.
Timeblock remains the authority and the only service that signs the LiveKit
participant JWT.

The canonical BFF route is already allowlisted:

`POST /api/messaging/call-rooms/{room_id}/media/session`

The BFF forwards the opaque Timeblock client session in
`X-Timeblock-Client-Session`; browser cookies and the Timeblock server API key
never cross into application JavaScript. The response is validated in memory
with `parse_group_media_session()` before a future LiveKit client consumes it.

The parser accepts only the approved `livekit-cloud` provider, `ws`/`wss`
server URL, `audio`/`video`, Singapore region, 8 participants, a 300-second
token TTL, a 3,600-second room window, and explicit recording/raw-media
storage disabled flags. It never persists or logs the JWT.

This P4 candidate does not add an SFU browser SDK or call `getUserMedia()`.
Those media lifecycle and device checks remain the next media-client gate.
