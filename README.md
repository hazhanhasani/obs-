# StreamCore

Self-hosted, server-side 24/7 live streaming foundation powered by FFmpeg, MediaMTX and Caddy. Designed to run on a Linux VPS without OBS or a continuously connected PC/phone.

> Status: **v0.1.0 infrastructure bootstrap**. The streaming engine and HLS delivery are implemented. An authenticated visual control dashboard, upload manager, scheduler, playlists, multi-channel supervisor, and RTMP multistream controls are planned for the next milestone, not yet implemented.

## Architecture

```
VPS only
  FFmpeg (file loop or generated test pattern)
     | RTMP (private Docker network)
     v
  MediaMTX
     | HLS (private Docker network)
     v
  Caddy (HTTP or HTTPS)
     |
     v
  Browser / HLS-compatible player
```

The public ports are 80 and 443 only. RTMP (1935) and HLS origin (8888) are **not published** from the Docker network. Source media must be content you are authorized to redistribute.

## Requirements

- Ubuntu 22.04/24.04 or a comparable Linux VPS, Docker Engine with Compose v2.
- Recommended starting size: 2 vCPU, 2 GB RAM for an H.264 input without re-encoding.
- For HTTPS, a domain with an A/AAAA record pointing to the VPS and inbound TCP 80/443.
- Enough outbound bandwidth and transfer allowance for expected viewers.

## Quick start: test broadcast without any media file

```sh
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env
# Set STREAM_DOMAIN in .env to your DNS name for trusted HTTPS;
# for IP-only HTTP testing, use STREAM_DOMAIN=:80
docker compose --profile demo up -d --build
docker compose logs -f demo-publisher
```

Then open `https://YOUR_DOMAIN/live/main/index.m3u8` in an HLS player. On an IP-only installation using `STREAM_DOMAIN=:80`, use `http://SERVER_IP/live/main/index.m3u8` instead. The `/health` endpoint reports whether the Caddy gateway is up (not the video pipeline).

The demo publisher sends a generated 720p color test pattern and a test tone. It is entirely server-side and needs no Windows machine, phone, or OBS.

## Stream a local video continuously

Place an **H.264** video (with optional AAC audio) at `media/loop.mp4`, then:

```sh
docker compose --profile demo down
docker compose --profile file up -d --build
docker compose logs -f file-publisher
```

The file publisher uses **stream copy for video** to minimize CPU. Incompatible codecs and formats (e.g. HEVC video) must be converted to H.264 first. The file loops forever, and Docker restarts its publisher container if it exits. Playback starts from the beginning after a container restart.

Convert an incompatible file once with:

```sh
ffmpeg -i input.mkv -c:v libx264 -preset medium -pix_fmt yuv420p -c:a aac -movflags +faststart media/loop.mp4
```

Conversion is an **offline one-time operation**, not continuous transcoding on the VPS. Ensure enough temporary disk space.

## Operating it

```sh
docker compose ps
docker compose logs --tail=100 mediamtx
docker compose logs --tail=100 caddy
docker compose --profile file down
```

Use **only one publisher profile at a time** for the `main` path; they compete to publish to the same stream.

MediaMTX publishes `main` internally using RTMP on port 1935 and generates HLS on port 8888. External clients only use Caddy at `/live/main/index.m3u8`. Some browsers require an HLS JavaScript player (e.g. hls.js); Safari supports native HLS.

## Deployment and security

- Production: configure a real domain in `.env`, point DNS to the VPS, expose TCP 80 and 443; Caddy obtains HTTPS certificates automatically.
- Do not publish RTMP, MediaMTX management ports, Docker sockets, or metrics publicly.
- The public HLS link is **not access-controlled** in this initial version. Do not use it for paid/private broadcasts yet.
- `media/` and `.env` are ignored by Git and should not contain credentials committed to Git.
- No reverse proxy UI, access-controlled admin, upload, scheduling, or user management is included in this bootstrap.

## Capacity planning

Approximate outbound speed = viewers × stream bitrate. For 100 viewers at 3 Mbps, plan for ~300 Mbps plus protocol overhead. A CDN/origin-edge architecture is recommended for large audiences.

## Roadmap

- [ ] Secure bilingual RTL admin dashboard based on the selected visual design.
- [ ] Channel/media management and chunked uploads.
- [ ] Durable 24/7 playlist scheduler, per-channel health checks and autorestart.
- [ ] Output targets and authorized multistream destinations.
- [ ] Proper observability, retention, logs, and backup workflows.
- [ ] Automated CI smoke tests and one-command production updates.

## References

- https://mediamtx.org/docs/kickoff/introduction
- https://mediamtx.org/docs/features/configuration
- https://mediamtx.org/docs/references/configuration-file
