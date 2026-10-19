"""Safe 720p composited scenes for StreamCore.

One FFmpeg encoder creates a single RTMP output. Independent multistream
relays copy that encoded feed; each additional video layer costs CPU to decode.
"""
import json
import os
import re
import subprocess
from pathlib import Path

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

def scene_for(connect, channel):
    with connect() as db:
        row = db.execute("SELECT id,mode,file,desired FROM channels WHERE id=?", (channel,)).fetchone()
        if row is None:
            raise LookupError("کانال پیدا نشد.")
        layers = [dict(x) for x in db.execute(
            "SELECT layer_id,media_file,x,y,w,h,fit,opacity,layer_order "
            "FROM scene_layers WHERE channel_id=? ORDER BY layer_order", (channel,)
        )]
        return {"channel":channel, "mode":row["mode"],"base_file":row["file"] if row["mode"]=="scene" else None,
                "layers":layers, "desired":bool(row["desired"])}

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
        if l.fit not in SUPPORTED_FITS:
            raise ValueError("حالت تناسب تصویر نامعتبر است.")
        if media[l.media_file]=="video":vcount+=1
        elif media[l.media_file]=="image":icount+=1
        else: raise ValueError("نوع رسانه نامعتبر است.")
    if vcount>MAX_VIDEO_LAYERS or icount>MAX_IMAGE_LAYERS:
        raise ValueError("در هر صحنه حداکثر ۳ لایه ویدئویی و ۵ لایه تصویری مجاز است.")
    return media

def save_scene(connect, channel, base_file, layers):
    media=validate_scene(connect,base_file,layers)
    with connect() as db:
        row=db.execute("SELECT id FROM channels WHERE id=?", (channel,)).fetchone()
        if not row: raise LookupError("کانال پیدا نشد.")
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))
        db.executemany(
            "INSERT INTO scene_layers(channel_id,layer_id,media_file,x,y,w,h,fit,opacity,layer_order)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            [(channel,l.layer_id,l.media_file,l.x,l.y,l.w,l.h,l.fit,l.opacity,i)
             for i,l in enumerate(layers)]
        )
        db.execute("UPDATE channels SET mode='scene',file=? WHERE id=?", (base_file,channel))
    return media

def is_scene_media_used(connect, filename):
    with connect() as db:
        return bool(db.execute("SELECT 1 FROM scene_layers WHERE media_file=? LIMIT 1",(filename,)).fetchone())

def remove_scene(connect, channel):
    with connect() as db:
        db.execute("DELETE FROM scene_layers WHERE channel_id=?", (channel,))

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

def scene_command(connect, channel, base_file, media_root, target):
    with connect() as db:
        records=[dict(r) for r in db.execute(
            "SELECT sl.layer_id,sl.media_file,sl.x,sl.y,sl.w,sl.h,sl.fit,sl.opacity,"
            "sl.layer_order,m.kind FROM scene_layers sl JOIN media m ON m.file=sl.media_file "
            "WHERE sl.channel_id=? ORDER BY sl.layer_order",(channel,)
        )]
    if len(records)>MAX_LAYERS:
        raise ValueError("تعداد لایه‌ها بیشتر از حد مجاز است.")
    if base_file:
        base_path=_media_file(media_root,base_file)
        args=["-re","-stream_loop","-1","-i",base_path]
        base_has_audio=_audio_present(base_path)
    else:
        args=["-re","-f","lavfi","-i","testsrc2=size=1280x720:rate=25"]
        base_has_audio=False
    graph=["[0:v]fps=25,scale=1280:720:force_original_aspect_ratio=decrease,"
           "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,"
           "setsar=1,setpts=PTS-STARTPTS,format=rgba[v0]"]
    prev="v0"
    for idx,layer in enumerate(records, start=1):
        path=_media_file(media_root,layer["media_file"])
        if layer["kind"]=="image":
            args+=["-loop","1","-framerate",str(FPS),"-i",path]
        elif layer["kind"]=="video":
            args+=["-re","-stream_loop","-1","-i",path]
        else:
            raise ValueError("نوع لایه معتبر نیست.")
        w=_even(CANVAS_W*layer["w"]/100)
        h=_even(CANVAS_H*layer["h"]/100)
        x=int(CANVAS_W*layer["x"]/100)
        y=int(CANVAS_H*layer["y"]/100)
        if layer["fit"]=="contain":
            resize=(f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                    f"format=rgba,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black@0")
        elif layer["fit"]=="cover":
            resize=(f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                    f"crop={w}:{h},format=rgba")
        else:
            raise ValueError("حالت تناسب نامعتبر است.")
        graph.append(f"[{idx}:v]fps={FPS},{resize},setsar=1,"
                     f"setpts=PTS-STARTPTS,colorchannelmixer=aa={layer['opacity']/100:.2f}[ol{idx}]")
        graph.append(f"[{prev}][ol{idx}]overlay={x}:{y}:shortest=0:"
                     f"eof_action=repeat:format=auto[v{idx}]")
        prev=f"v{idx}"
    graph.append(f"[{prev}]format=yuv420p[vout]")
    # Always offer AAC even when the base clip has no audio.
    audio_idx=len(records)+1
    args+=["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]
    audio_map="0:a:0" if base_has_audio else f"{audio_idx}:a:0"
    return (["ffmpeg","-nostdin","-hide_banner","-loglevel","warning"]
        +args+["-filter_complex",";".join(graph),"-map","[vout]", "-map",audio_map,
               "-c:v","libx264","-preset","veryfast","-tune","zerolatency",
               "-pix_fmt","yuv420p","-r",str(FPS),"-g","50",
               "-b:v","2500k","-maxrate","2500k","-bufsize","5000k",
               "-c:a","aac","-ar","48000","-b:a","128k","-f","flv",target])
