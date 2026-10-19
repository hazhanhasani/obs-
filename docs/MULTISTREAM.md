# Multistream outputs — StreamCore v0.3.0 alpha

The VPS is the only runtime. Each destination is independently controlled via
the authenticated RTL dashboard under **پخش چندمقصدی**.

## What is implemented

- Output destinations: Telegram, Instagram, Aparat, YouTube, Twitch and arbitrary RTMP/RTMPS endpoints.
- Per-channel destination entries, each with a label, server URL, encrypted stream key and enable toggle.
- Individual FFmpeg stream-copy relay: MediaMTX RTMP input → FFmpeg (`-c copy`) → external RTMP/RTMPS.
- Auto-retry after a process failure, restart when source is running again; disable/stop isolates a single output.
- Secrets are encrypted in SQLite using a stable key derived from `SESSION_SECRET`; API responses omit them.
- New outputs default to disabled. Deleting a channel removes its output definitions.

## How to connect

1. Enable a stream source on the dashboard, e.g. **کانال اصلی**.
2. Open **پخش چندمقصدی** and select a platform.
3. Obtain the **exact RTMP(S) server address** and separate **Stream Key** from that platform's official live producer/control panel. Do not share keys via chat or commit them to GitHub.
4. Select channel, give the output a label, enter server and key, and save.
5. Enable the saved destination. When the source channel is running, the VPS starts sending packets. Verify that the **platform itself** shows the preview and has accepted the broadcast.
6. If a key expires, choose **تغییر کلید** and paste the new one.

**Important:** status **در حال ارسال** means the relay process is running. It is *not* confirmation that your live is public, that people can view it, or that the platform accepted the stream.

### Telegram
Telegram group/channel RTMP live sessions offer a URL and key. Start an RTMP-mode livestream in the channel/group and copy the values. Permission/admin rights are required. See [Telegram RTMP schema](https://core.telegram.org/type/phone.GroupCallStreamRtmpUrl).

### Aparat
Open your **Aparat Live dashboard** and obtain Stream URL and Stream Key in the streaming settings. The server address and key are separate inputs. Review the official [Aparat streaming settings guide](https://support.aparat.com/kb/articles/pdf/chgonh-dashbord-pkhsh-zndh-aparat-ra-tnthym-knym).

### Instagram
Live Producer is subject to account eligibility and may require a professional account. A fresh session-specific URL/key can be required. External stream delivery does not always publish a live automatically: confirm **Go Live** in the Live Producer UI when Instagram requires it. Instagram has its own live session duration limits, so **24/7 continuous Instagram Live is not guaranteed**. A 16:9 source is copied unchanged; for 9:16 output, create a vertical source or implement a separate transcoding pipeline (not included here).

### YouTube
Enable live streaming and obtain the RTMP(S) server URL and key in YouTube Studio Live Control Room. Some scheduled live events require you to click **Go live** there. See [YouTube official encoder guide](https://support.google.com/youtube/answer/2907883).

### Twitch and custom RTMP
Obtain the current server URL and key in your account/streaming dashboard and add them as a custom destination.

## Limitations and security

- Requires outbound network access to destinations; plan outbound bandwidth as **(destination count × configured source bitrate)** plus HLS viewers.
- Each relay uses stream copy. Codec, audio, frame-rate, aspect ratio and bitrate must already meet the destination's requirements. There is **no per-platform automatic re-encode, rescale or vertical cropping**.
- Encrypted-at-rest does not mean runtime invisibility: FFmpeg receives the destination URL in its child process argument list, readable by privileged processes on the VPS. Never give untrusted users shell/process-list access to the VPS. Rotate exposed keys promptly.
- Destination server must use RTMP or RTMPS; local/private literals are blocked. DNS rebinding and non-IP hostname indirections are a residual SSRF risk; enforce VPS outbound firewall policies.
- Rotating `SESSION_SECRET` invalidates existing encrypted destination keys; re-enter stream keys after a rotation. Back up the secret securely, outside Git.
- Per-output status is process-based, not end-to-end platform health. Restarting a relay may not resume expired Instagram / time-limited sessions.
- Admin access is currently single-user and CI/VPS tests are required before any production deployment.
- The output IDs, stream keys and destinations exist only on the VPS: never put them in frontend configuration or README.
- OBS code was **studied as an architectural reference only**; it was not copied into this repository. OBS Studio itself uses GPL licensing, so any direct future reuse must undergo a licensing review.

## Upstream OBS architectural references

- [libobs plugin architecture](https://github.com/obsproject/obs-studio/blob/master/docs/sphinx/plugins.rst)
- [RTMP publisher](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-outputs/rtmp-stream.c)
- [Common RTMP service settings](https://github.com/obsproject/obs-studio/blob/master/plugins/rtmp-services/rtmp-common.c)
- [Service catalog](https://github.com/obsproject/obs-studio/blob/master/plugins/rtmp-services/data/services.json)
