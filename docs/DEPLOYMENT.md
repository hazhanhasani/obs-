# StreamCore VPS Deployment (Alpha)

## Prerequisites

- Ubuntu 22.04+ VPS with Docker Engine and Compose v2.
- DNS A/AAAA record pointing your domain to VPS; incoming TCP 80/443. Optional UDP 443.
- Basic test: 2 vCPU / 2 GB RAM; higher resources for encoding and many viewers.

## One-command installation (recommended for new VPS)

```sh
curl -fsSL https://raw.githubusercontent.com/hazhanhasani/obs-/main/install.sh | sudo bash
```

The installer prompts for your domain through the SSH terminal, checks that the DNS A record matches the VPS IPv4, installs Docker Engine + Compose as required, creates a randomly generated admin username/password and durable session encryption key, starts services and verifies trusted HTTPS. It displays the panel URL and credentials at the end **only if HTTPS validation succeeds**.

Before running, configure the DNS A record; if using Cloudflare, use DNS-only while obtaining TLS certificates. Fix any stale AAAA records and allow inbound 80/443 TCP from the internet. Open the installer source on GitHub and inspect it before running code as root.

Install location: `/opt/streamcore`. Re-running the installer preserves the existing credentials and data. `sudo cat /opt/streamcore/.env` reveals private credentials to anyone with root access; do not share this output. Never commit this file.

## Deploy (manual)

```bash
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env
openssl rand -hex 24 # set ADMIN_PASSWORD
# ADMIN_USERNAME=admin is the manual-install default
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

H.264 media can be uploaded in the dashboard and selected for continuous single-file looping. Private streams, timed playlists, transcoding workers and advanced telemetry are not yet available. Multistream destinations were added in v0.3.0-alpha.

## Security checks

- [ ] TLS certificates valid and browser requests use HTTPS.
- [ ] Admin password and session secret generated uniquely.
- [ ] RTMP (1935), MediaMTX HLS origin (8888), Docker Socket not publicly exposed.
- [ ] Test start, stop, login, upload, codec rejection and recovery after reboot.
- [ ] Set up disk and volume backups.
- [ ] Use only licensed media.
- [ ] Do not sell private stream access before HLS authentication is added.
