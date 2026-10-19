# Changelog

All significant StreamCore changes are documented here.

This project is still in alpha; stable release guarantees and migration automation are not yet available.

## [0.6.2-alpha] — 2026-10-19

### Fixed
- Replace muted CSS color bars in Scene Studio with an authenticated JPEG
  frame generated from the actual FFmpeg `testsrc2` 1280×720 input.
- Visibly distinguish unsaved scene drafts from the live stream using an
  overlay that does not intercept touch gestures.
- Retain a CSS-only fallback when FFmpeg snapshot generation is unavailable.
- Bump editor JS/CSS cache keys to 0.6.2.

### Validation
- 18 source-based mobile interaction, draft/live state, and destination tests passed.
- Added integration coverage for authenticated 1280×720 FFmpeg test-pattern rendering.
- Source is committed; VPS rollout and live Telegram output equivalence are not yet verified.

## [0.6.1-alpha] — 2026-10-19

### Fixed
- Wire the server-side FFmpeg scene snapshot into the studio layout comparison flow.
- Warn when Telegram destinations broadcast a different channel than the one currently edited.
- Add a deliberate one-click switch to the channel configured for Telegram, without automatically remapping destinations.
- Highlight when a selected channel is not in scene mode or its local encoder is stalled.
- Match letterbox color in Studio to the actual black-background broadcast canvas.
- Bump scene editor JS/CSS asset URLs to avoid stale mobile layouts.

### Tests
- Sixteen source-level mobile editor/persistence/destination tests passed.
- Added authenticated FFmpeg preview API tests for CSRF, invalid drafts, concurrency and non-disruptive rendering.
- End-to-end VPS deployment and Telegram comparison are still pending.

## [0.6.0-alpha] — 2026-10-19

### Added
- Local FFmpeg progress tracking via a bounded in-memory collector.
- Five-second sampling of per-channel encoder FPS, speed, CPU and RSS memory.
- Encoder health states: stopped, starting, healthy, slow, no-data and stalled.
- RTL status widgets on the main dashboard and system management screen.

### Output parity
- Added authenticated FFmpeg JPEG rendering for unsaved scene drafts using the same compositor filters as live streaming.
- The draft snapshot is isolated from SQLite writes and existing publishers and never uploads to Telegram.
- One snapshot at a time, a 25-second timeout and non-cacheable JPEG responses protect the VPS.
- Added an exact 1280×720 pixel-position FFmpeg test and API persistence/authentication regression tests.
- The editor now distinguishes approximate CSS layout from true FFmpeg output before saving.

### Security and reliability
- Monitoring endpoint uses the existing authenticated `/api/overview`.
- Progress output is whitelisted and retains no RTMP secrets.
- PID isolation prevents a stopped encoder's progress from contaminating a restarted channel.
- Added Python collector/API tests and Node.js dashboard rendering tests.

### Deployment
- Source changes only; no VPS or live streams have been modified.
- Live FFmpeg / MediaMTX validation and longer-duration reliability tests are pending.
- See [Encoder Monitoring](docs/MONITORING.md).

## [0.5.3-alpha] — 2026-10-19

### Fixed
- Remove the orange highlight that misleadingly outlined the entire scene while the user resized a layer.
- Replace the 40px solid orange resize square that obscured small overlays with a 14px visible grip and a large transparent mobile touch target.
- Let the drag handle protrude from an image corner without clipping the image.
- Force refresh of both versioned CSS and JavaScript scene assets.

### Validation
- 12 simulated gesture and CSS/DOM regression cases passed, including the new case derived from the user's Android screen recording.
- End-to-end installation and physical Android QA remain outstanding.

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
