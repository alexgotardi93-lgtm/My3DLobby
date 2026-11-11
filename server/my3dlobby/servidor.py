"""Tiny HTTP server: serves web/ and the JSON API.

  GET  /api/state            -> everything the 3D scene needs (agents, statuses, feed, what each agent is
                                doing now, the chain board and the conversation previews)
  GET  /api/chat?agent=X     -> the conversation with one agent
  POST /api/chat             -> {"agent", "text", "demanda"}: talk to an agent (local only)
  GET  /api/conversas/busca?q=  -> messages containing q, across all agents
  GET  /api/uso?periodo=hoje|7d|mes|30d -> tokens and US$ per agent, per day (or hour) and in total
  GET  /api/aprovacao        -> everything that waits for Alex: decisions of the Fila do Arquiteto and PRs the
                                Reviewer approved, waiting for his merge
  GET  /api/aprovacao/detalhe?chave=  -> the whole text of one pending item
  POST /api/aprovacao        -> {"chave", "acao", "motivo"} (local only): a = approve, r = refuse, b = backlog,
                                d = back to the Dev (a plan that stopped), m = merge the PR (merge commit into main)
  GET  /api/health           -> {"ok": true}

POSTs are accepted only from the office computer (or the LAN with chat_lan = true), only as JSON and only
from the lobby's own page (a page from another site cannot make the browser talk to the agents or decide).
"""
from __future__ import annotations

import json
import mimetypes
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

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

        def _mesma_origem(self) -> bool:
            """A browser always sends Origin on a POST; it must be this server (the page the lobby served)."""
            origem = self.headers.get("Origin")
            if origem is None:
                return True  # not a browser (curl, tests): the local-only rule still applies
            return urlsplit(origem).netloc.lower() == str(self.headers.get("Host", "")).lower() != ""

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in ("/api/chat", "/api/aprovacao"):
                self.send_error(404)
                return
            if not self._local():
                quem = "conversa" if path == "/api/chat" else "aprovação"
                return self._json({"ok": False, "erro": f"{quem} só pelo computador do escritório (ou chat_lan = true)"}, 403)
            if not self._mesma_origem() or not self.headers.get("Content-Type", "").startswith("application/json"):
                return self._json({"ok": False, "erro": "pedido recusado: só a página do próprio lobby pode enviar"}, 403)
            try:
                n = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(min(n, 200_000)).decode("utf-8") or "{}")
                if not isinstance(data, dict):
                    raise ValueError
            except (ValueError, OSError):
                return self._json({"ok": False, "erro": "pedido inválido"}, 400)
            if path == "/api/aprovacao":
                res = reader.aprovacao.decidir(str(data.get("chave", "")), str(data.get("acao", "")), str(data.get("motivo", "")))
                return self._json(res, 200 if res.get("ok") else 409)
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
            if path == "/api/conversas/busca":
                from urllib.parse import parse_qs
                q = (parse_qs(query).get("q") or [""])[0]
                return self._json({"q": q, "results": reader.chat.buscar(q)})
            if path == "/api/uso":
                from urllib.parse import parse_qs
                periodo = (parse_qs(query).get("periodo") or ["mes"])[0]
                try:
                    return self._json(reader.uso_resumo(periodo))
                except Exception as e:  # a locked or odd state.db must not take the page down
                    return self._json({"ok": False, "erro": f"uso: {e}"}, 500)
            if path == "/api/aprovacao":
                st = reader.aprovacao.vista()
                st["allowed"] = self._local()
                return self._json(st)
            if path == "/api/aprovacao/detalhe":
                from urllib.parse import parse_qs
                chave = (parse_qs(query).get("chave") or [""])[0]
                res = reader.aprovacao.detalhe(chave)
                return self._json(res, 200 if res.get("ok") else 404)
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
