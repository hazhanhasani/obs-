"""Secure RTL/LTR text rasterization and timed FFmpeg overlay expressions."""
import math
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, features
from scene_geometry import layer_bounds, ffmpeg_sizing

CANVAS_W, CANVAS_H = 1280, 720
MAX_TEXT_LAYERS = 5
SUPPORTED_EFFECTS = frozenset({"none", "fade", "slide-left", "slide-right", "blink"})
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
RTL = re.compile(r"[\u0590-\u08FF]")

def check_timing(effect, start_sec, duration_sec, repeat_sec):
    if effect not in SUPPORTED_EFFECTS:
        raise ValueError("افکت انتخاب‌شده معتبر نیست.")
    for n in (start_sec, duration_sec, repeat_sec):
        if not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0 or n > 3600:
            raise ValueError("محدوده زمان‌بندی معتبر نیست.")
    if repeat_sec and (not duration_sec or repeat_sec < duration_sec):
        raise ValueError("برای تکرار، مدت نمایش باید مثبت و از فاصله تکرار بیشتر نباشد.")

def _font(rtl, mixed, size):
    base = Path("/usr/share/fonts/truetype")
    # DejaVu covers both Latin and Arabic; Noto Arabic alone cannot render Latin.
    names = (["DejaVuSans.ttf"] if mixed else
             ["NotoSansArabic-Regular.ttf", "DejaVuSans.ttf"] if rtl else
             ["NotoSans-Regular.ttf", "DejaVuSans.ttf"])
    for name in names:
        for folder in ("noto", "dejavu"):
            path = base / folder / name
            if path.is_file():
                if rtl and not features.check("raqm"):
                    raise ValueError("برای نوشتار فارسی باید libraqm فعال باشد.")
                return ImageFont.truetype(str(path), size)
    raise ValueError("فونت سرور پیدا نشد. fonts-noto-core و fonts-dejavu-core را نصب کنید.")

def render_text_layer(layer, destination):
    text = layer["text"].strip()
    if not text or len(text) > 240 or len(text.splitlines()) > 5 or any(
        ord(c) < 32 and c != "\n" for c in text
    ):
        raise ValueError("متن باید حداکثر ۲۴۰ کاراکتر و ۵ خط باشد.")
    color = layer.get("color", "#ffffff")
    background = layer.get("background", "transparent")
    if not COLOR.fullmatch(color) or (background != "transparent" and not COLOR.fullmatch(background)):
        raise ValueError("رنگ متن یا پس‌زمینه معتبر نیست.")
    bounds = layer_bounds(layer)
    width, height = bounds.width, bounds.height
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if background != "transparent":
        draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=10, fill=background + "c8")
    rtl = bool(RTL.search(text))
    mixed = rtl and bool(re.search(r"[a-zA-Z]", text))
    direction = "rtl" if rtl else "ltr"
    align = layer.get("align", "right" if rtl else "center")
    if align not in ("left", "center", "right"):
        raise ValueError("تراز متن معتبر نیست.")
    size = int(layer.get("font_size", 46))
    if size < 12 or size > 110:
        raise ValueError("اندازه فونت معتبر نیست.")
    raw_lines = text.splitlines()
    for _ in range(25):
        font = _font(rtl, mixed, size)
        padding = max(4, int(size * .16))
        lines = []
        for raw in raw_lines:
            words = raw.split()
            current = ""
            for word in words:
                candidate = (current + " " + word).strip()
                if current and draw.textlength(candidate, font=font, direction=direction) > width - padding * 2:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            lines.append(current)
        line_height = max(12, int(size * 1.5))
        if (len(lines) * line_height <= height - 2 * padding and
            all(draw.textlength(line, font=font, direction=direction) <= width - 2 * padding for line in lines)):
            break
        if size == 12:
            break
        size = max(12, size - 4)
    top = max(0, (height - len(lines) * line_height) // 2)
    for index, line in enumerate(lines):
        measured = draw.textlength(line, font=font, direction=direction)
        x = (width - padding - measured if align == "right" else
             padding if align == "left" else (width - measured) / 2)
        y = top + index * line_height
        if y >= height:
            break
        draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0, 150), direction=direction)
        draw.text((x, y), line, font=font, fill=color, direction=direction,
                  stroke_width=int(layer.get("outline", 2)), stroke_fill="#101925")
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".temp.png")
    image.save(tmp, format="PNG")
    tmp.replace(target)
    return str(target)

def _num(value):
    return format(float(value), ".3f").rstrip("0").rstrip(".") or "0"

def _enable(layer):
    start = _num(layer.get("start_sec", 0))
    duration = float(layer.get("duration_sec", 0))
    repeat = float(layer.get("repeat_sec", 0))
    if duration == 0:
        expr = f"gte(t\\,{start})"
    elif repeat:
        expr = f"gte(t\\,{start})*lt(mod(t-{start}\\,{_num(repeat)})\\,{_num(duration)})"
    else:
        expr = f"gte(t\\,{start})*lt(t\\,{_num(float(start)+duration)})"
    if layer.get("effect") == "blink":
        expr += f"*lt(mod(t-{start}\\,1)\\,0.65)"
    return expr

def effect_filters(layer, input_index, prev, output_index):
    check_timing(layer.get("effect", "none"), layer.get("start_sec", 0),
                 layer.get("duration_sec", 0), layer.get("repeat_sec", 0))
    bounds = layer_bounds(layer)
    width, height = bounds.width, bounds.height
    x, y = bounds.x, bounds.y
    sizing = ffmpeg_sizing(bounds, layer.get("fit", "contain"))
    opacity = _num(layer.get("opacity", 100) / 100)
    effect = layer.get("effect", "none")
    filters = (f"[{input_index}:v]fps=25,{sizing},setsar=1,"
               f"setpts=PTS-STARTPTS,colorchannelmixer=aa={opacity}")
    start = float(layer.get("start_sec", 0))
    if effect == "fade":
        filters += f",fade=t=in:st={_num(start)}:d=0.6:alpha=1"
        duration = float(layer.get("duration_sec", 0))
        if duration > 1:
            filters += f",fade=t=out:st={_num(start+duration-.5)}:d=0.5:alpha=1"
    filters += f"[ol{output_index}]"
    xexpr = str(x)
    if effect in ("slide-left", "slide-right"):
        phase = f"(t-{_num(start)})"
        repeat = float(layer.get("repeat_sec", 0))
        if repeat:
            phase = f"mod(t-{_num(start)}\\,{_num(repeat)})"
        progress = f"min(1\\,max(0\\,{phase}/0.7))"
        sign = "-" if effect == "slide-left" else "+"
        xexpr = f"{x}{sign}{width+25}*(1-{progress})"
    overlay = (f"[{prev}][ol{output_index}]overlay=x='{xexpr}':y={y}:shortest=0:"
               f"eof_action=repeat:format=auto:enable='{_enable(layer)}'[v{output_index}]")
    return [filters, overlay]
