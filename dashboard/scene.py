"""Safe 720p composited scenes for StreamCore.

One FFmpeg encoder creates a single RTMP output. Independent multistream
relays copy that encoded feed; each additional video layer costs CPU to decode.
"""
import json
import os
import re
import subprocess
from pathlib import Path
from text_effects import (MAX_TEXT_LAYERS, COLOR, check_timing,
                          render_text_layer, effect_filters)

CANVAS_W = 1280
CANVAS_H = 720
FPS = 25
MAX_LAYERS = 8
MAX_VIDEO_LAYERS = 3
MAX_IMAGE_LAYERS = 5
SUPPORTED_FITS = ("contain", "cover")

def init_scene_db(connect):
    with connect() as db:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(media)")}
        if "kind" not in columns:
            db.execute("ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'video'")
        db.execute("""CREATE TABLE IF NOT EXISTS scene_layers (
            channel_id TEXT NOT NULL,
            layer_id TEXT NOT NULL,
            media_file TEXT NOT NULL,
            x INTEGER NOT NULL, y INTEGER NOT NULL,
            w INTEGER NOT NULL, h INTEGER NOT NULL,
            fit TEXT NOT NULL DEFAULT 'contain',
            opacity INTEGER NOT NULL DEFAULT 100,
            layer_order INTEGER NOT NULL,
            PRIMARY KEY (channel_id,layer_id)
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS ix_scene_media ON scene_layers(media_file)")
        columns = {r["name"] for r in db.execute("PRAGMA table_info(scene_layers)")}
        for name, default in (("effect", "'none'"), ("start_sec", "0"),
                              ("duration_sec", "0"), ("repeat_sec", "0")):
            if name not in columns:
                db.execute(f"ALTER TABLE scene_layers ADD COLUMN {name} "
                           f"{'TEXT' if name == 'effect' else 'REAL'} NOT NULL DEFAULT {default}")
        db.execute("""CREATE TABLE IF NOT EXISTS scene_text_layers (
            channel_id TEXT NOT NULL, layer_id TEXT NOT NULL, text TEXT NOT NULL,
            x INTEGER NOT NULL, y INTEGER NOT NULL,
            w INTEGER NOT NULL, h INTEGER NOT NULL,
            font_size INTEGER NOT NULL DEFAULT 46,
            color TEXT NOT NULL DEFAULT '#ffffff',
            background TEXT NOT NULL DEFAULT 'transparent',
            align TEXT NOT NULL DEFAULT 'right',
            outline INTEGER NOT NULL DEFAULT 2,
            opacity INTEGER NOT NULL DEFAULT 100,
            effect TEXT NOT NULL DEFAULT 'none',
            start_sec REAL NOT NULL DEFAULT 0,
            duration_sec REAL NOT NULL DEFAULT 0,
            repeat_sec REAL NOT NULL DEFAULT 0,
            layer_order INTEGER NOT NULL,
            PRIMARY KEY(channel_id,layer_id)
        )""")

def scene_for(connect, channel):
    with connect() as db:
        row = db.execute("SELECT id,mode,file,desired FROM channels WHERE id=?", (channel,)).fetchone()
        if row is None:
            raise LookupError("کانال پیدا نشد.")
        layers = [dict(x) for x in db.execute(
            "SELECT layer_id,media_file,x,y,w,h,fit,opacity,effect,start_sec,duration_sec,repeat_sec,layer_order "
            "FROM scene_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
        text_layers = [dict(x) for x in db.execute(
            "SELECT layer_id,text,x,y,w,h,font_size,color,background,align,outline,"
            "opacity,effect,start_sec,duration_sec,repeat_sec,layer_order "
            "FROM scene_text_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
        return {"channel":channel, "mode":row["mode"],
                "base_file":row["file"] if row["mode"]=="scene" else None,
                "layers":layers, "text_layers":text_layers, "desired":bool(row["desired"])}

def validate_scene(connect, base_file, layers):
    if len(layers)>MAX_LAYERS:
        raise ValueError("حداکثر ۸ لایه در هر صحنه مجاز است.")
    if len({l.layer_id for l in layers})!=len(layers):
        raise ValueError("شناسه لایه تکراری است.")
    filenames=([base_file] if base_file else [])+[layer.media_file for layer in layers]
    media={}
    with connect() as db:
        for filename in filenames:
            if not filename or Path(filename).name!=filename:
                raise ValueError("نام فایل در صحنه معتبر نیست.")
            item=db.execute("SELECT file,kind FROM media WHERE file=?", (filename,)).fetchone()
            if item is None:
                raise ValueError("فایل انتخاب‌شده از کتابخانه حذف شده است.")
            media[filename]=item["kind"]
    if base_file and media[base_file]!="video":
        raise ValueError("پس‌زمینه صحنه باید فایل ویدئویی باشد.")
    vcount=icount=0
    for l in layers:
        if l.x+l.w>100 or l.y+l.h>100:
            raise ValueError("لایه از کادر ۱۶:۹ خارج می‌شود؛ موقعیت و اندازه را اصلاح کنید.")
        check_timing(getattr(l, "effect", "none"), getattr(l, "start_sec", 0),
                     getattr(l, "duration_sec", 0), getattr(l, "repeat_sec", 0))
        if l.fit not in SUPPORTED_FITS:
            raise ValueError("حالت تناسب تصویر نامعتبر است.")
        if media[l.media_file]=="video":vcount+=1
        elif media[l.media_file]=="image":icount+=1
        else: raise ValueError("نوع رسانه نامعتبر است.")
    if vcount>MAX_VIDEO_LAYERS or icount>MAX_IMAGE_LAYERS:
        raise ValueError("در هر صحنه حداکثر ۳ لایه ویدئویی و ۵ لایه تصویری مجاز است.")
    return media


def validate_text_layers(items):
    if len(items) > MAX_TEXT_LAYERS:
        raise ValueError("در هر صحنه حداکثر ۵ لایه متنی مجاز است.")
    if len({item.layer_id for item in items}) != len(items):
        raise ValueError("شناسه لایه متن تکراری است.")
    for item in items:
        if item.x + item.w > 100 or item.y + item.h > 100:
            raise ValueError("محدوده متن از کادر ۱۶:۹ خارج می‌شود.")
        if not item.text.strip() or len(item.text) > 240 or len(item.text.splitlines()) > 5:
            raise ValueError("متن باید ۱ تا ۲۴۰ کاراکتر و حداکثر ۵ خط باشد.")
        if any(ord(ch) < 32 and ch != "\n" for ch in item.text):
            raise ValueError("کاراکتر کنترلی در متن مجاز نیست.")
        if not COLOR.fullmatch(item.color):
            raise ValueError("رنگ متن نامعتبر است.")
        if item.background != "transparent" and not COLOR.fullmatch(item.background):
            raise ValueError("رنگ پس‌زمینه نامعتبر است.")
        if item.align not in ("left", "center", "right"):
            raise ValueError("تراز متن نامعتبر است.")
        check_timing(item.effect, item.start_sec, item.duration_sec, item.repeat_sec)


def save_scene(connect, channel, base_file, layers, text_layers=None):
    media=validate_scene(connect,base_file,layers)
    if text_layers is not None:
        validate_text_layers(text_layers)
    with connect() as db:
        row=db.execute("SELECT id FROM channels WHERE id=?", (channel,)).fetchone()
        if not row: raise LookupError("کانال پیدا نشد.")
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))
        db.executemany(
            "INSERT INTO scene_layers(channel_id,layer_id,media_file,x,y,w,h,fit,opacity,"
            "effect,start_sec,duration_sec,repeat_sec,layer_order)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(channel,l.layer_id,l.media_file,l.x,l.y,l.w,l.h,l.fit,l.opacity,
              getattr(l,"effect","none"),getattr(l,"start_sec",0),
              getattr(l,"duration_sec",0),getattr(l,"repeat_sec",0),i)
             for i,l in enumerate(layers)]
        )
        if text_layers is not None:
            db.execute("DELETE FROM scene_text_layers WHERE channel_id=?", (channel,))
            db.executemany(
                "INSERT INTO scene_text_layers(channel_id,layer_id,text,x,y,w,h,font_size,"
                "color,background,align,outline,opacity,effect,start_sec,duration_sec,repeat_sec,layer_order)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [(channel,t.layer_id,t.text,t.x,t.y,t.w,t.h,t.font_size,t.color,
                  t.background,t.align,t.outline,t.opacity,t.effect,t.start_sec,
                  t.duration_sec,t.repeat_sec,i) for i,t in enumerate(text_layers)]
            )
        db.execute("UPDATE channels SET mode='scene',file=? WHERE id=?", (base_file,channel))
    return media

def is_scene_media_used(connect, filename):
    with connect() as db:
        return bool(db.execute("SELECT 1 FROM scene_layers WHERE media_file=? LIMIT 1",(filename,)).fetchone())

def remove_scene(connect, channel):
    with connect() as db:
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))
        db.execute("DELETE FROM scene_text_layers WHERE channel_id=?", (channel,))

def _media_file(media_root, filename):
    if not filename or Path(filename).name != filename:
        raise ValueError("نام فایل رسانه معتبر نیست.")
    root=Path(media_root).resolve()
    path=(root/filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("فایل صحنه روی سرور وجود ندارد.")
    return str(path)

def _audio_present(path):
    try:
        p=subprocess.run(["ffprobe","-v","error","-select_streams","a:0",
              "-show_entries","stream=codec_type","-of","default=nw=1",path],
              capture_output=True, text=True, check=True, timeout=12)
    except (OSError,subprocess.SubprocessError):
        return False
    return "codec_type=audio" in p.stdout

def _even(value):
    return max(2,int(value)//2*2)

def scene_command(connect, channel, base_file, media_root, target, text_cache=None):
    """Build ONE FFmpeg pipeline for all media/text overlays."""
    with connect() as db:
        media = [dict(r) for r in db.execute(
            "SELECT sl.layer_id,sl.media_file,sl.x,sl.y,sl.w,sl.h,sl.fit,sl.opacity,"
            "sl.effect,sl.start_sec,sl.duration_sec,sl.repeat_sec,"
            "sl.layer_order,m.kind FROM scene_layers sl "
            "JOIN media m ON m.file=sl.media_file WHERE sl.channel_id=? "
            "ORDER BY sl.layer_order", (channel,)
        )]
        text_layers = [dict(r) for r in db.execute(
            "SELECT layer_id,text,x,y,w,h,font_size,color,background,align,outline,"
            "opacity,effect,start_sec,duration_sec,repeat_sec,layer_order "
            "FROM scene_text_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
    if len(media) > MAX_LAYERS or len(text_layers) > MAX_TEXT_LAYERS:
        raise ValueError("تعداد لایه‌های صحنه بیش از حد مجاز است.")
    if base_file:
        base_path = _media_file(media_root, base_file)
        args = ["-re", "-stream_loop", "-1", "-i", base_path]
        base_has_audio = _audio_present(base_path)
    else:
        args = ["-re", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25"]
        base_has_audio = False
    graph = ["[0:v]fps=25,scale=1280:720:force_original_aspect_ratio=decrease,"
             "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,"
             "setsar=1,setpts=PTS-STARTPTS,format=rgba[v0]"]
    previous = "v0"
    overlay_index = 0
    for layer in media:
        filename = _media_file(media_root, layer["media_file"])
        if layer["kind"] == "image":
            args += ["-re", "-loop", "1", "-framerate", str(FPS), "-i", filename]
        elif layer["kind"] == "video":
            args += ["-re", "-stream_loop", "-1", "-i", filename]
        else:
            raise ValueError("نوع رسانه صحنه نامعتبر است.")
        overlay_index += 1
        graph.extend(effect_filters(layer, overlay_index, previous, overlay_index))
        previous = f"v{overlay_index}"
    cache = Path(text_cache) if text_cache else Path(media_root).parent / "rendered_text"
    for layer in text_layers:
        # Only paths built from validated server-generated identifiers reach FFmpeg.
        if not re.fullmatch(r"[a-z][a-z0-9_-]{2,39}", channel) or not re.fullmatch(
            r"[a-z][a-z0-9_-]{2,35}", layer["layer_id"]
        ):
            raise ValueError("شناسه لایه متنی معتبر نیست.")
        check_timing(layer["effect"],layer["start_sec"],layer["duration_sec"],layer["repeat_sec"])
        image = render_text_layer(layer,cache / f"{channel}_{layer['layer_id']}.png")
        args += ["-re", "-loop", "1", "-framerate", str(FPS), "-i", image]
        overlay_index += 1
        # PNG was rendered at the final dimensions; keep its aspect ratio.
        layer["fit"] = "contain"
        graph.extend(effect_filters(layer, overlay_index, previous, overlay_index))
        previous = f"v{overlay_index}"
    graph.append(f"[{previous}]format=yuv420p[vout]")
    # The base clip supplies audio if possible. Extra videos/images are muted.
    silence_input_index = overlay_index + 1
    args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    audio_source = "0:a:0" if base_has_audio else f"{silence_input_index}:a:0"
    return (["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning"] + args +
            ["-filter_complex", ";".join(graph), "-map", "[vout]", "-map", audio_source,
             "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
             "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", "50",
             "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
             "-c:a", "aac", "-ar", "48000", "-b:a", "128k", "-f", "flv", target])
