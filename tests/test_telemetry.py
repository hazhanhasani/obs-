"""Deterministic tests for bounded, nonblocking FFmpeg progress telemetry."""
import io
import unittest
from types import SimpleNamespace

from telemetry import ProgressTracker, decode_progress


class ProgressTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.now = [100.0]
        self.tracker = ProgressTracker(clock=lambda: self.now[0])

    def test_bounded_and_redacted_progress(self):
        sample = decode_progress({
            "fps": "24.72", "speed": "0.98x", "frame": "432",
            "path": "rtmp://secret/private", "stream_key": "PRIVATE"
        })
        self.assertEqual(sample, {"fps": 24.72, "speed": 0.98, "frame": 432})
        self.assertNotIn("PRIVATE", str(sample))
        self.assertNotIn("rtmp", str(sample))
        self.assertEqual(
            decode_progress({"fps": "NaN", "speed": "-3x", "frame": "inf"}),
            {"fps": None, "speed": None, "frame": None}
        )

    def test_startup_and_stale_thresholds(self):
        self.tracker.attach("main", SimpleNamespace(pid=101, stdout=None))
        self.assertEqual(self.tracker.snapshot("main", 101, True)["state"], "starting")
        self.now[0] += 26
        self.assertEqual(self.tracker.snapshot("main", 101, True)["state"], "no-data")
        self.tracker.record("main", 101, {"fps": "24.9", "speed": "0.99x", "frame": "100"})
        self.assertEqual(self.tracker.snapshot("main", 101, True)["state"], "healthy")
        self.now[0] += 19
        self.assertEqual(self.tracker.snapshot("main", 101, True)["state"], "healthy")
        self.now[0] += 2
        self.assertEqual(self.tracker.snapshot("main", 101, True)["state"], "stalled")
        self.assertEqual(self.tracker.snapshot("main", 101, True)["age_seconds"], 21)
        self.assertEqual(self.tracker.snapshot("main", 101, False)["state"], "stopped")

    def test_two_slow_samples_required_to_warn(self):
        self.tracker.attach("news", SimpleNamespace(pid=202, stdout=None))
        self.tracker.record("news", 202, {"speed": "0.82x", "fps": "20", "frame": "5"})
        self.assertEqual(self.tracker.snapshot("news", 202, True)["state"], "healthy")
        self.now[0] += 5
        self.tracker.record("news", 202, {"speed": "0.73x", "fps": "18", "frame": "7"})
        self.assertEqual(self.tracker.snapshot("news", 202, True)["state"], "slow")
        self.now[0] += 5
        self.tracker.record("news", 202, {"speed": "1.01x", "fps": "25", "frame": "12"})
        self.assertEqual(self.tracker.snapshot("news", 202, True)["state"], "healthy")

    def test_old_process_cannot_override_restarted_channel(self):
        self.tracker.attach("main", SimpleNamespace(pid=1, stdout=None))
        self.tracker.attach("main", SimpleNamespace(pid=2, stdout=None))
        self.tracker.record("main", 1, {"speed": "0.01x"})
        self.assertEqual(self.tracker.snapshot("main", 2, True)["state"], "starting")
        self.tracker.detach("main", 1)
        self.tracker.record("main", 2, {"fps": "25", "speed": "1.00x", "frame": "100"})
        self.assertEqual(self.tracker.snapshot("main", 2, True)["state"], "healthy")
        self.tracker.detach("main", 2)
        self.assertEqual(self.tracker.snapshot("main", 2, True)["state"], "starting")

    def test_progress_pipe_parses_complete_records_only(self):
        self.tracker.attach("main", SimpleNamespace(pid=10, stdout=None))
        data = (
            b"frame=100\nfps=24.8\nspeed=0.95x\nout_time=00:00:04\nprogress=continue\n"
            b"frame=200\nfps=25.1\nspeed=1.02x\nprogress=continue\n"
            b"fps=not-a-number\n"
        )
        self.tracker._consume("main", 10, io.BytesIO(data))
        report = self.tracker.snapshot("main", 10, True)
        self.assertEqual(report["fps"], 25.1)
        self.assertEqual(report["frame"], 200)
        self.assertEqual(report["speed"], 1.02)
        self.assertEqual(report["state"], "healthy")


if __name__ == "__main__":
    unittest.main()
