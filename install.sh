#!/usr/bin/env bash
# StreamCore zero-touch VPS bootstrap. Domain is read from /dev/tty.
# Usage: curl -fsSL https://raw.githubusercontent.com/hazhanhasani/obs-/main/install.sh | sudo bash
set -Eeuo pipefail
umask 077

REPO_URL="https://github.com/hazhanhasani/obs-.git"
APP_DIR="/opt/streamcore"
ENV_FILE="$APP_DIR/.env"

info() { printf '\033[1;36m[StreamCore]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[StreamCore ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

valid_domain() {
  local domain="$1" label
  [[ "$domain" == *.* && "$domain" =~ ^[a-z0-9.-]+$ ]] || return 1
  [[ "$domain" != *..* && "$domain" != .* && "$domain" != *. ]] || return 1
  [[ "$domain" != *.local && "$domain" != *.invalid && "$domain" != *.test && "$domain" != *.example ]] || return 1
  [[ $(printf '%s' "$domain" | wc -c) -le 253 ]] || return 1
  local IFS='.'
  read -r -a labels <<< "$domain"
  for label in "${labels[@]}"; do
    [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
    [[ $(printf '%s' "$label" | wc -c) -le 63 ]] || return 1
  done
}

env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  case "$key" in STREAM_DOMAIN|ADMIN_USERNAME|ADMIN_PASSWORD|SESSION_SECRET) ;; *) return 1 ;; esac
  sed -n "s/^$key=//p" "$ENV_FILE" | head -n 1
}

get_domain() {
  local default="$1" input=""
  [[ -r /dev/tty ]] || die "Interactive SSH terminal unavailable. Use --domain YOUR_DOMAIN instead."
  while :; do
    printf 'Enter domain%s: ' "$(test -n "$default" && printf ' [%s]' "$default" || true)" > /dev/tty
    if ! IFS= read -r -t 90 input < /dev/tty; then
      die "Terminal input timeout (90 seconds). Re-run with --domain YOUR_DOMAIN."
    fi
    input="$(printf '%s' "$input" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
    input="${input%.}"
    [[ -n "$input" ]] || input="$default"
    if valid_domain "$input"; then
      DOMAIN_INPUT="$input"
      info "Domain accepted: $DOMAIN_INPUT"
      return 0
    fi
    printf 'Invalid domain. Use a public DNS hostname without protocol/path.\n' > /dev/tty
  done
}

parse_domain_arg() {
  DOMAIN_CLI="${STREAMCORE_DOMAIN:-}"
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --domain|-d)
        [[ "$#" -ge 2 && -n "$2" ]] || die "Missing value for --domain"
        DOMAIN_CLI="$2"
        shift 2
        ;;
      --help|-h)
        printf 'Usage: bash install.sh [--domain YOUR_DOMAIN]\n'
        exit 0
        ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  if [[ -n "$DOMAIN_CLI" ]]; then
    DOMAIN_CLI="$(printf '%s' "$DOMAIN_CLI" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
    DOMAIN_CLI="${DOMAIN_CLI%.}"
    valid_domain "$DOMAIN_CLI" || die "Invalid domain: use a public DNS hostname."
  fi
}

prerequisites() {
  [[ $(id -u) -eq 0 ]] || die "Run this installer using sudo or as root."
  [[ -f /etc/os-release ]] || die "Ubuntu Linux is required."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "$ID" == ubuntu ]] || die "This installer requires Ubuntu Linux."
  local major
  major="$(printf '%s' "$VERSION_ID" | cut -d. -f1)"
  [[ "$major" =~ ^[0-9]+$ && "$major" -ge 22 ]] || die "Ubuntu 22.04 or newer required."
  [[ -d /run/systemd/system ]] || die "systemd is required; container-only hosts are unsupported."
  export DEBIAN_FRONTEND=noninteractive
  info "Installing prerequisites..."
  apt-get update -qq || die "Failed to update apt"
  apt-get install -y -qq ca-certificates curl git openssl gnupg python3 util-linux >/dev/null || die "Failed to install prerequisites"
}

dns_check() {
  local domain="$1" public addresses
  info "Checking DNS A record against VPS public IPv4..."
  public="$(curl -4 -fsS --connect-timeout 6 --max-time 12 https://api.ipify.org)" || die "Cannot detect public IPv4."
  [[ "$public" =~ ^[0-9.]+$ ]] || die "Invalid public IPv4."
  addresses="$(timeout 15s getent ahostsv4 "$domain" | awk '$2 == "STREAM" {print $1}' | sort -u || true)"
  [[ -n "$addresses" ]] || die "DNS lookup failed or timed out (15s). Point $domain A record to $public, then retry."
  grep -Fxq "$public" <<< "$addresses" || die "DNS mismatch. Set $domain A record to $public and disable CDN proxying for installation."
  info "DNS IPv4 points to this VPS. Remove stale AAAA records if they point elsewhere."
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    info "Docker and Compose found."
  else
    info "Installing Docker Engine and Compose..."
    # shellcheck disable=SC1091
    . /etc/os-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc || die "Docker signing key download failed."
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$(printf '%s' "$VERSION_CODENAME")" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq || die "Docker apt repository unavailable."
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null || die "Docker installation failed."
  fi
  systemctl enable --now docker >/dev/null || die "Cannot start Docker service."
  docker compose version >/dev/null || die "Docker Compose plugin unavailable."
}

check_ports() {
  if [[ ! -f "$ENV_FILE" ]] && command -v ss >/dev/null 2>&1; then
    if ss -H -ltn '( sport = :80 or sport = :443 )' | grep -q .; then
      die "Ports 80/443 are occupied. Stop the existing web server before installation."
    fi
  fi
}

get_project() {
  [[ ! -L "$APP_DIR" ]] || die "$APP_DIR cannot be a symlink."
  if [[ -d "$APP_DIR/.git" ]]; then
    local origin
    origin="$(git -C "$APP_DIR" remote get-url origin || true)"
    [[ "$origin" == "$REPO_URL" ]] || die "The existing folder contains a different Git repository."
    [[ -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]] || die "Local project changes detected; refusing to overwrite."
    info "Updating existing StreamCore installation..."
    git -C "$APP_DIR" fetch --quiet origin main
    git -C "$APP_DIR" merge --ff-only --quiet origin/main || die "Fast-forward update failed."
  elif [[ -e "$APP_DIR" ]]; then
    die "$APP_DIR already exists and is not a StreamCore checkout."
  else
    info "Downloading StreamCore..."
    git clone --quiet --depth 1 --branch main "$REPO_URL" "$APP_DIR" || die "Cannot clone repository."
  fi
  mkdir -p "$APP_DIR/media"
}

configure() {
  local domain="$1" username password secret tmp old_domain
  username="$(env_value ADMIN_USERNAME)"
  password="$(env_value ADMIN_PASSWORD)"
  secret="$(env_value SESSION_SECRET)"
  if [[ -f "$ENV_FILE" ]]; then
    [[ $(printf '%s' "$password" | wc -c) -ge 12 && $(printf '%s' "$secret" | wc -c) -ge 32 ]] ||
      die "Existing .env credentials invalid; refusing to overwrite encrypted destination keys."
    [[ -n "$username" ]] || username="admin"
    old_domain="$(env_value STREAM_DOMAIN)"
    if [[ "$domain" != "$old_domain" ]]; then
      tmp="$(mktemp "$APP_DIR/.env.XXXXXXXX")"
      # Only the hostname changes. Preserve custom encoder and auto-update settings.
      awk -v value="$domain" 'BEGIN{seen=0}
        /^STREAM_DOMAIN=/ {print "STREAM_DOMAIN="value;seen=1;next}
        {print}
        END{if(!seen)print "STREAM_DOMAIN="value}' "$ENV_FILE" > "$tmp"
      chmod 600 "$tmp"
      mv -f "$tmp" "$ENV_FILE"
    fi
    info "Preserving existing credentials, stream encryption and custom .env settings."
  else
    username="admin_$(openssl rand -hex 3)"
    password="$(openssl rand -hex 20)"
    secret="$(openssl rand -hex 32)"
    tmp="$(mktemp "$APP_DIR/.env.XXXXXXXX")"
    {
      printf 'STREAM_DOMAIN=%s\n' "$domain"
      printf 'ADMIN_USERNAME=%s\n' "$username"
      printf 'ADMIN_PASSWORD=%s\n' "$password"
      printf 'SESSION_SECRET=%s\n' "$secret"
      printf 'COOKIE_SECURE=true\nMAX_UPLOAD_MB=1024\n'
      printf 'AUTO_UPDATE_ENABLED=true\nAUTO_UPDATE_ALLOW_LIVE=false\n'
    } > "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$ENV_FILE"
  fi
  LOGIN_USERNAME="$username"
  LOGIN_PASSWORD="$password"
}

start_stack() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    info "Allowing HTTPS/HTTP through existing UFW..."
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
  fi
  info "Validating and starting Docker services..."
  (cd "$APP_DIR" && docker compose config --quiet) || die "Invalid Docker Compose configuration."
  (cd "$APP_DIR" && docker compose up -d --build --remove-orphans) || die "Containers failed to start. Inspect docker compose ps."
}

check_https() {
  local domain="$1" attempt reply
  info "Waiting for Caddy to issue a trusted SSL certificate..."
  for ((attempt=1;attempt<=24;attempt++)); do
    reply="$(curl --noproxy '*' -fsS --max-time 8 "https://$domain/health" 2>/dev/null)" || reply=""
    if [[ "$reply" == *'"ok":true'* ]]; then
      info "Valid HTTPS certificate and application health confirmed."
      return 0
    fi
    sleep 5
  done
  die "HTTPS validation failed. Verify DNS (including AAAA), provider firewall and ports 80/443. Inspect: cd /opt/streamcore && docker compose logs caddy"
}

main() {
  parse_domain_arg "$@"
  prerequisites
  info "StreamCore interactive one-command installation"
  local domain old
  old="$(env_value STREAM_DOMAIN)"
  if [[ -n "$DOMAIN_CLI" ]]; then
    domain="$DOMAIN_CLI"
    info "Using domain: $domain (non-interactive mode)"
  else
    get_domain "$old"
    domain="$DOMAIN_INPUT"
  fi
  info "Domain selected. Checking DNS..."
  dns_check "$domain"
  check_ports
  install_docker
  get_project
  configure "$domain"
  start_stack
  check_https "$domain"
  info "Enabling stable GitHub Release auto-updates..."
  bash "$APP_DIR/scripts/install-updater.sh" || die "Could not install the release-update timer."
  printf '\n\033[1;32m========= STREAMCORE READY =========\033[0m\n'
  printf ' Panel    : https://%s\n' "$domain"
  printf ' Username : %s\n' "$LOGIN_USERNAME"
  printf ' Password : %s\n' "$LOGIN_PASSWORD"
  printf ' HLS      : https://%s/live/main/index.m3u8\n' "$domain"
  printf ' Location : /opt/streamcore\n'
  printf ' Next     : Log in and press Start on the main channel.\n'
  printf ' WARNING  : Keep these credentials private.\n'
  printf '====================================\n'
}

if [[ "${STREAMCORE_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
