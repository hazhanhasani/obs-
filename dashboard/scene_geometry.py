"""One scene-space geometry contract shared by FFmpeg composition and diagnostics.

Like OBS scene items, a layer has a bounding box independent from the media
pixels drawn inside it. Coordinates are based on the final 1280×720 canvas.
This code is original; no OBS GPL implementation is incorporated.
"""
from dataclasses import dataclass

CANVAS_WIDTH = 1280
CANVAS_HEIGHT = 720
FIT_MODES = ("contain", "cover", "stretch")


@dataclass(frozen=True)
class LayerBounds:
    x: int
    y: int
    width: int
    height: int


def layer_bounds(layer: dict, canvas_width: int = CANVAS_WIDTH,
                 canvas_height: int = CANVAS_HEIGHT) -> LayerBounds:
    """Convert a normalized percentage bounding box to deterministic pixels.

    Even dimensions are required by common 4:2:0 codecs. Position uses
    the top-left canvas origin (same convention as CSS absolute positioning).
    """
    x, y = (float(layer[k]) for k in ("x", "y"))
    w, h = (float(layer[k]) for k in ("w", "h"))
    if not all(0 <= n <= 100 for n in (x, y, w, h)):
        raise ValueError("Invalid normalized scene position.")
    if w <= 0 or h <= 0 or x+w > 100 or y+h > 100:
        raise ValueError("Scene layer extends beyond the canvas.")
    if canvas_width < 2 or canvas_height < 2:
        raise ValueError("Canvas too small for video output.")
    px_x = round(canvas_width * x / 100)
    px_y = round(canvas_height * y / 100)
    # Keep a strictly even positive extent without extending beyond the canvas.
    width = max(2, int(canvas_width * w / 100) // 2 * 2)
    height = max(2, int(canvas_height * h / 100) // 2 * 2)
    width = min(width, (canvas_width-px_x)//2*2)
    height = min(height, (canvas_height-px_y)//2*2)
    if width < 2 or height < 2:
        raise ValueError("Scene layer is outside the video canvas.")
    return LayerBounds(px_x, px_y, width, height)


def ffmpeg_sizing(bounds: LayerBounds, fit: str) -> str:
    """OBS-like inner/outer/stretch within a precomputed source box."""
    w, h = bounds.width, bounds.height
    if fit == "contain":
        return (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"format=rgba,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0")
    if fit == "cover":
        return (f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h},format=rgba")
    if fit == "stretch":
        return f"scale={w}:{h},format=rgba"
    raise ValueError("Unknown scene bounds fitting mode.")
