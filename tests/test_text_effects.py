"""Regression tests for Persian text, animation and scheduled overlay rendering."""
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi.testclient import TestClient
from PIL import Image
from test_dashboard import streamcore
from text_effects import check_timing, effect_filters, render_text_layer
from scene import scene_command, scene_for


class TextEffectsTests(unittest.TestCase):
    def test_timing_validation(self):
        for effect in ("none", "fade", "slide-left", "slide-right", "blink"):
            check_timing(effect, 3, 8, 16)
        for args in [("unknown", 0, 0, 0), ("none", -1, 0, 0),
                     ("fade", 0, 5, 3), ("blink", 0, 0, 8)]:
            with self.assertRaises(ValueError):
                check_timing(*args)

    def test_filter_graph_has_safe_timing_without_raw_text(self):
        layer = dict(x=8, y=12, w=40, h=26, opacity=86, fit="contain",
                     text="سلام به StreamCore; [0:v] movie=secret",
                     effect="slide-right", start_sec=2, duration_sec=8, repeat_sec=15)
        output = ";".join(effect_filters(layer, 1, "v0", 1))
        self.assertIn("overlay=", output)
        self.assertIn("mod(t-2", output)
        self.assertNotIn("سلام", output)
        self.assertNotIn("movie=secret", output)

    def test_persian_and_mixed_latin_rasterized(self):
        with TemporaryDirectory() as temp:
            for i, text in enumerate(("سلام به StreamCore", "پخش زنده", "English text")):
                source = dict(text=text, x=5, y=5, w=60, h=24,
                              color="#ffffff", background="#142131",
                              font_size=44, align="right", outline=2)
                file = Path(temp) / f"layer_{i}.png"
                self.assertEqual(render_text_layer(source, file), str(file))
                with Image.open(file) as img:
                    self.assertEqual(img.mode, "RGBA")
                    self.assertGreater(img.getbbox()[2], 0)
            with self.assertRaises(ValueError):
                render_text_layer({**source, "text":"X", "color":"bad"}, Path(temp)/"unsafe.png")

    def test_authentication_text_persistence_and_command(self):
        with TestClient(streamcore.app) as client:
            auth=client.post("/api/login",json={
                "username":"testadmin", "password":"test-password-12-chars-or-longer"
            })
            self.assertEqual(auth.status_code,200,auth.text)
            headers={"X-CSRF-Token":auth.json()["csrf"]}
            body={"base_file":None,"layers":[],"text_layers":[{
                "layer_id":"text_welcome","text":"به StreamCore خوش آمدید",
                "x":10,"y":20,"w":70,"h":24,"color":"#ffffff",
                "background":"transparent","font_size":44,"align":"right",
                "outline":2,"opacity":95,"effect":"fade",
                "start_sec":1,"duration_sec":5,"repeat_sec":0
            }]}
            self.assertEqual(client.put("/api/channels/main/scene",json=body).status_code,403)
            response=client.put("/api/channels/main/scene",json=body,headers=headers)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()["scene"]["text_layers"][0]["text"],body["text_layers"][0]["text"])
            with TemporaryDirectory() as tmp:
                command=scene_command(streamcore.connect,"main",None,streamcore.MEDIA,
                        "rtmp://mediamtx:1935/main",Path(tmp))
                self.assertIn("-filter_complex",command)
                graph=command[command.index("-filter_complex")+1]
                self.assertIn("fade=t=in:st=1",graph)
                self.assertNotIn("StreamCore",graph)
                self.assertEqual(len(list(Path(tmp).glob("*.png"))),1)
            body["text_layers"][0].update({"duration_sec":8,"repeat_sec":2})
            bad=client.put("/api/channels/main/scene",json=body,headers=headers)
            self.assertEqual(bad.status_code,422)
            # Legacy clients that omit text_layers do not erase existing texts.
            keep=client.put("/api/channels/main/scene",json={"layers":[]},headers=headers)
            self.assertEqual(keep.status_code,200)
            self.assertEqual(len(client.get("/api/channels/main/scene").json()["text_layers"]),1)
            self.assertEqual(client.put("/api/channels/main/scene",json={
                "layers":[],"text_layers":[]},headers=headers).status_code,200)


if __name__ == "__main__":
    unittest.main()
