"""No downgrades, prereleases, malformed tags or untrusted release fields."""
import importlib.util
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
from contextlib import redirect_stderr
from io import StringIO
from urllib.error import HTTPError
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "release-check.py"
spec = importlib.util.spec_from_file_location("streamcore_release_check", MODULE)
release_checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_checker)


class ReleaseCheckTests(unittest.TestCase):
    def test_new_stable_upgrade(self):
        self.assertEqual(release_checker.new_release("0.6.2-alpha", {
            "tag_name": "v0.7.0", "draft": False, "prerelease": False
        }), "v0.7.0")
        self.assertEqual(release_checker.new_release("v0.7.0-alpha", {
            "tag_name": "v0.7.0"
        }), "v0.7.0")

    def test_refuses_downgrade_equal_and_prerelease(self):
        self.assertIsNone(release_checker.new_release("v1.2.0", {"tag_name":"v1.2.0"}))
        self.assertIsNone(release_checker.new_release("v1.2.0", {"tag_name":"v1.1.9"}))
        self.assertIsNone(release_checker.new_release("v1.2.0", {
            "tag_name":"v1.3.0","prerelease":True
        }))
        self.assertIsNone(release_checker.new_release("v1.2.0", {
            "tag_name":"v1.3.0","draft":True
        }))

    def test_refuses_malformed_and_injected_tags(self):
        for value in ["main","latest","v1.3.0-rc1","v1.0.0;touch /tmp/exploit",
                      "v01.2.3","v1.2.3\n","v1.2.3/../../.."]:
            with self.subTest(value=value):
                self.assertIsNone(release_checker.new_release("v1.0.0",{"tag_name":value}))
        self.assertIsNone(release_checker.new_release("not-a-version",{"tag_name":"v1.2.3"}))


    def test_no_published_release_is_expected_not_network_failure(self):
        with TemporaryDirectory() as path:
            manifest = Path(path) / "VERSION"
            manifest.write_text("0.7.0-alpha", encoding="utf-8")
            stderr = StringIO()
            with patch("sys.argv", ["release-check.py", str(manifest)]):
                with patch.object(release_checker.urllib.request, "urlopen",
                                  side_effect=HTTPError("https://api.github.com", 404, "Not Found", None, None)):
                    with redirect_stderr(stderr):
                        self.assertEqual(release_checker.main(), 1)
            self.assertIn("No published GitHub Release yet", stderr.getvalue())

    def test_server_error_is_distinguished_from_empty_release_list(self):
        with TemporaryDirectory() as path:
            manifest = Path(path) / "VERSION"
            manifest.write_text("0.7.0-alpha", encoding="utf-8")
            stderr = StringIO()
            with patch("sys.argv", ["release-check.py", str(manifest)]):
                with patch.object(release_checker.urllib.request, "urlopen",
                                  side_effect=HTTPError("https://api.github.com", 503, "Unavailable", None, None)):
                    with redirect_stderr(stderr):
                        self.assertEqual(release_checker.main(), 2)
            self.assertIn("GitHub Release API error: HTTP 503", stderr.getvalue())


if __name__=="__main__":
    unittest.main()
