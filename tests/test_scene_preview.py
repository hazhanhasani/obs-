"""Ensure true FFmpeg preview matches scene graph and never restarts live publishers."""
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from fastapi.testclient import TestClient
from test_dashboard import streamcore
from scene import init_scene_db, save_scene, scene_command, scene_snapshot_command


class ScenePreviewEndpointTests(unittest.TestCase):
    @staticmethod
    def logged_in(client):
        result=client.post("/api/login",json={
            "username":"testadmin","password":"test-password-12-chars-or-longer"
        })
        assert result.status_code==200,result.text
        return {"X-CSRF-Token":result.json()["csrf"]}

    def test_authenticated_preview_does_not_save_or_stop_stream(self):
        with TestClient(streamcore.app) as client:
            payload={"base_file":None,"layers":[],"text_layers":[]}
            url="/api/channels/main/scene/preview"
            self.assertEqual(client.post(url,json=payload).status_code,401)
            headers=self.logged_in(client)
            self.assertEqual(client.post(url,json=payload).status_code,403)
            before=client.get("/api/channels/main/scene").json()
            with patch.object(streamcore,"render_scene_snapshot",
                              return_value=bytes((255,216))+b"pretend jpeg") as snapshot:
                with patch.object(streamcore.controller,"stop") as stop:
                    with patch.object(streamcore.controller,"reconcile") as reconcile:
                        result=client.post(url,headers=headers,json=payload)
                        self.assertEqual(result.status_code,200,result.text)
                        self.assertEqual(result.headers["content-type"],"image/jpeg")
                        self.assertEqual(result.headers["cache-control"],"no-store")
                        snapshot.assert_called_once()
                        stop.assert_not_called()
                        reconcile.assert_not_called()
            after=client.get("/api/channels/main/scene").json()
            self.assertEqual(before,after)

    def test_invalid_draft_does_not_encode_or_update(self):
        with TestClient(streamcore.app) as client:
            headers=self.logged_in(client)
            payload={"base_file":None,"layers":[{
                "layer_id":"layer_nonexistent", "media_file":"not-uploaded.png",
                "x":3,"y":5,"w":20,"h":20,"fit":"contain","opacity":100
            }],"text_layers":[]}
            with patch.object(streamcore,"render_scene_snapshot") as renderer:
                response=client.post("/api/channels/main/scene/preview",
                                     headers=headers,json=payload)
                self.assertEqual(response.status_code,422,response.text)
                renderer.assert_not_called()
            self.assertEqual(client.post("/api/channels/unknown/scene/preview",
                             headers=headers,json={"layers":[],"text_layers":[]}).status_code,404)

    def test_preview_layer_changes_are_not_committed(self):
        with TestClient(streamcore.app) as client:
            headers=self.logged_in(client)
            source=Image.new("RGBA",(120,80),(250,120,20,220))
            buf=io.BytesIO();source.save(buf,format="PNG")
            result=client.post("/api/media/raw?filename=parity.png",headers={
                **headers,"Content-Type":"application/octet-stream"
            },content=buf.getvalue())
            self.assertEqual(result.status_code,200,result.text)
            media=next(item for item in client.get("/api/overview").json()["media"]
                       if item["name"]=="parity.png")
            payload={"layers":[{
                "layer_id":"layer_parity","media_file":media["file"],
                "x":10,"y":5,"w":75,"h":42,"fit":"contain","opacity":100
            }],"text_layers":[]}
            before=client.get("/api/channels/main/scene").json()
            with patch.object(streamcore,"render_scene_snapshot",
                              return_value=bytes((255,216))+b"jpeg"):
                response=client.post("/api/channels/main/scene/preview",
                                     headers=headers,json=payload)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(client.get("/api/channels/main/scene").json(),before)
            self.assertEqual(client.delete("/api/media/"+str(media["id"]),headers=headers).status_code,200)


class FFmpegParityCommandTests(unittest.TestCase):
    def test_live_and_draft_use_the_same_overlay_filters(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            filename=base/"scene.sqlite"
            def connect():
                db=sqlite3.connect(filename)
                db.row_factory=sqlite3.Row
                return db
            with connect() as db:
                db.execute("CREATE TABLE channels(id TEXT PRIMARY KEY, mode TEXT, file TEXT, desired INTEGER)")
                db.execute("CREATE TABLE media(file TEXT PRIMARY KEY,kind TEXT)")
                db.execute("INSERT INTO channels(id,mode,desired) VALUES('main','test',0)")
                db.execute("INSERT INTO media(file,kind) VALUES('overlay.png','image')")
            init_scene_db(connect)
            Image.new("RGBA",(300,120),(25,180,100,150)).save(base/"overlay.png")
            media=SimpleNamespace(layer_id="layer_alpha",media_file="overlay.png",
                x=10,y=10,w=75,h=42,fit="contain",opacity=90,
                effect="none",start_sec=0,duration_sec=0,repeat_sec=0)
            save_scene(connect,"main",None,[media],[])
            live=scene_command(connect,"main",None,base,"rtmp://mediamtx:1935/main")
            preview=scene_command(connect,"main",None,base,"ignored",
                scene_override={"media":[{**vars(media),"kind":"image"}],"text_layers":[]})
            self.assertEqual(live[live.index("-filter_complex")+1],
                             preview[preview.index("-filter_complex")+1])
            snapshot=scene_snapshot_command(preview)
            self.assertNotIn("rtmp://mediamtx:1935/main",snapshot)
            self.assertNotIn("ignored",snapshot)
            self.assertEqual(snapshot[-1],"pipe:1")
            self.assertEqual(snapshot[snapshot.index("-map")+1],"[vout]")
            self.assertEqual(snapshot[snapshot.index("-frames:v")+1],"1")


if __name__=="__main__":
    unittest.main()
