#!/usr/bin/env bash
# Opt-in low-resource setup for Ubuntu VPS installations of StreamCore.
# No server credentials, stream keys, or environment file contents are printed.
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION=check
ACK_INTERRUPTION=false
COMPOSE=(docker compose -f compose.yaml -f compose.telegram-free.yaml)

fail() { printf '[StreamCore] ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '[StreamCore] %s\n' "$*"; }
warn() { printf '[StreamCore] WARNING: %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
Usage: bash scripts/telegram-free-setup.sh [--check | --apply --acknowledge-stream-interruption]
  --check  : validate this VPS and the optional Compose profile (default).
  --apply  : rebuild and start the low-resource profile.
  --acknowledge-stream-interruption : required with --apply; active broadcasts may be interrupted.
Requires an already installed StreamCore checkout with a private .env file.
If Telegram supplied only an RTMP URL and key, use the dashboard's Telegram
destination instead: that URL is not a Linux VPS for hosting StreamCore.
USAGE
}

parse_args() {
  ACTION=check
  ACK_INTERRUPTION=false
  while (( $# )); do
    case "$1" in
      --check) ACTION=check ;;
      --apply) ACTION=apply ;;
      --acknowledge-stream-interruption) ACK_INTERRUPTION=true ;;
      -h|--help) usage; return 2 ;;
      *) fail "Unknown argument: $1" ;;
    esac
    shift
  done
  if [[ "$ACTION" == apply && "$ACK_INTERRUPTION" != true ]]; then
    fail "--apply requires --acknowledge-stream-interruption."
  fi
  if [[ "$ACTION" != apply && "$ACK_INTERRUPTION" == true ]]; then
    fail "--acknowledge-stream-interruption is only valid with --apply."
  fi
}

preflight() {
  cd -- "$ROOT"
  [[ -f compose.yaml && -f compose.telegram-free.yaml ]] ||
    fail "Compose files not found in $ROOT."
  [[ -f .env ]] ||
    fail "Private .env missing. First run the official install.sh or configure .env safely."
  if grep -Eq '^(ADMIN_PASSWORD|SESSION_SECRET)=(CHANGE_ME|replace-me|change-this-password)$' .env; then
    fail "Replace placeholder credentials in .env before starting."
  fi
  command -v docker >/dev/null 2>&1 || fail "Docker is missing. Run install.sh on Ubuntu first."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
  docker info >/dev/null 2>&1 ||
    fail "Cannot reach Docker daemon. Check permissions and the Docker service."
  "${COMPOSE[@]}" config --quiet ||
    fail "Compose configuration is invalid; verify .env and profile settings."

  local cpu ram_mb free_mb
  cpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf '0')"
  ram_mb="$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || true)"
  free_mb="$(df -Pk "$ROOT" | awk 'NR==2 {print int($4/1024)}')"
  info "Resources: CPU=${cpu:-unknown}, RAM=${ram_mb:-unknown} MiB, free disk=${free_mb:-unknown} MiB."
  if [[ "${cpu:-0}" =~ ^[0-9]+$ ]] && (( cpu < 2 )); then
    warn "Fewer than 2 logical CPUs. Prefer an H.264 file loop; multi-layer scenes may stall."
  fi
  if [[ "${ram_mb:-0}" =~ ^[0-9]+$ ]] && (( ram_mb < 1536 )); then
    warn "Less than 1.5 GiB RAM. Docker builds and layered scenes may run out of memory."
  fi
  if [[ "${free_mb:-0}" =~ ^[0-9]+$ ]] && (( free_mb < 4096 )); then
    warn "Less than 4 GiB disk free. Large uploads, builds and logs may exhaust storage."
  fi
  info "Low-resource profile: H.264 scene preset=ultrafast, threads=1, video=1200 kbps (unless TG_* overrides)."
  info "HLS, HTTPS, dashboard, database, and existing RTMP destinations remain enabled."
  info "Only a real Docker-capable Linux VPS can host this application."
}

apply_profile() {
  cd -- "$ROOT"
  warn "This command can restart containers and interrupt any live broadcasts."
  "${COMPOSE[@]}" up -d --build --remove-orphans ||
    fail "Container deployment failed. Inspect docker compose logs before attempting recovery."
  # The dashboard health endpoint is local to its container; no credentials are needed.
  local attempt
  for attempt in 1 2 3 4 5; do
    if "${COMPOSE[@]}" exec -T dashboard python -c       'from urllib.request import urlopen; import json; assert json.load(urlopen("http://127.0.0.1:8000/health",timeout=5))["ok"] is True'       >/dev/null 2>&1; then
      # Persist the selected Compose overlay without touching credentials.
      # The stable-release updater reads this gitignored marker.
      : > .streamcore-telegram-free-profile
      chmod 600 .streamcore-telegram-free-profile
      info "Dashboard health check: passed."
      info "Low-resource update profile enabled for future stable releases."
      info "Open your existing HTTPS panel, attach a Telegram RTMP(S) destination, and verify actual playback in Telegram."
      return 0
    fi
    sleep 2
  done
  fail "Dashboard health check failed. Inspect: docker compose -f compose.yaml -f compose.telegram-free.yaml logs --tail=100 dashboard"
}

main() {
  parse_args "$@" || return $?
  preflight
  if [[ "$ACTION" == apply ]]; then
    apply_profile
  else
    info "Check complete. No containers, streams, or settings were changed."
  fi
}

if [[ "${STREAMCORE_FREE_SOURCE_ONLY:-0}" != 1 ]]; then
  main "$@"
fi
