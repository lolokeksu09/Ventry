#!/usr/bin/env python3
"""Deterministic build-time cards for the reviewed Ventry project catalog."""
import argparse
import html
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/projects.json"
SITE = ROOT / "site"
START = "      <!-- PROJECTS:START -->"
END = "      <!-- PROJECTS:END -->"
FIELDS = {"id", "name", "category", "platform", "description", "features", "product",
          "demo", "icon", "image", "image_alt", "image_width", "image_height", "gallery",
          "releases", "docs", "featured"}

def validate(data):
    if not isinstance(data, list) or not data:
        raise ValueError("Catalog must be a nonempty array")
    ids = set()
    for item in data:
        if not isinstance(item, dict) or set(item) != FIELDS:
            raise ValueError("Invalid catalog record")
        slug = item["id"]
        if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,50}", slug) or slug in ids:
            raise ValueError("Invalid or duplicate project id")
        ids.add(slug)
        for key in ("name", "category", "platform", "description", "image_alt"):
            if not isinstance(item[key], str) or not item[key].strip() or len(item[key]) > 300:
                raise ValueError("Invalid catalog text")
        if not isinstance(item["features"], list) or not 1 <= len(item["features"]) <= 8 or any(
            not isinstance(x, str) or not x.strip() or len(x) > 180 for x in item["features"]
        ):
            raise ValueError("Invalid project features")
        for key in ("product", "demo", "icon", "image", "gallery", "releases", "docs"):
            value = item[key]
            if not isinstance(value, str) or not re.fullmatch(r"/[A-Za-z0-9._/?=&-]+(?:#[A-Za-z0-9_-]+)?", value):
                raise ValueError("Invalid local URL")
            u = urlsplit(value)
            if u.scheme or u.netloc or value.startswith("//") or ".." in u.path.split("/"):
                raise ValueError("Only local project URLs permitted")
            target = SITE / u.path.lstrip("/")
            if target.is_dir():
                target /= "index.html"
            if not target.is_file() or not target.resolve().is_relative_to(SITE):
                raise ValueError("Missing or unsafe project resource")
        if item["product"] != f"/projects/{slug}/":
            raise ValueError("Product route must match project id")
        if urlsplit(item["gallery"]).path != item["product"]:
            raise ValueError("Gallery must belong to product")
        if type(item["featured"]) is not bool:
            raise ValueError("Invalid featured flag")
        for k in ("image_width", "image_height"):
            if type(item[k]) is not int or not 1 <= item[k] <= 4096:
                raise ValueError("Invalid image dimensions")
    if not any(x["featured"] for x in data):
        raise ValueError("At least one featured project is required")
    return data

def render_card(item, heading):
    if heading not in ("h2", "h3"):
        raise ValueError("Invalid heading")
    p = {k: html.escape(str(v)) for k, v in item.items() if isinstance(v, (str, int))}
    features = "\n".join(f"            <li>{html.escape(s)}</li>" for s in item["features"])
    return f'''      <article class="work-item" data-product="{p["id"]}">
        <img class="work-mark" src="{p["icon"]}" width="72" height="72" decoding="async" alt="">
        <div class="work-detail">
          <p class="work-category">{p["category"]}</p>
          <{heading} class="work-name">{p["name"]}</{heading}><span class="work-type">{p["platform"]}</span>
          <p class="work-lead">{p["description"]}</p>
          <ul class="work-features" aria-label="Возможности приложения">
{features}
          </ul>
          <div class="work-actions">
            <a class="hero-primary" href="{p["demo"]}">Открыть демо <span aria-hidden="true">↗</span></a>
            <a class="hero-secondary" href="{p["product"]}">О приложении</a>
          </div>
          <p class="demo-note">Без установки и регистрации. Только вымышленные записи; изменения сбрасываются при перезагрузке.</p>
          <nav class="work-resource-links" aria-label="Ресурсы приложения"><a href="{p["releases"]}">Версии и обновления</a><a href="{p["docs"]}">Инструкции</a></nav>
        </div>
        <figure class="work-preview">
          <a href="{p["gallery"]}" aria-label="Посмотреть настоящие экраны приложения {p["name"]}">
            <img src="{p["image"]}" width="{p["image_width"]}" height="{p["image_height"]}" alt="{p["image_alt"]}" loading="lazy" decoding="async">
          </a>
          <figcaption>Экран тестовой Android-сборки <a href="{p["gallery"]}">Все снимки ↗</a></figcaption>
        </figure>
      </article>'''

def replace_block(page, items, heading):
    if page.count(START) != 1 or page.count(END) != 1:
        raise ValueError("Expected one catalog block")
    before, remainder = page.split(START)
    _, after = remainder.split(END)
    return before + START + "\n" + "\n".join(render_card(p, heading) for p in items) + "\n" + END + after

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()
    data = validate(json.loads(DATA.read_text(encoding="utf-8")))
    for path, items, heading in ((SITE / "index.html", [p for p in data if p["featured"]], "h3"),
                                 (SITE / "projects/index.html", data, "h2")):
        old = path.read_text(encoding="utf-8")
        new = replace_block(old, items, heading)
        if args.check and old != new:
            raise SystemExit(f"FAIL: catalog differs from reviewed metadata: {path.name}")
        if args.write:
            path.write_text(new, encoding="utf-8")
    print(f"PASS: {len(data)} reviewed project records")

if __name__ == "__main__":
    main()
