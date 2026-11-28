#!/usr/bin/env python3
"""Read-only acceptance preflight for a signed, owner-approved Actions artifact.
Never changes the active release, database, gateway, or APK on the server.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_APK = 64 * 1024 * 1024
MAX_ARCHIVE = MAX_APK + 1024 * 1024
APK = "Raschet-licensed-candidate.apk"
MEMBERS = {APK, "CERT_SHA256", "REVISION", "LICENSE_PUBLIC_KEY", "SHA256SUMS"}
RELEASE = Path(__file__).resolve().parents[1] / "service" / "release.json"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def hex_value(value, length):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % length, value), "Invalid hexadecimal identity")
    return value

def digest(data):
    return hashlib.sha256(data).hexdigest()

def bounded_read(path, limit):
    with path.open("rb") as stream:
        result = stream.read(limit + 1)
    require(0 < len(result) <= limit, "Unexpected file size")
    return result

def unpack(archive, expected_sha, revision, pin, cert):
    require(digest(archive) == hex_value(expected_sha, 64), "Actions archive digest mismatch")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        entries = bundle.infolist()
        require(len(entries) == len(MEMBERS) and {e.filename for e in entries} == MEMBERS,
                "Unexpected, missing or duplicate archive members")
        for entry in entries:
            mode = (entry.external_attr >> 16) & 0xFFFF
            require(not entry.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG),
                    "Non-regular archive member")
            require(not entry.flag_bits & 1 and 0 < entry.file_size <= (MAX_APK if entry.filename == APK else 1024),
                    "Invalid candidate member size or encryption")
        def line(name):
            raw = bundle.read(name)
            return raw.decode("ascii").removesuffix("\n")
        require(line("REVISION") == hex_value(revision, 40), "Candidate revision mismatch")
        require(line("LICENSE_PUBLIC_KEY") == hex_value(pin, 64) and pin != "0"*64,
                "Delivery public key mismatch")
        require(line("CERT_SHA256") == hex_value(cert, 64), "Candidate certificate receipt mismatch")
        data = bundle.read(APK)
        checksum = digest(data)
        require(line("SHA256SUMS") == checksum + "  " + APK, "APK checksum receipt mismatch")
        return data, checksum

def tool_output(tool, *args):
    result = subprocess.run([tool, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=True, timeout=90)
    return result.stdout.decode("utf-8", errors="strict")

def verify_android(apk, apksigner, aapt, cert, code, name):
    certificates = tool_output(apksigner, "verify", "--min-sdk-version", "26", "--verbose", "--print-certs", str(apk))
    signers = re.findall(r"^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$",
                         certificates, re.MULTILINE)
    require(len(signers) == 1 and signers[0].lower() == cert, "Unexpected actual signer")
    badging = tool_output(aapt, "dump", "badging", str(apk))
    package = next((line for line in badging.splitlines() if line.startswith("package: ")), "")
    required = {"name='dev.ventry.raschet'", f"versionCode='{code}'", f"versionName='{name}'"}
    require(required.issubset(set(package.split())), "APK package or version mismatch")
    require("sdkVersion:'26'" in badging.splitlines(), "Unexpected minimum SDK")
    permissions = tool_output(aapt, "dump", "permissions", str(apk))
    require(re.search(r"name='android\.permission\.INTERNET'", permissions), "Missing internet permission")
    manifest = tool_output(aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml")
    require(".license.LicenseActivity" in manifest and "networkSecurityConfig" in manifest,
            "Missing licensed manifest components")
    with zipfile.ZipFile(apk) as payload:
        names = payload.namelist()
        for abi in ("arm64-v8a", "armeabi-v7a", "x86", "x86_64"):
            member = f"lib/{abi}/libraschet_jni.so"
            require(names.count(member) == 1 and payload.getinfo(member).file_size > 0,
                    "Missing native library: " + abi)

def stage(root, data, receipt):
    # The caller selects an existing staging root. Never replace a release, a
    # symlink target or a previously prepared bundle. Ready marker is written last.
    require(root.is_dir(), "Staging root must already exist")
    work = Path(tempfile.mkdtemp(prefix="candidate-", dir=root))
    try:
        for name, payload in ((APK, data), ("candidate.json", (json.dumps(receipt, indent=2)+"\n").encode())):
            with (work/name).open("xb") as stream:
                stream.write(payload)
                stream.flush()
                import os
                os.fsync(stream.fileno())
        require(digest(bounded_read(work/APK, MAX_APK)) == receipt["sha256"], "Staged APK mismatch")
        with (work/"VERIFIED_NOT_APPROVED").open("x") as marker:
            marker.write(receipt["sha256"]+"\n")
        return str(work)
    except Exception:
        shutil.rmtree(work)
        raise

def run(args):
    old = json.loads(RELEASE.read_text())
    cert = hex_value(old["certificate_sha256"], 64)
    require(args.version_code > old["version_code"], "Candidate must upgrade active delivery version")
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?", args.version_name), "Invalid version name")
    archive = bounded_read(args.archive, MAX_ARCHIVE)
    data, checksum = unpack(archive, args.archive_sha256, args.revision, args.public_key, cert)
    with tempfile.TemporaryDirectory(prefix="ventry-candidate-") as work:
        apk = Path(work) / APK
        apk.write_bytes(data)
        verify_android(apk, args.apksigner, args.aapt, cert, args.version_code, args.version_name)
        require(digest(bounded_read(apk, MAX_APK)) == checksum, "APK changed during verification")
    # Receipt is evidence of artifact identity, not acceptance or an active release manifest.
    receipt = {"status": "verified_candidate_not_approved", "package_name": "dev.ventry.raschet",
            "version_code": args.version_code, "version_name": args.version_name,
            "revision": args.revision, "size": len(data), "sha256": checksum,
            "certificate_sha256": cert, "archive_sha256": args.archive_sha256,
            "license_public_key": args.public_key, "physical_device_acceptance": "not_verified"}
    if args.stage_root is not None:
        receipt["staged_directory"] = stage(args.stage_root, data, receipt)
    return receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--archive-sha256", required=True, help="Trusted digest from GitHub Actions API, not inside ZIP")
    parser.add_argument("--revision", required=True, help="Exact approved main workflow head SHA")
    parser.add_argument("--public-key", required=True, help="Existing Delivery raw PUBLIC Ed25519 key")
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--apksigner", default="apksigner")
    parser.add_argument("--aapt", default="aapt")
    parser.add_argument("--stage-root", type=Path, help="Optional existing isolated staging directory; never activates release")
    try:
        receipt = run(parser.parse_args())
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as exc:
        # No tool output, paths containing user input, credentials or archive contents.
        print("Candidate rejected: " + (str(exc) if isinstance(exc, ValueError) else type(exc).__name__), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
