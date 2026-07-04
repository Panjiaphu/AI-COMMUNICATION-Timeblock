from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Enum as SQLAlchemyEnum, text

from app.core.config import BASE_DIR, get_settings
from app.core.i18n import resolve_locale
from app.core.security import SessionMiddleware, ensure_admin_bootstrap
from app.db.session import Base, SessionLocal, engine
from app.routers import admin, agent, auth, member, public, slbo, webhooks
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

    enum_names = list(POSTGRES_ENUM_NAMES)
    with engine.begin() as conn:
        for enum_name in enum_names:
            conn.execute(
                text(
                    """
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1
                            FROM pg_type t
                            JOIN pg_namespace n ON n.oid = t.typnamespace
                            WHERE t.typname = :enum_name
                              AND n.nspname = current_schema()
                        ) AND NOT EXISTS (
                            SELECT 1
                            FROM pg_attribute a
                            JOIN pg_type t ON a.atttypid = t.oid
                            JOIN pg_class c ON a.attrelid = c.oid
                            JOIN pg_namespace n ON n.oid = t.typnamespace
                            WHERE t.typname = :enum_name
                              AND n.nspname = current_schema()
                              AND c.relkind IN ('r', 'p')
                              AND NOT a.attisdropped
                        ) THEN
                            EXECUTE format('DROP TYPE %I', :enum_name);
                        END IF;
                    END $$;
                    """
                ),
                {"enum_name": enum_name},
            )


def _prepare_database_bootstrap() -> None:
    _disable_native_enums_for_bootstrap_create_all()
    _drop_orphan_postgres_enum_types()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, debug=settings.debug)
    app.add_middleware(SessionMiddleware)
    app.add_middleware(SecurityFirewallMiddleware)
    app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")
    app.include_router(public.router)
    app.include_router(auth.router)
    app.include_router(member.router)
    app.include_router(slbo.router)
    app.include_router(admin.router)
    app.include_router(agent.router)
    app.include_router(webhooks.router)

    @app.on_event("startup")
    def startup() -> None:
        _prepare_database_bootstrap()
        Base.metadata.create_all(bind=engine)
        ensure_admin_bootstrap()
        with SessionLocal() as db:
            ensure_default_rates(db)
            ensure_default_utilities(db)
            ensure_default_playbooks(db)
            ensure_all_user_referral_identities(db)

    @app.middleware("http")
    async def locale_cookie(request: Request, call_next):
        response = await call_next(request)
        locale = resolve_locale(request)
        response.set_cookie("lang", locale, max_age=60 * 60 * 24 * 365, samesite="lax")
        return response

    @app.get("/healthz/")
    def healthz():
        return {"status": "ok", "app": settings.app_name}

    @app.get("/dashboard")
    def dashboard_redirect():
        return RedirectResponse("/member", status_code=303)

    return app


app = create_app()
