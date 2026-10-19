import base64
import json
import sqlite3
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
from destinations import DestinationSupervisor, encryptor, init_table, validate_server

class DestinationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dbfile = Path(self.temp.name) / "test.sqlite"
        self.data = Path(self.temp.name)
        self.status = lambda channel: {"running": channel == "main"}
        def connect():
            db = sqlite3.connect(self.dbfile)
            db.row_factory = sqlite3.Row
            return db
        self.connect = connect
        with connect() as db:
            db.execute("CREATE TABLE channels (id TEXT PRIMARY KEY)")
            db.execute("INSERT INTO channels(id) VALUES ('main')")
        init_table(connect)
        self.manager = DestinationSupervisor(connect, "x"*64, self.status, self.data)

    def tearDown(self):
        self.temp.cleanup()


    def test_live_process_without_progress_is_not_sending(self):
        proc = SimpleNamespace(pid=123, stdout=None, poll=lambda: None)
        self.manager.processes['dest'] = proc
        self.assertFalse(self.manager.status('dest')['sending'])

    def test_stalled_relay_is_stopped_without_stopping_channel(self):
        ident = self.manager.create('main', 'telegram', 'Test',
                                    'rtmps://example.com/live', 'secret', True)
        proc = SimpleNamespace(pid=123, stdout=None, poll=lambda: None)
        self.manager.processes[ident] = proc
        self.manager.tracker.clock = lambda: 0
        self.manager.tracker.attach(ident, proc)
        self.manager.tracker.clock = lambda: 60
        with patch.object(self.manager, 'stop') as stop:
            self.manager.reconcile()
        stop.assert_called_once_with(ident)
        self.assertGreater(self.manager.retry_after[ident], 0)

    def test_relay_reports_only_sanitized_progress(self):
        proc = SimpleNamespace(pid=123, stdout=None, poll=lambda: None)
        self.manager.processes['dest'] = proc
        self.manager.tracker.attach('dest', proc)
        self.manager.tracker.record('dest', 123, {'frame': '100', 'speed': '1x',
                                                 'url': 'SECRET'})
        state = self.manager.status('dest')
        self.assertTrue(state['sending'])
        self.assertNotIn('SECRET', json.dumps(state))

    def test_relay_bounds_network_waits_and_emits_progress(self):
        row = {'server_url': 'rtmps://example.com/live', 'channel_id': 'main',
               'encrypted_key': self.manager.crypt.encrypt(b'secret').decode()}
        cmd = self.manager.command(row)
        self.assertEqual(cmd.count('-rw_timeout'), 2)
        self.assertEqual(cmd[cmd.index('-progress') + 1], 'pipe:1')

    def test_server_validation(self):
        self.assertEqual(validate_server("rtmps://example.com/live/"), "rtmps://example.com/live")
        for url in [
            "http://example.com/live", "rtmp://localhost/live",
            "rtmp://127.0.0.1/live", "rtmps://192.168.1.4/live",
            "rtmps://example.com/live?key=x", "rtmp://u:p@example.com/live",
            "rtmp://example.com/live#password",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_server(url)

    def test_encrypt_and_redact(self):
        ident = self.manager.create("main", "telegram", "Main Telegram",
                                    "rtmps://example.com/live", "THIS_IS_A_SECRET", False)
        with self.connect() as db:
            row = dict(db.execute("SELECT * FROM stream_destinations WHERE id=?", (ident,)).fetchone())
            self.assertNotIn("THIS_IS_A_SECRET", str(row))
        public = self.manager.public_rows()[0]
        self.assertNotIn("stream_key", json.dumps(public))
        self.assertNotIn("encrypted_key", json.dumps(public))
        self.assertNotIn("THIS_IS_A_SECRET", json.dumps(public))
        self.assertEqual(public["server_host"], "example.com")
        command = self.manager.command(row)
        self.assertIn("-c:v", command)
        self.assertIn("copy", command)
        self.assertEqual(command[-1], "rtmps://example.com/live/THIS_IS_A_SECRET")
        self.manager.update(ident, stream_key="ROTATED_KEY", enabled=True)
        self.assertNotIn("THIS_IS_A_SECRET", str(self.manager.public_rows()))
        with self.connect() as db:
            row = dict(db.execute("SELECT * FROM stream_destinations WHERE id=?", (ident,)).fetchone())
        self.assertEqual(self.manager.command(row)[-1], "rtmps://example.com/live/ROTATED_KEY")
        self.manager.delete(ident)
        self.assertEqual(self.manager.public_rows(), [])

    def test_missing_channel_and_invalid_platform(self):
        with self.assertRaises(LookupError):
            self.manager.create("missing", "telegram", "Test", "rtmps://example.com/live", "abc")
        with self.assertRaises(ValueError):
            self.manager.create("main", "invalid", "Test", "rtmps://example.com/live", "abc")

if __name__ == "__main__":
    unittest.main()
