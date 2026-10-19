#!/usr/bin/env bash
set -Eeuo pipefail
export STREAMCORE_SOURCE_ONLY=1
# shellcheck source=../install.sh
source "$(dirname "$0")/../install.sh"
for name in stream.example.com live-23.example.org a.b; do
  valid_domain "$name" || { echo "Expected valid domain: $name"; exit 1; }
done
for name in '' localhost a.local a.test a.invalid a.example https://example.com example.com/path example..com -example.com example-.com example.com:443; do
  if valid_domain "$name"; then echo "Expected invalid domain: $name"; exit 1; fi
done
parse_domain_arg --domain OBS.BluePanel.ir
[[ "$DOMAIN_CLI" == "obs.bluepanel.ir" ]] || { echo "Long --domain flag failed"; exit 1; }
parse_domain_arg -d live.example.net
[[ "$DOMAIN_CLI" == "live.example.net" ]] || { echo "Short -d flag failed"; exit 1; }
parse_domain_arg
[[ -z "$DOMAIN_CLI" ]] || { echo "Interactive default failed"; exit 1; }
if (parse_domain_arg --domain "https://example.com") >/dev/null 2>&1; then
  echo "Invalid URL incorrectly accepted"; exit 1
fi
echo "Installer domain and CLI tests: PASS"

# Existing .env must preserve arbitrary extra settings and encryption secrets.
test_dir="$(mktemp -d)"
APP_DIR="$test_dir"
ENV_FILE="$test_dir/.env"
printf '%s\n' \
  'STREAM_DOMAIN=old.example.org' 'ADMIN_USERNAME=testadmin' \
  'ADMIN_PASSWORD=abcdefghijklmnopqrstuvwx' \
  'SESSION_SECRET=1234567890123456789012345678901234567890' \
  'SCENE_ENCODER_PRESET=superfast' 'AUTO_UPDATE_ALLOW_LIVE=true' > "$ENV_FILE"
configure "new.example.org"
grep -qx 'STREAM_DOMAIN=new.example.org' "$ENV_FILE"
grep -qx 'SCENE_ENCODER_PRESET=superfast' "$ENV_FILE"
grep -qx 'AUTO_UPDATE_ALLOW_LIVE=true' "$ENV_FILE"
grep -qx 'SESSION_SECRET=1234567890123456789012345678901234567890' "$ENV_FILE"
rm -- "$ENV_FILE"
rmdir -- "$test_dir"
echo "Existing configuration preservation: PASS"
