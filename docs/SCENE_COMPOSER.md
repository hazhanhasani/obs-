# Visual Scene Composer — StreamCore v0.9.0-alpha

Compose videos, images and text on a VPS from a desktop or mobile browser.
The browser edits a draft; FFmpeg renders the published scene independently.

## Edit a scene

1. Select the channel, output preset, and background video (or test pattern).
2. Add media or text. Limits are three videos, five images and five text sources.
3. Drag a source body to move it. Drag an orange corner to resize freely; the
   opposite corner stays fixed. Mid-edge controls resize one axis and appear
   only when there is sufficient displayed space. Zoom in to expose them on
   small sources. All corner targets remain 44 CSS pixels at any zoom.
4. Use **Preserve aspect** (or hold Shift while resizing) to preserve the box's
   initial ratio. Free independent width/height resizing remains the default.
5. Enable **Snapping** for source/canvas edges and centers within six displayed
   CSS pixels; Ctrl/Command temporarily bypasses it. Guides show matched edges.
   Aspect-locked resizing takes priority over snapping to prevent ratio drift.
6. Use numeric percentages for X/Y/Width/Height, including fully off-frame
   sources. Fit restores intrinsic media aspect and fits to the output; Stretch
   fills the output, Center repositions only, Reset box restores default size
   at the canvas origin. For text, Fit preserves its current box ratio.
7. The source list shows the topmost source first. Eye/lock controls toggle
   visibility and editability. Up/down crosses media and text boundaries.
8. Inspect **Render output** for a real FFmpeg frame, then **Save and apply**.

Moving, resizing, adding/removing sources, properties, ordering, locks,
visibility, background and orientation are undoable within the open editor
(100 transactions). One drag is one transaction. Undo does not write to the
server; explicitly save to publish the restored draft. History resets when a
scene is loaded. It is not a cross-session or server-wide version archive.

## Keyboard and navigation

- Ctrl/Command+Z: undo; Ctrl/Command+Shift+Z or Ctrl/Command+Y: redo.
- Escape: roll back the current gesture to its initial geometry.
- Focus a source with Tab, then Enter/Space to select it.
- Arrow keys: move a focused/selected source by one output pixel; Shift moves
  ten. Positions are quantized to the existing 0.1% storage precision.
- Delete/Backspace inside the canvas: remove an unlocked source.
- Text inputs retain native caret movement, deletion and undo.
- Zoom is local to the editor and never changes output presets or scene data.
  Use the Hand tool to drag the editing viewport with mouse/pen or scroll
  it natively with a finger, without transforming sources. Use numeric controls/Center for distant sources.

Locked sources cannot be dragged, resized, reordered, removed or changed via
properties until unlocked. They still render normally. Hidden sources do not
render or receive gestures and remain available in the source list. Locking is
an editing aid, not an API access-control boundary.

## Output and geometry

Available outputs are 1280×720, 1920×1080, 720×1280 and 1080×1920 at 25fps.
Changing orientation keeps stored percentages unchanged. X/Y may range from
-200% to 200%, dimensions from 0.1% to 200%; output clips at the video frame.
The limits cap resource consumption and do not force sources into the frame.

The editor uses static posters and approximate text layout. **Render output**
is the authoritative first FFmpeg frame, including actual text rasterization,
source order, opacity and effects. Timed sources starting later may not appear
in that first frame. HLS in the dashboard shows the moving stream with latency.
Only the background supplies audio, with silence when it lacks audio; overlay
videos are muted. Composition re-encodes once; destination relays stream-copy.

## Safe updates

This version adds backend fields and additive SQLite columns. Deploy the full
application image, not only its JS/CSS. Finish uploads and wait until channels
are stopped; container recreation can interrupt running broadcasts.

```bash
cd /opt/streamcore
git pull --ff-only origin main
docker compose build dashboard
# Only during the agreed idle maintenance window:
docker compose up -d --no-deps dashboard
```

Do not remove volumes or `.env`. Back up SQLite before deployment. The stable
release updater defers when any channel is desired=1 unless live updates were
explicitly enabled; alpha/main changes are not automatically stable releases.

**Save and apply can restart an active channel's compositor.** It is not a
seamless OBS Studio Mode transition. Rendering an unpublished draft does not
restart the channel. See [geometry](SCENE_GEOMETRY.md),
[OBS comparison](OBS_EDITOR_PARITY.md) and [investigation](SCENE_TRANSFORM_INVESTIGATION.md).
