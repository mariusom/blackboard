#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${APPLE_CERTIFICATE:?Missing base64 Developer ID Application .p12}"
: "${APPLE_CERTIFICATE_PASSWORD:?Missing .p12 export password}"
: "${APPLE_TEAM_ID:?Missing Apple Team ID}"
: "${RUNNER_TEMP:?This script runs in GitHub Actions}"

KEYCHAIN_PATH="$RUNNER_TEMP/blackboard-signing.keychain-db"
CERTIFICATE_PATH="$RUNNER_TEMP/blackboard-signing.p12"
KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
echo "::add-mask::$KEYCHAIN_PASSWORD"
export KEYCHAIN_PATH
python3 - <<'PY'
import base64, json, os, pathlib, shlex, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP'])
original = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
(root / 'blackboard-original-keychains.json').write_text(json.dumps(original))
(root / 'blackboard-signing.p12').write_bytes(base64.b64decode(os.environ['APPLE_CERTIFICATE'], validate=True))
PY
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERTIFICATE_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -k "$KEYCHAIN_PATH" -T /usr/bin/codesign -T /usr/bin/security
rm -f "$CERTIFICATE_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null
python3 - <<'PY'
import json, os, pathlib, re, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP'])
original = json.loads((root / 'blackboard-original-keychains.json').read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', os.environ['KEYCHAIN_PATH'], *original], check=True)
team = os.environ['APPLE_TEAM_ID']
if not re.fullmatch(r'[A-Z0-9]{10}', team):
    raise SystemExit('APPLE_TEAM_ID must be the 10-character Apple team identifier')
identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', os.environ['KEYCHAIN_PATH']], text=True)
matches = re.findall(r'([A-Fa-f0-9]{40}) "Developer ID Application: [^"\n]+ \(' + re.escape(team) + r'\)"', identities)
if len(matches) != 1:
    raise SystemExit('The .p12 must hold exactly one valid Developer ID Application identity, including its private key, for APPLE_TEAM_ID')
with open(os.environ['GITHUB_ENV'], 'a') as env:
    env.write('APPLE_SIGNING_IDENTITY=' + matches[0] + '\n')
PY
