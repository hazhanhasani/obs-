# Scene geometry — v0.7.0-alpha

StreamCore uses one normalized 1280 × 720, top-left-origin bounding box per
layer: `x, y, w, h` are percentages of the **output canvas**, not the
source file dimensions and not percentages of the mobile screen.

The canonical Python geometry lives in
[`dashboard/scene_geometry.py`](../dashboard/scene_geometry.py).

| StreamCore fit | Equivalent OBS bounds behavior | Browser preview | FFmpeg render |
| --- | --- | --- | --- |
| Contain | Scale to inner bounds | `object-fit: contain` | Aspect-preserving scale + transparent pad |
| Cover | Scale to outer bounds | `object-fit: cover` | Aspect-preserving scale + central crop |
| Stretch | Stretch to bounds | `object-fit: fill` | Explicit width × height scaling |

The output pixel width and height are rounded down to even values for H.264
compatibility. A 90%-wide, 90%-high layer at X=10%, Y=10% becomes:
`x=128, y=72, w=1152, h=648`.

An optional dashed Safe Area overlay marks approximate 5% left/right and
8% top/bottom margins. It does **not** modify the encoded stream or crop
the content. It is a visual placement guide.

These bounds modes are modeled after the **concepts** in OBS's publicly
documented `obs_transform_info.bounds_type`. This module is an independent
Python implementation and does not copy OBS's GPL scene implementation.

**Important**: Cropping individual source edges, arbitrary-angle rotation,
pixel-perfect font measurement, multi-canvas portrait outputs and timecoded
program/draft transitions are not yet implemented. Use `رندر خروجی قبل از
ذخیره` to inspect the exact output of FFmpeg. An editable browser layout
remains an approximation of its media pixels.

Saving changes may restart the channel compositor; back up and use an
appropriate maintenance window.
