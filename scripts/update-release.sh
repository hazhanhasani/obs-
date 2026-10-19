#!/usr/bin/env bash
# Safe unattended StreamCore deployment from published GitHub stable Releases.
set -Eeuo pipefail
umask 077
APP=/opt/streamcore
BACKUPS=/var/backups/streamcore
MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == "--check" ]] || {
  echo "Usage: update-release.sh [--check]" >&2
  exit 2
}
ORIGIN=https://github.com/hazhanhasani/obs-.git
say(){ printf '[StreamCore update] %s\n' "$*"; }
stop(){ say "ERROR: $*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || stop "Must run as root."
[[ -d "$APP/.git" && -f "$APP/.env" ]] || stop "Existing installation required."
[[ "$(git -C "$APP" remote get-url origin)" == "$ORIGIN" ]] || stop "Unexpected git origin."
[[ -z "$(git -C "$APP" status --porcelain --untracked-files=no)" ]] || stop "Dirty tracked worktree."
[[ "$(git -C "$APP" branch --show-current)" == "main" ]] ||
  stop "Updater requires a clean main branch; refusing detached-HEAD deployment."
exec 9>/run/lock/streamcore-update.lock
flock -n 9 || { say "Update already running"; exit 0; }
cd "$APP"
setting(){ sed -n "s/^$1=//p" .env | head -1 | tr -d '\r'; }
[[ "$(setting AUTO_UPDATE_ENABLED)" != "false" ]] || exit 0
tag="$(python3 scripts/release-check.py VERSION 2>/dev/null)" ||
  { say "No newer published stable release."; exit 0; }
say "New release detected: $tag"
if [[ "$MODE" == "--check" ]]; then
  say "Dry run: release available, no Git checkout, backup, or Docker action."
  exit 0
fi
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
# A release must advance the installation; never deploy a tag that rewinds
# main or introduces unrelated history.
git merge-base --is-ancestor "$old" "$target" ||
  stop "Release tag is not a fast-forward from installed main. Skipping unsafe update."
old_branch="$(git symbolic-ref --quiet --short HEAD || true)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUPS/$stamp"
install -d -m 0700 "$backup"
cp -p .env "$backup/dot-env"
printf '%s\n' "$old" > "$backup/previous-commit"
container="$(docker compose ps -q dashboard)"
[[ -n "$container" ]] || stop "Dashboard must run for a safe SQLite backup."
db_staging="/tmp/streamcore-update-${stamp}.sqlite3"
docker compose exec -T dashboard python3 - "$db_staging" <<'PY' ||
  stop "Database backup failed."
import sqlite3
import sys
source="/data/streamcore.sqlite3"
with sqlite3.connect(source) as src, sqlite3.connect(sys.argv[1]) as dst:
    src.backup(dst)
    if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("SQLite snapshot failed integrity check")
PY
docker cp "$container:$db_staging" "$backup/database.sqlite3" ||
  stop "Cannot export SQLite backup."
docker compose exec -T dashboard rm -f -- "$db_staging" ||
  stop "Could not remove temporary snapshot from container."
chmod 600 "$backup/"*
say "Private database and env backup: $backup"
rollback(){
  trap - ERR
  say "Unhealthy upgrade: restoring previous code and containers."
  if [[ -n "$old_branch" ]]; then
    git checkout --quiet "$old_branch" || { say "Cannot restore original branch."; exit 1; }
  fi
  # Checking out main alone leaves it at the failed release's commit.
  # The worktree was checked clean before deployment; restore its exact SHA.
  git reset --hard --quiet "$old" || { say "Cannot restore original commit."; exit 1; }
  docker compose up -d --build || true
  say "Database backup retained separately at $backup (not overwritten)."
  exit 1
}
trap rollback ERR
git merge --ff-only --quiet "$target"
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
# A healthy dashboard alone is not enough if the RTMP media server or TLS
# reverse proxy failed. Inspect all three mandatory services.
running_services="$(docker compose ps --status running --services)"
for required in dashboard mediamtx caddy; do
  grep -Fxq "$required" <<< "$running_services" || {
    say "Required service $required is not running after upgrade."
    rollback
  }
done
trap - ERR
say "Installed $tag successfully. Backup: $backup"
say "Main remains attached; the timer can install later releases."
