"""Authenticated API smoke test for per-channel telemetry."""
import os
import unittest

from fastapi.testclient import TestClient
from test_dashboard import streamcore


class TelemetryAPITests(unittest.TestCase):
    def test_overview_includes_encoder_state_but_requires_login(self):
        with TestClient(streamcore.app) as client:
            self.assertEqual(client.get("/api/overview").status_code, 401)
            login = client.post("/api/login", json={
                "username": "testadmin",
                "password": os.environ["ADMIN_PASSWORD"],
            })
            self.assertEqual(login.status_code, 200, login.text)
            result = client.get("/api/overview")
            self.assertEqual(result.status_code, 200)
            channels = result.json()["channels"]
            self.assertTrue(channels)
            main = next(c for c in channels if c["id"] == "main")
            encoder = main["encoder"]
            self.assertIn(
                encoder["state"],
                {"stopped", "starting", "no-data", "healthy", "slow", "stalled"},
            )
            for field in ("fps", "speed", "frame", "age_seconds",
                          "cpu_percent", "memory_mb"):
                self.assertIn(field, encoder)
            self.assertNotIn("password", str(encoder).lower())
            self.assertNotIn("stream_key", str(encoder).lower())


if __name__ == "__main__":
    unittest.main()
