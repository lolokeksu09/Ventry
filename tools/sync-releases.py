#!/usr/bin/env python3
"""Generate a deterministic, deliberately reviewed public release list.

No APK downloads, arbitrary Markdown rendering, runtime API calls or credentials.
"""
import argparse
from datetime import datetime
import html
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data/raschet-releases.json"
PAGE = ROOT / "site/releases/index.html"
API = "https://api.github.com/repos/lolokeksu09/dolg-book/releases?per_page=100"
RELEASE_BASE = "https://github.com/lolokeksu09/dolg-book/releases/tag/"
START = "        <!-- RELEASES:START -->"
END = "        <!-- RELEASES:END -->"
TAG = re.compile(r"raschet-v[0-9][A-Za-z0-9._-]{0,100}")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

def normalize(entries):
    if not isinstance(entries, list):
        raise ValueError("Expected release array")
    result = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid release object")
        if entry.get("draft") is True:
            continue
        tag = entry.get("tag_name")
        if not isinstance(tag, str) or not TAG.fullmatch(tag):
            continue
        published = entry.get("published_at")
        if not isinstance(published, str) or not DATE.fullmatch(published):
            raise ValueError("Invalid release date")
        datetime.strptime(published, "%Y-%m-%dT%H:%M:%SZ")
        prerelease = entry.get("prerelease")
        if type(prerelease) is not bool:
            raise ValueError("Missing prerelease flag")
        if tag in seen:
            raise ValueError("Duplicate release tag")
        seen.add(tag)
        name = entry.get("name") or tag
        if not isinstance(name, str):
            raise ValueError("Invalid release name")
        name = " ".join(name.split())[:180] or tag
        result.append(dict(tag=tag, name=name, published_at=published, prerelease=prerelease))
    return sorted(result, key=lambda x: (x["published_at"], x["tag"]), reverse=True)[:10]

def verify_snapshot(data):
    if not isinstance(data, list):
        raise ValueError("Invalid snapshot")
    converted = []
    for item in data:
        if set(item) != {"tag", "name", "published_at", "prerelease"}:
            raise ValueError("Unexpected snapshot fields")
        converted.append(dict(tag_name=item["tag"], name=item["name"],
                              published_at=item["published_at"], prerelease=item["prerelease"],
                              draft=False))
    if normalize(converted) != data:
        raise ValueError("Noncanonical or invalid release snapshot")
    return data

def render(data):
    data = verify_snapshot(data)
    lines = ['        <div class="release-list">']
    if not data:
        lines.append('          <p>Подтверждённых публичных релизов в сохранённом снимке нет.</p>')
    for item in data:
        tag = html.escape(item["tag"])
        name = html.escape(item["name"])
        date = item["published_at"]
        display = datetime.strptime(date, "%Y-%m-%dT%H:%M:%SZ").strftime("%d.%m.%Y")
        kind = "Предварительный релиз" if item["prerelease"] else "Опубликованный релиз"
        lines.extend([
            '          <article class="release-entry">',
            f'            <div class="release-entry-top"><h3>{name}</h3><span class="release-kind">{kind}</span></div>',
            f'            <p class="release-meta"><code>{tag}</code><span>Дата публикации: <time datetime="{date}">{display} UTC</time></span></p>',
            f'            <a class="resource-link" href="{RELEASE_BASE}{tag}" rel="noopener noreferrer">Запись релиза на GitHub <span aria-hidden="true">↗</span></a>',
            '          </article>',
        ])
    lines.append('        </div>')
    return "\n".join(lines)

def replace_block(page, data):
    if page.count(START) != 1 or page.count(END) != 1:
        raise ValueError("Expected one generated release block")
    before, remaining = page.split(START)
    _, after = remaining.split(END)
    return before + START + "\n" + render(data) + "\n" + END + after

def fetch():
    request = Request(API, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "Ventry-release-snapshot",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(request, timeout=20) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
    if len(payload) > 4 * 1024 * 1024:
        raise ValueError("Unexpected response size")
    return normalize(json.loads(payload))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    page = PAGE.read_text(encoding="utf-8")
    if args.check:
        data = verify_snapshot(json.loads(SNAPSHOT.read_text(encoding="utf-8")))
        if replace_block(page, data) != page:
            raise SystemExit("FAIL: generated release list differs from reviewed snapshot")
        print(f"PASS: {len(data)} reviewed public release records")
    else:
        data = fetch()
        generated = replace_block(page, data)
        SNAPSHOT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        PAGE.write_text(generated, encoding="utf-8")
        print(f"Fetched {len(data)} public release records; inspect diff before publication")

if __name__ == "__main__":
    main()
