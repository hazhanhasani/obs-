"""Run a short real FFmpeg compositing smoke test in GitHub Actions."""
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from scene import init_scene_db, save_scene, scene_command, scene_snapshot_command


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                     "FFmpeg and ffprobe are required for the integration smoke test")
class SceneFFmpegSmokeTests(unittest.TestCase):
    def test_preview_frame_matches_exact_overlay_geometry(self):
        """A saved 75% width layer must occupy the same pixels in live and draft."""
        with tempfile.TemporaryDirectory(prefix="scene-parity-") as temp:
            root=Path(temp)
            db_file=root/"scene.sqlite"
            def connect():
                db=sqlite3.connect(db_file)
                db.row_factory=sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY, mode TEXT, file TEXT, desired INTEGER)")
                db.execute("CREATE TABLE media (file TEXT PRIMARY KEY, kind TEXT)")
                db.execute("INSERT INTO channels(id,mode,desired) VALUES('main','test',0)")
                db.execute("INSERT INTO media(file,kind) VALUES('red-logo.png','image')")
            # Landscape image with transparency; intentional contain letterboxing.
            Image.new("RGBA",(300,120),(255,0,0,255)).save(root/"red-logo.png")
            init_scene_db(connect)
            layer=SimpleNamespace(layer_id="layer_red",media_file="red-logo.png",
                x=10,y=5,w=75,h=42,fit="contain",opacity=100,
                effect="none",start_sec=0,duration_sec=0,repeat_sec=0)
            save_scene(connect,"main",None,[layer],[])
            live=scene_command(connect,"main",None,root,"rtmp://example.com/live")
            preview=scene_command(connect,"main",None,root,"discard",
                scene_override={"media":[{**vars(layer),"kind":"image"}],
                                "text_layers":[]})
            self.assertEqual(live[live.index("-filter_complex")+1],
                             preview[preview.index("-filter_complex")+1])
            command=scene_snapshot_command(preview)
            result=subprocess.run(command,capture_output=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr[-1500:])
            self.assertTrue(result.stdout.startswith(bytes((255,216))))
            from io import BytesIO
            with Image.open(BytesIO(result.stdout)) as image:
                self.assertEqual(image.size,(1280,720))
                red=image.convert("RGB").getpixel((400,150))
                self.assertGreater(red[0],200)
                self.assertLess(red[1],80)
                self.assertLess(red[2],80)

    def test_animated_image_and_persian_text_encode(self):
        with tempfile.TemporaryDirectory(prefix="streamcore-ffmpeg-") as temp:
            root = Path(temp)
            db_file = root / "scene.sqlite"
            def connect():
                db = sqlite3.connect(db_file)
                db.row_factory = sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE media (file TEXT NOT NULL UNIQUE, kind TEXT)")
                db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY, mode TEXT, file TEXT, desired INTEGER)")
                db.execute("INSERT INTO channels(id,mode,desired) VALUES('main','test',0)")
                db.execute("INSERT INTO media(file,kind) VALUES('logo.png','image')")
            Image.new("RGBA", (120, 90), (255, 110, 30, 180)).save(root / "logo.png")
            init_scene_db(connect)
            media_layer = SimpleNamespace(
                layer_id="overlay_logo", media_file="logo.png",
                x=5, y=5, w=20, h=20, fit="contain", opacity=90,
                effect="slide-right", start_sec=0, duration_sec=0, repeat_sec=0,
            )
            text_layer = SimpleNamespace(
                layer_id="text_welcome", text="سلام به StreamCore",
                x=22, y=55, w=56, h=20, font_size=43,
                color="#ffffff", background="transparent",
                align="center", outline=2, opacity=90,
                effect="fade", start_sec=0, duration_sec=0, repeat_sec=0,
            )
            save_scene(connect, "main", None, [media_layer], [text_layer])
            with patch.dict(os.environ, {
                "SCENE_ENCODER_PRESET": "ultrafast",
                "SCENE_ENCODER_THREADS": "2",
                "SCENE_VIDEO_BITRATE_KBPS": "2100",
            }):
                cmd = scene_command(
                    connect, "main", None, root,
                    "rtmp://127.0.0.1:1/not-used", root / "text_cache"
                )
            self.assertEqual(cmd[-3:-1], ["-f", "flv"])
            # Never connect to an RTMP server: encode just 0.5s to /dev/null.
            cmd = cmd[:-3] + ["-t", "0.5", "-f", "null", "-"]
            finished = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            self.assertEqual(finished.returncode, 0, finished.stderr[-3000:])
            self.assertIn("-filter_complex_threads", cmd)
            self.assertEqual(len(list((root / "text_cache").glob("*.png"))), 1)


if __name__ == "__main__":
    unittest.main()
