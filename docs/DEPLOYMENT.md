# StreamCore VPS Deployment (Alpha)

## Prerequisites

- Ubuntu 22.04+ VPS with Docker Engine and Compose v2.
- DNS A/AAAA record pointing your domain to VPS; incoming TCP 80/443. Optional UDP 443.
- Basic test: 2 vCPU / 2 GB RAM; higher resources for encoding and many viewers.

## Deploy

```bash
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env
openssl rand -hex 24 # set ADMIN_PASSWORD
openssl rand -hex 32 # set SESSION_SECRET
nano .env # set STREAM_DOMAIN=stream.yourdomain.com
docker compose up -d --build
docker compose ps
```

Do not leave default CHANGE_ME values. In production set COOKIE_SECURE=true and use valid HTTPS. After setup open your domain, log in, select "کانال اصلی", and start the test source. HLS: https://stream.yourdomain.com/live/main/index.m3u8

## Operations

```bash
docker compose logs --tail=100 dashboard
docker compose logs --tail=100 mediamtx
docker compose restart dashboard
docker compose down
```

H.264 media can be uploaded in the dashboard and selected for continuous single-file looping. Private streams, multistream destinations, timed playlists, transcoding worker and advanced telemetry are not part of v0.2.0.

## Security checks

- [ ] TLS certificates valid and browser requests use HTTPS.
- [ ] Admin password and session secret generated uniquely.
- [ ] RTMP (1935), MediaMTX HLS origin (8888), Docker Socket not publicly exposed.
- [ ] Test start, stop, login, upload, codec rejection and recovery after reboot.
- [ ] Set up disk and volume backups.
- [ ] Use only licensed media.
- [ ] Do not sell private stream access before HLS authentication is added.
