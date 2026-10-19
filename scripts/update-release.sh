#!/usr/bin/env bash
# Safe unattended StreamCore deployment from published GitHub stable Releases.
set -Eeuo pipefail
umask 077
APP=/opt/streamcore
BACKUPS=/var/backups/streamcore
ORIGIN=https://github.com/hazhanhasani/obs-.git
say(){ printf '[StreamCore update] %s\n' "$*"; }
stop(){ say "ERROR: $*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || stop "Must run as root."
[[ -d "$APP/.git" && -f "$APP/.env" ]] || stop "Existing installation required."
[[ "$(git -C "$APP" remote get-url origin)" == "$ORIGIN" ]] || stop "Unexpected git origin."
[[ -z "$(git -C "$APP" status --porcelain --untracked-files=no)" ]] || stop "Dirty tracked worktree."
exec 9>/run/lock/streamcore-update.lock
flock -n 9 || { say "Update already running"; exit 0; }
cd "$APP"
setting(){ sed -n "s/^$1=//p" .env | head -1 | tr -d '\r'; }
[[ "$(setting AUTO_UPDATE_ENABLED)" != "false" ]] || exit 0
tag="$(python3 scripts/release-check.py VERSION 2>/dev/null)" ||
  { say "No newer published stable release."; exit 0; }
say "New release detected: $tag"
git fetch --quiet --no-tags origin "refs/tags/$tag:refs/tags/$tag" ||
  stop "Could not fetch release tag."
target="$(git rev-parse --verify "refs/tags/$tag^{commit}")"
release_version="$(git show "$target:VERSION" | tr -d '[:space:]')"
[[ "$release_version" == "$tag" || "v$release_version" == "$tag" ]] ||
  stop "Tag and VERSION mismatch."
if [[ "$(setting AUTO_UPDATE_ALLOW_LIVE)" != "true" ]]; then
  desired="$(docker compose exec -T dashboard python3 -c '
import sqlite3
with sqlite3.connect("/data/streamcore.sqlite3") as db:
 print(db.execute("SELECT count(*) FROM channels WHERE desired=1").fetchone()[0])
' 2>/dev/null)" || { say "Cannot determine live stream state: postponed."; exit 0; }
  [[ "$desired" =~ ^[0-9]+$ ]] || stop "Invalid active channel count."
  if (( desired > 0 )); then say "Live channels active; deferring update."; exit 0; fi
fi
old="$(git rev-parse HEAD)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUPS/$stamp"
install -d -m 0700 "$backup"
cp -p .env "$backup/dot-env"
printf '%s\n' "$old" > "$backup/previous-commit"
container="$(docker compose ps -q dashboard)"
[[ -n "$container" ]] || stop "Dashboard must run for a safe SQLite backup."
docker compose exec -T dashboard python3 -c '
import sqlite3
with sqlite3.connect("/data/streamcore.sqlite3") as src, sqlite3.connect("/data/update-backup.sqlite3") as dst:
 src.backup(dst)
' || stop "Database backup failed."
docker cp "$container:/data/update-backup.sqlite3" "$backup/database.sqlite3" ||
  stop "Cannot export SQLite backup."
chmod 600 "$backup/"*
say "Private database and env backup: $backup"
rollback(){
  trap - ERR
  say "Unhealthy upgrade: restoring previous code and containers."
  git checkout --quiet --detach "$old" || true
  docker compose up -d --build || true
  say "Database backup retained separately at $backup (not overwritten)."
  exit 1
}
trap rollback ERR
git checkout --quiet --detach "$target"
docker compose config --quiet
docker compose build dashboard
docker compose up -d
healthy=false
for attempt in $(seq 1 30); do
  if docker compose exec -T dashboard python3 -c '
import json,urllib.request
with urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=4) as response:
 assert response.status == 200
 assert json.load(response).get("ok") is True
' >/dev/null 2>&1; then healthy=true; break; fi
  sleep 4
done
[[ "$healthy" == true ]] || rollback
trap - ERR
say "Installed $tag successfully. Backup: $backup"
