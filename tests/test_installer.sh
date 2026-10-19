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
echo "Installer domain validation: PASS"
