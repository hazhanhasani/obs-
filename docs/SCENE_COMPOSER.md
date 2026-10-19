# Visual Scene Composer — StreamCore v0.4.0-alpha

**Compose multiple videos and images on one 1280×720 stream directly on the VPS.** No OBS, active browser, phone, or Windows PC is required after saving a scene and starting its channel.

## What you can do

- Upload H.264 videos (`MP4`, `MOV`, `MKV`) and still images (`PNG`, `JPEG/JPG`, `WebP`).
- Choose one looping **background video** or the generated test pattern.
- Add up to **3 additional simultaneous video layers and 5 still image layers** (8 total).
- Move and resize layers by dragging inside the **استودیو صحنه** 16:9 layout preview.
- Set `X`, `Y`, `width`, `height` as percentages of the output canvas, plus opacity and display fit.
- Use **Contain** for the entire uncropped image with transparent padding or **Cover** to fill the box and crop excess.
- Change the stacking order, remove layers, then click **ذخیره و اعمال صحنه** to save everything.
- View the *actual* HLS broadcast in **Dashboard**; the editor preview uses still image/video posters so it stays responsive even on phones.

Scene changes are stored in SQLite and preserved over restart. The existing per-channel FFmpeg process restarts when **Save and apply** is pressed, without changing its desired running state or deleting any output destination. Changes are not continuously sent to FFmpeg while dragging.

## How it works

```text
background video or generator ─── [scale/pad 1280x720] ───┐
video layer 1 ─── [fps / scale / alpha / x,y] ─────────────┤
video layer 2 ─── [fps / scale / alpha / x,y] ─────────────┤
image layer ───── [repeat / scale / alpha / x,y] ─────────┤
                                                           ↓
                                                      FFmpeg overlay
                                                           ↓
                                                H.264 720p / AAC 25fps
                                                           ↓
                                            MediaMTX origin + HLS + relays
                                                           ↓
                                        Telegram / Aparat / Web / others
```

FFmpeg encodes the **composited** video once; outward RTMP(S) destination relays use stream-copy of that output when the platform accepts H.264/AAC. CPU consumption depends on the number and resolutions of concurrent video layers; the 4-shared-vCPU VPS may require reducing to one or two video overlays.

- Output: 1280x720, 25fps, H.264, ~2.5Mbps video, 128kbps AAC. The background audio track is used when available; otherwise silent AAC audio is generated. Other video layers are muted in the final stream.
- Media never leaves the VPS unless the configured stream destinations send it.
- Photos are checked with Pillow for actual format, dimensions and size before appearing in the library (max 12MB and 20 megapixels). Animated WebP is rejected.
- In this alpha the encoder is **not adaptive**. It will not automatically make separate vertical streams for Instagram; independent 9:16 scene presets are a future feature.
- Composition always re-encodes the final video; it cannot use `-c:v copy` for multiple visual inputs.
- A scene's saved dimensions and positions are applied identically for all viewers. The editor is not a live remote screen-sharing canvas.
- Changing/saving an active scene momentarily interrupts HLS/RTMP during encoder restart. There is no seamless transition or frame-accurate timeline yet.
- The project has not been end-to-end verified on the user's VPS; run smoke tests before production.

## Secure image preview and upload

Uploaded images and generated thumbnails are served via authenticated `/api/media/poster/<id>` and are never exposed via a public media directory. Paths are generated server-side and checked to remain under `/media`.

An image in use as a layer cannot be deleted until removed from that scene. Video backgrounds likewise remain protected from accidental deletion.

## Update (existing server)

Before updating, finish ongoing uploads and schedule a short break in active streams:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Do not remove Docker volumes or the `.env` file; SQLite migrates existing media entries by adding a `kind` column when the dashboard starts.

## Operator smoke test

1. Upload a small H.264 MP4 and a valid PNG.
2. Open **استودیو صحنه**, choose background video or the test pattern.
3. Add PNG and one extra MP4. Drag, resize and adjust opacity.
4. Save the scene. Start the channel (or wait for restart if running).
5. Open **Dashboard** and check HLS output. Inspect FFmpeg logs on the server when needed.
6. Stop/start and restart the dashboard Docker service to confirm persistence.
7. Verify that disabled multistream outputs do not send data.

If video playback is choppy or the VPS CPU becomes saturated, reduce the number of simultaneous video layers before changing the output bitrate or encoder preset.
