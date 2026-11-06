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

        def _local(self) -> bool:
            return cfg.chat_lan or self.client_address[0] in ("127.0.0.1", "::1", "localhost")

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path != "/api/chat":
                self.send_error(404)
                return
            if not self._local():
                return self._json({"ok": False, "erro": "conversa só pelo computador do escritório (ou chat_lan = true)"}, 403)
            try:
                n = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            except (ValueError, OSError):
                return self._json({"ok": False, "erro": "pedido inválido"}, 400)
            agent = str(data.get("agent", "")).strip()
            if not agent or agent not in reader.agent_ids():
                return self._json({"ok": False, "erro": "agente desconhecido"}, 400)
            return self._json(reader.chat.send(agent, str(data.get("text", "")), bool(data.get("demanda", False))))

        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path == "/api/state":
                return self._json(reader.snapshot())
            if path == "/api/chat":
                params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
                from urllib.parse import unquote
                agent = unquote(params.get("agent", ""))
                st = reader.chat.state(agent)
                st["allowed"] = self._local()
                st["demand_agent"] = agent in cfg.demand_agents
                return self._json(st)
            if path == "/api/health":
                return self._json({"ok": True, "version": __version__, "office": cfg.office_name})
            if path == "/":
                self.path = "/index.html"
            return super().do_GET()

        def _json(self, data, code=200):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
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
