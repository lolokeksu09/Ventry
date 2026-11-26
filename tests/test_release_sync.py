"""Offline release-snapshot regression tests; never call GitHub."""
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / "tools/sync-releases.py"
SPEC = importlib.util.spec_from_file_location("sync_releases", PATH)
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)

def release(tag="raschet-v1.2.3", **kwargs):
    return dict(tag_name=tag, name="Test", published_at="2026-11-25T20:33:03Z",
                prerelease=True, draft=False, **{}) | kwargs

class ReleaseTests(unittest.TestCase):
    def test_only_public_expected_tags(self):
        data = sync.normalize([release(draft=True), release("unrelated-v1"),
                               release("raschet-v1/../../bad"), release("raschet-v2", name="Candidate")])
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["tag"], "raschet-v2")

    def test_sort_and_limit(self):
        entries = [release(f"raschet-v{i}", published_at=f"2026-11-{i:02}T00:00:00Z") for i in range(1, 13)]
        data = sync.normalize(entries)
        self.assertEqual(len(data), 10)
        self.assertEqual(data[0]["tag"], "raschet-v12")

    def test_reject_invalid_date_and_duplicate(self):
        for entries in ([release(published_at="2026-02-31T00:00:00Z")], [release(), release()]):
            with self.assertRaises(ValueError):
                sync.normalize(entries)

    def test_escape_and_ignore_external_assets(self):
        data = sync.normalize([release(name='<script>alert("x")</script>', html_url="https://invalid.test",
                                      assets=[{"browser_download_url": "https://invalid.test/file.apk"}])])
        rendered = sync.render(data, {"raschet-v1.2.3": {"title": "Расчёт 1.2.3", "changes": ['<script>alert("x")</script>']}})
        self.assertNotIn("<script>", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertNotIn("invalid.test", rendered)
        self.assertIn("Предварительный релиз", rendered)
        self.assertIn("Что изменилось", rendered)
        self.assertNotIn("href=", rendered)
        self.assertNotIn("github", rendered.lower())

    def test_missing_notes_and_external_urls(self):
        data = sync.normalize([release(name="https://invalid.test")])
        rendered = sync.render(data)
        self.assertIn("Описание изменений готовится", rendered)
        self.assertNotIn("invalid.test", rendered)
        with self.assertRaises(ValueError):
            sync.render(data, {"raschet-v1.2.3": {"title": "Расчёт", "changes": ["https://github.com/example"]}})

    def test_empty_and_idempotent(self):
        template = "before\n" + sync.START + "\nold\n" + sync.END + "\nafter"
        result = sync.replace_block(template, [])
        self.assertIn("релизов", result)
        self.assertEqual(result, sync.replace_block(result, []))
        with self.assertRaises(ValueError):
            sync.replace_block("no markers", [])

    def test_invalid_snapshot(self):
        with self.assertRaises(ValueError):
            sync.render([{"tag": "x", "name": "x", "published_at": "bad", "prerelease": False}])
