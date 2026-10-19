# Scene Output Parity — v0.5.4-alpha

## Why an editor and a live broadcast can look different

The drag-and-drop canvas uses browser CSS and still-media posters. Its
appearance is an *editing approximation* — not an encoded video frame.
FFmpeg composes the actual channel at its selected output preset, then MediaMTX
distributes it to HLS and the RTMP destinations such as Telegram.

Transparent padding in an uploaded logo, `Contain`/`Cover` resizing,
portrait sources inside a landscape canvas, animated layers and unsaved
drafts can all make the browser preview appear different.

## Verify the true output before applying a scene

1. Open **استودیو صحنه** and choose the correct channel.
2. Arrange the background video, image/logo and text overlays.
3. Click **رندر خروجی قبل از ذخیره** in the new **پیش‌نمایش واقعی FFmpeg** panel.
4. The VPS encodes a JPEG frame at the selected canvas resolution using the **same graph of source
   inputs, geometry, scaling and effects as the live FFmpeg publisher**.
5. Inspect this encoded frame before **ذخیره و اعمال صحنه**.
6. Save and apply. The publisher for that channel may briefly restart.
7. Wait for the HLS/RTMP pipeline to replace buffered frames; compare the
   dashboard HLS preview and destination broadcast.

**Important:** this is a snapshot at scene startup (approximately t=0).
Time-scheduled elements may be absent and movement/fades cannot be judged
from a single static frame. It is not a live preview of the destination.

### Source selection and letterboxing

The selected canvas can be landscape (1280×720 / 1920×1080) or portrait
(720×1280 / 1080×1920). The editor, test background, real-render preview and
live encoder all use that preset. Source media is fitted inside that canvas;
changing orientation never rewrites stored layer percentages. Telegram may
letterbox the encoded frame in its player, but does not rearrange sources.

For pictures, `Contain` preserves the entire image, including any
transparent margins; `Cover` fills the box but may crop the image.
Cropping transparent margins in the source file itself is another option
when a logo looks disproportionately small.

### If the picture is still different after save

- Confirm the same **channel** is selected in Studio and Dashboard.
- Verify **ذخیره و اعمال صحنه** returned success, and the channel source
  is **استودیو صحنه** (not Test or a single File).
- If the dashboard and Telegram look identical but the editor differs,
  trust the **real FFmpeg preview**, not the CSS editing canvas.
- Wait a short time after save; HLS/Telegram players may display buffered
  frames from before the publisher restart.
- Check for the current `v0.5.4` label and asset versions
  `scene-editor.js?v=0.5.4` / `scene-editor.css?v=0.5.4`.
- Report the difference with images of the *real FFmpeg preview* and
  *HLS output* (avoid showing RTMP keys).

## Security and performance

- The endpoint is `POST /api/channels/{channel}/scene/preview` and requires
  administrator session authentication and a CSRF token.
- Files and font inputs are validated before running FFmpeg. No draft
  changes are saved and the running publisher is not stopped.
- Requests are limited to one active FFmpeg preview on this VPS.
- FFmpeg exits after a single frame or a 25-second timeout.
- Snapshots and intermediate rasterized text stay in temporary private
  server files; the response is `image/jpeg` with `Cache-Control: no-store`.
- The same `scene_command()` constructs the input/filter graph for both
  live publication and draft preview. Snapshot output replaces only the
  final RTMP muxing with a single JPEG frame.

## Deployment

The source changes are currently on GitHub's main branch only; there has
been **no confirmed deployment to the user's VPS**. Before updating, back up
`.env`, media files and the StreamCore Docker data volume. Schedule a short
broadcast interruption, then:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
docker compose ps
```

After refreshing the dashboard, use the new render button on an unpublished
draft and verify no live channel restarts. Then apply a test scene and compare
the actual HLS output. New tests cover endpoint authorization, unchanged
scene data, identical FFmpeg graphs, image dimensions and crop/scale behavior.

## Scope

This release does not introduce 9:16 output, seamless transitions, a live
animated editing preview, or automatic output adjustment to specific
platform player aspect ratios. Those require additional implementation and
real device/VPS testing.
