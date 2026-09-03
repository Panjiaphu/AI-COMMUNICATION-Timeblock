# Vendored Timeblock Assistant UI

This directory is a local source-locked migration input copied from
`Panjiaphu/fumap-bot-life`. It is not loaded from a network source at runtime.

- Source SHA: `c12e37f8137552159d7756cf3d96eab0d812585f`
- Lock: `SOURCE_LOCK.json`
- Sync: `python scripts/sync_timeblock_assistant_ui.py ...`

The synchronizer reads blobs from the pinned Git commit object database, so
Windows checkout line-ending filters cannot change the locked source bytes.
The four paths listed under `preserved_legacy_unmanaged` are rollback-only
legacy files; they are outside the canonical runtime/destination graph.

The templates and assets are controlled inputs for the Guilua Assistant shell.
Timeblock remains the authority for identity, quota, AI history, messaging,
media, permissions, audit and retention. No local database or production mock
is created by this vendor copy.
