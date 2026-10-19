# Scene Transform Implementation Plan

**Goal:** Make actual pointer/touch resizing reliable with persisted off-frame geometry.
**Architecture:** One pure geometry engine, stable media DOM and an independent control plane. Run production headers, routes, SQLite and FFmpeg in browser tests.
**Scope:** The supplied Scene Editor task; no live publisher or production server restart.

- [x] Reproduce production CSP violations using authenticated browser routes.
- [x] Add failing off-frame and tiny-handle hit tests before replacing controls.
- [x] Extract normalized corner math to `scene-transform.js`.
- [x] Separate controls from media opacity, effects and stacking.
- [x] Use one input event family, root capture, window continuation and explicit completion.
- [x] Match canvas content-space metrics, maintain fractional geometry and add landscape Full HD.
- [x] Expand browser tests to actual input, persistence and decoded FFmpeg frames.
- [x] Run full regressions and review the final diff.
- [ ] Commit and push main; inspect Actions. Leave production streams running.

Review focus: CSP applied by the HTTP server, sub-percent bounds, translucent
selected layers below another source, pointer cancellation/lost capture,
and orientation/viewport changes without pointer motion.
