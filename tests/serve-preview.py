"""Loopback-only preview fixture with the public health endpoint."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

SITE = Path(__file__).resolve().parents[1] / "site"

class Preview(SimpleHTTPRequestHandler):
    def health(self, body):
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length","2")
        self.end_headers()
        if body:
            self.wfile.write(b"ok")

    def do_GET(self):
        if urlsplit(self.path).path == "/healthz":
            self.health(True)
        else:
            super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path == "/healthz":
            self.health(False)
        else:
            super().do_HEAD()

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1",18765),partial(Preview,directory=str(SITE))).serve_forever()
