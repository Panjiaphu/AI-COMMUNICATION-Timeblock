#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

python scripts/check_env.py --phase runtime

gunicorn app.main:app \
  --workers 1 \
  --worker-class uvicorn.workers.UvicornWorker \
  --logger-class app.telemetry.gunicorn.JsonGunicornLogger \
  --bind "0.0.0.0:${PORT:-8000}" \
  --log-file -
