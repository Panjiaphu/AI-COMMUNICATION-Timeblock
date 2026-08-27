#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python scripts/check_env.py --phase build
python scripts/verify_assistant_source_lock.py
python -m compileall app
