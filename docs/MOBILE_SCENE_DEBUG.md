# Current transform diagnostics (0.8.1)

Start with [the confirmed root causes and browser tests](SCENE_TRANSFORM_INVESTIGATION.md)
and [the geometry contract](SCENE_GEOMETRY.md). Earlier CSS-only diagnoses
below are historical and do not establish that resizing works.

# Mobile Scene Editor Debugging — StreamCore v0.5.3

A recorded Android reproduction showed the overlay geometry becoming smaller
correctly, while two unrelated UI elements misleadingly made the scene appear
unchanged: the entire canvas flashed orange and an oversized orange corner
handle hid the shrunken logo. The new 14px visible handle sits on the layer
boundary while its 42px transparent touch target remains usable.

The editor should keep an image/video/text layer's size and location immediately
after finger release. The **Save and apply** button is still required to persist
the new scene on the VPS and update the encoded broadcast.

## Install and verify the exact mobile fix

> This fix is currently committed to GitHub. It has **not** been deployed to the
> connected VPS, because server management access is on hold.

If a live stream is running, choose a short maintenance window before updating.
On the VPS, back up `.env`, the `media` directory and the
`streamcore_dashboard_data` Docker volume. Then:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
docker compose ps
git log -1 --oneline
```

Ensure that the resulting version label in the dashboard reads
`v0.5.3`. The HTML uses these versioned assets:

- `/assets/scene-editor.js?v=0.8.1`
- `/assets/scene-editor.css?v=0.8.1`

If your Android browser still uses the older script, reload the tab, close
other copies of the dashboard, or clear **site-only** cached data for the
StreamCore domain. Clearing all browser app data is normally unnecessary.

## Verification on Android (portrait and landscape)

1. Open **استودیو صحنه**, select the desired channel, and add one logo or
   still image over the test-pattern background.
2. Tap the image. Use the orange square in its bottom-right corner to resize.
3. Confirm that the on-screen HUD updates `X / Y / width / height` in percent.
4. Lift your finger. Confirm the layer remains at its new size, even after
   waiting more than 5 seconds (dashboard polling interval).
5. Resize again; drag beyond the image edge and release. It should still keep
   the final position and size.
6. Use the **25% / 50% / 75%** quick presets if your fingers obscure the
   resize handle. A size preset never repositions an off-frame layer.
7. Click **ذخیره و اعمال صحنه**, wait for the success message, and reload the
   editor. Confirm the size and position have survived the round-trip to SQLite.
8. Verify the actual HLS output on Dashboard. Visual changes to the broadcast
   are applied only when a saved scene is re-encoded.
9. Check both portrait and landscape mode. Try a text layer too.

### If the issue continues

Please provide **only**:
- A short screen recording showing the resize attempt and finger release.
- Whether the size jumps **immediately**, **after ~5 seconds**, or
  **only after reloading**.
- The dashboard version shown in the sidebar and whether the 25/50/75%
  buttons appear.
- If Save fails, the displayed error message (with secrets concealed).

These details distinguish pointer event failure, periodic poll redraw,
stale browser files, and rejected server persistence. **Do not share
admin passwords, private stream keys, or the `.env` file.**

## Implementation notes

- The active gesture owns the in-memory geometry until pointerup/cancel.
  Periodic overview refreshes cannot recreate the touched DOM while dragging.
- Unexpected pointer-capture loss does not abort the gesture; window-level
  pointer listeners continue tracking changes.
- Final geometry is mirrored in the percent HUD and UI fields.
- Save confirms the API persisted exactly the submitted layer IDs and
  X/Y/W/H values before displaying success.
- Quick size presets reposition a layer within the 16:9 canvas rather than
  silently shrinking the chosen width.
- JavaScript and CSS use explicit versioned URLs, preventing stale fixed assets
  across most browser caches.

## Validation limits

12 gesture, CSS visibility and persistence regression scenarios have passed in a JavaScript
simulation using the repository's exact editor source. CI also runs the
Node.js regression suite. This does **not** replace live mobile browser QA or
a real VPS deployment smoke test, both of which remain outstanding.
