"""Real FFmpeg frame must clip an offscreen layer without resizing it."""
import io
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image
from scene import init_scene_db, save_scene, scene_command, scene_snapshot_command


@unittest.skipUnless(shutil.which("ffmpeg"), "requires FFmpeg")
class OffCanvasFFmpegTests(unittest.TestCase):
    def test_partial_offscreen_overlay_is_cropped_by_output_frame_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "scene.sqlite3"
            (root / "logo.png").parent.mkdir(exist_ok=True)
            Image.new("RGBA", (96, 96), (240, 20, 30, 255)).save(root / "logo.png")
            def connect():
                db = sqlite3.connect(database)
                db.row_factory = sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY,mode TEXT,file TEXT,desired INT)")
                db.execute("CREATE TABLE media (file TEXT PRIMARY KEY,kind TEXT)")
                db.execute("INSERT INTO channels VALUES('main','scene',NULL,0)")
                db.execute("INSERT INTO media VALUES('logo.png','image')")
            init_scene_db(connect)
            layer = SimpleNamespace(
                layer_id="layer_logo", media_file="logo.png",
                x=-10, y=40, w=40, h=20, fit="stretch", opacity=100
            )
            save_scene(connect, "main", None, [layer])
            cmd = scene_command(connect, "main", None, root, "unused-rtmp-url")
            graph = cmd[cmd.index("-filter_complex") + 1]
            self.assertIn("overlay=x='-128':y=288", graph)
            self.assertIn("scale=512:144", graph)
            frame = scene_snapshot_command(cmd)
            result = subprocess.run(
                frame, stdin=subprocess.DEVNULL,
                capture_output=True, timeout=25, check=False
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace")[-1500:])
            self.assertTrue(result.stdout.startswith(bytes((255,216))))
            with Image.open(io.BytesIO(result.stdout)) as jpg:
                self.assertEqual(jpg.size, (1280, 720))
                visible = jpg.convert("RGB").getpixel((80, 340))
                self.assertGreater(visible[0], 160)
                self.assertLess(visible[1], 100)
                self.assertLess(visible[2], 110)

    def test_completely_offscreen_layer_remains_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "logo.png"
            Image.new("RGBA", (80, 80), (255, 0, 0, 255)).save(image)
            database = root / "scene.sqlite3"
            def connect():
                db=sqlite3.connect(database)
                db.row_factory=sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY,mode TEXT,file TEXT,desired INT)")
                db.execute("CREATE TABLE media (file TEXT PRIMARY KEY,kind TEXT)")
                db.execute("INSERT INTO channels VALUES('main','scene',NULL,0)")
                db.execute("INSERT INTO media VALUES('logo.png','image')")
            init_scene_db(connect)
            layer = SimpleNamespace(
                layer_id="layer_logo",media_file="logo.png",
                x=150,y=110,w=25,h=25,fit="contain",opacity=100
            )
            save_scene(connect,"main",None,[layer])
            cmd=scene_command(connect,"main",None,root,"unused")
            graph=cmd[cmd.index("-filter_complex")+1]
            self.assertIn("overlay=x='1920':y=792",graph)
