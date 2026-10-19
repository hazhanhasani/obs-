"""Independent RTMP/RTMPS output workers for StreamCore.

Every destination re-publishes the same already encoded MediaMTX stream using
FFmpeg stream-copy. The UI only receives redacted metadata; secrets are
encrypted in SQLite using a key derived from the persistent session secret.
"""
import base64
import hashlib
import ipaddress
import os
import re
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from telemetry import ProgressTracker

PLATFORMS = ("telegram", "instagram", "aparat", "youtube", "twitch", "custom")
MAX_DESTINATIONS = 32
MAX_PER_CHANNEL = 8
SAFE_STREAM_KEY = re.compile(r"^[^\s\x00-\x1f]{1,512}$")


def validate_server(url: str) -> str:
    """Require a plain public RTMP(S) server URL, with the stream key separate."""
    if not isinstance(url, str) or len(url) > 700:
        raise ValueError("آدرس سرور باید یک URL معتبر RTMP یا RTMPS باشد.")
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise ValueError("آدرس سرور یا پورت معتبر نیست.") from error
    if parsed.scheme not in ("rtmp", "rtmps") or not parsed.hostname:
        raise ValueError("فقط RTMP و RTMPS پشتیبانی می‌شوند.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("کلید پخش را جداگانه وارد کنید؛ آدرس سرور نباید رمز یا Query داشته باشد.")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("پورت مقصد معتبر نیست.")
    hostname = parsed.hostname.lower()
    if hostname in ("localhost", "host.docker.internal") or hostname.endswith((".local", ".internal")):
        raise ValueError("آدرس سرور داخلی مجاز نیست.")
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        # DNS names may still resolve to private addresses. Only trusted admins
        # can configure outputs; outbound firewall rules remain necessary.
        if "." not in hostname:
            raise ValueError("نام سرور باید دامنه معتبر باشد.")
    else:
        if not ip.is_global:
            raise ValueError("آدرس شبکه خصوصی یا محلی مجاز نیست.")
    if url.endswith("/"):
        return url.rstrip("/")
    return url


def validate_key(key: str) -> str:
    if not isinstance(key, str) or not SAFE_STREAM_KEY.fullmatch(key):
        raise ValueError("کلید استریم معتبر نیست.")
    return key


def encryptor(secret: str) -> Fernet:
    digest = hashlib.sha256(("streamcore-rtmp-outputs-v1:" + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def init_table(connect):
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS stream_destinations (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            label TEXT NOT NULL,
            server_url TEXT NOT NULL,
            encrypted_key TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_destinations_channel ON stream_destinations(channel_id)")


class DestinationSupervisor:
    def __init__(self, connect, secret, channel_state, data_dir):
        self.connect = connect
        self.crypt = encryptor(secret)
        self.channel_state = channel_state
        self.data_dir = Path(data_dir)
        self.lock = threading.RLock()
        self.processes = {}
        self.tracker = ProgressTracker()
        self.retry_after = {}
        self.errors = {}
        self.stop_event = threading.Event()
        self.thread = None

    def command(self, row):
        server = validate_server(row["server_url"])
        try:
            key = self.crypt.decrypt(row["encrypted_key"].encode()).decode()
        except (InvalidToken, UnicodeError) as error:
            raise ValueError("کلید خروجی قابل رمزگشایی نیست؛ آن را مجدداً ثبت کنید.") from error
        validate_key(key)
        # Key in a child argv is visible to privileged processes on the VPS.
        # Never expose ffmpeg argv, error output, or /proc to untrusted users.
        target = server + "/" + key.lstrip("/")
        return [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "quiet",
            "-nostats", "-stats_period", "2", "-progress", "pipe:1",
            "-rw_timeout", "15000000",
            "-i", "rtmp://mediamtx:1935/" + row["channel_id"],
            "-map", "0:v:0", "-map", "0:a?", "-c:v", "copy",
            "-c:a", "copy", "-rw_timeout", "15000000", "-f", "flv", "-flvflags", "no_duration_filesize", target,
        ]

    def stop(self, destination_id):
        with self.lock:
            proc = self.processes.pop(destination_id, None)
            self.tracker.detach(destination_id, proc.pid if proc else None)
            if proc is None or proc.poll() is not None:
                return
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=4)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                if proc.poll() is None:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait(timeout=3)
                    except ProcessLookupError:
                        pass

    def reconcile(self):
        with self.lock:
            with self.connect() as db:
                rows = [dict(x) for x in db.execute("SELECT * FROM stream_destinations")]
            active = {
                row["id"]: row for row in rows
                if row["enabled"] and self.channel_state(row["channel_id"])["running"]
            }
            for ident in list(self.processes):
                proc = self.processes[ident]
                if ident not in active:
                    self.stop(ident)
                elif proc.poll() is not None:
                    self.errors[ident] = "اتصال مقصد قطع شد؛ تلاش مجدد خودکار فعال است."
                    self.processes.pop(ident, None)
                    self.tracker.detach(ident, proc.pid)
                elif self.tracker.snapshot(ident, proc.pid, True)["state"] in {"stalled", "no-data"}:
                    self.stop(ident)
                    self.errors[ident] = "پیشرفت ارسال متوقف شد؛ اتصال مجدد انجام می‌شود."
                    self.retry_after[ident] = time.monotonic() + 3
            for ident, row in active.items():
                if ident in self.processes or time.monotonic() < self.retry_after.get(ident, 0):
                    continue
                try:
                    command = self.command(row)
                    # No secret-bearing argv or ffmpeg diagnostic output is logged.
                    process = subprocess.Popen(
                        command, stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                        start_new_session=True, close_fds=True
                    )
                    self.processes[ident] = process
                    self.tracker.attach(ident, process)
                    self.errors.pop(ident, None)
                except (OSError, ValueError) as error:
                    self.errors[ident] = str(error)
                self.retry_after[ident] = time.monotonic() + 10

    def status(self, ident):
        with self.lock:
            process = self.processes.get(ident)
            running = process is not None and process.poll() is None
            progress = self.tracker.snapshot(ident, process.pid if process else None, running)
            return {
                "sending": running and progress["state"] in {"healthy", "slow"} and (progress["frame"] or 0) > 0,
                "transport": progress,
                "error": self.errors.get(ident),
            }

    def start(self):
        self.thread = threading.Thread(target=self.run, name="destination-supervisor", daemon=True)
        self.thread.start()

    def run(self):
        while not self.stop_event.is_set():
            self.reconcile()
            self.stop_event.wait(3)

    def shutdown(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
        for ident in list(self.processes):
            self.stop(ident)

    def public_rows(self):
        with self.connect() as db:
            rows = [dict(r) for r in db.execute(
                "SELECT id,channel_id,platform,label,server_url,enabled,created "
                "FROM stream_destinations ORDER BY created DESC,id DESC"
            )]
        for row in rows:
            # Even the server URL may embed a sensitive account path.
            parsed = urlsplit(row.pop("server_url"))
            row["server_host"] = parsed.hostname or ""
            row["key_configured"] = True
            row.update(self.status(row["id"]))
        return rows

    def create(self, channel, platform, label, server_url, stream_key, enabled=False):
        if platform not in PLATFORMS:
            raise ValueError("پلتفرم انتخاب‌شده معتبر نیست.")
        server = validate_server(server_url)
        key = validate_key(stream_key)
        with self.connect() as db:
            if not db.execute("SELECT id FROM channels WHERE id=?", (channel,)).fetchone():
                raise LookupError("کانال موردنظر وجود ندارد.")
            if db.execute("SELECT COUNT(*) FROM stream_destinations").fetchone()[0] >= MAX_DESTINATIONS:
                raise ValueError("حداکثر تعداد خروجی مجاز تکمیل شده است.")
            if db.execute("SELECT COUNT(*) FROM stream_destinations WHERE channel_id=?", (channel,)).fetchone()[0] >= MAX_PER_CHANNEL:
                raise ValueError("هر کانال حداکثر ۸ مقصد دارد.")
            ident = uuid.uuid4().hex
            db.execute(
                "INSERT INTO stream_destinations"
                "(id,channel_id,platform,label,server_url,encrypted_key,enabled,created)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (ident, channel, platform, label, server,
                 self.crypt.encrypt(key.encode()).decode(), int(enabled), int(time.time()))
            )
        return ident

    def update(self, ident, enabled=None, stream_key=None, server_url=None, label=None):
        updates, values = [], []
        if enabled is not None:
            updates.append("enabled=?")
            values.append(int(enabled))
        if stream_key is not None and stream_key != "":
            updates.append("encrypted_key=?")
            values.append(self.crypt.encrypt(validate_key(stream_key).encode()).decode())
        if server_url is not None:
            updates.append("server_url=?")
            values.append(validate_server(server_url))
        if label is not None:
            updates.append("label=?")
            values.append(label)
        if not updates:
            return
        with self.connect() as db:
            if not db.execute("SELECT id FROM stream_destinations WHERE id=?", (ident,)).fetchone():
                raise LookupError("مقصد پیدا نشد.")
            db.execute("UPDATE stream_destinations SET " + ",".join(updates) + " WHERE id=?",
                       (*values, ident))
        self.stop(ident)
        self.retry_after.pop(ident, None)

    def delete(self, ident):
        with self.connect() as db:
            count = db.execute("DELETE FROM stream_destinations WHERE id=?", (ident,)).rowcount
        if not count:
            raise LookupError("مقصد پیدا نشد.")
        self.stop(ident)
        self.retry_after.pop(ident, None)
        self.errors.pop(ident, None)

    def delete_channel(self, channel):
        with self.connect() as db:
            ids = [row[0] for row in db.execute(
                "SELECT id FROM stream_destinations WHERE channel_id=?", (channel,)
            )]
            db.execute("DELETE FROM stream_destinations WHERE channel_id=?", (channel,))
        for ident in ids:
            self.stop(ident)
            self.retry_after.pop(ident, None)
            self.errors.pop(ident, None)
