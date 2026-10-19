#!/usr/bin/env python3
"""Read GitHub Releases/latest and return a validated newer stable tag only."""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RELEASE_URL = "https://api.github.com/repos/hazhanhasani/obs-/releases/latest"
STABLE = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
INSTALLED = re.compile(r"^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-alpha|-beta|-rc[0-9]+)?$")


def new_release(installed: str, release: dict) -> str | None:
    tag = release.get("tag_name", "")
    match = STABLE.fullmatch(tag) if isinstance(tag, str) else None
    previous = INSTALLED.fullmatch(installed)
    if not match or not previous or release.get("draft") or release.get("prerelease"):
        return None
    current = tuple(int(v) for v in previous.group(1, 2, 3))
    incoming = tuple(int(v) for v in match.groups())
    if incoming > current or (incoming == current and previous.group(4)):
        return tag
    return None


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: release-check.py /path/to/VERSION", file=sys.stderr)
        return 2
    installed = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
    request = urllib.request.Request(RELEASE_URL, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "StreamCore-Updater",
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            release = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print("No published GitHub Release yet (HTTP 404).", file=sys.stderr)
            return 1
        print(f"GitHub Release API error: HTTP {error.code}", file=sys.stderr)
        return 2
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"Cannot verify GitHub Releases: {error}", file=sys.stderr)
        return 2
    tag = new_release(installed, release)
    if not tag:
        return 1
    print(tag)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
