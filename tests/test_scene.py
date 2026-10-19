"""Scene layout persistence, FFmpeg composition, image upload and security tests."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from test_dashboard import streamcore
from fastapi.testclient import TestClient
from scene import (init_scene_db, save_scene, scene_for, scene_command,
                   is_scene_media_used, remove_scene)
from PIL import Image
from io import BytesIO
from unittest.mock import patch


class SceneUnitTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="scene-unit-")
        self.root=Path(self.temp.name)
        self.dbfile=self.root/"scene.sqlite"
        def connect():
            db=sqlite3.connect(self.dbfile,timeout=5)
            db.row_factory=sqlite3.Row
            return db
        self.connect=connect
        with connect() as db:
            db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY, mode TEXT, file TEXT, desired INTEGER)")
            db.execute("CREATE TABLE media (file TEXT PRIMARY KEY,kind TEXT)")
            db.execute("INSERT INTO channels(id,mode,desired) VALUES('main','test',0)")
            for file,kind in [("background.mp4","video"),("corner.mp4","video"),("logo.png","image")]:
                db.execute("INSERT INTO media(file,kind) VALUES(?,?)",(file,kind))
                (self.root/file).write_bytes(b"fake")
        init_scene_db(connect)
        # Existing schemas default to 'video'; this unit fixture already declares kind.
        self.layers=[SimpleNamespace(layer_id="layer_first",media_file="corner.mp4",x=3,y=5,
                                    w=35,h=40,fit="cover",opacity=90),
                     SimpleNamespace(layer_id="layer_second",media_file="logo.png",x=70,y=5,
                                    w=20,h=20,fit="contain",opacity=85)]

    def tearDown(self):
        self.temp.cleanup()

    def test_persist_and_compose_multiple_streams_and_image(self):
        save_scene(self.connect,"main","background.mp4",self.layers)
        config=scene_for(self.connect,"main")
        self.assertEqual(config["mode"],"scene")
        self.assertEqual(len(config["layers"]),2)
        self.assertTrue(is_scene_media_used(self.connect,"logo.png"))
        with patch("scene._audio_present", return_value=False):
            cmd=scene_command(self.connect,"main","background.mp4",self.root,
                              "rtmp://mediamtx:1935/main")
        self.assertEqual(cmd.count("-stream_loop"),2)
        self.assertIn("-loop",cmd)
        self.assertIn("-filter_complex",cmd)
        graph=cmd[cmd.index("-filter_complex")+1]
        self.assertIn("overlay=",graph)
        self.assertEqual(graph.count("overlay="),2)
        self.assertIn("crop=",graph)
        self.assertIn("pad=",graph)
        self.assertIn("[vout]",cmd)
        self.assertEqual(cmd[-1],"rtmp://mediamtx:1935/main")
        remove_scene(self.connect,"main")
        self.assertFalse(is_scene_media_used(self.connect,"logo.png"))

    def test_reject_duplicate_out_of_bounds_and_too_many_videos(self):
        bad=[SimpleNamespace(**vars(self.layers[0]))]
        # Off-frame x=70 is valid now. Reject only the hardened safety range.
        bad[0].x=220
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main","background.mp4",bad)
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main",None,self.layers+self.layers)
        # Maximum three video overlays, regardless of distinct video filenames.
        five=[SimpleNamespace(**{**vars(self.layers[0]),"layer_id":"layer_"+str(i)})
              for i in range(4)]
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main",None,five)

    def test_refuse_unknown_media_and_path_traversal(self):
        invalid=SimpleNamespace(**{**vars(self.layers[0]),"media_file":"../secret.mp4"})
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main",None,[invalid])
        with self.assertRaises(ValueError):
            save_scene(self.connect,"main","logo.png",[])
        with self.assertRaises(LookupError):
            save_scene(self.connect,"notfound",None,[])


class SceneHttpTests(unittest.TestCase):
    @staticmethod
    def authorized(client):
        result=client.post("/api/login",json={
            "username":"testadmin","password":"test-password-12-chars-or-longer"
        })
        assert result.status_code==200, result.text
        return {"X-CSRF-Token":result.json()["csrf"]}

    def test_image_upload_scene_save_and_poster(self):
        with TestClient(streamcore.app) as client:
            headers=self.authorized(client)
            image=Image.new("RGBA",(90,65),(240,120,20,150))
            buffer=BytesIO();image.save(buffer,"PNG")
            result=client.post("/api/media/raw?filename=logo.png",content=buffer.getvalue(),
                               headers={**headers,"content-type":"application/octet-stream"})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["kind"],"image")
            media=client.get("/api/overview").json()["media"]
            record=next(m for m in media if m["file"]!=None and m["kind"]=="image"
                        and m["name"]=="logo.png")
            self.assertEqual(client.get("/api/media/poster/"+str(record["id"])).status_code,200)
            self.assertEqual(client.get("/api/media/poster/"+str(record["id"])).headers["content-type"],"image/png")
            layer={"layer_id":"logo_main","media_file":record["file"],
                   "x":65,"y":5,"w":20,"h":22,"fit":"contain","opacity":90}
            self.assertEqual(client.put("/api/channels/main/scene",json={"layers":[layer]}).status_code,403)
            scene=client.put("/api/channels/main/scene",headers=headers,json={"layers":[layer]})
            self.assertEqual(scene.status_code,200,scene.text)
            self.assertEqual(scene.json()["scene"]["mode"],"scene")
            self.assertEqual(client.delete("/api/media/"+str(record["id"]),headers=headers).status_code,409)
            self.assertEqual(client.put("/api/channels/main/scene",headers=headers,json={"layers":[]}).status_code,200)
            self.assertEqual(client.delete("/api/media/"+str(record["id"]),headers=headers).status_code,200)

    def test_reject_fake_png(self):
        with TestClient(streamcore.app) as client:
            headers=self.authorized(client)
            result=client.post("/api/media/raw?filename=fake.png",content=b"not png",
                               headers={**headers,"content-type":"application/octet-stream"})
            self.assertEqual(result.status_code,422,result.text)
            before=client.get("/api/overview").json()["media"]
            result=client.post("/api/media/raw?filename=bad.svg",content=b"<svg/>",
                               headers={**headers,"content-type":"application/octet-stream"})
            self.assertEqual(result.status_code,422)
            self.assertEqual(client.get("/api/overview").json()["media"],before)


if __name__=="__main__":
    unittest.main()
