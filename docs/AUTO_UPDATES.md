# Automatic stable-release upgrades

StreamCore can check **GitHub Releases** on the Linux VPS every 6 hours, without
requiring a desktop, phone, GitHub token, or an external monitoring agent.

## One-time activation on an existing VPS

After installing the latest GitHub code during a scheduled interruption:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
sudo bash scripts/install-updater.sh
systemctl status streamcore-release-update.timer --no-pager
```

Fresh one-command installs enable the same timer automatically after HTTPS setup.

The timer runs `scripts/update-release.sh` through a one-shot systemd service.
It asks the official GitHub API for the **latest published stable release** and
rejects Drafts, prereleases, malformed tags, equal versions and downgrades.
Updates require a valid `vMAJOR.MINOR.PATCH` tag and a matching release
`VERSION` file. Git worktrees with local tracked changes or an unexpected
remote are never overwritten.

## Default stream continuity policy

```dotenv
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_ALLOW_LIVE=false
```

With the default `AUTO_UPDATE_ALLOW_LIVE=false`, a new release is downloaded
only once no channels are configured as active (`desired=1`).
This means a **24/7 always-on channel will defer upgrades indefinitely**
until you stop it or explicitly change the setting.
For fully unattended upgrades that may interrupt live broadcasts, set
`AUTO_UPDATE_ALLOW_LIVE=true` in `/opt/streamcore/.env`. This accepts
a temporary broadcast interruption during Docker replacement.

The timer checks four times per day with up to 30 minutes of jitter.
It does not install from mutable `main` and it does not publish GitHub tags.

## Safety and recovery

Before replacing a release, the updater:
1. Takes an exclusive lock and checks the Git origin and worktree.
2. Records the old Git commit.
3. Saves a root-only copy of `.env`, including encrypted key material,
   and creates a consistent SQLite online backup outside Docker volumes.
4. Builds the new dashboard image while old containers are running.
5. Recreates changed containers and checks `/health` for about two minutes.

If the health check fails, the updater attempts to restore the previous
commit and rebuild the old containers. **The SQLite snapshot is retained, not
automatically restored**: automatic database restoration might discard live
orders or newly saved content. Media files and Docker volumes are never
intentionally deleted by this updater.

Backups: `/var/backups/streamcore/<timestamp>/`. These snapshots contain
credentials. Keep root access restricted and back up the media folder
separately; snapshots do not contain video uploads.

The health check confirms only dashboard availability, **not** whether each
social platform has accepted the live. Test Telegram/HLS and check
`docker compose ps` after a release.

## Release publishing

On GitHub, set `VERSION` to a stable release version, e.g. `0.7.0`, and
push an annotated `v0.7.0` tag pointing to that exact commit:

```bash
git tag -a v0.7.0 -m "StreamCore v0.7.0"
git push origin v0.7.0
```

The `Publish validated StreamCore Release` workflow tests scripts, Node,
Python and Docker **before** creating the public GitHub Release. Simply
pushing to `main` does not trigger VPS installation.

## Troubleshooting

```bash
systemctl list-timers streamcore-release-update.timer
sudo systemctl start streamcore-release-update.service
journalctl -u streamcore-release-update.service -n 80 --no-pager
```

To pause all unattended updates:
```bash
sudo systemctl disable --now streamcore-release-update.timer
```

Current implementation is **alpha**. It requires real VPS systemd, GitHub
Release, backup, failure-injection and rollback validation before calling it
production-ready. For sensitive, paid or nonstop live content, maintain a
manual maintenance window until those checks pass.
