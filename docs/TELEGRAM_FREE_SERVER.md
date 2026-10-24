# Telegram streaming on an approved free server

This guide covers two different meanings of "Telegram server". **They are not
interchangeable.**

## 1. Identify the access that was approved

| You received | Can StreamCore run there? | Action |
| --- | --- | --- |
| Ubuntu Linux VPS, public IP, SSH/root, Docker permitted | Potentially yes | Follow the low-resource VPS deployment below |
| Only Telegram `rtmp://` / `rtmps://` Server URL and Stream Key | **No**: it is a media ingest endpoint, not a VPS | Keep StreamCore on your own VPS; configure a Telegram destination in the dashboard |
| Free app host with no Docker, no background processes, or sleeping workers | Usually no | Use a persistent Linux VPS or a provider supporting continuously running FFmpeg |
| A provider's "free server" approval email without specifications | Not yet determined | Check the product, SSH availability, CPU/RAM, monthly outbound data and permitted background execution |

**Telegram's RTMP endpoint distributes the stream; it does not execute the
StreamCore dashboard.** Never send a personal Telegram session or private
Stream Key to support, chat, GitHub, issues or screenshots.

## 2. Compatible VPS installation (Ubuntu 22.04+)

Prerequisites:

- A persistent Ubuntu Linux VPS with SSH/root access, Docker Engine + Compose v2.
- A DNS name pointing to the server, open inbound TCP 80/443 for Caddy HTTPS.
- Unrestricted outbound access to the actual Telegram RTMP(S) host/port for the live session.
- At least 2 vCPU, 1.5 GiB RAM and 4 GiB available disk suggested for a small
  composited scene; these are **planning estimates**, not a guarantee of smooth
  broadcasting. A 1-vCPU free tier can be attempted with an H.264 file loop.
- Review the free provider's bandwidth, CPU-time, uptime and storage limits.
  Do not assume "free" means unlimited 24/7 video transcoding.

For a **new** Ubuntu VPS, use the existing, audited domain-based installer:

```bash
curl -fsSL https://raw.githubusercontent.com/hazhanhasani/obs-/main/install.sh | sudo bash
cd /opt/streamcore
```

For a **future deployment after this change has been merged to main**, run:

```bash
git pull --ff-only origin main
bash scripts/telegram-free-setup.sh --check
# Stop any broadcasts and back up .env, media/, and Docker volume data first.
bash scripts/telegram-free-setup.sh --apply --acknowledge-stream-interruption
```

For pre-merge evaluation, review and check out the feature branch in a separate
test environment instead. Do not use a development branch during production live
broadcasts.

The profile uses `compose.yaml` **plus** `compose.telegram-free.yaml`.
It does not modify credentials, destination keys, data volumes, Caddy ports or
the normal production Compose file. Using the ordinary `docker compose up`
later will switch back to the original encoder settings. Use both Compose files
for upgrades and operations of this profile:

```bash
docker compose -f compose.yaml -f compose.telegram-free.yaml ps
docker compose -f compose.yaml -f compose.telegram-free.yaml logs --tail=100 dashboard
```

### Resource controls

These overrides are applied **only when the optional profile is selected**:

| Environment override (optional) | Default | Effect |
| --- | --- | --- |
| `TG_SCENE_ENCODER_PRESET` | `ultrafast` | Lower CPU, potentially less compression efficiency |
| `TG_SCENE_ENCODER_THREADS` | `1` | Cap FFmpeg scene-encoder threads |
| `TG_SCENE_VIDEO_BITRATE_KBPS` | `1200` | Target scene H.264 bitrate (kb/s) |
| `TG_MAX_UPLOAD_MB` | `512` | Dashboard upload limit |

Set overrides privately in `.env` before applying; never commit the file.
The original preset allowlist, thread count and bitrate validations still apply.
The profile cannot automatically reduce a saved **1080 × 1920** canvas: manually
select the 720p landscape or 720 × 1280 portrait canvas when using scenes.

**Important:** test-pattern mode and a single H.264 file-loop use their
existing pipelines and do **not** read the scene encoder overrides. The
file-loop may avoid transcoding when the video is already H.264/AAC. Multiple
video layers, Full HD portrait, complex effects and concurrent channels are
not recommended on a small free VPS.

After a successful `--apply`, a gitignored private marker
`.streamcore-telegram-free-profile` tells the existing stable-release updater
to preserve this Compose overlay (including rollback). The updater's normal
`AUTO_UPDATE_ALLOW_LIVE=false` stream interruption safeguards still apply.
This marker only exists after successful setup; a manual default-profile
`docker compose up` does not remove it.

To intentionally return to the ordinary profile during maintenance:

```bash
cd /opt/streamcore
# Stop broadcasts and ensure you have backed up .env and data.
docker compose up -d --build
rm -f .streamcore-telegram-free-profile
```

Avoid mixing profile and default Compose commands unless you are explicitly
switching configurations.

## 3. Connect Telegram as the stream destination

1. In Telegram, as a channel owner/admin, open the channel's live-stream setup,
   select streaming from an external application, and get **Server URL** and
   **Stream Key**. They belong to a live session and may change.
2. In StreamCore, log in and start the main source (a low-cost file loop is
   preferable for a low-tier VPS). Open **پخش چندمقصدی** and create a
   **Telegram** destination for the same channel.
3. Paste Server URL and Stream Key into their separate private fields, save,
   then enable the destination.
4. Verify incoming live video **inside Telegram**. A healthy local FFmpeg
   process alone does not prove accepted publication. Check the current
   Telegram session's start/publish confirmation.
5. Watch CPU, FFmpeg speed, frame progress, lost connections and data transfer
   on the host; disable unused destinations.

For a rough outbound data estimate, a 1200 kb/s video plus 128 kb/s audio
requires around **0.6 GB per hour per destination**, excluding protocol
overhead and any preview/viewer traffic. A 24-hour daily stream can therefore
use more than **400 GB/month** for just one external destination. Do not assume
the free plan includes this much traffic.

## 4. Rollout and security

- **No remote installation has been performed** by this change.
- Do not share root credentials, Telegram session files, private keys or the
  unredacted `.env`. Use SSH keys for administration.
- Stop the current stream before applying any container rebuild; the apply
  command deliberately requires acknowledgement of interruption.
- Backup the application data, secrets and media before upgrades.
- Verify HTTPS login, local playback, resource consumption and end-to-end
  Telegram playback separately.
- If the provider only approved a Telegram RTMP endpoint, skip VPS installation
  entirely: the existing StreamCore dashboard already supports that output.
