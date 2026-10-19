"""Bounds behavior modeled after OBS SCENE_INNER / SCENE_OUTER / STRETCH.

The canonical transform is shared with FFmpeg. Browser uses the equivalent
object-fit:contain/cover/fill CSS modes for the image in the same 16:9 box.
"""
import unittest
from scene_geometry import LayerBounds, layer_bounds, ffmpeg_sizing
from text_effects import effect_filters


class SceneGeometryTests(unittest.TestCase):
    def test_pixel_bounding_box_matches_editor_percentages(self):
        bounds = layer_bounds(dict(x=10, y=10, w=90, h=90))
        self.assertEqual(bounds, LayerBounds(x=128, y=72, width=1152, height=648))

    def test_even_dimensions_and_no_overflow(self):
        bounds = layer_bounds(dict(x=12, y=5, w=55, h=37))
        self.assertEqual(bounds.width % 2, 0)
        self.assertEqual(bounds.height % 2, 0)
        self.assertLessEqual(bounds.x + bounds.width, 1280)
        self.assertLessEqual(bounds.y + bounds.height, 720)

    def test_rejects_off_canvas_and_invalid_extent(self):
        for item in (dict(x=90,y=0,w=20,h=30),
                     dict(x=0,y=95,w=30,h=10),
                     dict(x=0,y=0,w=0,h=20),
                     dict(x=-1,y=0,w=5,h=5)):
            with self.subTest(item=item), self.assertRaises(ValueError):
                layer_bounds(item)

    def test_bounds_fit_modes_share_exact_same_pixel_box(self):
        bounds = LayerBounds(128, 72, 1152, 648)
        self.assertIn("force_original_aspect_ratio=decrease",ffmpeg_sizing(bounds,"contain"))
        self.assertIn("force_original_aspect_ratio=increase",ffmpeg_sizing(bounds,"cover"))
        self.assertEqual(ffmpeg_sizing(bounds,"stretch"),"scale=1152:648,format=rgba")
        with self.assertRaises(ValueError):
            ffmpeg_sizing(bounds,"unknown")

    def test_overlay_has_expected_position_with_each_bounds_fit(self):
        for fit in ("contain","cover","stretch"):
            with self.subTest(fit=fit):
                layer = dict(x=10, y=10, w=90, h=90, fit=fit,
                             opacity=100,effect="none",start_sec=0,
                             duration_sec=0,repeat_sec=0)
                graph = ";".join(effect_filters(layer,1,"v0",1))
                self.assertIn("overlay=x='128':y=72",graph)
                self.assertIn("scale=1152:648",graph)


if __name__=="__main__":
    unittest.main()
