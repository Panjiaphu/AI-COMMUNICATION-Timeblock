# Vendored Timeblock Communication presentation layer

This directory is a local, source-locked copy of the Timeblock Communication
presentation layer. It is not loaded from GitHub or another network source at
runtime.

- Source repository: `Panjiaphu/fumap-bot-life`
- Source SHA: `1ca83486c8985f2c28d60a767be9b30a68701dae`
- Lock file: `SOURCE_LOCK.json`
- Sync command: `python scripts/sync_timeblock_communication_ui.py ...`

The CSS and HTML are preserved as `EXACT_VENDOR`. JavaScript is classified as
`ADAPTED_VENDOR` because it expects the Timeblock same-origin session, routes,
translation function, and DOM shell. Guilua must adapt those runtime bindings
only after the secure Communication Client Contract exists.

The vendored files are reference and controlled migration inputs. They do not
grant Guilua ownership of Timeblock identity, conversations, messages, media,
permissions, audit, retention, or durable storage.
