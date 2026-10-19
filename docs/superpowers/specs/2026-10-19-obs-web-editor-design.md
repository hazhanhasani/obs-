# OBS-inspired web scene editing

The operator requested OBS-style scene editing on desktop and Android Chrome.
This changes the existing editor, not the native OBS application or live encoder
architecture. The existing normalized geometry contract and off-frame positioning
remain authoritative. No running deployment is restarted by this work.

## Design

- Eight axis-aligned handles with opposite-edge anchoring. Corner controls retain
  separate outward 44 CSS pixel targets. Edge controls appear only when there is
  enough displayed space to avoid overlapping the corner targets.
- Geometry-first hit testing prioritizes selected handles, then visible unlocked
  sources from front to back. Native buttons remain for Chromium touch adjustment.
- Free resize is the default; an explicit aspect toggle (or Shift while resizing)
  preserves the initial box ratio. Optional snapping uses displayed CSS pixels,
  supports source/canvas edges and centers, and never confines sources to canvas.
- One undo transaction per gesture; numeric edits, adding/removing sources,
  visibility, locking, ordering, base and orientation also participate. Escape
  restores the gesture baseline. Browser cancellation keeps the last valid draft.
- Shared media/text stacking, visibility and locking persist using additive SQLite
  columns with legacy defaults. DOM composition and FFmpeg use the same order;
  hidden sources are omitted from rendering but retained in the scene.
- Transform commands include center, fit, stretch and reset. Arrow keys nudge in
  output pixels; Shift increases the step. Shortcuts never intercept text fields.
- Zoom affects only the editing viewport, not output dimensions or saved geometry.
  Workspace scrolling provides navigation at higher zoom and for off-frame items.

## Boundaries

No GPL source is copied. The reference is OBS Studio revision
`f1c0a116441bdb7a1de7896f810009ea487b8508`, principally
`frontend/widgets/OBSBasicPreview.cpp`, `frontend/dialogs/OBSBasicTransform.cpp`,
`frontend/utility/undo_stack.cpp`, and `libobs/obs-scene.c`.
Rotation, source cropping, groups, multi-selection, native capture plugins and
seamless Preview/Program transitions are separate capabilities, not simulated
with inert UI. Existing safe resource limits remain (X/Y ±200%, size 0.1–200%).

## Verification

Pure geometry tests cover edge anchors, aspect ratio, snapping and hit tests.
Real browser input covers mouse and finite-contact touch, all eight handles,
undo/redo/cancel, locks/visibility, mixed stacking, zoom, save/reload, and decoded
FFmpeg output. Existing production-CSP browser tests remain gates. Physical
Android verification is reported separately from desktop touch emulation.
