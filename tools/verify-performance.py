#!/usr/bin/env python3
"""Conservative source-payload budget: include even lazy images and both font subsets.

The separate Chromium QA records actual resource timing and bytes. Neither is
a real-user Core Web Vitals or internet latency measurement.
"""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

SITE = Path(__file__).resolve().parents[1] / "site"
PAGE_BYTES = 300 * 1024
PAGE_REQUESTS = 24
LIMITS = {"styles.css": 10*1024, "home-company.css": 24*1024, "inner-pages.css": 32*1024}
CSS_URL = re.compile(r"url\(\s*['\"]?([^'\"\s)]+)", re.I)
JS_IMPORT = re.compile(r"""^\s*import\s+(?:[^;\n]+?\s+from\s+)?['"]([^'"]+)['"]""", re.M)

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("img","script","source","video","audio") and a.get("src"):
            self.refs.append(a["src"])
        if tag == "link" and a.get("rel") in ("stylesheet","icon","preload","modulepreload") and a.get("href"):
            self.refs.append(a["href"])
        if tag in ("img","source") and a.get("srcset"):
            self.refs.extend(part.strip().split()[0] for part in a["srcset"].split(",") if part.strip())

def resolve(path, ref):
    u = urlsplit(ref)
    if u.scheme or u.netloc or ref.startswith("//"):
        raise ValueError(f"{path.name}: nonlocal runtime asset {ref}")
    if not u.path:
        return None
    rel = unquote(u.path)
    target = (SITE / rel.lstrip("/") if rel.startswith("/") else path.parent / rel).resolve()
    if not target.is_relative_to(SITE) or not target.is_file():
        raise ValueError(f"Missing/unsafe asset {ref} in {path}")
    return target

def closure(page):
    seen = set()
    pending = [page.resolve()]
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        refs = []
        if path.suffix == ".html":
            parser = Assets()
            parser.feed(path.read_text(encoding="utf-8"))
            refs = parser.refs
        elif path.suffix == ".css":
            refs = CSS_URL.findall(path.read_text(encoding="utf-8"))
        elif path.suffix == ".js":
            refs = JS_IMPORT.findall(path.read_text(encoding="utf-8"))
        for ref in refs:
            target = resolve(path, ref)
            if target:
                pending.append(target)
    return seen

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path)
    args = parser.parse_args()
    sizes = {name:(SITE/name).stat().st_size for name in LIMITS}
    for name, size in sizes.items():
        assert size <= LIMITS[name], f"FAIL {name}: {size} > {LIMITS[name]}"
    pages = []
    for page in sorted(SITE.rglob("index.html")):
        files = closure(page)
        total = sum(p.stat().st_size for p in files)
        route = "/" + page.parent.relative_to(SITE).as_posix().strip(".").strip("/")
        route = route.rstrip("/")+"/"
        assert total <= PAGE_BYTES, f"FAIL {route} payload {total} > {PAGE_BYTES}"
        assert len(files) <= PAGE_REQUESTS, f"FAIL {route} assets {len(files)} > {PAGE_REQUESTS}"
        pages.append({"route":route,"source_bytes":total,"files":len(files),
                      "dependencies":sorted(str(p.relative_to(SITE)) for p in files)})
        print(f"PASS {route}: {total} source bytes, {len(files)} files")
    report = {"scope":"uncompressed source dependency closure, including lazy images and fonts",
              "page_limit_bytes":PAGE_BYTES,"file_limit":PAGE_REQUESTS,
              "stylesheet_bytes":sizes,"stylesheet_limits":LIMITS,"pages":pages}
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("PASS: public resource budgets")

if __name__ == "__main__":
    main()
