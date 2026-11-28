import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("candidate", Path(__file__).parents[1]/"bin"/"verify-candidate.py")
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)

REV = "1"*40
PIN = "2"*64
CERT = "3"*64
APK = b"synthetic test fixture"
def archive(changes=None, extra=None):
    content = {candidate.APK: APK, "REVISION": REV+"\n", "CERT_SHA256":CERT+"\n",
               "LICENSE_PUBLIC_KEY":PIN+"\n",
               "SHA256SUMS": hashlib.sha256(APK).hexdigest()+"  "+candidate.APK+"\n"}
    content.update(changes or {})
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, value in content.items():z.writestr(name,value)
        if extra:z.writestr(*extra)
    return out.getvalue()

class IntakeTest(unittest.TestCase):
    def unpack(self, data, **kwargs):
        return candidate.unpack(data, kwargs.get("sha", candidate.digest(data)),
                                kwargs.get("revision",REV), kwargs.get("pin",PIN), kwargs.get("cert",CERT))
    def test_staging_is_unique_and_not_approved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            receipt={"sha256":candidate.digest(APK),"status":"verified_candidate_not_approved"}
            first=Path(candidate.stage(root,APK,receipt))
            second=Path(candidate.stage(root,APK,receipt))
            self.assertNotEqual(first,second)
            self.assertEqual((first/candidate.APK).read_bytes(),APK)
            self.assertTrue((first/"VERIFIED_NOT_APPROVED").exists())
            self.assertFalse((first/"release.json").exists())
            with self.assertRaises(ValueError):
                candidate.stage(root,b"wrong",receipt)
            self.assertEqual(len(list(root.iterdir())),2)
    def test_exact_identity(self):
        self.assertEqual(self.unpack(archive()),(APK,candidate.digest(APK)))
    def test_reject_wrong_external_identity(self):
        for args in ({"sha":"0"*64},{"revision":"9"*40},{"pin":"9"*64},{"cert":"9"*64}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.unpack(archive(), **args)
    def test_reject_changed_bytes_and_receipts(self):
        for changes in ({candidate.APK:b"changed"},{"SHA256SUMS":"invalid\n"},{"REVISION":REV+"\nextra"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.unpack(archive(changes))
    def test_reject_unexpected_path_and_oversize_metadata(self):
        with self.assertRaises(ValueError):self.unpack(archive(extra=("../Raschet.apk",b"bad")))
        with self.assertRaises(ValueError):self.unpack(archive({"REVISION":"1"*1025}))
    def test_actual_signer_and_manifest_guard(self):
        with tempfile.TemporaryDirectory() as d:
            apk=Path(d)/"fixture.apk"
            with zipfile.ZipFile(apk,"w") as z:
                for abi in ("arm64-v8a","armeabi-v7a","x86","x86_64"):
                    z.writestr(f"lib/{abi}/libraschet_jni.so",b"fake")
            outputs=[f"Signer #1 certificate SHA-256 digest: {CERT}\n",
                     "package: name='dev.ventry.raschet' versionCode='36' versionName='0.31.0-beta.1'\nsdkVersion:'26'\n",
                     "uses-permission: name='android.permission.INTERNET'\n",
                     ".license.LicenseActivity networkSecurityConfig"]
            with patch.object(candidate,"tool_output",side_effect=outputs):
                candidate.verify_android(apk,"apksigner","aapt",CERT,36,"0.31.0-beta.1")
            with patch.object(candidate,"tool_output",side_effect=[outputs[0]+f"Signer #2 certificate SHA-256 digest: {CERT}\n"]):
                with self.assertRaises(ValueError):
                    candidate.verify_android(apk,"apksigner","aapt",CERT,36,"0.31.0-beta.1")
            with patch.object(candidate,"tool_output",side_effect=outputs):
                with self.assertRaises(ValueError):
                    candidate.verify_android(apk,"apksigner","aapt",CERT,37,"0.31.0-beta.1")

if __name__=="__main__":unittest.main()
