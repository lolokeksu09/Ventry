"""Exercise the exact package verifier embedded in the restricted SSH entrypoint."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "deploy/ventry-github-status").read_text()
VERIFIER = SCRIPT.split("3<&0 <<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
BASE = {
    "compose.yaml": b"services: {}\n",
    "site/index.html": b"Ventry",
    "site/version.json": json.dumps({"commit": "a" * 40}).encode(),
    "deploy/Caddyfile": b"example",
    "deploy/caddy-patched": b"binary",
}


def package(*, tamper=False, extra=None, omit=None):
    files = BASE.copy()
    files["deploy/release-manifest.json"] = json.dumps({
        k: hashlib.sha256(v).hexdigest() for k, v in files.items()
    }).encode()
    if tamper:
        files["site/index.html"] = b"changed"
    if omit:
        del files[omit]
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, contents in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(contents)
            tar.addfile(member, io.BytesIO(contents))
        if extra:
            member = tarfile.TarInfo(extra)
            member.size = 1
            tar.addfile(member, io.BytesIO(b"x"))
    return buffer.getvalue()


class PackageTests(unittest.TestCase):
    def verify(self, data, expected):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(
                ["bash", "-c", 'exec 3<&0; exec python3 -c "$1" "$2" "$3"',
                 "verify", VERIFIER, str(root / "release.tar.gz"), str(root / "out")],
                input=data, capture_output=True, timeout=15,
            )
            if expected:
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual((root / "out/site/index.html").read_bytes(), BASE["site/index.html"])
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / "escape").exists())
            return result.stderr.decode()

    def test_valid_package(self):
        self.verify(package(), True)

    def test_tampered_contents(self):
        self.assertIn("manifest mismatch", self.verify(package(tamper=True), False))

    def test_missing_required_file(self):
        self.assertIn("Incomplete release", self.verify(package(omit="site/version.json"), False))

    def test_traversal(self):
        self.assertIn("Unsafe or duplicate", self.verify(package(extra="site/../../escape"), False))

    def test_duplicate(self):
        self.assertIn("Unsafe or duplicate", self.verify(package(extra="site/index.html"), False))

    def test_unexpected_root(self):
        self.assertIn("Unexpected release path", self.verify(package(extra=".env"), False))

    def test_unlisted_file(self):
        self.assertIn("manifest mismatch", self.verify(package(extra="site/extra.txt"), False))


if __name__ == "__main__":
    unittest.main()
