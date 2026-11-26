"""Catalog generator regression checks."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("project_catalog", Path(__file__).resolve().parents[1] / "tools/build-catalog.py")
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)

class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(catalog.DATA.read_text(encoding="utf-8"))

    def test_published_pages_match(self):
        data = catalog.validate(self.data)
        for path, heading, records in (("index.html", "h3", [p for p in data if p["featured"]]),
                                       ("projects/index.html", "h2", data)):
            original = (catalog.SITE / path).read_text(encoding="utf-8")
            self.assertEqual(original, catalog.replace_block(original, records, heading))

    def test_escape(self):
        item = copy.deepcopy(self.data[0])
        item["name"] = '<script>alert("test")</script>'
        rendered = catalog.render_card(item, "h2")
        self.assertNotIn("<script>", rendered)
        self.assertIn("&lt;script&gt;", rendered)

    def test_reject_external_and_duplicate(self):
        for url in ("https://example.test/", "//example.test/", "/../secret", "/missing/"):
            items = copy.deepcopy(self.data)
            items[0]["demo"] = url
            with self.assertRaises(ValueError):
                catalog.validate(items)
        with self.assertRaises(ValueError):
            catalog.validate(self.data + self.data)
