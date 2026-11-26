#!/usr/bin/env python3
"""Generate a deterministic, deliberately reviewed public release list.

No APK downloads, arbitrary Markdown rendering, runtime API calls or credentials.
"""
import argparse
from datetime import datetime
import html
import json
import os
from pathlib import Path
import re
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data/raschet-releases.json"
PAGE = ROOT / "site/releases/index.html"
API = "https://api.github.com/repos/lolokeksu09/dolg-book/releases?per_page=100"
NOTES = ROOT / "data/raschet-release-notes.json"
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

def verify_notes(notes):
    if not isinstance(notes, dict):
        raise ValueError("Invalid reviewed release notes")
    for tag, item in notes.items():
        if not TAG.fullmatch(tag) or not isinstance(item, dict) or set(item) != {"title", "changes"}:
            raise ValueError("Invalid release note record")
        title, changes = item["title"], item["changes"]
        if not isinstance(title, str) or not title.strip() or len(title) > 180:
            raise ValueError("Invalid release title")
        if not isinstance(changes, list) or not 1 <= len(changes) <= 30:
            raise ValueError("Invalid release changes")
        for value in [title, *changes]:
            if not isinstance(value, str) or not value.strip() or len(value) > 500:
                raise ValueError("Invalid release note text")
            if re.search(r"https?://|github[.]com|www[.]", value, re.I):
                raise ValueError("External URLs are not permitted in public release notes")
    return notes

def render(data, notes=None):
    data = verify_snapshot(data)
    notes = verify_notes({} if notes is None else notes)
    lines = ['        <div class="release-list">']
    if not data:
        lines.append('          <p>Подтверждённых публичных релизов в сохранённом снимке нет.</p>')
    for item in data:
        reviewed = notes.get(item["tag"])
        # Unreviewed names and release bodies are not published verbatim.
        name = html.escape(reviewed["title"] if reviewed else "Расчёт " + item["tag"].removeprefix("raschet-v"))
        date = item["published_at"]
        display = datetime.strptime(date, "%Y-%m-%dT%H:%M:%SZ").strftime("%d.%m.%Y")
        kind = "Предварительный релиз" if item["prerelease"] else "Опубликованный релиз"
        lines.extend([
            '          <article class="release-entry">',
            f'            <div class="release-entry-top"><h3>{name}</h3><span class="release-kind">{kind}</span></div>',
            f'            <p class="release-meta"><span>Дата публикации: <time datetime="{date}">{display} UTC</time></span></p>',
        ])
        if reviewed:
            lines.extend([
                '            <h4 class="release-changes-title">Что изменилось</h4>',
                '            <ul class="release-changes">',
            ])
            lines.extend(f'              <li>{html.escape(change)}</li>' for change in reviewed["changes"])
            lines.append('            </ul>')
        else:
            lines.append('            <p class="release-notes-pending">Описание изменений готовится.</p>')
        lines.append('          </article>')
    lines.append('        </div>')
    return "\n".join(lines)

def replace_block(page, data, notes=None):
    if page.count(START) != 1 or page.count(END) != 1:
        raise ValueError("Expected one generated release block")
    before, remaining = page.split(START)
    _, after = remaining.split(END)
    return before + START + "\n" + render(data, notes) + "\n" + END + after

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "Redirect refused", headers, fp)

def fetch():
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Ventry-release-snapshot",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    # Optional ephemeral read-only CI credential. Never persist or print it.
    token = os.environ.get("GH_TOKEN", "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(API, headers=headers)
    opener = build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            payload = response.read(4 * 1024 * 1024 + 1)
    except HTTPError as error:
        raise RuntimeError(f"GitHub release API returned HTTP {error.code}; published snapshot unchanged") from None
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
    notes = verify_notes(json.loads(NOTES.read_text(encoding="utf-8")))
    if args.check:
        data = verify_snapshot(json.loads(SNAPSHOT.read_text(encoding="utf-8")))
        if replace_block(page, data, notes) != page:
            raise SystemExit("FAIL: generated release list differs from reviewed snapshot")
        print(f"PASS: {len(data)} reviewed public release records")
    else:
        data = fetch()
        generated = replace_block(page, data, notes)
        SNAPSHOT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        PAGE.write_text(generated, encoding="utf-8")
        print(f"Fetched {len(data)} public release records; inspect diff before publication")

if __name__ == "__main__":
    main()
