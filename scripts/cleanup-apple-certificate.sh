#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import json, os, pathlib, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP'])
saved = root / 'blackboard-original-keychains.json'
if saved.exists():
    original = json.loads(saved.read_text())
    subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *original], check=True)
keychain = root / 'blackboard-signing.keychain-db'
if keychain.exists():
    subprocess.run(['security', 'delete-keychain', str(keychain)], check=True)
(root / 'blackboard-signing.p12').unlink(missing_ok=True)
saved.unlink(missing_ok=True)
PY
