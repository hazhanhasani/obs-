#!/usr/bin/env bash
set -Eeuo pipefail
export STREAMCORE_FREE_SOURCE_ONLY=1
# shellcheck source=../scripts/telegram-free-setup.sh
source "$(dirname "$0")/../scripts/telegram-free-setup.sh"

parse_args --check
[[ "$ACTION" == check && "$ACK_INTERRUPTION" == false ]]
parse_args --apply --acknowledge-stream-interruption
[[ "$ACTION" == apply && "$ACK_INTERRUPTION" == true ]]
if (parse_args --apply) >/dev/null 2>&1; then
  echo "Unsafe apply unexpectedly accepted without explicit interruption approval" >&2
  exit 1
fi
if (parse_args --check --acknowledge-stream-interruption) >/dev/null 2>&1; then
  echo "Unused interruption acknowledgement unexpectedly accepted" >&2
  exit 1
fi
if (parse_args --nonsense) >/dev/null 2>&1; then
  echo "Unknown argument unexpectedly accepted" >&2
  exit 1
fi
echo "Telegram free VPS profile CLI guards: PASS"
