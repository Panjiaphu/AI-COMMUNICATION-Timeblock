from __future__ import annotations

import sys

from app.core.config import Settings
from app.db import Database, GROUP_V3_SCHEMA_REVISION


def main() -> int:
    settings = Settings()
    database = Database(settings)
    try:
        revisions = database.migration_revisions()
    except Exception:
        print("ERROR: Unable to read the Alembic revision after migration.", file=sys.stderr)
        return 1
    finally:
        database.dispose()

    expected = (GROUP_V3_SCHEMA_REVISION,)
    if revisions != expected:
        print(
            f"ERROR: Group V3 schema mismatch; expected {expected[0]}, got {list(revisions)}.",
            file=sys.stderr,
        )
        return 1
    print(f"Group V3 schema is ready at {GROUP_V3_SCHEMA_REVISION}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
