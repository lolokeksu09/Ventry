#!/usr/bin/env python3
"""Generate the shared corporate navigation and the local discovery directory."""
import argparse
import html
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DATA = ROOT / "data/navigation.json"
CATEGORIES = {"product":"Продукты", "demo":"Демо", "help":"Помощь", "company":"Компания"}

def escape(value):
    return html.escape(value)

def valid_text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 400:
        raise ValueError("Invalid navigation text")
    return value

def valid_url(url):
    if not isinstance(url,str) or not re.fullmatch(r"/[A-Za-z0-9._/?=&-]*(?:#[A-Za-z0-9_-]+)?",url) or url.startswith("//"):
        raise ValueError("Only local navigation URLs permitted")
    path = urlsplit(url).path
    if ".." in path.split("/"):
        raise ValueError("Unsafe navigation path")
    target = (SITE/path.lstrip("/")).resolve()
    if target.is_dir():
        target /= "index.html"
    if not target.is_file() or not target.is_relative_to(SITE):
        raise ValueError("Missing navigation destination: "+url)

def validate(data):
    if set(data) != {"menu","search","groups","directory"}:
        raise ValueError("Unexpected navigation fields")
    def check_links(links):
        urls = set()
        for url,label in links:
            valid_url(url)
            valid_text(label)
            if url in urls:
                raise ValueError("Duplicate link: "+url)
            urls.add(url)
    check_links([*data["menu"],data["search"]])
    for group in data["groups"]:
        if set(group) != {"title","links"}:
            raise ValueError("Invalid footer group")
        valid_text(group["title"])
        check_links(group["links"])
    check_links([(url,title) for _,url,title,_ in data["directory"]])
    for category,url,title,description in data["directory"]:
        if category not in CATEGORIES:
            raise ValueError("Invalid directory category")
        valid_text(description)
    return data

def anchor(url,title,route,menu=False):
    current = ""
    if url == route:
        current = ' aria-current="page"'
    elif menu and ((url == "/projects/" and route == "/projects/raschet/") or
                   (url == "/support/" and route == "/status/") or
                   (url == "/about/" and route in ("/approach/","/contact/","/legal/","/privacy/"))):
        current = ' aria-current="location"'
    return f'<a href="{escape(url)}"{current}>{escape(title)}</a>'

def footer(data,route):
    groups = "\n".join(
        f'      <nav class="ventry-footer-group" aria-label="{escape(g["title"])}"><h2>{escape(g["title"])}</h2>'
        + "".join(anchor(u,t,route) for u,t in g["links"]) + "</nav>"
        for g in data["groups"])
    return f'''<footer class="site-footer ventry-footer" itemscope itemtype="https://schema.org/Organization" itemid="https://ventrylab.top/#organization">
    <meta itemprop="logo" content="https://ventrylab.top/images/ventry-mark.webp">
    <div class="ventry-footer-grid">
      <div class="ventry-footer-identity">
        <a class="ventry-footer-brand" itemprop="url" href="/" aria-label="Ventry — на главную"><img src="/images/ventry-mark.webp" width="34" height="34" alt="" loading="lazy" decoding="async"><span itemprop="name">Ventry</span></a>
        <p>Цифровые инструменты для малого бизнеса.</p>
        <a class="ventry-footer-email" itemprop="email" href="mailto:ventrybusinesswork@gmail.com">Написать нам ↗</a>
      </div>
{groups}
    </div>
    <div class="ventry-footer-bottom"><span>© <span id="year">2026</span> Ventry</span><a href="#main">К началу содержимого ↑</a></div>
  </footer>'''

def directory(data):
    return "\n".join(
        f'        <article class="directory-entry" data-knowledge-item="{category}"><div><p class="directory-category">{CATEGORIES[category]}</p><h2><a href="{escape(url)}">{escape(title)} <span aria-hidden="true">↗</span></a></h2><p>{escape(description)}</p></div></article>'
        for category,url,title,description in data["directory"])

def block(text,key,content,prefix,expected):
    start,end = f"<!-- {key}:START -->",f"<!-- {key}:END -->"
    if text.count(start) != expected or text.count(end) != expected:
        raise ValueError("Missing/duplicate generated block: "+key)
    pattern = re.escape(start)+r"[\s\S]*?"+re.escape(end)
    return re.sub(pattern,lambda _:start+"\n"+content+"\n"+prefix+end,text)

def render(text,data,route):
    menu = "\n".join("        "+anchor(u,t,route,True) for u,t in data["menu"])
    expected = 2 if route in ("/","/about/","/approach/","/projects/","/contact/") else 1
    text = block(text,"MENU",menu,"        ",expected)
    search = "        "+anchor(*data["search"],route).replace("<a ",'<a class="header-search" ',1)
    text = block(text,"SEARCH",search,"        ",expected)
    text = block(text,"FOOTER","  "+footer(data,route),"  ",1)
    if route == "/explore/":
        text = block(text,"DIRECTORY",directory(data),"        ",1)
    return text

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check",action="store_true")
    mode.add_argument("--write",action="store_true")
    args = parser.parse_args()
    data = validate(json.loads(DATA.read_text(encoding="utf-8")))
    pages = []
    for path in sorted(SITE.rglob("index.html")):
        route = "/"+path.parent.relative_to(SITE).as_posix().strip(".").strip("/")
        route = route.rstrip("/")+"/"
        if route == "/raschet/":
            continue
        old = path.read_text(encoding="utf-8")
        new = render(old,data,route)
        if args.check and old != new:
            raise SystemExit("FAIL: generated navigation differs: "+route)
        if args.write:
            path.write_text(new,encoding="utf-8")
        pages.append(route)
    print(f"PASS: shared navigation on {len(pages)} pages; {len(data['directory'])} discovery entries")

if __name__ == "__main__":
    main()
