"""Check that every lock installs on every platform it is meant for.

``pip install --require-hashes --no-deps --only-binary=:all: -r <lock>`` succeeds on
a platform when every requirement whose marker holds there has a wheel, on one of
the lock's indexes, whose tags the interpreter accepts and whose SHA-256 the lock
lists. That is what this checks, for each target below, against the live indexes
(nothing is downloaded but the index pages), so a lock can be verified for Windows
and Linux from a Mac. Needs ``packaging``.

    python verify_locks.py            # all locks
    python verify_locks.py mlx        # one lock
"""
from __future__ import annotations

import html
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from packaging import tags
from packaging.requirements import Requirement
from packaging.utils import InvalidWheelFilename, canonicalize_name, parse_wheel_filename
from packaging.version import Version

HERE = Path(__file__).resolve().parent
PY = (3, 12)


def _linux():
    return ["manylinux2014_x86_64", "linux_x86_64"] + [f"manylinux_2_{minor}_x86_64" for minor in range(35, 4, -1)]


def _env(sys_platform, machine, system, os_name):
    return {
        "implementation_name": "cpython", "implementation_version": "3.12.14", "os_name": os_name,
        "platform_machine": machine, "platform_python_implementation": "CPython", "platform_release": "",
        "platform_system": system, "platform_version": "", "python_full_version": "3.12.14",
        "python_version": "3.12", "sys_platform": sys_platform, "extra": "",
    }


TARGETS = {
    "darwin-arm64": (_env("darwin", "arm64", "Darwin", "posix"), list(tags.mac_platforms((14, 0), "arm64"))),
    "darwin-x64": (_env("darwin", "x86_64", "Darwin", "posix"), list(tags.mac_platforms((13, 0), "x86_64"))),
    "win32-x64": (_env("win32", "AMD64", "Windows", "nt"), ["win_amd64"]),
    "linux-x64": (_env("linux", "x86_64", "Linux", "posix"), _linux()),
}
LOCKS = {
    "mlx": ("requirements-mlx.lock", ["darwin-arm64"]),
    "torch-cpu": ("requirements-torch-cpu.lock", ["win32-x64", "linux-x64", "darwin-x64"]),
    "torch-cuda": ("requirements-torch-cuda.lock", ["win32-x64", "linux-x64"]),
    "pocket": ("requirements-pocket.lock", ["darwin-arm64", "win32-x64", "linux-x64"]),
}


def parse_lock(path: Path):
    indexes, entries, current = [], [], None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("--index-url") or line.startswith("--extra-index-url"):
            indexes.append(line.split(None, 1)[1].rstrip("/"))
        elif line.startswith("--hash=sha256:"):
            current["hashes"].add(line.split(":", 1)[1].rstrip(" \\"))
        elif line and not line.startswith("#") and not line.startswith("--"):
            current = {"req": Requirement(line.rstrip(" \\")), "hashes": set()}
            entries.append(current)
    return indexes, entries


_pages: dict = {}


def index_files(index: str, name: str):
    url = f"{index}/{canonicalize_name(name)}/"
    if url not in _pages:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "text/html"}), timeout=60) as response:
                body = response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            body = ""
        files = []
        for href in re.findall(r'href="([^"]+)"', body):
            href = html.unescape(href)
            target, _, fragment = href.partition("#")
            filename = urllib.parse.unquote(target.rsplit("/", 1)[-1])
            digest = fragment[len("sha256="):] if fragment.startswith("sha256=") else None
            if filename.endswith(".whl") and digest:
                files.append((filename, digest))
        _pages[url] = files
    return _pages[url]


def check(lock: str, targets) -> bool:
    indexes, entries = parse_lock(HERE / lock)
    ok = True
    for target in targets:
        env, platforms = TARGETS[target]
        accepted = set(tags.cpython_tags(PY, platforms=platforms)) | set(tags.compatible_tags(PY, "cp312", platforms))
        problems, count = [], 0
        for entry in entries:
            req = entry["req"]
            if req.marker is not None and not req.marker.evaluate(env):
                continue
            count += 1
            pinned = Version(next(iter(req.specifier)).version)
            found = False
            for index in indexes:
                for filename, digest in index_files(index, req.name):
                    try:
                        name, version, _build, wheel_tags = parse_wheel_filename(filename)
                    except InvalidWheelFilename:
                        continue  # historical malformed wheels on PyPI are not installable
                    if name == canonicalize_name(req.name) and version == pinned and wheel_tags & accepted and digest in entry["hashes"]:
                        found = True
                        break
                if found:
                    break
            if not found:
                problems.append(str(req))
        status = "ok" if not problems else "MISSING " + ", ".join(problems)
        print(f"{lock:32} {target:13} {count:3} packages  {status}")
        ok = ok and not problems
    return ok


if __name__ == "__main__":
    names = sys.argv[1:] or list(LOCKS)
    results = [check(*LOCKS[name]) for name in names]
    sys.exit(0 if all(results) else 1)
