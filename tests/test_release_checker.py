"""No downgrades, prereleases, malformed tags or untrusted release fields."""
import importlib.util
import unittest
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


if __name__=="__main__":
    unittest.main()
