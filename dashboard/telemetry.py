"""Lightweight FFmpeg -progress collector for channel-local encoder health.

FFmpeg writes key=value records to a pipe consumed by a daemon thread.  The
collector keeps just the latest bounded in-memory sample (no files or secrets).
It measures local encoder progress, NOT remote RTMP/HLS availability.
"""
from __future__ import annotations

import math
import threading
import time


def _finite_number(value, low=0.0, high=1000000.0):
    try:
        number = float(str(value).strip().rstrip("x"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not low <= number <= high:
        return None
    return round(number, 2)


def decode_progress(fields):
    """Whitelist parsed metrics; never expose raw FFmpeg output or paths."""
    fps = _finite_number(fields.get("fps"), high=1000)
    speed = _finite_number(fields.get("speed"), high=50)
    frame = _finite_number(fields.get("frame"), high=1000000000000)
    return {
        "fps": fps,
        "speed": speed,
        "frame": int(frame) if frame is not None else None,
    }


class ProgressTracker:
    STALE_SECONDS = 20
    STARTUP_SECONDS = 25

    def __init__(self, clock=None):
        self.clock = clock or time.monotonic
        self.lock = threading.Lock()
        self.channels = {}

    def attach(self, channel, process):
        """Initialize metrics and begin draining FFmpeg's progress stdout."""
        with self.lock:
            self.channels[channel] = {
                "pid": process.pid,
                "started": self.clock(),
                "received": None,
                "advanced": self.clock(),
                "last_frame": None,
                "sample": None,
                "slow_count": 0,
            }
        if process.stdout is not None:
            thread = threading.Thread(
                target=self._consume, args=(channel, process.pid, process.stdout),
                daemon=True, name="progress-" + channel
            )
            thread.start()

    def _consume(self, channel, pid, stream):
        fields = {}
        try:
            for raw in stream:
                if isinstance(raw, bytes):
                    line = raw.decode("ascii", errors="replace").strip()
                else:
                    line = str(raw).strip()
                name, separator, value = line.partition("=")
                if not separator:
                    continue
                if name == "progress":
                    self.record(channel, pid, fields)
                    fields = {}
                elif name in ("fps", "speed", "frame"):
                    # Prevent malicious or malformed output from growing memory.
                    fields[name] = value[:64]
        except OSError:
            pass
        finally:
            try:
                stream.close()
            except OSError:
                pass

    def record(self, channel, pid, fields):
        sample = decode_progress(fields)
        with self.lock:
            item = self.channels.get(channel)
            if not item or item["pid"] != pid:
                return
            frame = sample["frame"]
            if frame is not None and frame > (item["last_frame"] or 0):
                item["advanced"] = self.clock()
            if frame is not None:
                item["last_frame"] = max(frame, item["last_frame"] or 0)
            item["sample"] = sample
            item["received"] = self.clock()
            speed = sample["speed"]
            item["slow_count"] = item["slow_count"] + 1 if (
                speed is not None and speed < 0.85
            ) else 0

    def detach(self, channel, pid=None):
        with self.lock:
            item = self.channels.get(channel)
            if item and (pid is None or item["pid"] == pid):
                self.channels.pop(channel, None)

    def snapshot(self, channel, pid, running):
        if not running:
            return {
                "state": "stopped", "fps": None, "speed": None,
                "frame": None, "age_seconds": None,
            }
        with self.lock:
            item = self.channels.get(channel)
            item = item.copy() if item and item["pid"] == pid else None
        if item is None:
            return {
                "state": "starting", "fps": None, "speed": None,
                "frame": None, "age_seconds": None,
            }
        now = self.clock()
        received = item["received"]
        if received is None:
            stage = "starting" if now - item["started"] < self.STARTUP_SECONDS else "no-data"
            return {
                "state": stage, "fps": None, "speed": None,
                "frame": None, "age_seconds": None,
            }
        age = max(0, round(now - received))
        frozen = (item["last_frame"] is not None and
                  now - item["advanced"] > self.STALE_SECONDS)
        stage = "stalled" if age > self.STALE_SECONDS or frozen else (
            "slow" if item["slow_count"] >= 2 else "healthy"
        )
        return {"state": stage, "age_seconds": age, **item["sample"]}
