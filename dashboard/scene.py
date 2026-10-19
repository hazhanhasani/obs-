"""Safe configurable-aspect composited scenes for StreamCore.

One FFmpeg encoder creates a single RTMP output. Independent multistream
relays copy that encoded feed; each additional video layer costs CPU to decode.
"""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from scene_geometry import canvas_size, CANVAS_PRESETS, layer_bounds
from text_effects import (MAX_TEXT_LAYERS, COLOR, check_timing,
                          render_text_layer, effect_filters)

CANVAS_W = 1280
CANVAS_H = 720
FPS = 25
MAX_LAYERS = 8
MAX_VIDEO_LAYERS = 3
MAX_IMAGE_LAYERS = 5
SUPPORTED_FITS = ("contain", "cover", "stretch")

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
        db.execute("""CREATE TABLE IF NOT EXISTS scene_settings (
            channel_id TEXT PRIMARY KEY,
            canvas_preset TEXT NOT NULL DEFAULT 'landscape'
        )""")
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

        # Additive migration: legacy scenes retain their geometry and their
        # original media-then-text order until the operator reorders sources.
        for table in ("scene_layers", "scene_text_layers"):
            columns = {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}
            for name, declaration in (("locked", "INTEGER NOT NULL DEFAULT 0"),
                                      ("visible", "INTEGER NOT NULL DEFAULT 1"),
                                      ("z_index", "INTEGER")):
                if name not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")

def _source_metadata(item):
    return {**item, "locked": bool(item.get("locked", False)),
            "visible": bool(item.get("visible", True))}

def _validate_stack_ids(layers, texts):
    ids = [l.layer_id for l in [*layers, *(texts or [])] if hasattr(l, "layer_id")]
    if len(set(ids)) != len(ids):
        raise ValueError("شناسه لایه تکراری است.")

def scene_for(connect, channel):
    with connect() as db:
        row = db.execute("SELECT id,mode,file,desired FROM channels WHERE id=?", (channel,)).fetchone()
        if row is None:
            raise LookupError("کانال پیدا نشد.")
        layers = [_source_metadata(dict(x)) for x in db.execute(
            "SELECT layer_id,media_file,x,y,w,h,fit,opacity,effect,start_sec,duration_sec,repeat_sec,layer_order,locked,visible,z_index "
            "FROM scene_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
        text_layers = [_source_metadata(dict(x)) for x in db.execute(
            "SELECT layer_id,text,x,y,w,h,font_size,color,background,align,outline,"
            "opacity,effect,start_sec,duration_sec,repeat_sec,layer_order,locked,visible,z_index "
            "FROM scene_text_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
        preset_row = db.execute(
            "SELECT canvas_preset FROM scene_settings WHERE channel_id=?", (channel,)
        ).fetchone()
        preset = preset_row["canvas_preset"] if preset_row else "landscape"
        width, height = canvas_size(preset)
        return {"channel":channel, "mode":row["mode"],
                "canvas_preset":preset, "canvas_width":width, "canvas_height":height,
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
        # Deliberately allow negative/off-frame coordinates for staging media.
        layer_bounds(l.model_dump() if hasattr(l, "model_dump") else vars(l))
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
        layer_bounds(item.model_dump() if hasattr(item, "model_dump") else vars(item))
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


def save_scene(connect, channel, base_file, layers, text_layers=None, canvas_preset=None):
    media=validate_scene(connect,base_file,layers)
    _validate_stack_ids(layers, text_layers)
    if canvas_preset is not None:
        canvas_size(canvas_preset)
    if text_layers is not None:
        validate_text_layers(text_layers)
    with connect() as db:
        row=db.execute("SELECT id FROM channels WHERE id=?", (channel,)).fetchone()
        if not row: raise LookupError("کانال پیدا نشد.")
        if text_layers is None:
            existing_ids = {r["layer_id"] for r in db.execute(
                "SELECT layer_id FROM scene_text_layers WHERE channel_id=?", (channel,))}
            if existing_ids.intersection(l.layer_id for l in layers):
                raise ValueError("شناسه لایه تکراری است.")
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))
        db.executemany(
            "INSERT INTO scene_layers(channel_id,layer_id,media_file,x,y,w,h,fit,opacity,"
            "effect,start_sec,duration_sec,repeat_sec,layer_order,locked,visible,z_index)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(channel,l.layer_id,l.media_file,l.x,l.y,l.w,l.h,l.fit,l.opacity,
              getattr(l,"effect","none"),getattr(l,"start_sec",0),
              getattr(l,"duration_sec",0),getattr(l,"repeat_sec",0),i,
              bool(getattr(l,"locked",False)),bool(getattr(l,"visible",True)),getattr(l,"z_index",None))
             for i,l in enumerate(layers)]
        )
        if text_layers is not None:
            db.execute("DELETE FROM scene_text_layers WHERE channel_id=?", (channel,))
            db.executemany(
                "INSERT INTO scene_text_layers(channel_id,layer_id,text,x,y,w,h,font_size,"
                "color,background,align,outline,opacity,effect,start_sec,duration_sec,repeat_sec,layer_order,locked,visible,z_index)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [(channel,t.layer_id,t.text,t.x,t.y,t.w,t.h,t.font_size,t.color,
                  t.background,t.align,t.outline,t.opacity,t.effect,t.start_sec,
                  t.duration_sec,t.repeat_sec,i,bool(getattr(t,"locked",False)),
                  bool(getattr(t,"visible",True)),getattr(t,"z_index",None)) for i,t in enumerate(text_layers)]
            )
        if canvas_preset is not None:
            db.execute("""INSERT INTO scene_settings(channel_id,canvas_preset)
                          VALUES(?,?)
                          ON CONFLICT(channel_id) DO UPDATE SET canvas_preset=excluded.canvas_preset""",
                       (channel, canvas_preset))
        db.execute("UPDATE channels SET mode='scene',file=? WHERE id=?", (base_file,channel))
    return media

def is_scene_media_used(connect, filename):
    with connect() as db:
        return bool(db.execute("SELECT 1 FROM scene_layers WHERE media_file=? LIMIT 1",(filename,)).fetchone())

def remove_scene(connect, channel):
    with connect() as db:
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))
        db.execute("DELETE FROM scene_text_layers WHERE channel_id=?", (channel,))
        db.execute("DELETE FROM scene_settings WHERE channel_id=?", (channel,))

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

def scene_encoder_profile():
    """Bound encoder CPU demand on shared VPS plans.

    Invalid values are rejected, not silently passed through to FFmpeg.
    Only a small preset allowlist is accepted to avoid arbitrary arguments.
    """
    preset = os.getenv("SCENE_ENCODER_PRESET", "ultrafast").lower().strip()
    if preset not in {"ultrafast", "superfast", "veryfast"}:
        raise ValueError("SCENE_ENCODER_PRESET must be ultrafast, superfast or veryfast.")
    try:
        threads = int(os.getenv("SCENE_ENCODER_THREADS", "2"))
        bitrate = int(os.getenv("SCENE_VIDEO_BITRATE_KBPS", "2500"))
    except ValueError as error:
        raise ValueError("Scene encoding settings must be integers.") from error
    if not 1 <= threads <= 4:
        raise ValueError("SCENE_ENCODER_THREADS must be between 1 and 4.")
    if not 800 <= bitrate <= 6000:
        raise ValueError("SCENE_VIDEO_BITRATE_KBPS must be between 800 and 6000.")
    return preset, threads, bitrate


def preflight_scene(media_root, base_file, layers, text_layers, canvas_preset="landscape"):
    """Catch missing files, unsupported fonts and invalid filter expressions BEFORE
    persisting the new layout or interrupting an active channel.
    """
    _validate_stack_ids(layers, text_layers)
    scene_encoder_profile()
    width, height = canvas_size(canvas_preset)
    if base_file:
        _media_file(media_root, base_file)
    for i, layer in enumerate(layers):
        _media_file(media_root, layer.media_file)
        item = layer.model_dump() if hasattr(layer, "model_dump") else vars(layer)
        effect_filters(item, i + 1, "v0", i + 1, width, height)
    if text_layers:
        with tempfile.TemporaryDirectory(prefix="streamcore-scene-check-") as directory:
            for i, layer in enumerate(text_layers):
                item = layer.model_dump() if hasattr(layer, "model_dump") else vars(layer)
                render_text_layer(item, Path(directory) / f"text_{i}.png", width, height)
                effect_filters({**item, "fit": "contain"}, i + 1, "v0", i + 1, width, height)


def scene_command(connect, channel, base_file, media_root, target, text_cache=None, scene_override=None):
    """Use identical FFmpeg filtergraph for live streams and unpublished draft previews.

    scene_override contains already-validated media and text dictionaries. Passing
    it never writes to the persistent channels or scene_layers SQLite tables.
    """
    if scene_override is None:
        with connect() as db:
            media = [dict(r) for r in db.execute(
                "SELECT sl.layer_id,sl.media_file,sl.x,sl.y,sl.w,sl.h,sl.fit,sl.opacity,"
                "sl.effect,sl.start_sec,sl.duration_sec,sl.repeat_sec,"
                "sl.layer_order,sl.locked,sl.visible,sl.z_index,m.kind FROM scene_layers sl "
                "JOIN media m ON m.file=sl.media_file WHERE sl.channel_id=? "
                "ORDER BY sl.layer_order", (channel,)
            )]
            text_layers = [dict(r) for r in db.execute(
                "SELECT layer_id,text,x,y,w,h,font_size,color,background,align,outline,"
                "opacity,effect,start_sec,duration_sec,repeat_sec,layer_order,locked,visible,z_index "
                "FROM scene_text_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
            )]
    else:
        # Never mutate the user's draft while building the FFmpeg filter graph.
        media = [dict(item) for item in scene_override["media"]]
        text_layers = [dict(item) for item in scene_override["text_layers"]]
    if len(media) > MAX_LAYERS or len(text_layers) > MAX_TEXT_LAYERS:
        raise ValueError("تعداد لایه‌های صحنه بیش از حد مجاز است.")
    if scene_override is None:
        preset = scene_for(connect, channel)["canvas_preset"]
    else:
        preset = scene_override.get("canvas_preset") or scene_for(connect, channel)["canvas_preset"]
    width, height = canvas_size(preset)
    if base_file:
        base_path = _media_file(media_root, base_file)
        args = ["-re", "-stream_loop", "-1", "-i", base_path]
        base_has_audio = _audio_present(base_path)
    else:
        args = ["-re", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate=25"]
        base_has_audio = False
    graph = [f"[0:v]fps=25,scale={width}:{height}:force_original_aspect_ratio=decrease,"
             f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
             "setsar=1,setpts=PTS-STARTPTS,format=rgba[v0]"]
    previous = "v0"
    overlay_index = 0
    cache = Path(text_cache) if text_cache else Path(media_root).parent / "rendered_text"
    combined = media + text_layers
    # Python's stable sort matches the editor for legacy/null and tied indexes.
    ordered = sorted(enumerate(combined), key=lambda entry:
                     entry[1].get("z_index") if entry[1].get("z_index") is not None else entry[0])
    for _, layer in ordered:
        if not layer.get("visible", True):
            continue
        if "text" in layer:
            if not re.fullmatch(r"[a-z][a-z0-9_-]{2,39}", channel) or not re.fullmatch(
                r"[a-z][a-z0-9_-]{2,35}", layer["layer_id"]
            ):
                raise ValueError("شناسه لایه متنی معتبر نیست.")
            check_timing(layer["effect"],layer["start_sec"],layer["duration_sec"],layer["repeat_sec"])
            image = render_text_layer(layer,cache / f"{channel}_{layer['layer_id']}.png", width, height)
            args += ["-re", "-loop", "1", "-framerate", str(FPS), "-i", image]
            layer["fit"] = "contain"
        else:
            filename = _media_file(media_root, layer["media_file"])
            if layer["kind"] == "image":
                args += ["-re", "-loop", "1", "-framerate", str(FPS), "-i", filename]
            elif layer["kind"] == "video":
                args += ["-re", "-stream_loop", "-1", "-i", filename]
            else:
                raise ValueError("نوع رسانه صحنه نامعتبر است.")
        overlay_index += 1
        graph.extend(effect_filters(layer, overlay_index, previous, overlay_index, width, height))
        previous = f"v{overlay_index}"
    graph.append(f"[{previous}]format=yuv420p[vout]")
    preset, threads, bitrate = scene_encoder_profile()
    # The base clip supplies audio if possible. Extra videos/images are muted.
    silence_input_index = overlay_index + 1
    args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    audio_source = "0:a:0" if base_has_audio else f"{silence_input_index}:a:0"
    return (["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
             "-filter_complex_threads", str(threads)] + args +
            ["-filter_complex", ";".join(graph), "-map", "[vout]", "-map", audio_source,
             "-c:v", "libx264", "-threads", str(threads), "-preset", preset,
             "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-g", "50", "-b:v", f"{bitrate}k", "-maxrate", f"{bitrate}k",
             "-bufsize", f"{bitrate * 2}k",
             "-c:a", "aac", "-ar", "48000", "-b:a", "128k", "-f", "flv", target])



def scene_snapshot_command(command):
    """Create a single JPEG frame from the SAME scene graph used for live RTMP.

    No external RTMP connection, no audio muxing, and no persisted changes.
    Layer timing is evaluated at the beginning of the scene (t≈0).
    """
    marker = command.index("-map")
    return command[:marker] + [
        "-map", "[vout]", "-frames:v", "1", "-q:v", "3",
        "-f", "image2pipe", "pipe:1"
    ]
