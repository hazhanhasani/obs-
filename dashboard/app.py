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
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.request import urlopen

import psutil
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

ROOT = Path(__file__).resolve().parent
MEDIA = Path(os.getenv("MEDIA_DIR", "/media")).resolve()
DATA = Path(os.getenv("DATA_DIR", "/data")).resolve()
PASSWORD = os.getenv("ADMIN_PASSWORD", "")
SECRET = os.getenv("SESSION_SECRET", "")
MAX_MB = max(1, int(os.getenv("MAX_UPLOAD_MB", "1024")))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"
SLUG = re.compile(r"^[a-z][a-z0-9_-]{2,39}$")
VALID_EXT = {".mp4", ".mkv", ".mov"}

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

class Controller:
    def __init__(self):
        self.lock = threading.RLock()
        self.processes = {}
        self.next_retry = {}
        self.errors = {}
        self.stop_event = threading.Event()
        self.thread = None

    def command(self, row):
        target = "rtmp://mediamtx:1935/" + row["id"]
        base = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y"]
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
                    self.processes.pop(channel, None)
            for channel, row in enabled.items():
                if channel in self.processes or time.monotonic() < self.next_retry.get(channel, 0):
                    continue
                try:
                    cmd = self.command(row)
                    log_path = DATA / ("ffmpeg-" + channel + ".log")
                    with log_path.open("ab") as log:
                        proc = subprocess.Popen(
                            cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=log, start_new_session=True, close_fds=True
                        )
                    self.processes[channel] = proc
                    self.errors.pop(channel, None)
                except (ValueError, OSError) as error:
                    self.errors[channel] = str(error)
                self.next_retry[channel] = time.monotonic() + 8

    def state(self, channel):
        with self.lock:
            process = self.processes.get(channel)
            return {
                "running": process is not None and process.poll() is None,
                "error": self.errors.get(channel),
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
failed_logins = {}
login_lock = threading.Lock()

@asynccontextmanager
async def lifespan(app):
    init_db()
    controller.start()
    yield
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
    if not hmac.compare_digest(credentials.password, PASSWORD):
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
        "system": {"cpu": cpu, "ram": ram, "total_ram": round(psutil.virtual_memory().total / 1024**3, 1)},
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
    controller.stop(channel)
    return {"ok": True}

@app.post("/api/media")
async def upload(request: Request, file: UploadFile = File(...)):
    authorize(request, unsafe=True)
    original = Path(file.filename or "untitled").name
    suffix = Path(original).suffix.lower()
    if suffix not in VALID_EXT:
        raise HTTPException(status_code=422, detail="فرمت‌های مجاز MP4، MOV و MKV هستند.")
    filename = secrets.token_hex(16) + suffix
    destination = MEDIA / filename
    total = 0
    try:
        with destination.open("xb") as out:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_MB * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="حجم فایل بیشتر از محدودیت مجاز است.")
                out.write(chunk)
        duration = await asyncio.to_thread(validate_media, destination)
        with connect() as db:
            db.execute("INSERT INTO media(file,name,bytes,duration,created) VALUES(?,?,?,?,?)",
                       (filename, original[:180], total, duration, int(time.time())))
    except (HTTPException, ValueError) as error:
        destination.unlink(missing_ok=True)
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(status_code=422, detail=str(error))
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return {"ok": True, "name": original}

@app.delete("/api/media/{media_id}")
def delete_media(request: Request, media_id: int):
    authorize(request, unsafe=True)
    with connect() as db:
        row = db.execute("SELECT file FROM media WHERE id=?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404)
        if db.execute("SELECT count(*) FROM channels WHERE file=?", (row["file"],)).fetchone()[0]:
            raise HTTPException(status_code=409, detail="این فایل به یک کانال متصل است.")
        db.execute("DELETE FROM media WHERE id=?", (media_id,))
    (MEDIA / row["file"]).unlink(missing_ok=True)
    return {"ok": True}
