# StreamCore · 24/7 VPS Streaming Control Center

StreamCore is a self-hosted live streaming control center that runs **entirely on a Linux VPS**. No Windows PC, mobile phone, OBS desktop, or external device needs to remain online.

**Current version: v0.2.0 (functional alpha)**

The backend controls FFmpeg processes and persists channel settings in SQLite. MediaMTX receives private RTMP streams and publishes public HLS through Caddy. The authenticated, responsive Persian RTL dashboard is inspired by the approved StreamCore design mockup.

> Important: the web dashboard is implemented but has not yet been visually verified against the original image in a running browser or deployed on a live VPS. Until validated, consider it an alpha release.

## Features implemented

- RTL dark admin dashboard with responsive sidebar, HLS preview and system statistics.
- Admin login with signed, HttpOnly, SameSite session cookie; CSRF protection for mutations.
- Create channels, select active channel, start / stop server-side FFmpeg, delete non-default channels.
- Generate a video + audio test source **on the VPS** for first-run testing.
- Upload H.264 MP4/MKV/MOV files; validate with ffprobe; assign a file to a channel.
- Continuous repeat of selected video via FFmpeg; channel intent is stored and auto-restored on restart.
- HLS published at `/live/<channel-id>/index.m3u8`.
- CPU, RAM, channel process status and local media library statistics.
- No public RTMP or Docker socket exposure; Docker bridge connects internal services.

## Architecture

```text
ADMIN (HTTPS browser)
     |
 Caddy :443  ---------------------------> Public HLS /live/*
     |                                        ^
     v                                        |
 Authenticated FastAPI (dashboard)       MediaMTX :8888
     |                                        ^
 SQLite + process supervisor                  |
     |                                        |
 FFmpeg (file loop or server-generated) ------+
            RTMP private bridge :1935
```

The management browser is optional **after configuration**: the VPS continues streaming independently. The media library and SQLite state survive container restarts via mounted storage.

## First deployment on Ubuntu VPS

Requirements: Docker Engine with Docker Compose v2, 2+ vCPU / 2GB+ RAM for a basic stream, and DNS A/AAAA records pointing the domain to the VPS. Allow inbound TCP 80 and 443 and UDP 443 (optional HTTP/3). Outbound capacity must scale with viewers.

```sh
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env
openssl rand -hex 24   # paste this as ADMIN_PASSWORD in .env
openssl rand -hex 32   # paste this as SESSION_SECRET in .env
nano .env              # also set STREAM_DOMAIN=stream.yourdomain.com
docker compose up -d --build
docker compose ps
```

Do **not** leave the example placeholders `CHANGE_ME` in `.env`. The dashboard refuses to start with weak/placeholder credentials. For production set `COOKIE_SECURE=true`; the domain must be reachable by Caddy to obtain HTTPS certificates.

Open `https://stream.yourdomain.com`, enter your configured admin password, select **کانال اصلی**, and click **شروع پخش**. The server generates a demo signal. The publicly accessible HLS URL is:

```text
https://stream.yourdomain.com/live/main/index.m3u8
```

HLS can take several seconds to become available after starting the source. The web player uses Hls.js for non-Safari browsers. If the external JS CDN is unreachable, native HLS players can still open the m3u8 URL directly.

### Temporary testing by IP (no HTTPS)

Set `STREAM_DOMAIN=:80` and `COOKIE_SECURE=false` in `.env`, then run `docker compose up -d --build`; browse `http://SERVER_IP`. This mode sends the admin credential without TLS and is **only for isolated, short-lived tests**. Do not use over an untrusted network.

### Uploading and broadcasting media

Upload through **رسانه‌ها** in the panel. Choose a file for the selected channel; this switches off the old source, then click Start. Only H.264 files are accepted to avoid continuous transcoding load. Audio is normalized to AAC. You can preconvert a video once:

```sh
ffmpeg -i input.mkv -c:v libx264 -preset medium -pix_fmt yuv420p -c:a aac -movflags +faststart converted.mp4
```

The above is an offline preprocessing example, not part of the server auto-loop pipeline.

### Operator commands

```sh
docker compose ps
docker compose logs --tail=100 dashboard
docker compose logs --tail=100 mediamtx
docker compose restart dashboard
docker compose down
```

The private stream publisher logs are written to the persistent `dashboard_data` Docker volume as `ffmpeg-<channel>.log`. Processes are stopped cleanly on dashboard shutdown. Docker `restart: unless-stopped` restores streaming services after a host reboot.

## Security boundaries

- The dashboard requires a password with 12+ characters and a random 32+ character session signing secret.
- Browser sessions expire after 8 hours. Cookies are HttpOnly, SameSite=Strict and Secure when HTTPS is configured; unsafe API requests require a CSRF token.
- Login attempts are throttled in memory (single-instance safeguard, **not** a distributed brute-force defense).
- User-submitted video sources are stored on the server and passed to ffmpeg using argument arrays, not shell commands.
- The dashboard does **not** mount `/var/run/docker.sock`, and ports 1935/8888 are not published to the internet.
- HLS output is publicly accessible: **do not serve private or paid streams** until stream auth / signed URLs have been implemented.
- Do not commit `.env`, uploaded media, login credentials or API tokens.
- Limit file upload sizes and disk usage before opening the panel to other operators.
- MediaMTX and FFmpeg are external dependencies; maintain and patch Docker images regularly.
- Only distribute media that you own or are licensed to stream.

## Boundaries of v0.2.0

This release does **not** yet implement scheduling, true media queues, live input URL ingest, automatic per-viewer counts, output destinations to YouTube/Twitch, recording, transcoding presets, paid stream authentication, CDN integration, or per-user permissions. The displayed media list allows selecting media for a channel, not an automatic playlist. Up to 8 channels are allowed, subject to VPS capacity. The dashboard metrics reflect the **dashboard container's** CPU/memory context and should not be interpreted as full VPS/network throughput.

## Roadmap

- Authenticated HLS, per-channel policies and reverse-proxy rate limiting.
- Multi-source playlist scheduler, per-channel media queues and playback progress.
- Authorized RTSP/RTMP/SRT ingest, destination fan-out and multi-bitrate HLS.
- Media conversion workers, transcoding presets, bandwidth telemetry, viewer counts.
- Real VPS browser UX QA, responsive/accessibility audit and deployment smoke tests.
- Backup, logs rotation, alerts, update workflow and CI security scanning.

## References

- [MediaMTX documentation](https://mediamtx.org/docs/)
- [MediaMTX HLS](https://mediamtx.org/docs/read/hls)
- [MediaMTX path / reverse proxy](https://mediamtx.org/docs/features/expose-the-server-in-a-subfolder)
- [FastAPI deployment](https://fastapi.tiangolo.com/deployment/docker/)
