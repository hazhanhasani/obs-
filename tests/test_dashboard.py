import os
import sys
import tempfile
import unittest
from pathlib import Path

TEST_ROOT = tempfile.TemporaryDirectory(prefix="streamcore-test-")
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
            self.assertEqual(client.post("/api/login", json={"password": "invalid"}).status_code, 401)

            response = client.post(
                "/api/login", json={"password": os.environ["ADMIN_PASSWORD"]}
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

    def test_source_path_rejected(self):
        controller = streamcore.Controller()
        with self.assertRaises(ValueError):
            controller.command({"id": "main", "mode": "file", "file": "../secret"})


if __name__ == "__main__":
    unittest.main()
