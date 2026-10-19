<div align="center">

# 🔴 StreamCore

### Your own 24/7 live streaming control center — entirely on a VPS.

**Stream once. Run continuously. Manage from anywhere.**

[![Version](https://img.shields.io/badge/version-0.2.0--alpha-ff5b13?style=flat-square)](https://github.com/hazhanhasani/obs-)
[![Self Hosted](https://img.shields.io/badge/deployment-self--hosted-172436?style=flat-square)](https://github.com/hazhanhasani/obs-)
[![Powered by](https://img.shields.io/badge/media-FFmpeg%20%2B%20MediaMTX-19bd93?style=flat-square)](https://github.com/hazhanhasani/obs-)

**[Installation](#-quick-start)** · **[Architecture](#-architecture)** · **[Screenshots](#-design-preview)** · **[Roadmap](#-roadmap)**

</div>

---

## ✨ Design preview

> **Concept designs — not screenshots from a tested deployment.** Some controls, counters, and features shown here are illustrative and are not yet available in the v0.2.0 alpha. These images show the approved design direction.

<div align="center">

<img src="docs/screenshots/dashboard.webp" alt="StreamCore main streaming dashboard — concept preview" width="100%" />

*Live monitoring, stream control, HLS preview, and a dark Persian RTL dashboard.*

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/channels.webp" alt="Concept preview of channel management" /></td>
    <td width="50%"><img src="docs/screenshots/media.webp" alt="Concept preview of media library" /></td>
  </tr>
  <tr>
    <th>Channel Management</th>
    <th>Media Library</th>
  </tr>
</table>

<img src="docs/screenshots/mobile.webp" alt="Concept preview of responsive mobile dashboard" width="35%" />

*Mobile-first control — the broadcast itself continues on the VPS.*

</div>

## ⚡ Why StreamCore?

Unlike a traditional desktop-based streaming setup, **StreamCore runs its media pipeline on your own Linux VPS**. Your computer and phone do not need to stay online. The browser is only used to configure and monitor your streams.

| Capability | v0.2.0 alpha |
|:--|:--|
| Server-generated live test broadcast | ✅ Implemented |
| Upload H.264 files to VPS | ✅ Implemented |
| Loop a single selected video | ✅ Implemented |
| Multi-channel create/start/stop (up to 8 configured channels) | ✅ Implemented |
| Authenticated RTL dashboard | ✅ Implemented |
| HLS browser delivery via Caddy | ✅ Implemented |
| Recover desired streams after container restart | ✅ Implemented |
| Timed playlists and automatic scheduling | 🛠️ Planned |
| External live inputs / RTMP multi-destination | 🛠️ Planned |
| Viewer analytics and advanced graphs | 🛠️ Planned |
| Protected paid/private HLS | 🛠️ Planned |

## 🧱 Architecture

```text
                       Ubuntu VPS
┌────────────────────────────────────────────────┐
│  Admin browser → Caddy HTTPS → FastAPI Panel    │
│                                  ↓              │
│                        SQLite + FFmpeg           │
│                                  ↓              │
│                          RTMP (private)          │
│                                  ↓              │
│                              MediaMTX            │
│                                  ↓              │
│                        HLS → Caddy HTTPS         │
└──────────────────────────────────┬─────────────┘
                                   ↓
                            Viewers / Apps
```

**Stack:** FFmpeg · MediaMTX · FastAPI · SQLite · Docker Compose · Caddy · HLS.js

The RTMP publisher and HLS origin ports are kept inside Docker's private bridge. No Docker Socket is exposed to the application.

## 🚀 Quick start

**Requirements:** Ubuntu 22.04+ VPS, Docker Engine + Compose v2, recommended 2 vCPU / 2 GB RAM for entry-level use, a domain pointed at the server, inbound TCP 80 and 443.

```bash
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env

# Generate and enter independent, strong secrets in .env
openssl rand -hex 24 # ADMIN_PASSWORD
openssl rand -hex 32 # SESSION_SECRET
nano .env           # STREAM_DOMAIN=stream.example.com

docker compose up -d --build
docker compose ps
```

Once DNS and HTTPS are ready, open your domain, log in, select your main channel, and start the server-generated test broadcast. Play it at:

```text
https://stream.example.com/live/main/index.m3u8
```

For full configuration and safety notes, see the [deployment guide](docs/DEPLOYMENT.md).

## 🔐 Security and limitations

- The admin panel uses signed session cookies and CSRF checks, but this **alpha has not undergone a security audit**.
- Stream playback is **public** in this version; do not upload private or paid content without access controls.
- Uploaded files must contain H.264 video. Video encoding/transcoding during broadcast is not automatic for file sources.
- Actual viewer capacity depends primarily on VPS outbound bandwidth, bitrate, network quality, and whether a CDN is used.
- Current CPU/RAM widgets should **not** be presented as comprehensive host-level telemetry, and the viewer counts in the concept images are illustrative.
- Only distribute media you own or are licensed to stream.

## 🗺️ Roadmap

- [ ] Run full end-to-end Docker/VPS smoke tests and UI visual QA
- [ ] 24/7 playlist scheduler with queue management
- [ ] RTSP, RTMP and SRT ingest with authorized source management
- [ ] Multi-destination output and per-channel presets
- [ ] Private viewer links, signed URLs and access policies
- [ ] Accurate bitrate, traffic, concurrent viewer and service telemetry
- [ ] Admin roles, event logs, backup and zero-downtime update workflow

## 📜 License and status

**Development status:** v0.2.0 alpha — not yet validated for production deployment. No open-source license has been granted for this repository. All rights reserved unless a license is added.

<div align="center">

Built for independent, always-on live broadcasting. 🚀

</div>