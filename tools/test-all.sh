#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
python3 worker/cloud_entry.py verify
node --test webapp/test/*.test.cjs test/parsers.test.js tools/*.test.cjs
python3 -m unittest discover -s test -p 'test_*.py'
python3 selftest.py
node webapp/tools/package.cjs
# Example placeholders must not become a deployable configuration.
if node tools/check-config.cjs config/profile.example.json; then exit 1; fi
python3 tools/demo.py "$(mktemp -d)"
