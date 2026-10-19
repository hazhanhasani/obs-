"""Safety checks for low-CPU scene encoding and live-scene preflight."""
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from test_dashboard import streamcore
from scene import init_scene_db, preflight_scene, scene_command, scene_encoder_profile


class SceneEncoderProfileTests(unittest.TestCase):
    def test_default_profile_bounds_cpu(self):
        with patch.dict(os.environ, {
            "SCENE_ENCODER_PRESET": "ultrafast",
            "SCENE_ENCODER_THREADS": "2",
            "SCENE_VIDEO_BITRATE_KBPS": "2500",
        }):
            self.assertEqual(scene_encoder_profile(), ("ultrafast", 2, 2500))

    def test_invalid_profiles_fail_closed(self):
        for setting, value in (
            ("SCENE_ENCODER_PRESET", "medium"),
            ("SCENE_ENCODER_PRESET", "-injected"),
            ("SCENE_ENCODER_THREADS", "0"),
            ("SCENE_ENCODER_THREADS", "32"),
            ("SCENE_VIDEO_BITRATE_KBPS", "20000"),
            ("SCENE_VIDEO_BITRATE_KBPS", "not-a-number"),
        ):
            with self.subTest(setting=setting, value=value):
                with patch.dict(os.environ, {setting: value}):
                    with self.assertRaises(ValueError):
                        scene_encoder_profile()

    def test_command_applies_bounded_options_to_composed_stream(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "state.sqlite3"
            def connect():
                db = sqlite3.connect(path)
                db.row_factory = sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE media (file TEXT UNIQUE NOT NULL, kind TEXT DEFAULT 'video')")
            init_scene_db(connect)
            with patch.dict(os.environ, {
                "SCENE_ENCODER_PRESET": "ultrafast",
                "SCENE_ENCODER_THREADS": "2",
                "SCENE_VIDEO_BITRATE_KBPS": "1900",
            }):
                args = scene_command(connect, "main", None, d, "rtmp://example.com/main")
            self.assertIn("-filter_complex_threads", args)
            self.assertEqual(args[args.index("-filter_complex_threads")+1], "2")
            self.assertEqual(args[args.index("-threads")+1], "2")
            self.assertEqual(args[args.index("-preset")+1], "ultrafast")
            self.assertEqual(args[args.index("-b:v")+1], "1900k")
            self.assertEqual(args[args.index("-maxrate")+1], "1900k")
            self.assertEqual(args[args.index("-bufsize")+1], "3800k")
            self.assertEqual(args[-1], "rtmp://example.com/main")

    def test_preflight_rejects_missing_image_without_mutation(self):
        overlay = SimpleNamespace(media_file="missing.png",x=10,y=10,w=30,h=20,
                                  fit="contain",opacity=100,effect="fade",
                                  start_sec=0,duration_sec=0,repeat_sec=0)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                preflight_scene(Path(d), None, [overlay], None)


class ScenePreflightHTTPTests(unittest.TestCase):
    def test_invalid_persian_text_does_not_stop_running_channel(self):
        with TestClient(streamcore.app) as client:
            login = client.post("/api/login", json={
                "username": "testadmin",
                "password": "test-password-12-chars-or-longer",
            })
            self.assertEqual(login.status_code, 200, login.text)
            headers = {"X-CSRF-Token": login.json()["csrf"]}
            before = client.get("/api/channels/main/scene").json()
            payload = {
                "base_file": None, "layers": [],
                "text_layers": [{
                    "layer_id": "text_preflight",
                    "text": "سلام StreamCore",
                    "x": 12, "y": 15, "w": 64, "h": 23,
                    "font_size": 42, "color": "#ffffff",
                    "effect": "fade", "start_sec": 0,
                    "duration_sec": 5, "repeat_sec": 0,
                }]
            }
            with patch("scene.render_text_layer", side_effect=ValueError("Missing RTL font")):
                with patch.object(streamcore.controller, "stop") as stop:
                    response = client.put("/api/channels/main/scene",
                                          json=payload, headers=headers)
                    self.assertEqual(response.status_code, 422, response.text)
                    stop.assert_not_called()
            self.assertEqual(client.get("/api/channels/main/scene").json(), before)

    def test_nonexistent_channel_returns_404_before_preflight(self):
        with TestClient(streamcore.app) as client:
            login=client.post("/api/login",json={
                "username": "testadmin",
                "password": "test-password-12-chars-or-longer",
            })
            headers={"X-CSRF-Token":login.json()["csrf"]}
            with patch("scene.render_text_layer") as renderer:
                result=client.put("/api/channels/nonexistent/scene",
                    headers=headers,json={"base_file":None,"layers":[],"text_layers":[]})
                self.assertEqual(result.status_code, 404)
                renderer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
