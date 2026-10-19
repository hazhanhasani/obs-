"""Isolated real API/SQLite/FFmpeg server; never connects to a live publisher."""
import os
from pathlib import Path
import sys
import tempfile
import subprocess

root = tempfile.TemporaryDirectory(prefix="scene-browser-")
os.environ.update(DATA_DIR=root.name + "/data", MEDIA_DIR=root.name + "/media",
                  ADMIN_USERNAME="browseradmin", ADMIN_PASSWORD="browser-test-password",
                  SESSION_SECRET="browser-test-secret-" * 4, COOKIE_SECURE="false")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import app
from PIL import Image
import uvicorn

# Only the external publishing supervisors are disabled. Routes, authentication,
# validation, SQLite and FFmpeg rendering run unmodified.
app.controller.start = lambda: None
app.controller.shutdown = lambda: None
app.controller.reconcile = lambda: None
app.destination_manager.start = lambda: None
app.destination_manager.shutdown = lambda: None
Image.new("RGB", (100, 100), (240, 20, 30)).save(app.MEDIA / "logo.png")
subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x240:r=25", "-t", "0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(app.MEDIA / "black.mp4")], check=True)
app.init_db()
app.init_scene_db(app.connect)
with app.connect() as db:
    db.execute("INSERT INTO media(name,file,bytes,kind,created) VALUES('Logo','logo.png',100,'image',0)")
    db.execute("INSERT INTO media(name,file,bytes,kind,created) VALUES('Black','black.mp4',100,'video',0)")
uvicorn.run(app.app, host="127.0.0.1", port=int(sys.argv[1]), log_level="error")
