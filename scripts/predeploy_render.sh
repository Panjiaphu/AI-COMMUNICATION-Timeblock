#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

python scripts/check_env.py --phase runtime
python -m alembic upgrade head
python -m scripts.verify_group_v3_schema
