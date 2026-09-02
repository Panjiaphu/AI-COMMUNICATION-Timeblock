import argparse
import base64
import os
import re
import sys
from urllib.parse import urlparse


def is_true(value: str | None) -> bool:
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def is_group_encryption_key(value: str | None) -> bool:
    normalized = str(value or '').strip()
    if not normalized:
        return False
    try:
        if len(bytes.fromhex(normalized)) == 32:
            return True
    except ValueError:
        pass
    try:
        return len(
            base64.urlsafe_b64decode(
                (normalized + '=' * (-len(normalized) % 4)).encode('ascii')
            )
        ) == 32
    except (ValueError, UnicodeEncodeError):
        return False


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
    group_v3_enabled = is_true(os.getenv('GROUP_V3_ENABLED', 'false'))
    group_media_enabled = is_true(os.getenv('GROUP_MEDIA_ENABLED', 'false'))
    group_radio_enabled = is_true(os.getenv('GROUP_RADIO_V3_ENABLED', 'false'))
    group_translation_enabled = is_true(os.getenv('GROUP_TRANSLATION_ENABLED', 'false'))
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

    if not group_v3_enabled and any(
        (group_media_enabled, group_radio_enabled, group_translation_enabled)
    ):
        errors.append(
            'GROUP_V3_ENABLED must be true before enabling Group media, radio, or translation.'
        )

    if is_production and group_v3_enabled:
        if os.getenv('GROUP_HANDOFF_AUDIENCE', '').strip() != 'ai-communication-group-v3':
            errors.append(
                'GROUP_HANDOFF_AUDIENCE must be ai-communication-group-v3 in production.'
            )
        database_url = os.getenv('DATABASE_URL', '').strip().lower()
        if not database_url.startswith(
            ('postgresql://', 'postgres://', 'postgresql+psycopg://')
        ):
            errors.append(
                'DATABASE_URL must use PostgreSQL when GROUP_V3_ENABLED is true in production.'
            )
        if not is_group_encryption_key(os.getenv('GROUP_MESSAGE_ENCRYPTION_KEY')):
            errors.append(
                'GROUP_MESSAGE_ENCRYPTION_KEY must decode to exactly 32 bytes.'
            )

        if group_media_enabled:
            livekit_url = urlparse(os.getenv('GROUP_LIVEKIT_URL', '').strip())
            if (
                livekit_url.scheme != 'wss'
                or not livekit_url.hostname
                or livekit_url.username
                or livekit_url.password
            ):
                errors.append(
                    'GROUP_LIVEKIT_URL must be a credential-free WSS URL in production.'
                )
            if not os.getenv('GROUP_LIVEKIT_API_KEY', '').strip():
                errors.append('GROUP_LIVEKIT_API_KEY is required when Group media is enabled.')
            if not os.getenv('GROUP_LIVEKIT_API_SECRET', '').strip():
                errors.append('GROUP_LIVEKIT_API_SECRET is required when Group media is enabled.')
            if os.getenv('GROUP_LIVEKIT_REGION', '').strip() != 'Singapore':
                errors.append('GROUP_LIVEKIT_REGION must remain Singapore.')
            if os.getenv('GROUP_LIVEKIT_TOKEN_TTL_SECONDS', '').strip() != '300':
                errors.append('GROUP_LIVEKIT_TOKEN_TTL_SECONDS must remain 300.')

        if group_radio_enabled:
            if not group_media_enabled:
                errors.append('GROUP_MEDIA_ENABLED must be true when Group Radio is enabled.')
            radio_url = urlparse(os.getenv('GROUP_RADIO_REDIS_URL', '').strip())
            if radio_url.scheme not in {'redis', 'rediss'} or not radio_url.hostname:
                errors.append(
                    'GROUP_RADIO_REDIS_URL must be a valid Redis/Valkey URL when Group Radio is enabled.'
                )
            try:
                lease_seconds = int(os.getenv('GROUP_RADIO_FLOOR_LEASE_SECONDS', '15'))
                heartbeat_seconds = int(os.getenv('GROUP_RADIO_HEARTBEAT_SECONDS', '5'))
            except ValueError:
                errors.append('Group Radio lease and heartbeat values must be integers.')
            else:
                if lease_seconds <= heartbeat_seconds * 2:
                    errors.append(
                        'GROUP_RADIO_FLOOR_LEASE_SECONDS must exceed two heartbeat intervals.'
                    )

        if group_translation_enabled and not os.getenv('OPENAI_API_KEY', '').strip():
            errors.append(
                'OPENAI_API_KEY is required when GROUP_TRANSLATION_ENABLED is true.'
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
