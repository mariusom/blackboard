#!/usr/bin/env bash
set -euo pipefail
: "${APPLE_SIGNING_IDENTITY:?Import a Developer ID Application certificate first}"
: "${APPLE_TEAM_ID:?Missing Apple Team ID}"
: "${APPLE_ID:?Missing notarization Apple ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Missing notarization password}"
: "${CARGO_PACKAGER_SIGN_PRIVATE_KEY:?Missing updater signing key}"
: "${CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD:?Missing updater signing password}"
: "${UPDATER_PUBLIC_KEY:?Missing embedded updater public key}"

# Only package the app here. Update signatures must be made AFTER Apple stapling.
env -u CARGO_PACKAGER_SIGN_PRIVATE_KEY -u CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD \
  -u APPLE_SIGNING_IDENTITY -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID \
  cargo packager --release --config packager.json --formats app
APP_PATH="bundle/Blackboard.app"
codesign --force --timestamp --options runtime \
  --entitlements assets/macos/entitlements.plist \
  --sign "$APPLE_SIGNING_IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

stapler_with_retry() {
  local action="$1" artifact="$2"
  local attempt=1 max_attempts=5 delay=5 status output
  output=$(mktemp "$RUNNER_TEMP/blackboard-stapler.XXXXXX")
  while true; do
    if xcrun stapler "$action" "$artifact" > "$output" 2>&1; then
      cat "$output"
      rm -f "$output"
      return 0
    else
      status=$?
    fi
    cat "$output" >&2
    # Error 68 also covers invalid tickets. Retry only explicit network failures,
    # including CloudKit's NSURLErrorDomain -1005 seen on hosted macOS runners.
    if [ "$attempt" -ge "$max_attempts" ] ||
      ! LC_ALL=C grep -Eq 'NSURLErrorDomain Code=-(1001|1003|1004|1005|1006|1009)([^0-9]|$)' "$output"; then
      rm -f "$output"
      return "$status"
    fi
    printf 'Apple stapler %s hit a transient network error; retrying (%s/%s) in %ss.\n' \
      "$action" "$((attempt + 1))" "$max_attempts" "$delay" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

notarize() {
  local artifact="$1"
  local staple_target="${2:-$artifact}"
  local result="$RUNNER_TEMP/blackboard-notary-result.json"
  if ! xcrun notarytool submit "$artifact" --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait --timeout 30m --output-format json > "$result"; then
    cat "$result"
    return 1
  fi
  if ! python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["status"] == "Accepted" else 1)' "$result"; then
    local submission_id
    submission_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$result")
    xcrun notarytool log "$submission_id" --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" || true
    return 1
  fi
  stapler_with_retry staple "$staple_target"
  stapler_with_retry validate "$staple_target"
}

# Staple the app itself so the updater archive also works with offline Gatekeeper.
ditto -c -k --keepParent "$APP_PATH" "$RUNNER_TEMP/Blackboard-notarization.zip"
# ZIPs cannot be stapled: submit the ZIP and staple its enclosed app.
notarize "$RUNNER_TEMP/Blackboard-notarization.zip" "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"

VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
DMG_PATH="bundle/Blackboard-${VERSION}-aarch64.dmg"
STAGING_PATH=$(mktemp -d "$RUNNER_TEMP/blackboard-dmg.XXXXXX")
trap 'rm -rf "$STAGING_PATH"' EXIT
ditto "$APP_PATH" "$STAGING_PATH/Blackboard.app"
ln -s /Applications "$STAGING_PATH/Applications"
hdiutil create -volname Blackboard -srcfolder "$STAGING_PATH" -ov -format UDZO "$DMG_PATH"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"
notarize "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"

# Archive only the final stapled app, then sign the exact bytes clients download.
UPDATE_PATH="bundle/Blackboard-aarch64.app.tar.gz"
tar -czf "$UPDATE_PATH" -C bundle Blackboard.app
cargo packager signer sign "$UPDATE_PATH"
test -s "$UPDATE_PATH.sig"
# Detect a wrong public/private key pair before publishing an unusable update.
export UPDATE_PATH
python3 - <<'PY'
import base64, os, pathlib
root = pathlib.Path(os.environ['RUNNER_TEMP'])
(root / 'blackboard-updater.pub').write_bytes(base64.b64decode(os.environ['UPDATER_PUBLIC_KEY'], validate=True))
(root / 'blackboard-updater.minisig').write_bytes(base64.b64decode(pathlib.Path(os.environ['UPDATE_PATH'] + '.sig').read_text(), validate=True))
PY
minisign -Vm "$UPDATE_PATH" -p "$RUNNER_TEMP/blackboard-updater.pub" -x "$RUNNER_TEMP/blackboard-updater.minisig"
(cd bundle && shasum -a 256 "Blackboard-${VERSION}-aarch64.dmg" Blackboard-aarch64.app.tar.gz > SHA256SUMS)
