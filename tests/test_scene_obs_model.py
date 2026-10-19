"""OBS-style source metadata uses the same persisted scene and render order."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import test_scene
from scene import init_scene_db, save_scene, scene_for, scene_command

@pytest.fixture
def scene():
    unit = test_scene.SceneUnitTests()
    unit.setUp()
    try:
        yield unit
    finally:
        unit.tearDown()

def text_layer(**extra):
    return SimpleNamespace(layer_id="text_front", text="OBS", x=20, y=20, w=40, h=20,
        font_size=46, color="#ffffff", background="transparent", align="left", outline=0,
        opacity=100, effect="none", start_sec=0, duration_sec=0, repeat_sec=0, **extra)

def test_metadata_migration_is_idempotent_and_defaults_preserve_legacy(scene):
    save_scene(scene.connect, "main", None, scene.layers)
    init_scene_db(scene.connect)
    init_scene_db(scene.connect)
    stored = scene_for(scene.connect, "main")["layers"][0]
    assert stored["locked"] is False
    assert stored["visible"] is True
    assert stored["z_index"] is None
    assert stored["x"] == 3

def test_metadata_survives_sqlite_for_media_and_text(scene):
    scene.layers[0].locked = True
    scene.layers[0].visible = False
    scene.layers[0].z_index = 4
    text = text_layer(locked=True, visible=False, z_index=2)
    save_scene(scene.connect, "main", None, scene.layers, [text])
    result = scene_for(scene.connect, "main")
    for layer in [result["layers"][0], result["text_layers"][0]]:
        assert layer["locked"] is True
        assert layer["visible"] is False
    assert result["layers"][0]["z_index"] == 4
    assert result["text_layers"][0]["z_index"] == 2

def test_ffmpeg_shared_order_and_hidden_sources(scene):
    scene.layers[0].visible = False
    scene.layers[1].z_index = 4
    text = text_layer(visible=True, z_index=0)
    save_scene(scene.connect, "main", None, scene.layers, [text])
    with patch("scene.render_text_layer", return_value=str(scene.root / "text.png")):
        cmd = scene_command(scene.connect, "main", None, scene.root, "not-used.flv")
    assert str(scene.root / "corner.mp4") not in cmd
    assert cmd.index(str(scene.root / "text.png")) < cmd.index(str(scene.root / "logo.png"))
    graph = cmd[cmd.index("-filter_complex")+1]
    assert graph.count("overlay=") == 2

def test_cross_type_ids_are_rejected_before_writes(scene):
    text = text_layer()
    text.layer_id = scene.layers[0].layer_id
    with pytest.raises(ValueError, match="شناسه"):
        save_scene(scene.connect, "main", None, scene.layers, [text])
