# Legacy database retirement plan

Status: application code removal only. No production table has been dropped by this refactor.

## Safety gate

Before any destructive migration:

1. Confirm the active production database and deployed SHA.
2. Export and verify a restorable backup.
3. Confirm no production traffic or external consumer uses legacy endpoints.
4. Inventory foreign keys, enum types, triggers, and background jobs.
5. Review and approve a dedicated destructive migration.
6. Test upgrade and downgrade against a production-shaped copy.
7. Deploy separately from the Communication Runtime foundation.

## Retirement status vocabulary

- `APPLICATION_CODE_REMOVED`
- `PRODUCTION_TABLE_NOT_DROPPED`
- `BACKUP_REQUIRED`
- `CONSUMER_CHECK_REQUIRED`
- `SEPARATE_DESTRUCTIVE_MIGRATION_REQUIRED`

These statuses apply to every domain below.

## Legacy SQLAlchemy domain groups pending live-schema verification

Exact production table/type names and presence must be verified from the live schema before any DROP statement:

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

Historical Alembic files remain as `LEGACY_SCHEMA_EVIDENCE`. They are not imported or executed by the new Render build/start path.

## Removed Django odds application

The retired Django models and migrations identified these expected table names under Django's default naming convention:

- `odds_oddsimportbatch`
- `odds_marketline`
- `odds_ticket`
- Django framework tables such as `django_migrations`, `django_session`, `auth_*`, and `django_admin_log` may also exist if the old Django application was deployed against the production database.

Status for this group:

```text
APPLICATION_CODE_REMOVED
PRODUCTION_TABLE_NOT_DROPPED
BACKUP_REQUIRED
CONSUMER_CHECK_REQUIRED
SEPARATE_DESTRUCTIVE_MIGRATION_REQUIRED
```

The repository no longer contains the Django project configuration, `manage.py`, `odds` models, services, views, routes, tests, templates, static assets, or Django migration code. This does not prove that the database tables are absent.

## Current application behavior

The Communication Runtime does not import Django, SQLAlchemy, or Alembic; create a database engine; call `Base.metadata.create_all`; run migrations; patch PostgreSQL enum types; or initialize rates, wallets, treasury, referrals, members, or admin accounts.

Legacy URLs return 404 because their routers and Django URL configuration are removed.

## Decision

Do not delete legacy production data in PR #1. Perform retirement only in a separately reviewed migration after backup, live-schema inspection, consumer verification, and explicit approval.
