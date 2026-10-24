"""Security regressions for the optional cloud control bridge."""
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from cloud_bridge import build_cloud_router

def client_fixture():
    actions = []
    app = FastAPI()
    def overview():
        return {"channels": [{"id": "main", "name": "Main", "mode": "scene",
             "desired": 1, "running": True, "error": None, "file": "secret.mp4",
             "encrypted_key": "private"}],
             "system": {"cpu": 7, "ram": 20, "total_ram": 4},
             "time": 123, "destinations": [{"encrypted_key": "private"}]}
    def control(channel, operation):
        actions.append((channel, operation))
        return {"ok": True}
    app.include_router(build_cloud_router(overview, control))
    return TestClient(app), actions

def test_disabled(monkeypatch):
    monkeypatch.delenv("STREAMCORE_CLOUD_API_TOKEN", raising=False)
    client, actions = client_fixture()
    assert client.get("/api/cloud/overview").status_code == 404
    assert client.post("/api/cloud/channels/main/start").status_code == 404
    assert actions == []

def test_authorization_and_redaction(monkeypatch):
    token = "a" * 64
    monkeypatch.setenv("STREAMCORE_CLOUD_API_TOKEN", token)
    client, _ = client_fixture()
    assert client.get("/api/cloud/overview").status_code == 401
    assert client.get("/api/cloud/overview", headers={"authorization": "Bearer bad"}).status_code == 401
    response = client.get("/api/cloud/overview", headers={"authorization": "Bearer " + token})
    assert response.status_code == 200
    assert response.json()["channels"][0]["running"] is True
    for forbidden in ("encrypted_key", "secret.mp4", "total_ram", "private", "destinations"):
        assert forbidden not in response.text

def test_only_start_stop(monkeypatch):
    token = "b" * 64
    monkeypatch.setenv("STREAMCORE_CLOUD_API_TOKEN", token)
    client, actions = client_fixture()
    h = {"authorization": "Bearer " + token}
    assert client.post("/api/cloud/channels/main/start", headers=h).status_code == 200
    assert client.post("/api/cloud/channels/main/stop", headers=h).status_code == 200
    assert client.post("/api/cloud/channels/main/delete", headers=h).status_code == 404
    assert client.post("/api/cloud/channels/INVALID/start", headers=h).status_code == 404
    assert client.post("/api/cloud/channels/main/stop").status_code == 401
    assert actions == [("main", "start"), ("main", "stop")]
