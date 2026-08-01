from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PATHS = [ROOT / 'odds', ROOT / 'config', ROOT / 'manage.py', ROOT / 'app' / 'templates' / 'admin', ROOT / 'app' / 'templates' / 'member', ROOT / 'app' / 'templates' / 'auth']
RUNTIME_ROOTS = [ROOT / 'app', ROOT / 'scripts' / 'start_render.sh', ROOT / 'scripts' / 'build_render.sh', ROOT / 'requirements.txt']
FORBIDDEN_RUNTIME_TOKENS = ('import django', 'from django', 'import sqlalchemy', 'from sqlalchemy', 'import alembic', 'from alembic', 'create_all(', 'alembic upgrade', 'app.routers.slbo', 'app.routers.member', 'app.routers.admin')


def iter_runtime_files():
    for item in RUNTIME_ROOTS:
        if item.is_file():
            yield item
        elif item.is_dir():
            for path in item.rglob('*'):
                if path.is_file() and path.suffix in {'.py', '.sh', '.txt', '.html', '.js', '.css'}:
                    yield path


def main() -> int:
    errors = []
    for path in FORBIDDEN_PATHS:
        if path.exists():
            errors.append(f'forbidden active legacy path: {path.relative_to(ROOT)}')
    for path in iter_runtime_files():
        text = path.read_text(encoding='utf-8', errors='ignore').lower()
        for token in FORBIDDEN_RUNTIME_TOKENS:
            if token in text:
                errors.append(f'forbidden runtime token {token!r} in {path.relative_to(ROOT)}')
    if errors:
        print('\n'.join(errors))
        return 1
    print('Legacy runtime absence check passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
