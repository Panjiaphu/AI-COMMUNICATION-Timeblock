# Legacy database retirement plan

Status: application code removal only. No production table has been dropped by this refactor.

## Safety gate

Before any destructive migration:

1. Confirm the active production database and deployed SHA.
2. Export and verify a restorable backup.
3. Confirm no production traffic or external consumer uses legacy endpoints.
4. Inventory foreign keys, enum types, triggers, and background jobs.
5. Review and approve a dedicated Alembic migration.
6. Test upgrade and downgrade against a production-shaped copy.
7. Deploy separately from the Communication Runtime foundation.

## Legacy tables and types pending verification

The pre-refactor application referenced the following domain groups. Exact production names and presence must be verified from the live schema before writing DROP statements:

- users and legacy member authentication/profile tables;
- transaction requests and sandbox transactions;
- internal wallets and point ledger entries;
- direct point transfers;
- platform treasury accounts and platform ledger entries;
- BO orders, BO side/status enum types, session results, and chart state;
- Rapid entries, result boards, play types, and game request status;
- affiliate/referral identities, policies, relationships, and commissions;
- manually managed exchange rates;
- content posts, admin operations, email logs, and verification records;
- security dashboard/firewall persistence created for the old admin portal.

Historical Alembic files remain temporarily as schema evidence. They are not executed by the new Render build or start scripts.

## Current application behavior

The Communication Runtime does not import SQLAlchemy models, create a database engine, call `Base.metadata.create_all`, run Alembic, patch PostgreSQL enum types, or initialize rates, wallets, treasury, referrals, members, or admin accounts.

Legacy URLs are expected to return 404 because their routers are no longer registered.

## Decision

Do not delete legacy production data in the foundation PR. Perform retirement only in a separately reviewed migration after backup and consumer verification.
