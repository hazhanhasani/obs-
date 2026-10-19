# Changelog

All significant StreamCore changes are documented here.

This project is still in alpha; stable release guarantees and migration automation are not yet available.

## [0.9.0-alpha] — 2026-10-19

### Added
- OBS-inspired geometry-first picking and eight resize handles, with fixed
  opposite edges, adaptive non-overlapping edge controls and 44px corner targets.
- Explicit aspect preservation, optional CSS-pixel snapping with guides and
  Ctrl/Command bypass, 100-step undo/redo and Escape gesture rollback.
- Keyboard source selection, pixel-based nudging, delete and undo/redo shortcuts;
  text fields retain native keyboard editing.
- Editor-only zoom and mouse/pen/native-touch hand navigation, intrinsic-aspect
  Fit, Stretch, center and default-box reset.
- Persisted source locking, visibility and shared media/text stacking. Additive
  SQLite migrations preserve existing coordinates and legacy composition order.
- One FFmpeg source composition loop shared by previews and published output;
  hidden sources remain saved but are not decoded or composited.

### Fixed
- Keep keyboard focus in the canvas after history restoration.
- Verify every supplied source property in save responses, not only geometry.
- Reject duplicate identifiers across media and text before persistence.
- Invalidate scene assets with 0.9.0 versions and update the displayed version.

### Validation and rollout
- Add pure transform/history, SQLite migration, and real browser input tests,
  including decoded FFmpeg pixels for mixed source order and hidden layers.
- Full backend deployment is required during an idle maintenance window;
  frontend-only copying is insufficient. No live installation is restarted.
- This remains an alpha web editor; no physical Android verification or native
  OBS feature parity is claimed. See `docs/OBS_EDITOR_PARITY.md`.

## [0.8.1-alpha] — 2026-10-19

### Fixed
- Use native buttons for resize grips. Chromium's mobile touch adjustment
  retargeted a finite finger contact on decorative span grips to the nearby
  media role=button, starting a move instead of a resize.
- Invalidate editor assets with 0.8.1 versions.

### Validation
- Add input tests at the visible orange grip, with touch contact radii of
  1, 8, 14 and 22 CSS pixels and device scale factors 1, 2.75 and 3.
- Verify actual pointer targets, all four opposite-edge anchors, dimensions,
  SQLite persistence and reload. Point-only center-of-hitbox tests did not
  cover this Chromium touch-adjustment behavior.
- Physical Android verification still requires testing the updated installation.

## [0.8.0-alpha] — 2026-10-19

### Fixed
- Permit dynamic style attributes under production CSP; previously pointermove
  CSSOM updates worked but HTML reconstruction rejected saved geometry.
- Permit Blob images for the actual FFmpeg preview.
- Separate transform controls from media stacking, opacity and animation.
- Replace overlapping tiny-logo grips with independent outward 44px targets.
- Expose off-frame editing controls and use the displayed content rectangle.
- Preserve stable DOM, last-frame geometry, cancellation and save response state.
- Use Pointer Events exclusively where supported, with legacy-only fallbacks.

### Added
- A pure, testable transform engine with opposite-corner anchoring and rAF paint.
- 1920×1080 landscape output, with existing geometry preserved on preset changes.
- 0.1% minimum media/text size, synchronized across API and renderer.
- Real browser mouse/touch/pen tests against production CSP, API and SQLite;
  decoded FFmpeg pixel comparisons in all four output presets.
- Browser interaction gates in both validation and release workflows.

### Compatibility and rollout
- Existing databases and stored scene geometry are preserved.
- Asset query versions are 0.8.0 to invalidate cached editor code/styles.
- Physical Android/WebView and live production rollout remain unverified.
- Main does not trigger unattended installation: the updater requires a stable
  published Release and defaults to postponing updates during active streams.

## [0.7.3-alpha] — 2026-10-19

### Fixed
- Resolve legacy CSS specificity override which stacked all four mobile
  resize handles at the SE (bottom-right) corner.
- Position actual northwest, northeast, southwest and southeast hit targets
  independently at mobile and desktop viewports.
- Preserve the opposite edge on extreme corner resizes and prevent quick-size
  controls from changing intentionally off-canvas X/Y coordinates.
- Bust stale Android browser CSS/JS with `v0.7.3` asset query versions.

### Validation
- Add real headless Chrome DOM hit-target regression to GitHub Actions.
- Existing FFmpeg and JavaScript tests remain part of the CI gate.
- Physical Android and live Telegram production verification remain pending.

## [0.7.2-alpha] — 2026-10-19

### Fixed
- Removed 0..100% viewport confinement from scene layer position and bounds.
- Matched media and text layer validation to FFmpeg's offscreen overlay
  semantics; negative and larger-than-canvas positions no longer fail Save.
- Added independent NW, NE, SW and SE mobile resize handles with opposite-edge
  anchoring; unchanged selected layer DOM while pointer capture is active.
- Added dedicated recovery control for layers that leave the visible canvas.
- Added 0.1% precision numeric X/Y/Width/Height editing.

### Validation
- Scene touch gestures, four-corner anchors, offscreen transforms and
  real FFmpeg/JPEG clipping tests are covered by automated regression tests.
- CI and VPS streaming verification must pass before live deployment.

## [0.7.1-alpha] — 2026-10-19

### Fixed
- Remove mandatory 1280×720 composition for portrait video/photo sources.
- Persist a channel-specific output preset with a backward-compatible SQLite
  table; existing channels remain landscape by default.
- Use the same 9:16 dimensions for FFmpeg filters, text PNGs, test background
  and authenticated draft snapshot.
- Adapt the Scene Studio canvas and Dashboard HLS preview for portrait video.
- Refresh versioned JavaScript/CSS URLs to avoid stale Android browser assets.

### Added
- 720×1280 portrait and 1080×1920 portrait-Full-HD output options.
- Nine Python orientation tests and three new UI selection tests.

### Operational notes
- All 22 simulated JavaScript regressions passed; Python CI outcome and
  live Telegram comparison remain pending.
- Higher-resolution portrait streams require more CPU and bandwidth.
- No GitHub stable release or VPS automatic deployment was triggered.

## [0.7.0-alpha] — 2026-10-19

### Added
- Canonical 1280×720 bounding-box math for scene overlays.
- OBS-inspired stretch mode in addition to Contain and Cover.
- Optional Safe Area guides for mobile composition.
- Stable SemVer GitHub Release detector and systemd six-hour checks.
- Backups for `.env` and SQLite before any unattended Docker rebuild.
- Health-gated deployment and best-effort container/code rollback.
- Release publishing CI gate requiring shell, Python, Node and Docker tests.

### Fixed
- Installer preserves existing custom environment variables and encryption keys.
- Live streams postpone automatic redeployments unless explicitly allowed.

### Validation status
- 19 source-level mobile editor regressions succeeded in isolated harness.
- New geometry and update selection unit tests added; GitHub Actions outcome
  and production VPS rollout have not yet been confirmed.
- No stable Release has been tagged/published by this change.

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
