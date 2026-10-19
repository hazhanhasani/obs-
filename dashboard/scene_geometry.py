"""One scene-space geometry contract shared by FFmpeg composition and diagnostics.

Like OBS scene items, a layer has a bounding box independent from the media
pixels drawn inside it. Coordinates are based on the active canvas dimensions selected for the channel.
This code is original; no OBS GPL implementation is incorporated.
"""
from dataclasses import dataclass
import math

CANVAS_WIDTH = 1280
CANVAS_HEIGHT = 720
FIT_MODES = ("contain", "cover", "stretch")
# The transform can leave the published viewport, unlike its visible pixels.
# Range also bounds CPU and memory requirements on a shared VPS.
MIN_POSITION, MAX_POSITION = -200.0, 200.0
MIN_SIZE, MAX_SIZE = 5.0, 200.0

# Rendering presets are intentionally finite to cap CPU and memory requirements.
# Older channels remain landscape unless explicitly changed by the operator.
CANVAS_PRESETS = {
    "landscape": (1280, 720),
    "portrait": (720, 1280),
    "portrait_fullhd": (1080, 1920),
}


def canvas_size(preset: str = "landscape") -> tuple[int, int]:
    try:
        return CANVAS_PRESETS[preset]
    except (KeyError, TypeError) as error:
        raise ValueError("Unknown scene canvas preset.") from error



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
    if not all(math.isfinite(n) for n in (x, y, w, h)):
        raise ValueError("Scene bounds must be finite.")
    if not (MIN_POSITION <= x <= MAX_POSITION and
            MIN_POSITION <= y <= MAX_POSITION and
            MIN_SIZE <= w <= MAX_SIZE and MIN_SIZE <= h <= MAX_SIZE):
        raise ValueError("Scene transform exceeds safe bounds.")
    if canvas_width < 2 or canvas_height < 2:
        raise ValueError("Canvas too small for video output.")
    # Position and dimensions must never shrink to fit the output frame.
    # FFmpeg overlay performs the actual clipping during final composition.
    px_x = round(canvas_width * x / 100)
    px_y = round(canvas_height * y / 100)
    width = max(2, int(canvas_width * w / 100) // 2 * 2)
    height = max(2, int(canvas_height * h / 100) // 2 * 2)
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
