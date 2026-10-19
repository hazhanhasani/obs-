#!/usr/bin/env bash
# Enable StreamCore unattended stable-release checks on an existing VPS.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo "Please use sudo/root." >&2; exit 1; }
APP=/opt/streamcore
[[ -f "$APP/scripts/update-release.sh" && -f "$APP/.env" ]] ||
  { echo "StreamCore must already be installed in $APP." >&2; exit 1; }
[[ -d /run/systemd/system ]] ||
  { echo "systemd is required." >&2; exit 1; }
command -v flock >/dev/null || { echo "Missing flock (install util-linux)." >&2; exit 1; }
install -m 0644 "$APP/systemd/streamcore-release-update.service" /etc/systemd/system/
install -m 0644 "$APP/systemd/streamcore-release-update.timer" /etc/systemd/system/
chmod 0755 "$APP/scripts/update-release.sh"
systemctl daemon-reload
systemctl enable --now streamcore-release-update.timer
printf 'Stable-release update checks enabled (every 6 hours).\n'
printf 'Inspect: systemctl list-timers streamcore-release-update.timer\n'
printf 'Logs: journalctl -u streamcore-release-update.service -n 40 --no-pager\n'
printf 'Manual check: systemctl start streamcore-release-update.service\n'
printf 'By default active streams postpone upgrades; set AUTO_UPDATE_ALLOW_LIVE=true in .env to opt into restarts.\n'
