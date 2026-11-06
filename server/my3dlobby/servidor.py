"""Tiny HTTP server: serves web/ and the JSON API.

  GET /api/state   -> everything the 3D scene needs (agents, statuses, feed)
  GET /api/health  -> {"ok": true}
"""
from __future__ import annotations

import json
import mimetypes
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import __version__
from .config import REPO, Config

WEB = REPO / "web"

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("model/gltf-binary", ".glb")


def make_handler(reader, cfg: Config):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(WEB), **k)

        def log_message(self, fmt, *args):  # quiet
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/state":
                return self._json(reader.snapshot())
            if path == "/api/health":
                return self._json({"ok": True, "version": __version__, "office": cfg.office_name})
            if path == "/":
                self.path = "/index.html"
            return super().do_GET()

        def _json(self, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


class LobbyServer:
    def __init__(self, cfg: Config, reader):
        self.cfg = cfg
        self.reader = reader
        self.httpd = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(reader, cfg))
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="my3dlobby-http", daemon=True)

    @property
    def url(self) -> str:
        host = "127.0.0.1" if self.cfg.host in ("0.0.0.0", "") else self.cfg.host
        return f"http://{host}:{self.httpd.server_address[1]}/"

    def start(self) -> None:
        self.reader.start()
        self.thread.start()

    def stop(self) -> None:
        self.reader.stop()
        self.httpd.shutdown()
        self.httpd.server_close()


def build(cfg: Config, demo: bool = False) -> LobbyServer:
    if demo:
        from .demo import DemoReader

        reader = DemoReader(cfg)
    else:
        from .hermes import HermesReader

        reader = HermesReader(cfg)
    return LobbyServer(cfg, reader)
