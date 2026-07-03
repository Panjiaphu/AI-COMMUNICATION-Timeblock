import argparse
import os
import sys
from urllib.parse import urlparse


def is_true(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", default="runtime", choices=["build", "runtime"])
    args = parser.parse_args()

    debug = is_true(os.getenv("DEBUG", "true"))
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    is_production = app_env == "production" or not debug
    use_sqlite = is_true(os.getenv("USE_SQLITE", "true"))
    database_url = os.getenv("DATABASE_URL", "")
    secret_key = os.getenv("SECRET_KEY", "")

    warnings = []
    errors = []

    if not debug and not secret_key:
        errors.append("SECRET_KEY must be set when DEBUG=false.")

    if os.getenv("ADMIN_SEED_EMAIL") or os.getenv("ADMIN_SEED_PASSWORD"):
        warnings.append("ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are ignored. Create admins with scripts/create_admin.py.")

    if is_true(os.getenv("ADMIN_BOOTSTRAP_ENABLED", "false")):
        bootstrap_email = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "").strip()
        bootstrap_password = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "")
        if not bootstrap_email:
            errors.append("ADMIN_BOOTSTRAP_EMAIL is required when ADMIN_BOOTSTRAP_ENABLED=true.")
        if not bootstrap_password:
            errors.append("ADMIN_BOOTSTRAP_PASSWORD is required when ADMIN_BOOTSTRAP_ENABLED=true.")
        elif len(bootstrap_password) < 14:
            errors.append("ADMIN_BOOTSTRAP_PASSWORD must be at least 14 characters.")

    if not use_sqlite and not database_url:
        errors.append("DATABASE_URL is required when USE_SQLITE=false.")

    if database_url and not use_sqlite:
        parsed = urlparse(database_url)
        if not parsed.hostname:
            errors.append("DATABASE_URL is set but does not include a database hostname.")

    if database_url and use_sqlite:
        warnings.append("DATABASE_URL is set but ignored because USE_SQLITE=true.")

    if args.phase == "build" and not is_true(os.getenv("RUN_MIGRATIONS_DURING_BUILD", "false")):
        warnings.append("Build will not run migrations. This avoids build failures from unavailable database hosts.")

    for warning in warnings:
        print(f"WARNING: {warning}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Environment check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
