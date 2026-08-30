import argparse
import os
import re
import sys
from urllib.parse import urlparse


def is_true(value: str | None) -> bool:
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', default='runtime', choices=['build', 'runtime'])
    parser.parse_args(argv)

    debug = is_true(os.getenv('DEBUG', 'true'))
    app_env = os.getenv('APP_ENV', 'development').strip().lower()
    is_production = app_env == 'production' or not debug
    secret_key = os.getenv('SECRET_KEY', '')
    public_base_url = os.getenv('PUBLIC_BASE_URL', '')
    timeblock_app_url = os.getenv('TIMEBLOCK_APP_URL', '')
    timeblock_api_url = os.getenv('TIMEBLOCK_API_URL', '')
    timeblock_api_key = os.getenv('TIMEBLOCK_API_KEY', '')
    # Render's immutable build identity is authoritative. DEPLOYMENT_VERSION
    # is only a fallback for non-Render production runtimes.
    deployment_version = (
        os.getenv('RENDER_GIT_COMMIT', '').strip()
        or os.getenv('DEPLOYMENT_VERSION', '').strip()
    )
    fallback_enabled = is_true(os.getenv('ALLOW_DEVELOPMENT_SESSION_FALLBACK', 'false'))
    errors: list[str] = []
    warnings: list[str] = []

    if is_production and len(secret_key) < 32:
        errors.append('SECRET_KEY must contain at least 32 characters in production.')
    if is_production and fallback_enabled:
        errors.append('ALLOW_DEVELOPMENT_SESSION_FALLBACK must be false in production.')

    for variable_name, configured_url in (
        ('PUBLIC_BASE_URL', public_base_url),
        ('TIMEBLOCK_APP_URL', timeblock_app_url),
    ):
        parsed = urlparse(configured_url)
        if is_production and (
            parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
        ):
            errors.append(f'{variable_name} must be a credential-free HTTPS URL in production.')

    if timeblock_api_url:
        parsed = urlparse(timeblock_api_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
            errors.append('TIMEBLOCK_API_URL must be a valid HTTP(S) URL.')
    elif is_production:
        errors.append('TIMEBLOCK_API_URL is required in production.')
    if is_production and len(timeblock_api_key.encode('utf-8')) < 32:
        errors.append('TIMEBLOCK_API_KEY must contain at least 32 bytes in production.')
    if is_production and not re.fullmatch(r'[0-9a-fA-F]{40,64}', deployment_version):
        errors.append(
            'DEPLOYMENT_VERSION or Render-provided RENDER_GIT_COMMIT must contain '
            'the exact 40-64 character hexadecimal deploy SHA in production.'
        )

    legacy_variables = sorted(
        key
        for key in os.environ
        if key.startswith(('BO_', 'RAPID_', 'SLBO_', 'PLATFORM_TREASURY_', 'CRYPTO_MARKET_', 'COINGECKO_', 'BINANCE_', 'EXCHANGE_RATE_'))
        or key in {
            'MEMBER_INITIAL_POINT_BALANCE',
            'MEMBER_REGISTRATION_ENABLED',
            'MEMBER_PORTAL_ENABLED',
            'REAL_MONEY_ENABLED',
            'REAL_CRYPTO_WITHDRAW_ENABLED',
            'LIVE_SETTLEMENT_ENABLED',
        }
    )
    if legacy_variables:
        warnings.append('Legacy variables are ignored and should be removed: ' + ', '.join(legacy_variables))

    for warning in warnings:
        print(f'WARNING: {warning}')
    if errors:
        for error in errors:
            print(f'ERROR: {error}', file=sys.stderr)
        return 1

    print('Environment check passed for Timeblock AI Assistant.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
