# Changelog

All significant StreamCore changes are documented here.

This project is still in alpha; stable release guarantees and migration automation are not yet available.

## [0.5.2-alpha] — 2026-10-19

### Fixed
- Prevent periodic dashboard polling from re-rendering a layer during active mobile drag/resize.
- Continue tracking the finger after pointer capture is unexpectedly lost in Android WebViews.
- Avoid reverting geometry when a drag ends outside the editor canvas.
- Verify that the scene API returns the exact saved positions and dimensions before reporting success.
- Prevent stale scene editor assets after updates with versioned JS/CSS URLs.

### Improved
- Show live X/Y/width/height percent feedback when selecting and resizing a layer.
- Add quick 25%, 50%, 75% size presets for small touch targets.
- Preserve requested preset size when a layer is too close to the canvas edge by moving it into bounds.
- Expand mobile gesture regression coverage to 11 test scenarios, including 390px viewport and refresh races.

### Deployment
- Repository-only change; the connected VPS has **not** been updated.
- See [Mobile Scene Debugging](docs/MOBILE_SCENE_DEBUG.md) for rollout and verification.

## [0.5.1-alpha] — 2026-10-19

### Improved
- Add bounded low-CPU encoding profiles for shared VPS deployments.
- Validate source files, text rendering, and filter configuration before replacing an active scene.
- Add FFmpeg compositing smoke-test coverage and performance documentation.

## [0.5.0-alpha] — 2026-10-19

### Added
- Persian/English text overlays with background, font, position, opacity and outline.
- Lightweight Fade, Slide Left, Slide Right, Blink animations.
- Start, duration and repeat timing controls for text and media layers.

## [0.4.1-alpha] — 2026-10-19

### Fixed
- Preserve drag/resize geometry when lifting a finger on the editor canvas.
- Enlarge mobile resize handle and add the first pointer-event regression tests.

## [0.4.0-alpha] — 2026-10-19

### Added
- Compose one background video with multiple simultaneous video/image layers.
- Mobile drag/resize, layer stacking, Contain/Cover options and scene persistence.

## [0.3.1-alpha] — 2026-10-19

### Improved
- Upload progress and cancel controls on mobile.
- Raw media streaming upload endpoint and file validation.
- Prevent video preview from floating over other tabs.

## [0.3.0-alpha] — 2026-10-19

### Added
- RTMP/RTMPS multistream outputs with independent publisher processes.
- Encrypted destination keys and per-output enable/disable controls.

## [0.2.0-alpha] — 2026-10-19

### Added
- Persian RTL control center for VPS-based broadcasting.
- Authenticated dashboard, HLS monitor, FFmpeg + MediaMTX backend and one-command installer.
