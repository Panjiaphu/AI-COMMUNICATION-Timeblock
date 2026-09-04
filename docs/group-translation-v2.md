# Group Translation V2

Group Video and Group Radio translation use a text-first pipeline owned by
AI-COMMUNICATION. A participant submits text or explicitly records one clip
from the already-connected microphone. The server stores one encrypted
canonical source segment, calls STT once for voice input, and translates once
per distinct recipient language. The API projects only the current recipient's
preferred language; other variants are never returned to that participant.

`PROCESSING`, `FINAL`, `PARTIAL`, and `FAILED` are persisted on the segment and
variant rows. A failed variant can be retried without repeating STT or creating
another source segment. Durable events contain only a space and resource ID;
clients re-read authorized history. Final text is visible before optional
recipient-local `speechSynthesis`; automatic reading is off by default.

The normal Group V3 path does not capture remote audio, publish PTT audio to a
translation service, create a browser provider session, or request a second
microphone. Legacy reservation endpoints remain for compatibility but are not
called by the V2 client.

Endpoints:

- `POST /api/group/spaces/{space}/translation/segments/text`
- `POST /api/group/spaces/{space}/translation/segments/voice`
- `POST /api/group/spaces/{space}/translation/segments/{segment}/variants/{target}/retry`
- `GET /api/group/spaces/{space}/translation/v2-history`
