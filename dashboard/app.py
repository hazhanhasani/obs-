"""StreamCore: single-process control plane. Only media on the mounted VPS filesystem is accepted."""
import asyncio
import hmac
import json
import os
import re
import secrets
import signal
import sqlite3
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.request import urlopen

import psutil
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from destinations import DestinationSupervisor, init_table
from telemetry import ProgressTracker
from scene import init_scene_db, scene_for, save_scene, remove_scene, is_scene_media_used, scene_command, preflight_scene, validate_scene, validate_text_layers, scene_snapshot_command
from scene_geometry import canvas_size, CANVAS_PRESETS
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
MEDIA = Path(os.getenv("MEDIA_DIR", "/media")).resolve()
DATA = Path(os.getenv("DATA_DIR", "/data")).resolve()
USERNAME = os.getenv("ADMIN_USERNAME", "admin")
PASSWORD = os.getenv("ADMIN_PASSWORD", "")
SECRET = os.getenv("SESSION_SECRET", "")
MAX_MB = max(1, int(os.getenv("MAX_UPLOAD_MB", "1024")))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"
SLUG = re.compile(r"^[a-z][a-z0-9_-]{2,39}$")
VIDEO_EXT = {".mp4", ".mkv", ".mov"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
VALID_EXT = VIDEO_EXT | IMAGE_EXT
MAX_IMAGE_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 20_000_000

if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{2,31}", USERNAME):
    raise RuntimeError("ADMIN_USERNAME must be 3-32 ASCII letters, numbers, underscores or hyphens")
if len(PASSWORD) < 12 or PASSWORD in {"change-this-password", "replace-me", "CHANGE_ME"}:
    raise RuntimeError("Set a unique ADMIN_PASSWORD of at least 12 characters in .env")
if len(SECRET) < 32 or SECRET.startswith("replace") or SECRET.startswith("CHANGE"):
    raise RuntimeError("Set a random SESSION_SECRET (openssl rand -hex 32) in .env")

MEDIA.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)
DB_FILE = DATA / "streamcore.sqlite3"

def connect():
    db = sqlite3.connect(DB_FILE, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=15000")
    return db

def init_db():
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'test',
            file TEXT, desired INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file TEXT UNIQUE NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL,
            duration REAL NOT NULL DEFAULT 0, created INTEGER NOT NULL
        )""")
        db.execute("INSERT OR IGNORE INTO channels(id,name,created) VALUES('main','کانال اصلی',?)", (int(time.time()),))

class ChannelNew(BaseModel):
    id: str = Field(min_length=3, max_length=40)
    name: str = Field(min_length=2, max_length=60)

class ChannelConfig(BaseModel):
    mode: str
    file: str | None = None

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str

def validate_media(path: Path):
    try:
        raw = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "stream=codec_type,codec_name:format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30, check=True
        )
        parsed = json.loads(raw.stdout)
    except (subprocess.SubprocessError, ValueError) as error:
        raise ValueError("فایل ویدئویی معتبر نیست یا قابل خواندن نیست.") from error
    if not any(s.get("codec_type") == "video" and s.get("codec_name") == "h264"
               for s in parsed.get("streams", [])):
        raise ValueError("فرمت ویدئو باید H.264 باشد؛ ابتدا فایل را تبدیل کنید.")
    return float(parsed.get("format", {}).get("duration") or 0)

def inspect_media(path: Path):
    if path.suffix.lower() in IMAGE_EXT:
        if path.stat().st_size > MAX_IMAGE_BYTES:
            raise ValueError("حداکثر حجم تصویر ۱۲ مگابایت است.")
        formats = {".png": {"PNG"}, ".jpg": {"JPEG"}, ".jpeg": {"JPEG"}, ".webp": {"WEBP"}}
        try:
            with Image.open(path) as img:
                if img.format not in formats[path.suffix.lower()]:
                    raise ValueError("محتوای تصویر با پسوند فایل مطابقت ندارد.")
                if (img.width < 16 or img.height < 16 or img.width > 8192
                    or img.height > 8192 or img.width * img.height > 20_000_000):
                    raise ValueError("ابعاد تصویر باید حداقل ۱۶ پیکسل و حداکثر ۲۰ مگاپیکسل باشد.")
                if getattr(img, "n_frames", 1) != 1:
                    raise ValueError("تصاویر متحرک پشتیبانی نمی‌شوند.")
                img.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ValueError("فایل تصویر معتبر نیست.") from error
        return "image", 0.0
    return "video", validate_media(path)


class Controller:
    def __init__(self):
        self.lock = threading.RLock()
        self.processes = {}
        self.next_retry = {}
        self.errors = {}
        self.tracker = ProgressTracker()
        self.resource_processes = {}
        self.stop_event = threading.Event()
        self.thread = None

    def command(self, row):
        target = "rtmp://mediamtx:1935/" + row["id"]
        base = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y"]
        if row["mode"] == "scene":
            return scene_command(connect, row["id"], row["file"], MEDIA, target, DATA / "scene_text")
        if row["mode"] == "test":
            return base + [
                "-re", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                "-pix_fmt", "yuv420p", "-g", "50", "-b:v", "1500k",
                "-maxrate", "1500k", "-bufsize", "3000k", "-c:a", "aac",
                "-b:a", "96k", "-f", "flv", target
            ]
        filename = row["file"]
        if not filename or Path(filename).name != filename:
            raise ValueError("فایل انتخاب‌شده معتبر نیست.")
        path = (MEDIA / filename).resolve()
        if not path.is_relative_to(MEDIA) or not path.is_file():
            raise ValueError("فایل انتخاب‌شده روی سرور وجود ندارد.")
        return base + [
            "-re", "-stream_loop", "-1", "-i", str(path),
            "-map", "0:v:0", "-map", "0:a?", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k", "-f", "flv", target
        ]

    def stop(self, channel):
        with self.lock:
            process = self.processes.pop(channel, None)
            self.tracker.detach(channel, process.pid if process else None)
            self.resource_processes.pop(channel, None)
            if process is not None and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=4)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=3)

    def reconcile(self):
        with self.lock:
            with connect() as db:
                rows = [dict(x) for x in db.execute("SELECT * FROM channels")]
            enabled = {row["id"]: row for row in rows if row["desired"]}
            for channel in list(self.processes):
                if channel not in enabled:
                    self.stop(channel)
                elif self.processes[channel].poll() is not None:
                    finished = self.processes.pop(channel)
                    self.tracker.detach(channel, finished.pid)
                    self.resource_processes.pop(channel, None)
            for channel, row in enabled.items():
                if channel in self.processes or time.monotonic() < self.next_retry.get(channel, 0):
                    continue
                try:
                    cmd = self.command(row)
                    # FFmpeg -progress emits bounded machine-readable records.
                    # A reader thread drains stdout; stderr remains in FFmpeg logs.
                    cmd = [cmd[0], "-nostats", "-stats_period", "5",
                           "-progress", "pipe:1", *cmd[1:]]
                    log_path = DATA / ("ffmpeg-" + channel + ".log")
                    with log_path.open("ab") as log:
                        proc = subprocess.Popen(
                            cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=log, start_new_session=True, close_fds=True
                        )
                    self.processes[channel] = proc
                    self.tracker.attach(channel, proc)
                    try:
                        resource = psutil.Process(proc.pid)
                        resource.cpu_percent(interval=None)  # Prime nonblocking CPU sampling.
                        self.resource_processes[channel] = resource
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        self.resource_processes.pop(channel, None)
                    self.errors.pop(channel, None)
                except (ValueError, OSError) as error:
                    self.errors[channel] = str(error)
                self.next_retry[channel] = time.monotonic() + 8

    def state(self, channel):
        with self.lock:
            process = self.processes.get(channel)
            running = process is not None and process.poll() is None
            encoder = self.tracker.snapshot(
                channel, process.pid if process else None, running
            )
            encoder["cpu_percent"] = None
            encoder["memory_mb"] = None
            if running:
                resource = self.resource_processes.get(channel)
                if resource is not None and resource.pid == process.pid:
                    try:
                        encoder["cpu_percent"] = round(resource.cpu_percent(interval=None), 1)
                        encoder["memory_mb"] = round(resource.memory_info().rss / (1024 * 1024), 1)
                    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                        self.resource_processes.pop(channel, None)
            return {
                "running": running,
                "error": self.errors.get(channel),
                "encoder": encoder,
            }

    def start(self):
        self.thread = threading.Thread(target=self.run, name="stream-supervisor", daemon=True)
        self.thread.start()

    def run(self):
        while not self.stop_event.is_set():
            self.reconcile()
            self.stop_event.wait(3)

    def shutdown(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
        for channel in list(self.processes):
            self.stop(channel)

controller = Controller()
destination_manager = DestinationSupervisor(connect, SECRET, controller.state, DATA)
failed_logins = {}
login_lock = threading.Lock()

@asynccontextmanager
async def lifespan(app):
    init_db()
    init_scene_db(connect)
    init_table(connect)
    controller.start()
    destination_manager.start()
    yield
    destination_manager.shutdown()
    controller.shutdown()

app = FastAPI(title="StreamCore", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(
    SessionMiddleware, secret_key=SECRET, session_cookie="streamcore_session",
    max_age=60*60*8, same_site="strict", https_only=COOKIE_SECURE
)
app.mount("/assets", StaticFiles(directory=ROOT / "static"), name="assets")

@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net data:; "
        "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; "
        "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    return response

def authorize(request: Request, unsafe=False):
    if request.session.get("authenticated") is not True:
        raise HTTPException(status_code=401, detail="ورود به پنل ضروری است.")
    if unsafe and not hmac.compare_digest(
        request.headers.get("x-csrf-token", ""), request.session.get("csrf", "_missing")
    ):
        raise HTTPException(status_code=403, detail="نشست نامعتبر است. صفحه را تازه‌سازی کنید.")

@app.get("/", include_in_schema=False)
def index():
    return FileResponse(ROOT / "static" / "index.html")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/session")
def session(request: Request):
    return {
        "authenticated": request.session.get("authenticated") is True,
        "csrf": request.session.get("csrf") if request.session.get("authenticated") else None
    }

@app.post("/api/login")
def login(request: Request, credentials: Credentials):
    addr = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with login_lock:
        attempts = [t for t in failed_logins.get(addr, []) if now - t < 600]
        failed_logins[addr] = attempts
        if len(attempts) >= 8:
            raise HTTPException(status_code=429, detail="تلاش‌های زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید.")
    if not (hmac.compare_digest(credentials.username, USERNAME) and hmac.compare_digest(credentials.password, PASSWORD)):
        with login_lock:
            failed_logins.setdefault(addr, []).append(now)
        raise HTTPException(status_code=401, detail="رمز عبور اشتباه است.")
    with login_lock:
        failed_logins.pop(addr, None)
    request.session.clear()
    request.session["authenticated"] = True
    request.session["csrf"] = secrets.token_urlsafe(32)
    return {"ok": True, "csrf": request.session["csrf"]}

@app.post("/api/logout")
def logout(request: Request):
    authorize(request, unsafe=True)
    request.session.clear()
    return {"ok": True}

def overview():
    with connect() as db:
        channels = [dict(row) for row in db.execute("SELECT * FROM channels ORDER BY created, id")]
        media = [dict(row) for row in db.execute("SELECT * FROM media ORDER BY created DESC, id DESC")]
    for channel in channels:
        channel.update(controller.state(channel["id"]))
    try:
        mem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=None)
        ram = round(mem.percent, 1)
    except Exception:
        cpu = ram = 0
    return {
        "channels": channels, "media": media,
        "destinations": destination_manager.public_rows(),
        "system": {"cpu": cpu, "ram": ram, "total_ram": round(psutil.virtual_memory().total / 1024**3, 1)},
        "limits": {"max_upload_mb": MAX_MB, "max_image_mb": 12},
        "time": int(time.time())
    }

@app.get("/api/overview")
def get_overview(request: Request):
    authorize(request)
    return overview()

@app.post("/api/channels")
def create_channel(request: Request, body: ChannelNew):
    authorize(request, unsafe=True)
    if not SLUG.fullmatch(body.id):
        raise HTTPException(status_code=422, detail="شناسه کانال باید لاتین و بین ۳ تا ۴۰ کاراکتر باشد.")
    with connect() as db:
        if db.execute("SELECT count(*) FROM channels").fetchone()[0] >= 8:
            raise HTTPException(status_code=409, detail="نسخه اولیه حداکثر ۸ کانال را پشتیبانی می‌کند.")
        try:
            db.execute("INSERT INTO channels(id,name,created) VALUES(?,?,?)",
                       (body.id, body.name, int(time.time())))
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="شناسه کانال تکراری است.")
    return {"ok": True}

@app.post("/api/channels/{channel}/configure")
def configure(request: Request, channel: str, body: ChannelConfig):
    authorize(request, unsafe=True)
    if body.mode not in ("test", "file"):
        raise HTTPException(status_code=422, detail="نوع منبع معتبر نیست.")
    if body.mode == "file":
        with connect() as db:
            media = db.execute("SELECT file FROM media WHERE file=?", (body.file,)).fetchone()
        if not media or not (MEDIA / media["file"]).is_file():
            raise HTTPException(status_code=422, detail="فایل انتخاب‌شده وجود ندارد.")
    with connect() as db:
        row = db.execute("SELECT desired FROM channels WHERE id=?", (channel,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="کانال پیدا نشد.")
        db.execute("UPDATE channels SET mode=?, file=?, desired=0 WHERE id=?",
                   (body.mode, body.file if body.mode == "file" else None, channel))
    controller.stop(channel)
    return {"ok": True}

@app.post("/api/channels/{channel}/{operation}")
def control(request: Request, channel: str, operation: str):
    authorize(request, unsafe=True)
    if operation not in ("start", "stop"):
        raise HTTPException(status_code=404)
    with connect() as db:
        row = db.execute("SELECT * FROM channels WHERE id=?", (channel,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        if operation == "start":
            try:
                controller.command(dict(row))
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error))
        db.execute("UPDATE channels SET desired=? WHERE id=?",
                   (1 if operation == "start" else 0, channel))
    if operation == "stop":
        controller.stop(channel)
    else:
        controller.next_retry.pop(channel, None)
        controller.reconcile()
    return {"ok": True}

@app.delete("/api/channels/{channel}")
def remove_channel(request: Request, channel: str):
    authorize(request, unsafe=True)
    if channel == "main":
        raise HTTPException(status_code=403, detail="کانال اصلی قابل حذف نیست.")
    with connect() as db:
        row = db.execute("SELECT id FROM channels WHERE id=?", (channel,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        db.execute("DELETE FROM channels WHERE id=?", (channel,))
    destination_manager.delete_channel(channel)
    remove_scene(connect, channel)
    controller.stop(channel)
    return {"ok": True}

async def save_media_stream(original: str, chunks):
    """Write directly to persistent /media (without a second multipart temp copy)."""
    original = Path(original or "").name.strip()
    if not original or len(original.encode("utf-8")) > 255:
        raise HTTPException(status_code=422, detail="نام فایل معتبر نیست.")
    suffix = Path(original).suffix.lower()
    if suffix not in VALID_EXT:
        raise HTTPException(status_code=422, detail="فرمت‌های مجاز MP4، MOV، MKV، PNG، JPG و WebP هستند.")

    stored_name = secrets.token_hex(16) + suffix
    destination = MEDIA / stored_name
    total = 0
    limit = MAX_IMAGE_BYTES if suffix in IMAGE_EXT else MAX_MB * 1024 * 1024
    try:
        with destination.open("xb") as out:
            async for chunk in chunks:
                if not chunk:
                    continue
                total += len(chunk)
                if total > limit:
                    raise HTTPException(
                        status_code=413,
                        detail="حجم فایل از محدودیت مجاز برای تصویر یا ویدئو بیشتر است."
                    )
                await asyncio.to_thread(out.write, chunk)
        if not total:
            raise HTTPException(status_code=422, detail="فایل خالی است.")
        kind, duration = await asyncio.to_thread(inspect_media, destination)
        with connect() as db:
            db.execute(
                "INSERT INTO media(file,name,bytes,duration,created,kind) VALUES(?,?,?,?,?,?)",
                (stored_name, original[:180], total, duration, int(time.time()), kind)
            )
    except ValueError as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        destination.unlink(missing_ok=True)
        if error.errno == 28:
            raise HTTPException(status_code=507, detail="فضای ذخیره‌سازی سرور کافی نیست.") from error
        raise HTTPException(status_code=500, detail="خطا هنگام ذخیره فایل روی سرور.") from error
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {"ok": True, "name": original, "bytes": total, "duration": duration, "kind": kind}


@app.post("/api/media/raw")
async def upload_raw(request: Request, filename: str):
    """Streaming binary endpoint for reliable mobile uploads with progress events."""
    authorize(request, unsafe=True)
    declared = request.headers.get("content-length")
    if declared:
        try:
            declared_size = int(declared)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="اندازه درخواست معتبر نیست.") from error
        if declared_size > (MAX_IMAGE_BYTES if Path(filename).suffix.lower() in IMAGE_EXT else MAX_MB * 1024 * 1024):
            raise HTTPException(status_code=413, detail="حجم فایل بیشتر از حد مجاز است.")
    return await save_media_stream(filename, request.stream())


@app.post("/api/media")
async def upload(request: Request, file: UploadFile = File(...)):
    """Backward-compatible multipart endpoint for existing clients."""
    authorize(request, unsafe=True)

    async def chunks():
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            yield chunk

    try:
        return await save_media_stream(file.filename or "", chunks())
    finally:
        await file.close()


@app.delete("/api/media/{media_id}")
def delete_media(request: Request, media_id: int):
    authorize(request, unsafe=True)
    with connect() as db:
        row = db.execute("SELECT file FROM media WHERE id=?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        if db.execute("SELECT count(*) FROM channels WHERE file=?", (row["file"],)).fetchone()[0] or is_scene_media_used(connect, row["file"]):
            raise HTTPException(status_code=409, detail="این فایل به یک کانال متصل است.")
        db.execute("DELETE FROM media WHERE id=?", (media_id,))
    (MEDIA / row["file"]).unlink(missing_ok=True)
    return {"ok": True}


class SceneLayerInput(BaseModel):
    layer_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,35}$")
    media_file: str = Field(min_length=5, max_length=96)
    x: float = Field(ge=-200, le=200, allow_inf_nan=False)
    y: float = Field(ge=-200, le=200, allow_inf_nan=False)
    w: float = Field(ge=5, le=200, allow_inf_nan=False)
    h: float = Field(ge=5, le=200, allow_inf_nan=False)
    fit: str = Field(default="contain", pattern=r"^(contain|cover|stretch)$")
    opacity: int = Field(default=100, ge=10, le=100)
    effect: str = Field(default="none", pattern=r"^(none|fade|slide-left|slide-right|blink)$")
    start_sec: float = Field(default=0, ge=0, le=3600)
    duration_sec: float = Field(default=0, ge=0, le=3600)
    repeat_sec: float = Field(default=0, ge=0, le=3600)


class SceneTextInput(BaseModel):
    layer_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,35}$")
    text: str = Field(min_length=1, max_length=240)
    x: float = Field(ge=-200, le=200, allow_inf_nan=False)
    y: float = Field(ge=-200, le=200, allow_inf_nan=False)
    w: float = Field(ge=5, le=200, allow_inf_nan=False)
    h: float = Field(ge=5, le=200, allow_inf_nan=False)
    font_size: int = Field(default=46, ge=12, le=110)
    color: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    background: str = Field(default="transparent", pattern=r"^(transparent|#[0-9a-fA-F]{6})$")
    align: str = Field(default="right", pattern=r"^(left|center|right)$")
    outline: int = Field(default=2, ge=0, le=5)
    opacity: int = Field(default=100, ge=10, le=100)
    effect: str = Field(default="none", pattern=r"^(none|fade|slide-left|slide-right|blink)$")
    start_sec: float = Field(default=0, ge=0, le=3600)
    duration_sec: float = Field(default=0, ge=0, le=3600)
    repeat_sec: float = Field(default=0, ge=0, le=3600)


class SceneInput(BaseModel):
    base_file: str | None = None
    canvas_preset: str | None = Field(
        default=None, pattern=r"^(landscape|portrait|portrait_fullhd)$"
    )
    layers: list[SceneLayerInput] = Field(default_factory=list, max_length=8)
    text_layers: list[SceneTextInput] | None = Field(default=None, max_length=5)


@app.get("/api/channels/{channel}/scene")
def get_scene(request: Request, channel: str):
    authorize(request)
    try:
        return scene_for(connect, channel)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.put("/api/channels/{channel}/scene")
def update_scene(request: Request, channel: str, body: SceneInput):
    authorize(request, unsafe=True)
    try:
        # Check channel identity before resolving files or rendering expensive fonts.
        saved = scene_for(connect, channel)
        # Validate external files, fonts, timing and FFmpeg filter generation
        # before saving the scene or stopping the currently running publisher.
        preset = body.canvas_preset or saved["canvas_preset"]
        preflight_scene(MEDIA, body.base_file, body.layers, body.text_layers, preset)
        save_scene(connect, channel, body.base_file, body.layers, body.text_layers,
                   body.canvas_preset)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=422, detail="آماده‌سازی صحنه ناموفق بود؛ پخش قبلی حفظ شد.") from error
    # Rebuild the encoder only when the operator explicitly saves the scene.
    # Channel desired-state and destination configurations remain preserved.
    controller.stop(channel)
    controller.next_retry.pop(channel, None)
    controller.reconcile()
    return {"ok": True, "scene": scene_for(connect, channel)}



# Restrict full-resolution snapshots to one FFmpeg process on a shared VPS.
scene_preview_limit = threading.BoundedSemaphore(1)


def render_scene_snapshot(channel: str, body: SceneInput):
    """Create a true FFmpeg preview without touching persistent channel state."""
    with tempfile.TemporaryDirectory(prefix="scene-preview-", dir=DATA) as temp:
        with connect() as db:
            kinds = {row["file"]: row["kind"] for row in db.execute(
                "SELECT file,kind FROM media"
            )}
        media_layers = [
            {**layer.model_dump(), "kind": kinds[layer.media_file]}
            for layer in body.layers
        ]
        saved = scene_for(connect, channel)
        text_layers = (
            [dict(item) for item in saved["text_layers"]]
            if body.text_layers is None
            else [item.model_dump() for item in body.text_layers]
        )
        command = scene_command(
            connect, channel, body.base_file, MEDIA, "unused-preview-output",
            Path(temp) / "rendered_text",
            scene_override={"media": media_layers, "text_layers": text_layers,
                             "canvas_preset": body.canvas_preset or saved["canvas_preset"]}
        )
        snapshot = scene_snapshot_command(command)
        try:
            result = subprocess.run(
                snapshot, stdin=subprocess.DEVNULL, capture_output=True,
                check=False, timeout=25
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise HTTPException(
                status_code=503,
                detail="پیش‌نمایش زمان زیادی گرفت؛ تعداد لایه‌ها را کاهش دهید."
            ) from error
        if result.returncode or result.stdout[:2] != bytes((255, 216)):
            raise HTTPException(
                status_code=422,
                detail="رندر FFmpeg ناموفق بود؛ فرمت یا افکت‌های صحنه را بررسی کنید."
            )
        return result.stdout


@app.post("/api/channels/{channel}/scene/preview")
async def preview_unpublished_scene(request: Request, channel: str, body: SceneInput):
    """Authenticate, preflight and render an unpublished frame; no live restart."""
    authorize(request, unsafe=True)
    try:
        saved = scene_for(connect, channel)
        validate_scene(connect, body.base_file, body.layers)
        texts = body.text_layers
        if texts is None:
            texts = [SceneTextInput(**item) for item in saved["text_layers"]]
        validate_text_layers(texts)
        preflight_scene(MEDIA, body.base_file, body.layers, texts,
                        body.canvas_preset or saved["canvas_preset"])
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if not scene_preview_limit.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="پیش‌نمایش دیگری در حال رندر است.")
    try:
        frame = await asyncio.to_thread(render_scene_snapshot, channel, body)
    finally:
        scene_preview_limit.release()
    return Response(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# Avoid a CSS-only approximation of the FFmpeg testsrc2 background.
# Generate a single 720p frame with the same lavfi source as scene_command().
_test_pattern_guard = threading.Lock()

@app.get("/api/scene/test-pattern")
def scene_test_pattern(request: Request, preset: str = "landscape"):
    authorize(request)
    try:
        width, height = canvas_size(preset)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    poster = DATA / f"scene-test-pattern-{preset}.jpg"
    with _test_pattern_guard:
        if not poster.is_file() or poster.stat().st_size == 0:
            temporary = poster.with_suffix(".tmp.jpg")
            try:
                subprocess.run([
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate=25",
                    "-frames:v", "1", "-q:v", "3", str(temporary)
                ], check=True, capture_output=True, timeout=15)
                if not temporary.is_file() or temporary.stat().st_size == 0:
                    raise ValueError("Blank test pattern")
                temporary.replace(poster)
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                temporary.unlink(missing_ok=True)
                raise HTTPException(status_code=503, detail="ساخت تصویر پس‌زمینه آزمایشی ناموفق بود.") from error
    return FileResponse(poster, media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/media/poster/{media_id}")
def media_poster(request: Request, media_id: int):
    authorize(request)
    with connect() as db:
        row = db.execute("SELECT file,kind FROM media WHERE id=?", (media_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="رسانه پیدا نشد.")
    path = (MEDIA / row["file"]).resolve()
    if not path.is_relative_to(MEDIA) or not path.is_file():
        raise HTTPException(status_code=404, detail="فایل وجود ندارد.")
    if row["kind"] == "image":
        return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
    thumbnail_dir = DATA / "posters"
    thumbnail_dir.mkdir(parents=True, exist_ok=True)
    thumbnail = thumbnail_dir / (path.stem + ".jpg")
    if not thumbnail.is_file():
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(path), "-vf", "scale=480:-2", "-frames:v", "1",
                 str(thumbnail)], check=True, capture_output=True, timeout=15
            )
        except (OSError, subprocess.SubprocessError) as error:
            thumbnail.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail="امکان ساخت تصویر بندانگشتی نیست.") from error
    return FileResponse(thumbnail, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


class DestinationNew(BaseModel):
    channel_id: str = Field(min_length=3, max_length=40)
    platform: str
    label: str = Field(min_length=2, max_length=60)
    server_url: str = Field(min_length=9, max_length=700)
    stream_key: str = Field(min_length=1, max_length=512)
    enabled: bool = False


class DestinationUpdate(BaseModel):
    enabled: bool | None = None
    server_url: str | None = None
    stream_key: str | None = None
    label: str | None = Field(default=None, min_length=2, max_length=60)


@app.get("/api/destinations")
def list_destinations(request: Request):
    authorize(request)
    return {"destinations": destination_manager.public_rows()}


@app.post("/api/destinations", status_code=201)
def add_destination(request: Request, body: DestinationNew):
    authorize(request, unsafe=True)
    try:
        ident = destination_manager.create(
            body.channel_id, body.platform, body.label,
            body.server_url, body.stream_key, body.enabled
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return {"ok": True, "id": ident}


@app.patch("/api/destinations/{destination_id}")
def update_destination(request: Request, destination_id: str, body: DestinationUpdate):
    authorize(request, unsafe=True)
    try:
        destination_manager.update(
            destination_id, enabled=body.enabled, server_url=body.server_url,
            stream_key=body.stream_key, label=body.label
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return {"ok": True}


@app.delete("/api/destinations/{destination_id}")
def delete_destination(request: Request, destination_id: str):
    authorize(request, unsafe=True)
    try:
        destination_manager.delete(destination_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return {"ok": True}
