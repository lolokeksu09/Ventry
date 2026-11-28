import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("switch",Path(__file__).parents[1]/"deploy/release-switch.py")
switch=importlib.util.module_from_spec(spec)
spec.loader.exec_module(switch)

class ReleaseSwitchTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.store=switch.Store(self.root,{"version_code":35,"sha256":"0"*64})
        self.target="1"*64
        bundle=self.root/"releases"/self.target
        bundle.mkdir(parents=True)
        (bundle/"release.json").write_text(json.dumps({"version_code":37,"sha256":self.target}))
        self.calls=[]

    def worker(self,mode,selection):
        self.calls.append((mode,selection))

    def test_success_and_explicit_rollback(self):
        self.store.transition(self.store.load(),self.target,self.worker)
        state=self.store.load()
        self.assertEqual((state["current"],state["previous"],state["pending"],state["high_water"]),
                         (self.target,"legacy",None,37))
        self.store.transition(state,"legacy",self.worker,rollback=True)
        state=self.store.load()
        self.assertEqual((state["current"],state["previous"],state["high_water"]),("legacy",self.target,37))
        with self.assertRaises(ValueError):
            self.store.transition(state,self.target,self.worker)

    def test_failed_start_restores_previous_and_reserves_version(self):
        def fail(mode,selection):
            self.worker(mode,selection)
            if mode=="--release-worker" and selection==self.target:
                raise RuntimeError("synthetic startup failure")
        with self.assertRaises(RuntimeError):
            self.store.transition(self.store.load(),self.target,fail)
        state=self.store.load()
        self.assertEqual((state["current"],state["pending"],state["high_water"]),("legacy",None,37))
        self.assertEqual(self.calls[-1],("--release-worker","legacy"))
        self.assertEqual(state["history"][-1]["event"],"restored")

    def test_failed_recovery_stops_services_and_leaves_pending(self):
        def fail(mode,selection):
            self.worker(mode,selection)
            if mode=="--release-worker":
                raise RuntimeError("synthetic startup failure")
        with self.assertRaises(RuntimeError):
            self.store.transition(self.store.load(),self.target,fail)
        self.assertEqual(self.store.load()["pending"],self.target)
        self.assertEqual(self.calls[-1],("--stop-worker","legacy"))
        with self.assertRaises(ValueError):
            self.store.transition(self.store.load(),self.target,self.worker)
        self.store.recover(self.store.load(),self.worker)
        self.assertIsNone(self.store.load()["pending"])

    def test_preflight_failure_does_not_create_journal_or_restart(self):
        def fail(mode,selection):
            self.worker(mode,selection)
            if selection==self.target:
                raise RuntimeError("bad candidate")
        with self.assertRaises(RuntimeError):
            self.store.transition(self.store.load(),self.target,fail)
        self.assertFalse(self.store.path.exists())
        self.assertTrue(all(mode=="--verify-worker" for mode,_ in self.calls))

if __name__=="__main__":
    unittest.main()
