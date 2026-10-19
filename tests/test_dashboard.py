import os
import sys
import tempfile
import unittest
from pathlib import Path

TEST_ROOT = tempfile.TemporaryDirectory(prefix="streamcore-test-")
os.environ["ADMIN_USERNAME"] = "testadmin"
os.environ["ADMIN_PASSWORD"] = "test-password-12-chars-or-longer"
os.environ["SESSION_SECRET"] = "a" * 64
os.environ["COOKIE_SECURE"] = "false"
os.environ["DATA_DIR"] = str(Path(TEST_ROOT.name) / "data")
os.environ["MEDIA_DIR"] = str(Path(TEST_ROOT.name) / "media")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))

from fastapi.testclient import TestClient
import app as streamcore


class DashboardIntegrationTest(unittest.TestCase):
    def test_login_csrf_channels_and_media_validation(self):
        with TestClient(streamcore.app) as client:
            self.assertEqual(client.get("/health").json(), {"ok": True})
            self.assertEqual(client.get("/api/overview").status_code, 401)
            self.assertEqual(client.post("/api/login", json={"username": "testadmin", "password": "invalid"}).status_code, 401)
            self.assertEqual(client.post("/api/login", json={"username": "wrongadmin", "password": os.environ["ADMIN_PASSWORD"]}).status_code, 401)

            response = client.post(
                "/api/login", json={"username": "testadmin", "password": os.environ["ADMIN_PASSWORD"]}
            )
            self.assertEqual(response.status_code, 200)
            token = response.json()["csrf"]
            headers = {"X-CSRF-Token": token}
            self.assertTrue(client.get("/api/session").json()["authenticated"])

            self.assertEqual(
                client.post("/api/channels", json={"id": "music", "name": "Music"}).status_code, 403
            )
            response = client.post(
                "/api/channels", headers=headers, json={"id": "music", "name": "Music"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertIn(
                "music", [channel["id"] for channel in client.get("/api/overview").json()["channels"]]
            )
            self.assertEqual(
                client.post("/api/channels", headers=headers, json={"id": "../x", "name": "Test"}).status_code,
                422
            )
            self.assertEqual(
                client.post("/api/channels/main/configure", headers=headers,
                            json={"mode": "file", "file": "missing.mp4"}).status_code,
                422
            )
            self.assertEqual(
                client.post("/api/media", headers=headers, files={"file": ("bad.txt", b"x", "text/plain")}).status_code,
                422
            )
            self.assertEqual(client.delete("/api/channels/main", headers=headers).status_code, 403)
            self.assertEqual(client.delete("/api/channels/music", headers=headers).status_code, 200)
            created = client.post("/api/destinations", headers=headers, json={
                "channel_id": "main", "platform": "telegram", "label": "Test Telegram",
                "server_url": "rtmps://example.com/live",
                "stream_key": "PRIVATE_SECRET_FOR_TESTS"
            })
            self.assertEqual(created.status_code, 201)
            dest_id = created.json()["id"]
            output = client.get("/api/destinations").json()
            self.assertEqual(len(output["destinations"]), 1)
            self.assertNotIn("PRIVATE_SECRET_FOR_TESTS", str(output))
            self.assertEqual(output["destinations"][0]["server_host"], "example.com")
            self.assertEqual(client.patch("/api/destinations/" + dest_id,
                  json={"enabled": True}).status_code, 403)
            self.assertEqual(client.patch("/api/destinations/" + dest_id, headers=headers,
                  json={"stream_key": "NEW_SECRET_FOR_TESTS"}).status_code, 200)
            self.assertEqual(client.delete("/api/destinations/" + dest_id, headers=headers).status_code, 200)
            self.assertEqual(client.post("/api/logout", headers=headers).status_code, 200)
            self.assertEqual(client.get("/api/overview").status_code, 401)

    def test_streaming_upload_and_cleanup(self):
        from unittest.mock import patch
        with TestClient(streamcore.app) as client:
            guest = client.post("/api/media/raw?filename=test.mp4",
                                content=b"sample", headers={"content-type": "application/octet-stream"})
            self.assertEqual(guest.status_code, 401)
            response = client.post("/api/login", json={
                "username": "testadmin", "password": os.environ["ADMIN_PASSWORD"]
            })
            self.assertEqual(response.status_code, 200)
            headers = {"X-CSRF-Token": response.json()["csrf"],
                       "content-type": "application/octet-stream"}
            self.assertEqual(client.post("/api/media/raw?filename=test.mp4",
                  content=b"sample").status_code, 403)
            self.assertEqual(client.post("/api/media/raw?filename=test.avi",
                  content=b"sample", headers=headers).status_code, 422)

            with patch.object(streamcore, "validate_media", return_value=12.0):
                result = client.post("/api/media/raw?filename=test.mp4",
                                     content=b"video data", headers=headers)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["bytes"], len(b"video data"))
            self.assertEqual(result.json()["name"], "test.mp4")
            self.assertIn("max_upload_mb", client.get("/api/overview").json()["limits"])

            files_before = set(streamcore.MEDIA.iterdir())
            with patch.object(streamcore, "validate_media",
                              side_effect=ValueError("Invalid H.264")):
                result = client.post("/api/media/raw?filename=broken.mp4",
                                     content=b"invalid video", headers=headers)
            self.assertEqual(result.status_code, 422)
            self.assertEqual(set(streamcore.MEDIA.iterdir()), files_before)

            with patch.object(streamcore, "MAX_MB", 1):
                result = client.post("/api/media/raw?filename=oversize.mp4",
                                     content=b"x" * (1024 * 1024 + 1), headers=headers)
            self.assertEqual(result.status_code, 413)
            self.assertEqual(set(streamcore.MEDIA.iterdir()), files_before)

    def test_media_ui_has_progress_and_player_cleanup(self):
        with TestClient(streamcore.app) as client:
            html = client.get("/").text
            self.assertIn('id="upload-progress"', html)
            self.assertIn('id="upload-cancel"', html)
            self.assertIn("disablepictureinpicture", html)
        frontend = (Path(__file__).resolve().parents[1] / "dashboard" / "static" / "app.js").read_text()
        self.assertIn("function uploadMediaFile(", frontend)
        self.assertIn('if(pageName!=="dashboard" && state.playerKey!==null)stopPlayer()', frontend)

    def test_source_path_rejected(self):
        controller = streamcore.Controller()
        with self.assertRaises(ValueError):
            controller.command({"id": "main", "mode": "file", "file": "../secret"})


if __name__ == "__main__":
    unittest.main()
