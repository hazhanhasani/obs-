"""Optional Telegram Serverless control API; disabled without a 64-hex token."""
import hmac
import os
import re
from fastapi import APIRouter, HTTPException, Request

TOKEN_RE = re.compile(r"^[0-9a-fA-F]{64}$")
CHANNEL_RE = re.compile(r"^[a-z][a-z0-9_-]{2,39}$")

def authorize_cloud(request: Request):
    token = os.getenv("STREAMCORE_CLOUD_API_TOKEN", "")
    if not TOKEN_RE.fullmatch(token):
        raise HTTPException(status_code=404, detail="Not found")
    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
        raise HTTPException(status_code=401, detail="Invalid bridge authorization")

def build_cloud_router(get_overview, set_channel_state):
    router = APIRouter(prefix="/api/cloud", tags=["telegram-bridge"])

    @router.get("/overview")
    def overview(request: Request):
        authorize_cloud(request)
        data = get_overview()
        return {
            "ok": True,
            "channels": [{
                "id": c["id"], "name": c["name"], "mode": c["mode"],
                "desired": bool(c["desired"]), "running": bool(c["running"]),
                "error": str(c["error"])[:200] if c.get("error") else None,
            } for c in data["channels"]],
            "system": {"cpu": data["system"]["cpu"], "ram": data["system"]["ram"]},
            "time": data["time"],
        }

    @router.post("/channels/{channel}/{operation}")
    def control(request: Request, channel: str, operation: str):
        authorize_cloud(request)
        if not CHANNEL_RE.fullmatch(channel) or operation not in ("start", "stop"):
            raise HTTPException(status_code=404)
        return set_channel_state(channel, operation)

    return router
