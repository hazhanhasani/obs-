<div align="center">

# 🔴 StreamCore

### Your own 24/7 live streaming control center — entirely on a VPS.

**Stream once. Run continuously. Manage from anywhere.**

[![Version](https://img.shields.io/badge/version-0.5.3--alpha-ff5b13?style=flat-square)](https://github.com/hazhanhasani/obs-)
[![Self Hosted](https://img.shields.io/badge/deployment-self--hosted-172436?style=flat-square)](https://github.com/hazhanhasani/obs-)
[![Powered by](https://img.shields.io/badge/media-FFmpeg%20%2B%20MediaMTX-19bd93?style=flat-square)](https://github.com/hazhanhasani/obs-)

**[Installation](#-quick-start)** · **[Architecture](#-architecture)** · **[Screenshots](#-design-preview)** · **[Roadmap](#-roadmap)**

</div>

---

## ✨ Design preview

> **Concept designs — not screenshots from a tested deployment.** Some controls, counters, and features shown here are illustrative and are not yet available in the v0.5.3 alpha. These images show the approved design direction.

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

| Capability | v0.5.3 alpha |
|:--|:--|
| Server-generated live test broadcast | ✅ Implemented |
| Upload H.264 videos and PNG/JPG/WebP still images | ✅ Implemented |
| Loop a single selected video | ✅ Implemented |
| Visual scene studio with simultaneous videos and still image overlays | ✅ Implemented (alpha) |
| Persian/English text layers and timed Fade / Slide / Blink effects | ✅ Implemented (alpha) |
| Drag-and-resize canvas layers; position, size, opacity, Contain/Cover | ✅ Implemented (alpha) |
| Multi-channel create/start/stop (up to 8 configured channels) | ✅ Implemented |
| Authenticated RTL dashboard | ✅ Implemented |
| HLS browser delivery via Caddy | ✅ Implemented |
| Recover desired streams after container restart | ✅ Implemented |
| Timed playlists and automatic scheduling | 🛠️ Planned |
| RTMP/RTMPS outbound multistream to Telegram, Instagram, Aparat, YouTube, Twitch, custom | ✅ Implemented (alpha, keys required) |
| External live input URL ingest | 🛠️ Planned |
| Viewer analytics and advanced graphs | 🛠️ Planned |
| Protected paid/private HLS | 🛠️ Planned |

## 🎯 Mobile touch-target visual fix — v0.5.3-alpha

A user-provided 20-second Android recording confirmed the resize algorithm was
reducing the logo correctly, but two visual defects made the operation look
broken: the **entire 16:9 canvas** received an orange highlight during dragging,
and a **40px solid-orange resize square** covered most of a logo resized to 11%.

In v0.5.3, the canvas no longer glows orange, the selected image alone has an
orange outline, and the resize control now has a **small 14px visible grip**
outside the image corner with a larger transparent 42px mobile touch target.
This keeps even small logos visible while preserving touch ergonomics.

Mobile touch/caching safeguards from v0.5.2 remain in place. The editor assets
are explicitly versioned to `?v=0.5.3`. Twelve source-based touch and
UI regression cases now pass; **real Android device and VPS verification
remain pending**.

Read the [Android debugging guide](docs/MOBILE_SCENE_DEBUG.md) for safe rollout.

## 📱 Mobile Scene Editor Stability — v0.5.2-alpha

The mobile layer editor was audited for Android/WebView pointer events,
periodic data refreshes, layout resizing and server-side persistence.

- **Active gestures are never overwritten by periodic 5-second dashboard refreshes.**
- Touch movements survive leaving the canvas or losing pointer capture.
- The editor shows **X / Y / width / height percentages** while dragging.
- Quick-size presets (25%, 50%, 75%) are available as a fallback on touch devices.
- Saving verifies that the API returned the exact persisted geometry.
- Versioned assets (`scene-editor.js?v=0.5.2`) avoid stale JavaScript and CSS
  after deployment; page reload may still be needed for older open tabs.
- Eleven regression scenarios include an Android-sized 390px canvas and
  a polling event in the middle of an active resize.

**Important:** this is a GitHub source fix. Your VPS must pull/rebuild the new
version before the phone uses it. The connected VPS control channel is
currently unavailable, so production-device verification is still pending.
Avoid changing a live stream during active broadcasts.

[Mobile troubleshooting guide](docs/MOBILE_SCENE_DEBUG.md) ·
[Editor regression tests](tests/test_scene_editor.cjs)

## ⚡ VPS performance and safe scenes — v0.5.1-alpha

This release adds an optional shared-VPS encoder profile: **ultrafast H.264,
2 encoding/filter threads, and 2500 kbps video** at 720p/25 fps by default.
Presets `ultrafast`, `superfast`, `veryfast` are explicitly allowlisted.

Scene edits now validate files, image effects, output configuration and Persian
font rendering **before stopping an active stream or updating SQLite**, so
invalid changes return a clear error without replacing the running scene.

A GitHub Actions smoke test now encodes a short 720p scene with a Persian text
layer and animated logo using real FFmpeg. This is **not a verified live VPS
benchmark**: stream continuity and CPU changes still need deployment checks.

Read the [performance and deployment runbook](docs/PERFORMANCE.md) and
[Text & Effects Guide](docs/TEXT_EFFECTS.md).

## ✍️ Text overlays and animated scenes — v0.5.0

StreamCore now supports up to **5 Persian/English text layers** per channel,
in addition to the video and image overlays. Drag and resize text directly
in Scene Studio, choose text color, alignment, size, outline, background and opacity.

Images, logos and text can use lightweight **Fade, Slide Left, Slide Right,
Blink** and static effects with a configurable **Start / Duration / Repeat**
timeline. Mixed RTL/LTR text is shaped by Pillow and rendered into a private
PNG layer before being composited by FFmpeg (no raw text is embedded in filter expressions).

**Limitation:** Fade animates only on the first occurrence of a repeated window.
Zoom/Typewriter and per-platform aspect ratios are future work. The scene
editor's animation preview is an approximation; see the actual live output
in the Dashboard. This release remains alpha and needs a VPS smoke test.

**[Text & Effects Guide](docs/TEXT_EFFECTS.md)**

## 🛠️ Touch resize fix — v0.4.1

A mobile-scene-editor regression could cause a layer to snap back to its original
size when lifting a finger. The editor now captures touch gestures on a stable
canvas container, preserves final pointer coordinates, and keeps resized/moved
layers in the scene model until **Save and apply** is pressed. The resize handle
has a larger touch target. Regression coverage is included in
[`tests/test_scene_editor.cjs`](tests/test_scene_editor.cjs).

For an existing VPS installation:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
```

After updating, refresh the browser. Resize your overlay, lift your finger,
verify it stays at the new size, then press **ذخیره و اعمال صحنه** to publish it
to the live channel. Updating the dashboard container may briefly interrupt a
currently active stream. Live mobile-device verification is still pending.

## 🎬 Visual Scene Studio — v0.4.1

One channel can broadcast **a background video plus up to 3 other video layers and 5 image layers simultaneously**. Use the drag-and-resize Persian scene editor to place each photo, logo or video precisely on a 16:9 canvas. Adjust **X/Y, width/height, opacity, stacking order and Contain/Cover fit**.

The saved scene runs entirely on the VPS. FFmpeg composites to a **single 1280×720 H.264/AAC stream**, and MediaMTX distributes it to HLS and any configured multistream destinations.

The editor's static poster preview is for layout decisions; the actual live preview is in Dashboard. Composition requires encoding, so simultaneous video layers cost CPU. Review the [Scene Composer Guide](docs/SCENE_COMPOSER.md) for limits and operational checks.

## 📤 Reliable mobile media uploads (v0.4.0)

Upload MP4/MKV/MOV H.264 videos and PNG/JPG/WebP images directly to your VPS with a live percentage,
cancel control, backend size limit, and codec validation. The viewer preview
now stops automatically when you navigate away from the dashboard, preventing
the test-pattern video from floating over other screens on mobile.

Already installed? Pull the latest main branch, then rebuild the dashboard
using Docker Compose. Read the [Upload Troubleshooting Guide](docs/UPLOAD_TROUBLESHOOTING.md).

## 📡 Multistream: live on multiple platforms

Send the same VPS-hosted channel to **Telegram, Instagram, Aparat, YouTube, Twitch**, and any compatible RTMP/RTMPS endpoint. StreamCore uses independent stream-copy relay processes, so every destination can be toggled separately.

1. In the Persian admin dashboard, choose **پخش چندمقصدی**.
2. Select the source channel and output platform.
3. Obtain the official **Server URL** and **Stream Key** from the destination platform and save the destination.
4. Enable the destination. Confirm the broadcast is accepted and visible in the destination platform's own producer/control interface.

Stream Keys are encrypted in SQLite and never returned in the API. **Process-based output status is not proof that the remote platform has published the live.** Instagram is subject to account eligibility, session-specific credentials, stream-duration limits, and potentially an additional manual **Go Live** step. Every output currently receives the same H.264/AAC source without platform-specific resizing, vertical conversion, or transcoding. Read the [Multistream Guide](docs/MULTISTREAM.md) for precise steps and limitations.

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

## 🚀 One-command automatic installation

Run on a clean Ubuntu 22.04+ VPS over SSH. The installer asks for your **domain**, checks its DNS A record, installs Docker/Compose if needed, deploys all StreamCore containers, waits for Caddy's trusted HTTPS certificate, and finally prints the unique **panel URL, username and password**.

```bash
curl -fsSL https://raw.githubusercontent.com/hazhanhasani/obs-/main/install.sh | sudo bash
```

**Before running:** point your domain's DNS A record at your VPS's public IPv4, disable proxying (e.g. set Cloudflare to DNS-only during certificate issuance), and allow public TCP 80/443. Invalid IPv6 AAAA records should be fixed or removed. **Run this only after reviewing [install.sh](install.sh)**, since a remote shell installer executes as root.

The installation lives at `/opt/streamcore`. Credentials are securely generated using OpenSSL and saved in a root-readable `.env` with mode `600`. Re-running the installer preserves existing login and encryption secrets and updates the checkout; it does not discard existing stream keys or uploaded video data. The installer prints the login details only after HTTPS is validated.

> Production status: this one-command installation is newly implemented and has not yet been verified on a live VPS. The deployment remains an alpha and should not be treated as production-hardened.

## 🚀 Quick start (manual installation)

**Requirements:** Ubuntu 22.04+ VPS, Docker Engine + Compose v2, recommended 2 vCPU / 2 GB RAM for entry-level use, a domain pointed at the server, inbound TCP 80 and 443.

```bash
git clone https://github.com/hazhanhasani/obs-.git
cd obs-
cp .env.example .env

# Generate and enter independent, strong secrets in .env
openssl rand -hex 24 # ADMIN_PASSWORD
# ADMIN_USERNAME defaults to admin in manual installations
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

- The admin panel uses a username, signed session cookies and CSRF checks, but this **alpha has not undergone a security audit**.
- Keep `SESSION_SECRET` stable to decrypt destination keys after updates. FFmpeg's runtime process arguments are visible to privileged users on the VPS.
- Stream playback is **public** in this version; do not upload private or paid content without access controls.
- Uploaded files must contain H.264 video. Video encoding/transcoding during broadcast is not automatic for file sources.
- Actual viewer capacity depends primarily on VPS outbound bandwidth, bitrate, network quality, and whether a CDN is used.
- Current CPU/RAM widgets should **not** be presented as comprehensive host-level telemetry, and the viewer counts in the concept images are illustrative.
- Only distribute media you own or are licensed to stream.

## 🗺️ Roadmap

- [ ] Run full end-to-end Docker/VPS smoke tests and UI visual QA
- [ ] 24/7 playlist scheduler with queue management
- [ ] RTSP, RTMP and SRT ingest with authorized source management
- [x] RTMP/RTMPS multi-destination output management (alpha)
- [ ] Per-destination encoding presets, reliability telemetry, and verified platform health
- [ ] Private viewer links, signed URLs and access policies
- [ ] Accurate bitrate, traffic, concurrent viewer and service telemetry
- [ ] Admin roles, event logs, backup and zero-downtime update workflow

## 📜 License and status

**Development status:** v0.5.3 alpha — not yet validated for production deployment. No open-source license has been granted for this repository. All rights reserved unless a license is added.

<div align="center">

Built for independent, always-on live broadcasting. 🚀

</div>