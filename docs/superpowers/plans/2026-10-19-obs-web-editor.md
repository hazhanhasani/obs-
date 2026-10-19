# OBS-inspired Web Editor Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the OBS-inspired editing behaviors in the design with real browser evidence.
**Architecture:** Keep a pure transform/history engine, a stable gesture DOM, and
one shared persisted stacking/visibility model for preview and FFmpeg.
**Tech Stack:** Vanilla JS/CSS, Python/FastAPI, SQLite, FFmpeg, Playwright.
**Spec:** docs/superpowers/specs/2026-10-19-obs-web-editor-design.md

## Global Constraints

- No live deployment restart; preserve legacy scene geometry and data.
- X/Y ±200%, size 0.1–200%; four fixed output presets; free resize defaults.
- Native buttons and independent 44px corner targets stay supported.

## Review Focus

- Tiny selected sources must retain independent corner targets.
- Hidden/locked layers must not steal gestures from editable layers.
- Editing during an in-flight save must remain dirty.
- Zoom, portrait mode and DPR must not alter saved geometry.
- Mixed source ordering must agree with actual encoded pixels.

## Tasks

1. [x] Write and run failing pure tests for eight-edge transforms, aspect,
   geometry hit testing, snapping and bounded undo history; implement engine.
2. [x] Write and run failing persistence/renderer tests for optional locked,
   visible and z_index fields; add compatible migrations and shared composition.
3. [x] Write failing real browser tests for controls, history, cancellation,
   locks/visibility, order, zoom and keyboard. Integrate editor and mobile UI.
4. [ ] Run the full JS, Python, browser and shell checks; resolve regressions.
   Update docs, asset versions and changelog, review diff, commit and push main.
   Verify Actions and report deployment and physical-device limitations.


## Execution record

- Geometry/history tests first failed on missing functions and edge/aspect
  behavior, then passed with the pure engine and existing editor regressions.
- Metadata tests first failed on missing fields, mixed order and duplicate IDs;
  full Python suite subsequently passed: 68 tests plus 27 subtests.
- Geometry-first browser regression first failed with a canvas DOM target;
  passed after geometric picking was integrated.
- Independent review found numeric aspect clamping and focus defects. Browser
  regressions reproduced both before fixes. A tall-source toolbar interception
  was also reproduced and fixed by the independent scrollable editing viewport.
- Intrinsic Fit and hand-tool tests were observed failing before implementation.
- Deferred minor: pixel-based keyboard nudges are quantized to the existing
  0.1% geometry precision. This is documented; changing storage precision is
  outside this compatibility-preserving update.
- No physical Android or live VPS verification is claimed. No deployment was
  restarted. Full final browser verification and Actions are release gates.

- Final local results: 120/120 browser cases, 57/57 JS cases, 68/68 Python
  tests plus 27 subtests, 2/2 standalone Chromium hitbox cases, installer and
  syntax checks passed. An earlier local browser run timed out at the numeric
  aspect save case; added HTTP/status/settlement diagnostics, rechecked that
  case and reran the entire suite cleanly. Its product cause was not reproduced.
- Publication/Actions status is reported in the delivery message; deployment
  remains an explicit idle-window operation, not an effect of these tests.

- CI attempt 2 exposed a real mobile drawer interception (119/120 browser cases
  passed). A slowed closing transition reproduced the exact sidebar DOM target;
  the dismissed drawer now stops pointer input immediately. The new test failed
  before this fix and passed after it. Full 0.9.1 rerun: 121/121 browser cases,
  no failure/cancellation; 57/57 JS cases. The new main commit is rechecked in CI.
