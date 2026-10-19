# Text & Effects Engine — StreamCore v0.5.0-alpha

Scene Studio supports Persian/English text overlays and timed motion effects for images and videos. All compositing happens on the Linux VPS without OBS or a continuously connected phone.

## Text layers

1. Open استودیو صحنه and choose a channel.
2. Click افزودن متن, enter Persian or English (up to 240 characters / 5 lines), then drag and resize the overlay.
3. Configure font size (12–110px), foreground/background color, alignment, outline, opacity and position.
4. Choose animation and timing, click نمایش آزمایشی افکت to preview, and ذخیره و اعمال صحنه to publish.

Text uses Pillow with libraqm and Noto/DejaVu fonts to generate transparent PNG layers. Raw text never enters an FFmpeg filter expression or subprocess shell. Mixed Persian and Latin uses a font supporting both scripts.

## Supported effects

| Effect | Image | Text | Behavior |
| --- | --- | --- | --- |
| None | Yes | Yes | Static while enabled |
| Fade | Yes | Yes | Fade in/out within the first display window |
| Slide Left | Yes | Yes | Enter from left over ~0.7 seconds |
| Slide Right | Yes | Yes | Enter from right over ~0.7 seconds |
| Blink | Yes | Yes | Repeated visibility toggle |

Start is relative to FFmpeg encoder startup. Duration=0 means forever; positive Duration limits visibility. Repeat=0 disables repetition; otherwise Repeat must be at least Duration. Example: Start=0, Duration=5, Repeat=30 shows a banner for five seconds every thirty seconds.

**Limitation:** Fade animates during the first occurrence only; repeated display windows do not replay the alpha fade. Slide and Blink repeat. Zoom, Typewriter, Pan and advanced transitions are not yet implemented.

## Layer limits and resources

- Eight media overlays maximum: up to three video layers and five still images, plus five independent text layers.
- The output is currently 1280x720 H.264/AAC at 25fps; compositing requires re-encoding and consumes CPU.
- On shared-vCPU VPS plans, start with one extra video, one picture and one text before increasing complexity.
- The editor has an approximate visual preview; the real encoded HLS preview is in Dashboard.
- Saving an active scene briefly restarts the FFmpeg compositor; multistream destinations are left configured.
- Per-platform portrait 9:16 output and multiple bitrates are future improvements.

## Update existing VPS

From an SSH terminal, after finishing uploads and allowing a brief broadcast interruption:

    cd /opt/streamcore
    git pull --ff-only
    docker compose up -d --build
    docker compose ps

Preserve .env and Docker volumes. Existing scene data is migrated in SQLite; text layers are stored separately. After updating, refresh the dashboard. For problems inspect Docker dashboard/MediaMTX logs and FFmpeg logs inside the persistent dashboard data volume. Never paste credentials or stream keys into chat.

## Validation

Unit/API regressions cover timing, Unicode text rendering, text persistence and image effects. FFmpeg overlay expressions were tested in an isolated local prototype; real deployment on the user's VPS and complete GitHub Actions results still require verification.