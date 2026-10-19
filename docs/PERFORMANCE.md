# StreamCore v0.5.1 — Shared VPS performance and safe scene updates

## Why these changes?

A read-only check on the connected 4-shared-vCPU VPS showed high sustained load
(load average above 6 and roughly 350% dashboard container CPU use) while
several FFmpeg jobs were active. This is a workload-specific observation,
not a benchmark or proof of a fixed performance regression.

The default scene encoder is now `ultrafast`, with two encoder/filter threads
and 2500kbps H.264 video bitrate, still at 1280×720 / 25fps. Text rendering
and layered image/video composition remain available.

**Trade-off:** `ultrafast` uses less CPU than `veryfast` but can produce
larger artifacts at the same bitrate. Keep bitrate appropriate for every
destination's limits. If you have spare CPU capacity, use `superfast` or
`veryfast` for better compression.

## Configuration

Add optional environment variables to `/opt/streamcore/.env`:

```dotenv
SCENE_ENCODER_PRESET=ultrafast
SCENE_ENCODER_THREADS=2
SCENE_VIDEO_BITRATE_KBPS=2500
```

Accepted ranges:
- Preset: `ultrafast`, `superfast`, or `veryfast` (no arbitrary FFmpeg arguments).
- Threads: integer 1–4.
- Video bitrate: integer 800–6000 in kbps.

These settings apply to composed scenes. Test-pattern mode and single-file
stream-copy mode retain their existing behavior. Each active channel has its
own FFmpeg process, so multiple composited channels still consume CPU.

## Safe scene changes

Before writing a scene or stopping its existing publisher, the API now checks:

- The channel exists and each selected file is present on the VPS.
- The selected encoding options are valid.
- Image/video overlays have valid filter-graph parameters.
- Each text layer can be rendered with the installed Persian/Latin fonts.

If this preflight fails, the API responds with a validation error and keeps
the existing saved scene and active stream untouched. This prevents a common
failure mode caused by missing fonts, deleted files, or invalid effect data.

**Limitations:** Preflight is not a full RTMP end-to-end connectivity test.
It cannot guarantee the new scene will encode at realtime FPS or that
external platforms will accept the result. Saving a *valid* scene still
briefly restarts the channel's FFmpeg process.

## Deployment checklist

This patch has been committed to GitHub only. **It is not installed on the
connected VPS.** Do not update automatically during an active paid/public stream.

1. Make a backup of `/opt/streamcore/.env`, the `media` folder and the
   `streamcore_dashboard_data` Docker volume. Keep backups private.
2. Schedule a short maintenance window and verify the current scene's settings.
3. After the connected management account's access restrictions have been
   resolved, deploy with:
   
   ```bash
   cd /opt/streamcore
   git pull --ff-only
   docker compose up -d --build
   docker compose ps
   ```
4. Validate `/health`, the HLS output, all configured destinations, and
   CPU usage. Reduce extra simultaneous video layers if the server remains
   overloaded.
5. If deployment fails, stop and restore the previous known-good commit and
   image without deleting volumes, sessions, or media. Review service logs
   before retrying.

## Tests

- Unit tests validate preset/bitrate/thread bounds and generated FFmpeg options.
- API regression tests ensure invalid text fonts are rejected **without
  stopping live channels or overwriting saved scenes**.
- An isolated FFmpeg overlay smoke test succeeded with an H.264 output,
  though production VPS verification is still pending.
