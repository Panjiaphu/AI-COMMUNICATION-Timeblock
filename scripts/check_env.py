import argparse
import os
import sys
from urllib.parse import urlparse


def is_true(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", default="runtime", choices=["build", "runtime"])
    parser.parse_args()

    debug = is_true(os.getenv("DEBUG", "true"))
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    is_production = app_env == "production" or not debug
    secret_key = os.getenv("SECRET_KEY", "")
    timeblock_api_url = os.getenv("TIMEBLOCK_API_URL", "")
    errors: list[str] = []
    warnings: list[str] = []

    if is_production and len(secret_key) < 32:
        errors.append("SECRET_KEY must contain at least 32 characters in production.")

    if timeblock_api_url:
        parsed = urlparse(timeblock_api_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            errors.append("TIMEBLOCK_API_URL must be a valid HTTP(S) URL.")
    elif is_production:
        warnings.append("TIMEBLOCK_API_URL is not configured; production session authorization is unavailable.")

    legacy_variables = sorted(
        key
        for key in os.environ
        if key.startswith(("BO_", "RAPID_", "SLBO_", "PLATFORM_TREASURY_", "CRYPTO_MARKET_", "COINGECKO_", "BINANCE_", "EXCHANGE_RATE_"))
        or key in {
            "MEMBER_INITIAL_POINT_BALANCE",
            "MEMBER_REGISTRATION_ENABLED",
            "MEMBER_PORTAL_ENABLED",
            "REAL_MONEY_ENABLED",
            "REAL_CRYPTO_WITHDRAW_ENABLED",
            "LIVE_SETTLEMENT_ENABLED",
        }
    )
    if legacy_variables:
        warnings.append("Legacy variables are ignored and should be removed: " + ", ".join(legacy_variables))

    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Environment check passed for Guilua Communication Runtime.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
