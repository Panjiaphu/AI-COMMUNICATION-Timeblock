from app.core.config import Settings
from app.db.session import Database, normalize_database_url


def test_render_postgresql_url_selects_installed_psycopg_v3_driver():
    database_url = "postgresql://db.internal:5432/group_v3"

    normalized = normalize_database_url(database_url)

    assert normalized == (
        "postgresql+psycopg://db.internal:5432/group_v3"
    )


def test_legacy_postgres_url_selects_installed_psycopg_v3_driver():
    database_url = "postgres://db.internal:5432/group_v3"

    normalized = normalize_database_url(database_url)

    assert normalized == (
        "postgresql+psycopg://db.internal:5432/group_v3"
    )


def test_explicit_driver_and_sqlite_urls_are_preserved():
    assert normalize_database_url("postgresql+psycopg://db.internal/group_v3") == (
        "postgresql+psycopg://db.internal/group_v3"
    )
    assert normalize_database_url("sqlite:///./.data/group-v3.sqlite3") == (
        "sqlite:///./.data/group-v3.sqlite3"
    )


def test_database_engine_loads_psycopg_v3_without_connecting():
    database = Database(
        Settings(
            app_env="test",
            database_url="postgresql://db.internal:5432/group_v3",
        )
    )
    try:
        assert database.engine.url.drivername == "postgresql+psycopg"
    finally:
        database.dispose()
