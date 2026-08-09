#!/usr/bin/env bash
set -euo pipefail

echo "LOCAL_QA=ON"
echo "HEAD=$(git rev-parse HEAD)"
python --version

python -m compileall app
python scripts/check_legacy_runtime_absence.py
node --check app/static/communication.js
node --check app/static/service-worker.js

export PYTHONPATH=.
python -m pytest -q
python -m pytest -q tests/browser
python scripts/check_browser_artifacts.py "${BROWSER_QA_ARTIFACT_DIR:?Set BROWSER_QA_ARTIFACT_DIR to a local artifact directory}"
