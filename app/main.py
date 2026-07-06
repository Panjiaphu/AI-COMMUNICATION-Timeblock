from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Enum as SQLAlchemyEnum, text

from app.core.config import BASE_DIR, get_settings
from app.core.i18n import resolve_locale
from app.core.security import SessionMiddleware, ensure_admin_bootstrap
from app.db.session import Base, SessionLocal, engine
from app.services import slbo_settlement_guard  # noqa: F401
from app.services import slbo_member_profit_cap  # noqa: F401
from app.services import slbo_exposure_wrapper  # noqa: F401
from app.routers import admin, admin_legacy, admin_member_verification, agent, auth, member, public, slbo, slbo_admin_settings, webhooks
from app.services.commercial import ensure_default_utilities
from app.services.rates import ensure_default_rates
from app.services.referrals import ensure_all_user_referral_identities
from app.services.security_firewall import SecurityFirewallMiddleware, ensure_default_playbooks


POSTGRES_ENUM_NAMES = (
    "transactiontype",
    "transactionstatus",
    "emailstatus",
    "referralcommissiontype",
    "referralcommissionstatus",
    "walletledgertype",
    "sandboxrequesttype",
    "sandboxrequeststatus",
    "gamerequeststatus",
    "boside",
    "rapidplaytype",
    "contentpoststatus",
    "contentpostsource",
    "contentposttype",
)


def _disable_native_enums_for_bootstrap_create_all() -> None:
    """Avoid Render/Postgres startup failures caused by duplicate enum types.

    The app currently bootstraps tables with Base.metadata.create_all(). On a
    partially-created PostgreSQL database, native SQLAlchemy enums can leave an
    enum type behind even when table creation fails. A later deploy then fails
    with DuplicateObject when SQLAlchemy tries to CREATE TYPE again.

    For this sandbox app, storing enum values as VARCHAR during bootstrap is
    sufficient and safer. This keeps startup idempotent on Render Postgres.
    """

    for table in Base.metadata.tables.values():
        for column in table.columns:
            column_type = column.type
            if isinstance(column_type, SQLAlchemyEnum):
                column_type.native_enum = False
                if hasattr(column_type, "create_type"):
                    column_type.create_type = False


def _drop_orphan_postgres_enum_types() -> None:
    """Drop orphan enum types left by failed/partial previous deploys.

    This only drops enum types that are not referenced by table columns in the
    current schema. Enum types still used by existing tables are preserved.
    """

    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as conn:
        for enum_name in POSTGRES_ENUM_NAMES:
            enum_exists = conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_type t
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE t.typname = :enum_name
                          AND n.nspname = current_schema()
                    )
                    """
                ),
                {"enum_name": enum_name},
            ).scalar()
            if not enum_exists:
                continue
            referenced = conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_attribute a
                        JOIN pg_class c ON c.oid = a.attrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE a.atttypid = (
                            SELECT t.oid
                            FROM pg_type t
                            JOIN pg_namespace tn ON tn.oid = t.typnamespace
                            WHERE t.typname = :enum_name
                              AND tn.nspname = current_schema()
                        )
                          AND a.attnum > 0
                          AND NOT a.attisdropped
                          AND c.relkind IN ('r', 'p')
                          AND n.nspname = current_schema()
                    )
                    """
                ),
                {"enum_name": enum_name},
            ).scalar()
            if not referenced:
                conn.execute(text(f'DROP TYPE IF EXISTS "{enum_name}"'))


settings = get_settings()
_disable_native_enums_for_bootstrap_create_all()
_drop_orphan_postgres_enum_types()
Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.app_name, debug=settings.debug)
app.add_middleware(SessionMiddleware)
app.add_middleware(SecurityFirewallMiddleware)
app.mount("/static", StaticFiles(directory=BASE_DIR / "app" / "static"), name="static")


@app.on_event("startup")
def startup_tasks() -> None:
    with SessionLocal() as db:
        ensure_default_rates(db)
        ensure_default_utilities(db)
        ensure_all_user_referral_identities(db)
        ensure_default_playbooks(db)
    ensure_admin_bootstrap()


app.include_router(public.router)
app.include_router(auth.router)
app.include_router(member.router)
app.include_router(admin.router)
app.include_router(admin_member_verification.router)
app.include_router(admin_legacy.router)
app.include_router(slbo.router)
app.include_router(slbo_admin_settings.router)
app.include_router(agent.router)
app.include_router(webhooks.router)


@app.get("/language/{locale}")
def set_language(locale: str, request: Request):
    if locale not in settings.supported_locales:
        locale = settings.default_locale
    redirect = request.headers.get("referer") or "/"
    response = RedirectResponse(redirect)
    response.set_cookie("locale", locale, max_age=60 * 60 * 24 * 365, samesite="lax")
    return response
