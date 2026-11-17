"""Check the static site's internal routes, fragments, assets and page metadata."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / 'site'


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path, self.ids, self.refs, self.headings = path, set(), [], 0
        self.canonical = []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f'{self.path}: duplicate ID {attrs["id"]}'
            self.ids.add(attrs['id'])
        if tag == 'h1':
            self.headings += 1
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonical.append(attrs['href'])
        if tag in ('a', 'link', 'script', 'img'):
            ref = attrs.get('href') or attrs.get('src')
            if ref:
                self.refs.append(ref)


pages = {p.resolve(): Page(p) for p in ROOT.rglob('*.html')}
for path, page in pages.items():
    assert page.headings == 1, f'{path}: expected exactly one h1'
    route = '/' + path.parent.relative_to(ROOT).as_posix().strip('.')
    route = route.rstrip('/') + '/'
    assert page.canonical == ['https://135-106-227-179.sslip.io' + route], f'{path}: wrong canonical'
    for ref in page.refs:
        parsed = urlsplit(ref)
        if parsed.scheme or parsed.netloc:
            continue
        target = (ROOT / unquote(parsed.path).lstrip('/') if parsed.path.startswith('/')
                  else path.parent / unquote(parsed.path)) if parsed.path else path
        target = target.resolve()
        assert target.is_relative_to(ROOT), f'{path}: route leaves site: {ref}'
        if target.is_dir():
            target /= 'index.html'
        assert target.is_file(), f'{path}: missing target {ref}'
        if parsed.fragment and target.suffix == '.html':
            assert unquote(parsed.fragment) in pages[target].ids, f'{path}: missing fragment {ref}'
print(f'PASS: {len(pages)} pages; internal routes, fragments, assets and canonical URLs')
