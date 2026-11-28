#!/usr/bin/env python3
"""Owner-only Delivery release transaction. No DB writes, secret reads or public ingress changes."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
BASE = HERE.parent / "service/release.json"
MAX_APK = 64 * 1024 * 1024

def require(ok, message):
    if not ok:
        raise ValueError(message)

def hexstr(value, length=64):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % length, value) is not None

def regular(path, limit):
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= limit,
            "Missing, oversized or non-regular release member")
    return path.read_bytes()

def obj(path, limit=8192):
    return json.loads(regular(path, limit))

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def write_new(path, payload, mode=0o444):
    with path.open("xb") as f:
        f.write(payload)
        f.flush()
        os.fchmod(f.fileno(), mode)
        os.fsync(f.fileno())

class Store:
    def __init__(self, root, baseline):
        self.root = root
        self.baseline = baseline
        self.path = root / "release-selection.json"

    def manifest(self, selection):
        if selection == "legacy":
            return self.baseline
        require(hexstr(selection), "Invalid selected SHA")
        directory = self.root / "releases" / selection
        require(directory.is_dir() and not directory.is_symlink(), "Invalid release directory")
        data = obj(directory / "release.json")
        require(data["sha256"] == selection, "Selected manifest digest differs")
        return data

    def load(self):
        if not self.path.exists():
            return {"current":"legacy","previous":None,"pending":None,
                    "high_water":self.baseline["version_code"],"history":[]}
        data = obj(self.path, 131072)
        require(set(data) == {"current","previous","pending","high_water","history"}, "Invalid release journal")
        for key in ("current","previous","pending"):
            val = data[key]
            require(val == "legacy" or hexstr(val) or (key != "current" and val is None),
                    "Invalid release journal selection")
        require(type(data["high_water"]) is int and data["high_water"] >= self.baseline["version_code"]
                and isinstance(data["history"],list), "Invalid release journal version")
        return data

    def save(self, state, event, target):
        state["history"] = (state["history"] + [{"at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "event":event,"target":target}])[-100:]
        fd, name = tempfile.mkstemp(prefix=".release-selection-", dir=self.root)
        try:
            with os.fdopen(fd,"w",encoding="utf-8") as f:
                json.dump(state,f,indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(name,self.path)
            sync_dir(self.root)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def prepare(self, stage, expected, state):
        require(hexstr(expected), "Expected SHA must be independently approved")
        require(stage.is_absolute() and stage.is_dir() and not stage.is_symlink(), "Invalid staging directory")
        receipt = obj(stage / "candidate.json")
        require(receipt["status"] == "verified_candidate_not_approved"
                and regular(stage/"VERIFIED_NOT_APPROVED",1024).decode("ascii").strip() == expected
                and receipt["sha256"] == expected, "Candidate receipt mismatch")
        require(receipt["certificate_sha256"] == self.baseline["certificate_sha256"]
                and receipt["package_name"] == self.baseline["package_name"]
                and hexstr(receipt["revision"],40), "Candidate identity mismatch")
        pin = regular(self.root/"license-public-key.hex",1024).decode("ascii").strip()
        require(hexstr(pin) and pin != "0"*64 and receipt["license_public_key"] == pin, "Delivery public key mismatch")
        code, name = receipt["version_code"], receipt["version_name"]
        require(type(code) is int and state["high_water"] < code <= 2100000000
                and isinstance(name,str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?",name),
                "Candidate must use a newer, never previously activated versionCode")
        apk = regular(stage/"Raschet-licensed-candidate.apk",MAX_APK)
        require(len(apk) == receipt["size"] and hashlib.sha256(apk).hexdigest() == expected,
                "Candidate APK bytes differ")
        manifest = {"product":"raschet","tag":"licensed-candidate-"+str(code),"version_name":name,
                    "version_code":code,"package_name":receipt["package_name"],"revision":receipt["revision"],
                    "size":len(apk),"sha256":expected,"certificate_sha256":receipt["certificate_sha256"],
                    "source":"github-actions:"+receipt["revision"],"prerelease":True}
        releases = self.root/"releases"
        releases.mkdir(mode=0o700,exist_ok=True)
        require(not releases.is_symlink(),"Invalid releases directory")
        target = releases/expected
        if target.exists():
            require(self.manifest(expected)==manifest and hashlib.sha256(regular(target/"Raschet.apk",MAX_APK)).hexdigest()==expected,
                    "Existing immutable bundle differs")
            return expected
        work = Path(tempfile.mkdtemp(prefix=".bundle-",dir=releases))
        try:
            write_new(work/"Raschet.apk",apk)
            write_new(work/"release.json",(json.dumps(manifest,indent=2)+"\n").encode())
            work.chmod(0o555)
            sync_dir(work)
            os.rename(work,target)
            sync_dir(releases)
        finally:
            if work.exists():
                work.chmod(0o700)
                shutil.rmtree(work)
        return expected

    def transition(self, state, target, worker, rollback=False):
        require(state["pending"] is None, "Release switch incomplete; recover first")
        previous = state["current"]
        require(target != previous,"Release is already active")
        code = self.manifest(target)["version_code"]
        require((rollback and target == state["previous"]) or (not rollback and code > state["high_water"]),
                "Release transition violates version policy")
        # Validate both rollback and target before changing any running service.
        worker("--verify-worker",previous)
        worker("--verify-worker",target)
        state["pending"] = target
        # Reserve the version before starting, even if activation later fails.
        state["high_water"] = max(state["high_water"],code)
        self.save(state,"begin_rollback" if rollback else "begin_switch",target)
        try:
            worker("--release-worker",target)
        except BaseException:
            self.recover(state,worker)
            raise
        state["current"], state["previous"], state["pending"] = target, previous, None
        self.save(state,"committed",target)

    def recover(self,state,worker):
        require(state["pending"] is not None,"No pending release operation")
        target = state["pending"]
        try:
            worker("--release-worker",state["current"])
        except BaseException:
            try:
                worker("--stop-worker","legacy")
            finally:
                self.save(state,"recovery_failed",target)
            raise
        state["pending"] = None
        self.save(state,"restored",state["current"])

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("state",type=Path)
    modes = p.add_mutually_exclusive_group(required=True)
    modes.add_argument("--active",action="store_true")
    modes.add_argument("--expected")
    modes.add_argument("--check-current",action="store_true")
    modes.add_argument("--switch",type=Path)
    modes.add_argument("--rollback",action="store_true")
    modes.add_argument("--recover",action="store_true")
    p.add_argument("--accepted-sha",help="Owner independently verified exact SHA and accepted physical device tests")
    a = p.parse_args()
    root = a.state
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(),"Invalid Delivery state")
    store = Store(root,obj(BASE))
    if a.active:
        state = store.load()
        require(state["pending"] is None,"Release switch incomplete; run --recover")
        print(state["current"])
        return
    if a.expected:
        print(store.manifest(a.expected)["sha256"])
        return
    require(a.accepted_sha is None or a.switch is not None,"SHA approval only applies to switch")
    os.umask(0o077)
    with (root/"upgrade-006.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        require(not any((root/x).exists() for x in ("upgrade-006.incomplete","upgrade-007.incomplete")),
                "Database migration incomplete")
        state=store.load()
        def worker(mode,selection):
            env=dict(os.environ,DELIVERY_LOCK_FD=str(lock.fileno()))
            subprocess.run(["bash",str(HERE/"start-private.sh"),str(root),mode,selection],
                           env=env,pass_fds=(lock.fileno(),),check=True)
        if a.recover:
            # Rebuild/verify committed pair if a prior interrupted run left no image.
            require(state["pending"] is not None,"No pending release operation")
            try:
                worker("--verify-worker",state["current"])
            except BaseException:
                try:
                    worker("--stop-worker","legacy")
                finally:
                    store.save(state,"recovery_preflight_failed",state["pending"])
                raise
            store.recover(state,worker)
            print("DELIVERY_RELEASE_RECOVERED")
            return
        require(state["pending"] is None,"Release switch incomplete; run --recover")
        if a.check_current:
            worker("--verify-worker",state["current"])
            print("DELIVERY_RELEASE_PREFLIGHT_OK")
            return
        if a.switch:
            target=store.prepare(a.switch,a.accepted_sha,state)
        else:
            target=state["previous"]
            require(target is not None,"No previous release to restore")
        store.transition(state,target,worker,rollback=a.rollback)
        print("DELIVERY_RELEASE_SWITCHED")

if __name__ == "__main__":
    try:
        main()
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as exc:
        print("Delivery release operation failed: "+(str(exc) if isinstance(exc,ValueError) else type(exc).__name__),file=sys.stderr)
        sys.exit(1)
