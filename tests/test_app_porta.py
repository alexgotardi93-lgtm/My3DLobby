"""The desktop app takes the port over from an older My3DLobby still running, and leaves anything else alone.

Run: python3 -m unittest discover -s tests
"""
import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("my3dlobby_app", RAIZ / "app" / "my3dlobby_app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def porta_vaga() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def esperar(porta: int, segundos: float = 10) -> None:
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{porta}/", timeout=1).close()
            return
        except Exception:
            time.sleep(0.2)
    raise AssertionError(f"nada respondeu na porta {porta}")


class Cfg:
    def __init__(self, porta):
        self.port = porta
        self.host = "127.0.0.1"


@unittest.skipUnless(os.name == "posix" and shutil.which("lsof"), "precisa de lsof (macOS/Linux)")
class AssumirPortaTest(unittest.TestCase):
    def setUp(self):
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.wait(timeout=5)

    def lobby_falso(self, versao: str) -> int:
        """A stand-in for an older lobby: Python running `-m my3dlobby`, answering /api/health with that version."""
        porta = porta_vaga()
        pasta = Path(self.id().replace(".", "_"))
        codigo = (
            "import http.server, json\n"
            "class H(http.server.BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            f"        b = json.dumps({{'ok': True, 'version': '{versao}'}}).encode()\n"
            "        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)\n"
            "    def log_message(self, *a): pass\n"
            f"http.server.HTTPServer(('127.0.0.1', {porta}), H).serve_forever()\n"
        )
        import tempfile
        d = Path(tempfile.mkdtemp()) / "my3dlobby"
        d.mkdir()
        (d / "__init__.py").write_text("")
        (d / "__main__.py").write_text(codigo)
        self.procs.append(subprocess.Popen([sys.executable, "-m", "my3dlobby"], cwd=d.parent))
        esperar(porta)
        return porta

    def test_versao_antiga_sai_e_a_porta_fica_livre(self):
        porta = self.lobby_falso("0.0.1")
        self.assertEqual(app.versao_no_ar(porta), "0.0.1")
        self.assertEqual(app.lobbies_na_porta(porta), [self.procs[-1].pid])
        self.assertTrue(app.assumir_porta(Cfg(porta)))
        self.procs[-1].wait(timeout=5)
        self.assertTrue(app.porta_livre("127.0.0.1", porta))

    def test_mesma_versao_continua(self):
        porta = self.lobby_falso(app.__version__)
        self.assertFalse(app.assumir_porta(Cfg(porta)))
        self.assertIsNone(self.procs[-1].poll())

    def test_outro_programa_na_porta_nao_e_tocado(self):
        porta = porta_vaga()
        self.procs.append(subprocess.Popen([sys.executable, "-m", "http.server", str(porta), "--bind", "127.0.0.1"],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        esperar(porta)
        self.assertEqual(app.lobbies_na_porta(porta), [])
        self.assertFalse(app.assumir_porta(Cfg(porta)))
        self.assertIsNone(self.procs[-1].poll())


if __name__ == "__main__":
    unittest.main()
