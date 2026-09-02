# Group Radio V3 P7–P10 contract

Status: `V3_NATIVE_OWNER`

This document supersedes the former hybrid contract. Timeblock is not the
system of record for new Group Radio sessions or history.

## Ownership

AI-COMMUNICATION owns Group spaces and membership, Radio session status,
distributed floor leases, bursts, consent, encrypted FINAL/corrected
translation history, recipient TTS state and audit. Timeblock owns identity,
account status, entitlement, billing/quota grants and the one-time Handoff V3.

## P7 floor

Each session uses the configured Valkey namespace plus
`:floor:<session_id>`. A room has one active lease. The lease expires after the
configured interval and is released before downstream STT/translation/TTS.
A burst cannot exceed 30 seconds and a deployment may have at most 20 active
Radio rooms.

## P8 translation

The native Group Translation broker issues only short-lived OpenAI client
secrets. The server-only OpenAI key is never returned to the browser. Partial
events are not persisted or sent to TTS. FINAL/corrected events are stored by
AI-COMMUNICATION without raw audio; FINAL text is visible before Auto Read.

## P9 retrieval

History is authorized, decrypted and returned directly by AI-COMMUNICATION
after validating the native Group HttpOnly session and active membership.
Timeblock is never used as a Group Radio data proxy.

## P10 teardown

STOP releases the distributed floor before changing a burst to FINALIZING or
FINAL. LEAVE never means END FOR ALL. DEVICE_LOST releases the floor and
suppresses private audio/Auto Read. Physical-device and multi-account QA
remain owner acceptance evidence after deployment.
