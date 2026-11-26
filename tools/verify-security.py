"""Verify Ventry's CSP assumptions and deny rules before deployment.

This is a configuration and source-level regression guard, not a pentest.
The live Caddy matcher behavior is tested separately in tests/security-http.sh.
"""
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
caddy = (ROOT / "deploy/Caddyfile").read_text(encoding="utf-8")

match = re.search(r"^\s*@sensitive path_regexp (.+)$", caddy, re.M)
assert match, "Missing sensitive-path deny matcher"
blocked = re.compile(match.group(1))

for path in (
    "/.env", "/.env.local", "/.git/config", "/.github/workflows/deploy.yml",
    "/.ssh/id_rsa", "/backup.sql", "/backup.sql.gz", "/db.sqlite",
    "/snapshots/site.zip", "/file.bak", "/projects/raschet/.env",
    "/certs/server.pem", "/keys/prod.key",
):
    assert blocked.search(path), f"Sensitive URL not matched: {path}"

for path in (
    "/", "/healthz", "/index.html", "/app.js", "/styles.css", "/favicon.svg",
    "/google9048871eda96ab4a.html", "/projects/raschet/",
    "/fonts/golos-cyrillic.woff2", "/images/ventry-mark.webp",
):
    assert not blocked.search(path), f"Public URL incorrectly blocked: {path}"

assert "respond @sensitive 404" in caddy, "Sensitive matcher is not enforced"
manifest_match = re.search(r"^\s*@unpublished not path (.+)$", caddy, re.M)
assert manifest_match, "Missing explicit publication manifest"
manifest = manifest_match.group(1).split()
assert len(manifest) == len(set(manifest)), "Duplicate publication paths"
assert all("*" not in path and path.startswith("/") for path in manifest), "Manifest must use exact paths"
expected = {"/version.json"}
for path in SITE.rglob("*"):
    assert not path.is_symlink(), f"Unexpected site symlink: {path}"
    if not path.is_file():
        continue
    public = "/" + path.relative_to(SITE).as_posix()
    assert not blocked.search(public), f"Sensitive file in publication tree: {public}"
    expected.add(public)
    if path.name == "index.html":
        parent = public[:-len("/index.html")]
        expected.add(parent + "/")
        if parent:
            expected.add(parent)
assert set(manifest) == expected, f"Publication manifest mismatch: missing={expected-set(manifest)}, stale={set(manifest)-expected}"
assert "respond @unpublished 404" in caddy
assert "@nonread not method GET HEAD" in caddy and "respond @nonread 405" in caddy
assert 'header @nonread Allow "GET, HEAD"' in caddy
assert re.search(r"^\s*-Server\s*$", caddy, re.M), "Server header must be removed"
print(f"PASS: explicit publication manifest ({len(manifest)} public URLs), read-only method policy")

csp_match = re.search(r'^\s*Content-Security-Policy "([^"]+)"$', caddy, re.M)
assert csp_match, "CSP header missing"
csp = csp_match.group(1)
for requirement in (
    "default-src 'none'", "script-src 'self'", "style-src 'self'",
    "img-src 'self'", "font-src 'self'", "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
):
    assert requirement in csp, f"CSP requirement missing: {requirement}"

assert "unsafe-inline" not in csp and "unsafe-eval" not in csp


class InlineResourceInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline_violations = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if any(k.startswith("on") or k == "style" for k in attrs):
            self.inline_violations.append(f"{tag}: inline handler/style")
        if tag == "script":
            if not attrs.get("src"):
                self.inline_violations.append("inline script")
            elif not attrs["src"].startswith("/"):
                self.inline_violations.append("external script")
        if tag == "style":
            self.inline_violations.append("inline style element")
        if tag == "link" and attrs.get("rel") == "stylesheet":
            if not attrs.get("href", "").startswith("/"):
                self.inline_violations.append("external stylesheet")


pages = [p for p in SITE.rglob("*.html") if not p.name.startswith("google")]
assert len(pages) >= 3, "Unexpectedly few site pages checked"
for page in pages:
    inspector = InlineResourceInspector()
    inspector.feed(page.read_text(encoding="utf-8"))
    assert not inspector.inline_violations, f"{page}: {inspector.inline_violations}"

css = (SITE / "styles.css").read_text(encoding="utf-8")
assert not re.search(r'@import\b|url\(\s*["\']?https?://', css, re.I), "External CSS dependency"
print(f"PASS: CSP source compatibility ({len(pages)} pages), sensitive URL matcher, asset allowlist")
