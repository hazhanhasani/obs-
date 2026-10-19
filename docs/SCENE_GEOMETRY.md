# Scene geometry and interactions

`x`, `y`, `w`, `h` are percentages of the active **output canvas**, measured
from its top-left corner. They are never percentages of the source image or
phone screen. Media and text use the same bounding-box contract.

| Preset | Output pixels |
| --- | --- |
| landscape | 1280 × 720 |
| landscape_fullhd | 1920 × 1080 |
| portrait | 720 × 1280 |
| portrait_fullhd | 1080 × 1920 |

Changing presets preserves all stored layer percentages. Existing channels
without a setting default to landscape. SQLite INTEGER-affinity columns
already accept fractional numeric values; no destructive migration is needed.

The centralized browser math is `dashboard/static/scene-transform.js`;
FFmpeg conversion and validation are in `dashboard/scene_geometry.py`.
Keep their safety limits synchronized: X/Y -200..200%, W/H 0.1..200%, editor
precision 0.1%. These are resource limits, **not confinement to the frame**.
FFmpeg rounds dimensions down to even pixels, with a minimum 2px raster.
Positions are rounded to output pixels; 4:2:0 can introduce a further 1px
alignment difference. Geometry comparison allows at most 2 output pixels.

| Corner | Moving edges | Fixed corner |
| --- | --- | --- |
| NW | Left, top | Bottom-right |
| NE | Right, top | Bottom-left |
| SW | Left, bottom | Top-right |
| SE | Right, bottom | Top-left |

Width and height change independently. Crossing the anchor stops at the
minimum size rather than flipping the source. A selected source has one
independent control plane. Four outward 44px targets cannot overlap even for
a tiny logo; controls remain opaque and above sources without changing their
composition order. Drag the orange corner or the transparent area immediately
outside it. Drag the source body to move. Numeric X/Y/Width/Height controls
allow precise recovery of fully off-screen sources, as does Center layer.

The padded workspace displays off-frame editing content. Published output
is clipped to the video frame by FFmpeg, without shrinking source geometry.
Safe Area is a composition guide and never changes source coordinates.

| Fit | Browser | FFmpeg |
| --- | --- | --- |
| contain | object-fit: contain | Aspect-preserving scale + transparent pad |
| cover | object-fit: cover | Aspect-preserving scale + center crop |
| stretch | object-fit: fill | Independent width/height scaling |

The persistent root captures pointers; window listeners continue a drag
outside the frame. Pointer Events and legacy input are mutually exclusive.
Cancellation, blur and page hiding retain the last valid draft and clean up
capture. They never implicitly save or restart a publisher. Polling cannot
replace layer DOM during an active gesture. Releasing commits local geometry;
**Save and apply** persists it and may restart that channel's compositor.
Use Render output to inspect actual FFmpeg pixels without publishing.

For evidence, tests and deployment limitations see
[the investigation](SCENE_TRANSFORM_INVESTIGATION.md).
