"""Regression: output must be portrait when a 9:16 scene is selected."""
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scene import init_scene_db, save_scene, scene_for, scene_command
from scene_geometry import canvas_size, layer_bounds
from text_effects import render_text_layer
from PIL import Image


class PortraitCanvasTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="portrait-scene-")
        self.root = Path(self.temp.name)
        self.database = self.root / "test.sqlite"
        def connect():
            db = sqlite3.connect(self.database)
            db.row_factory = sqlite3.Row
            return db
        self.connect = connect
        with connect() as db:
            db.execute("CREATE TABLE media(file TEXT PRIMARY KEY,kind TEXT)")
            db.execute("CREATE TABLE channels(id TEXT PRIMARY KEY,mode TEXT,file TEXT,desired INTEGER)")
            db.execute("INSERT INTO channels VALUES('main','test',NULL,0)")
        init_scene_db(connect)

    def tearDown(self):
        self.temp.cleanup()

    def test_previous_channels_stay_landscape(self):
        old = scene_for(self.connect, "main")
        self.assertEqual(old["canvas_preset"], "landscape")
        self.assertEqual((old["canvas_width"], old["canvas_height"]), (1280,720))

    def test_portrait_persists_without_touching_old_layers(self):
        save_scene(self.connect, "main", None, [], canvas_preset="portrait")
        scene = scene_for(self.connect, "main")
        self.assertEqual(scene["canvas_preset"], "portrait")
        self.assertEqual((scene["canvas_width"],scene["canvas_height"]), (720,1280))
        # Legacy callers omit the new optional field and preserve the setting.
        save_scene(self.connect, "main", None, [])
        self.assertEqual(scene_for(self.connect,"main")["canvas_preset"],"portrait")

    def test_ffmpeg_graph_and_text_raster_share_portrait_dimensions(self):
        save_scene(self.connect, "main", None, [], canvas_preset="portrait")
        with patch.dict(os.environ, {"SCENE_ENCODER_PRESET":"ultrafast"}):
            command=scene_command(self.connect,"main",None,self.root,
                                  "rtmp://mediamtx:1935/main")
        self.assertIn("testsrc2=size=720x1280:rate=25",command)
        graph=command[command.index("-filter_complex")+1]
        self.assertIn("scale=720:1280",graph)
        self.assertIn("pad=720:1280",graph)
        box=layer_bounds(dict(x=10,y=10,w=90,h=90),720,1280)
        self.assertEqual((box.x,box.y,box.width,box.height),(72,128,648,1152))

    def test_fullhd_has_exact_output_pixels_and_is_opt_in(self):
        save_scene(self.connect, "main", None, [], canvas_preset="portrait_fullhd")
        frame=scene_for(self.connect, "main")
        self.assertEqual((frame["canvas_width"],frame["canvas_height"]),(1080,1920))
        command=scene_command(self.connect,"main",None,self.root,"rtmp://mediamtx:1935/main")
        self.assertIn("testsrc2=size=1080x1920:rate=25",command)

    def test_invalid_presets_cannot_be_saved(self):
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main",None,[],canvas_preset="../../etc")
        self.assertEqual(scene_for(self.connect,"main")["canvas_preset"],"landscape")

    def test_remove_scene_removes_custom_canvas_settings(self):
        from scene import remove_scene
        save_scene(self.connect,"main",None,[],canvas_preset="portrait")
        remove_scene(self.connect,"main")
        self.assertEqual(scene_for(self.connect,"main")["canvas_preset"],"landscape")

    def test_portrait_text_uses_portrait_layer_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp)/"caption.png"
            layer=dict(x=10,y=10,w=60,h=15,text="خبر فوری",font_size=32,
                       color="#ffffff",background="transparent",align="right",
                       outline=1)
            render_text_layer(layer,file,720,1280)
            with Image.open(file) as image:
                self.assertEqual(image.size,(432,192))



class PortraitSceneAPITests(unittest.TestCase):
    def test_authenticated_portrait_scene_persists_and_invalid_preset_rejected(self):
        from fastapi.testclient import TestClient
        from test_dashboard import streamcore
        with TestClient(streamcore.app) as client:
            auth=client.post("/api/login",json={
                "username":"testadmin",
                "password":"test-password-12-chars-or-longer"
            })
            self.assertEqual(auth.status_code,200,auth.text)
            headers={"X-CSRF-Token":auth.json()["csrf"]}
            result=client.put("/api/channels/main/scene",headers=headers,json={
                "base_file":None,"layers":[],"text_layers":[],
                "canvas_preset":"portrait"
            })
            self.assertEqual(result.status_code,200,result.text)
            scene=client.get("/api/channels/main/scene").json()
            self.assertEqual(scene["canvas_preset"],"portrait")
            self.assertEqual((scene["canvas_width"],scene["canvas_height"]),(720,1280))
            invalid=client.put("/api/channels/main/scene",headers=headers,json={
                "base_file":None,"layers":[],"canvas_preset":"480p;bad"
            })
            self.assertEqual(invalid.status_code,422)
            self.assertEqual(client.get("/api/channels/main/scene").json()["canvas_preset"],"portrait")

    def test_portrait_test_pattern_has_correct_dimensions(self):
        import shutil
        if not shutil.which("ffmpeg"):
            self.skipTest("FFmpeg executable is required")
        from fastapi.testclient import TestClient
        from test_dashboard import streamcore
        with TestClient(streamcore.app) as client:
            auth=client.post("/api/login",json={
                "username":"testadmin",
                "password":"test-password-12-chars-or-longer"
            })
            self.assertEqual(auth.status_code,200)
            response=client.get("/api/scene/test-pattern?preset=portrait")
            self.assertEqual(response.status_code,200,response.text[:160])
            from io import BytesIO
            with Image.open(BytesIO(response.content)) as image:
                self.assertEqual(image.size,(720,1280))
            bad=client.get("/api/scene/test-pattern?preset=../bad")
            self.assertEqual(bad.status_code,422)


if __name__ == "__main__":
    unittest.main()
