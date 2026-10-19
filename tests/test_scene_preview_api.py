"""Authenticated server-rendered scene preview must not mutate a live stream."""
import unittest
import shutil
from io import BytesIO
from PIL import Image
from unittest.mock import patch

from fastapi.testclient import TestClient
from test_dashboard import streamcore
from scene import scene_snapshot_command


class DraftScenePreviewTests(unittest.TestCase):
    @staticmethod
    def login(client):
        result = client.post("/api/login", json={
            "username": "testadmin",
            "password": "test-password-12-chars-or-longer",
        })
        assert result.status_code == 200, result.text
        return {"X-CSRF-Token": result.json()["csrf"]}

    def test_preview_requires_auth_and_csrf(self):
        with TestClient(streamcore.app) as client:
            endpoint = "/api/channels/main/scene/preview"
            payload = {"base_file": None, "layers": [], "text_layers": []}
            self.assertEqual(client.post(endpoint, json=payload).status_code, 401)
            self.login(client)
            self.assertEqual(client.post(endpoint, json=payload).status_code, 403)

    def test_draft_preview_uses_ffmpeg_without_restarting_or_saving(self):
        with TestClient(streamcore.app) as client:
            headers = self.login(client)
            endpoint = "/api/channels/main/scene/preview"
            before = client.get("/api/channels/main/scene").json()
            jpeg = bytes((0xFF, 0xD8, 0xFF, 0xE0)) + b'test' + bytes((0xFF, 0xD9))
            with patch.object(streamcore, "render_scene_snapshot", return_value=jpeg) as render:
                with patch.object(streamcore.controller, "stop") as stop:
                    response = client.post(endpoint, json={
                        "base_file": None, "layers": [], "text_layers": []
                    }, headers=headers)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.content, jpeg)
                    self.assertIn("image/jpeg", response.headers["content-type"])
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    render.assert_called_once()
                    stop.assert_not_called()
            self.assertEqual(client.get("/api/channels/main/scene").json(), before)

    def test_invalid_draft_is_rejected_without_mutation(self):
        with TestClient(streamcore.app) as client:
            headers = self.login(client)
            endpoint = "/api/channels/main/scene/preview"
            before = client.get("/api/channels/main/scene").json()
            invalid = {
                "base_file": None,
                "layers": [{
                    "layer_id": "missing_image",
                    "media_file": "nonexistent.png",
                    "x": 10, "y": 10, "w": 50, "h": 30
                }],
                "text_layers": [],
            }
            with patch.object(streamcore.controller, "stop") as stop:
                response = client.post(endpoint, json=invalid, headers=headers)
                self.assertEqual(response.status_code, 422)
                stop.assert_not_called()
            self.assertEqual(client.get("/api/channels/main/scene").json(), before)

    def test_snapshot_command_has_video_frame_but_no_rtmp_output(self):
        cmd = [
            "ffmpeg", "-filter_complex", "[0:v]format=yuv420p[vout]",
            "-map", "[vout]", "-map", "0:a:0",
            "-c:v", "libx264", "-f", "flv", "rtmp://mediamtx:1935/main",
        ]
        snapshot = scene_snapshot_command(cmd)
        self.assertEqual(snapshot[:3], cmd[:3])
        self.assertEqual(snapshot[-1], "pipe:1")
        self.assertNotIn("rtmp://mediamtx:1935/main", snapshot)
        self.assertIn("-frames:v", snapshot)

    @unittest.skipUnless(shutil.which("ffmpeg"), "requires FFmpeg")
    def test_testsrc2_poster_is_authenticated_and_matches_program_canvas(self):
        """The editor background must be drawn by FFmpeg, not CSS test bars."""
        with TestClient(streamcore.app) as client:
            endpoint = "/api/scene/test-pattern"
            self.assertEqual(client.get(endpoint).status_code, 401)
            self.login(client)
            picture = client.get(endpoint)
            self.assertEqual(picture.status_code, 200, picture.text[:160])
            self.assertTrue(picture.content.startswith(bytes((255, 216))))
            self.assertIn("image/jpeg", picture.headers["content-type"])
            with Image.open(BytesIO(picture.content)) as image:
                self.assertEqual(image.size, (1280, 720))
                left = image.convert("RGB").getpixel((80, 120))
                right = image.convert("RGB").getpixel((1170, 120))
                self.assertNotEqual(left, right)

    def test_busy_preview_returns_429(self):
        class BusyLimiter:
            def acquire(self, blocking=False):
                return False

            def release(self):
                raise AssertionError("Release must not be invoked after failed acquire")

        with TestClient(streamcore.app) as client:
            headers = self.login(client)
            with patch.object(streamcore, "scene_preview_limit", BusyLimiter()):
                result = client.post("/api/channels/main/scene/preview",
                                     json={"base_file": None, "layers": [], "text_layers": []},
                                     headers=headers)
                self.assertEqual(result.status_code, 429)


if __name__ == "__main__":
    unittest.main()
