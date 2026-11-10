"""Fila do Arquiteto: the adapter over the chain's own program, the HTTP endpoints and lobby demands.

Run: python3 -m unittest discover -s tests

The chain program (<lobby>/perfis/cadeia/fila_aprovacao.py) belongs to the agent chain, not to this repo, so
these tests write a small stand-in with the same interface: pendentes() and decidir(p, acao, motivo), using the
module globals PROJETO and ARQ.
"""
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from my3dlobby import servidor  # noqa: E402
from my3dlobby.aprovacao import AprovacaoReader, origem  # noqa: E402
from my3dlobby.chat import ChatHub  # noqa: E402
from my3dlobby.config import Config  # noqa: E402

PROGRAMA = '''
import os, re
from pathlib import Path
PROJETO = Path(os.environ.get("BPG_LOBBY_PROJETO") or "/nao/existe")
ARQ = PROJETO / "arquiteto"

def cab(t):
    d = {}
    for l in t.splitlines():
        if not l.strip():
            break
        m = re.match(r"^([a-z-]+):\\s*(.*)$", l)
        if m:
            d[m.group(1)] = m.group(2)
    return d

def pendentes():
    out = []
    for p in sorted((ARQ / "entrada").glob("*/item.md")):
        d = cab(p.read_text())
        if d.get("status", "novo") in ("novo", "em-triagem") and not d.get("aprovado"):
            out.append({"tipo": "item", "arquivo": p, "id": p.parent.name, "status": d.get("status", "novo"),
                        "titulo": d.get("titulo", ""), "quem": d.get("quem", ""), "quando": d.get("quando", ""),
                        "sugestao": d.get("triagem", ""), "resumo": p.read_text().split("\\n\\n", 1)[-1].strip()})
    for p in sorted((ARQ / "planos").glob("PLANO-*.md")):
        d = cab(p.read_text())
        if d.get("status") in ("aguardando-alex", "aguardando-aprovacao"):
            out.append({"tipo": "plano", "arquivo": p, "id": d.get("id", p.stem[6:]), "status": d["status"],
                        "titulo": d.get("titulo", ""), "quem": d.get("origem", ""), "quando": d.get("criado", ""),
                        "pr": d.get("pr", ""), "anterior": "", "sugestao": "", "resumo": "pergunta"})
    return out

def decidir(p, acao, motivo=""):
    t = p["arquivo"].read_text()
    novo = {"a": "aprovado-stub", "r": "descartado", "b": "backlog"}[acao]
    t = re.sub(r"^status: .*$", "status: " + novo, t, count=1, flags=re.M)
    p["arquivo"].write_text(t)
    with open(ARQ / "decisoes.md", "a") as fh:
        fh.write(p["id"] + " " + acao + " " + motivo + "\\n")
    return acao + ": " + p["id"]
'''


def escrever(p: Path, texto: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8")
    return p


class Lobby:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raiz = Path(self.tmp.name)
        self.arq = self.raiz / "arquiteto"
        escrever(self.raiz / "perfis" / "cadeia" / "fila_aprovacao.py", PROGRAMA)
        escrever(self.arq / "entrada" / "2026-11-10-0802-cesta" / "item.md",
                 "status: novo\ntitulo: Cesta arredondamento\nquem: Cliente\nquando: 10/11/2026 08:02\n"
                 "triagem: plano\n\nA cliente pergunta. token=abc123secretvalue\n")
        escrever(self.arq / "entrada" / "SENT-20261109-1940-diario" / "item.md",
                 "status: em-triagem\ntitulo: Sentinela diario\nquem: Sentinela\n\nRelatorio.\n")
        escrever(self.arq / "entrada" / "2026-11-09-ja-aprovado" / "item.md",
                 "status: novo\naprovado: 09/11/2026 10:00 (Alex)\ntitulo: Ja aprovado\n\nx\n")
        escrever(self.arq / "planos" / "PLANO-D-1-rpc.md",
                 "status: aguardando-alex\nid: D-1-rpc\ntitulo: Funcao\norigem: demanda:x.md\npr: 484\ncriado: 10/11/2026 02:20\n\n## Pedido\n")
        escrever(self.arq / "planos" / "PLANO-D-2-pronto.md", "status: pronto\nid: D-2\n\nx\n")

    def close(self):
        self.tmp.cleanup()


class AprovacaoReaderTest(unittest.TestCase):
    def setUp(self):
        self.lobby = Lobby()
        self.r = AprovacaoReader(self.lobby.raiz)
        self.r.atualizar(forcar=True)

    def tearDown(self):
        self.lobby.close()

    def test_lista_o_que_espera_com_origem_e_chave(self):
        v = self.r.vista()
        self.assertTrue(v["disponivel"])
        self.assertEqual(v["n"], 3)
        por_chave = {i["chave"]: i for i in v["itens"]}
        self.assertEqual(set(por_chave), {"arquiteto/entrada/2026-11-10-0802-cesta/item.md",
                                          "arquiteto/entrada/SENT-20261109-1940-diario/item.md",
                                          "arquiteto/planos/PLANO-D-1-rpc.md"})
        cesta = por_chave["arquiteto/entrada/2026-11-10-0802-cesta/item.md"]
        self.assertEqual((cesta["origem"], cesta["sugestao"]), ("whatsapp", "plano"))
        self.assertTrue(cesta["quando_iso"].startswith("2026-11-10T08:02"))
        self.assertNotIn("abc123secretvalue", cesta["resumo"])  # masked
        self.assertEqual(por_chave["arquiteto/entrada/SENT-20261109-1940-diario/item.md"]["origem"], "sentinela")
        plano = por_chave["arquiteto/planos/PLANO-D-1-rpc.md"]
        self.assertEqual((plano["origem"], plano["de"], plano["pr"]), ("plano", "demanda", "484"))

    def test_trava(self):
        self.assertFalse(self.r.vista()["trava"])
        (self.lobby.arq / ".trava-aprovacao").write_text("10/11/2026 09:00")
        self.r.atualizar(forcar=True)
        self.assertTrue(self.r.vista()["trava"])

    def test_decidir_usa_o_programa_da_cadeia_e_atualiza_a_lista(self):
        res = self.r.decidir("arquiteto/planos/PLANO-D-1-rpc.md", "a")
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["feito"], "a: D-1-rpc")
        self.assertIn("status: aprovado-stub", (self.lobby.arq / "planos" / "PLANO-D-1-rpc.md").read_text())
        self.assertEqual(self.r.vista()["n"], 2)
        res = self.r.decidir("arquiteto/entrada/2026-11-10-0802-cesta/item.md", "r", "  fora do\n escopo  ")
        self.assertTrue(res["ok"])
        self.assertIn("2026-11-10-0802-cesta r fora do escopo", (self.lobby.arq / "decisoes.md").read_text())

    def test_decidir_recusa_o_que_nao_esta_na_fila_ou_acao_invalida(self):
        self.assertFalse(self.r.decidir("arquiteto/planos/PLANO-D-2-pronto.md", "a")["ok"])
        self.assertFalse(self.r.decidir("../../etc/passwd", "a")["ok"])
        self.assertFalse(self.r.decidir("arquiteto/planos/PLANO-D-1-rpc.md", "x")["ok"])
        self.assertIn("status: aguardando-alex", (self.lobby.arq / "planos" / "PLANO-D-1-rpc.md").read_text())

    def test_detalhe_so_de_item_da_fila(self):
        ok = self.r.detalhe("arquiteto/entrada/2026-11-10-0802-cesta/item.md")
        self.assertTrue(ok["ok"])
        self.assertIn("Cesta arredondamento", ok["texto"])
        self.assertNotIn("abc123secretvalue", ok["texto"])
        self.assertFalse(self.r.detalhe("arquiteto/planos/PLANO-D-2-pronto.md")["ok"])
        self.assertFalse(self.r.detalhe("../perfis/cadeia/fila_aprovacao.py")["ok"])

    def test_sem_o_programa_fica_indisponivel(self):
        (self.lobby.raiz / "perfis" / "cadeia" / "fila_aprovacao.py").unlink()
        self.r.atualizar(forcar=True)
        v = self.r.vista()
        self.assertEqual((v["disponivel"], v["n"]), (False, 0))
        self.assertFalse(self.r.decidir("arquiteto/planos/PLANO-D-1-rpc.md", "a")["ok"])

    def test_programa_quebrado_nao_derruba(self):
        (self.lobby.raiz / "perfis" / "cadeia" / "fila_aprovacao.py").write_text("def pendentes(:\n")
        self.r.atualizar(forcar=True)
        self.assertIn("SyntaxError", self.r.vista()["erro"])

    def test_origem(self):
        self.assertEqual(origem({"tipo": "item", "id": "SENTRY-1"}), "sentry")
        self.assertEqual(origem({"tipo": "retorno", "id": "x"}), "retorno")


class StubChat:
    def send(self, agent, text, demanda):
        return {"ok": True, "demanda": ""}


class StubReader:
    def __init__(self, aprovacao):
        self.aprovacao = aprovacao
        self.chat = StubChat()

    def agent_ids(self):
        return ["arquiteto"]


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.lobby = Lobby()
        self.aprov = AprovacaoReader(self.lobby.raiz)
        self.aprov.atualizar(forcar=True)
        cfg = Config()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), servidor.make_handler(StubReader(self.aprov), cfg))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.lobby.close()

    def pedir(self, path, dados=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if dados is None else json.dumps(dados).encode(),
                                     headers=headers or {}, method="GET" if dados is None else "POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_get_lista_e_detalhe(self):
        code, j = self.pedir("/api/aprovacao")
        self.assertEqual((code, j["n"], j["allowed"]), (200, 3, True))
        code, j = self.pedir("/api/aprovacao/detalhe?chave=arquiteto%2Fplanos%2FPLANO-D-1-rpc.md")
        self.assertEqual(code, 200)
        self.assertIn("Funcao", j["texto"])
        code, _ = self.pedir("/api/aprovacao/detalhe?chave=arquiteto%2Fplanos%2FPLANO-D-2-pronto.md")
        self.assertEqual(code, 404)

    def test_post_so_json_e_da_propria_pagina(self):
        chave = "arquiteto/planos/PLANO-D-1-rpc.md"
        host = self.base.split("//", 1)[1]
        code, _ = self.pedir("/api/aprovacao", {"chave": chave, "acao": "a"}, {"Content-Type": "text/plain"})
        self.assertEqual(code, 403)
        code, _ = self.pedir("/api/aprovacao", {"chave": chave, "acao": "a"},
                             {"Content-Type": "application/json", "Origin": "https://site-malicioso.example"})
        self.assertEqual(code, 403)
        code, _ = self.pedir("/api/aprovacao", {"chave": chave, "acao": "a"}, {"Content-Type": "application/json", "Origin": "null"})
        self.assertEqual(code, 403)
        code, j = self.pedir("/api/aprovacao", {"chave": chave, "acao": "a"},
                             {"Content-Type": "application/json", "Origin": f"http://{host}"})
        self.assertEqual((code, j["ok"]), (200, True))
        code, j = self.pedir("/api/aprovacao", {"chave": chave, "acao": "a"}, {"Content-Type": "application/json"})
        self.assertEqual((code, j["ok"]), (409, False))  # already decided

    def test_chat_tambem_exige_a_propria_pagina(self):
        code, _ = self.pedir("/api/chat", {"agent": "arquiteto", "text": "oi"},
                             {"Content-Type": "application/json", "Origin": "https://outro.example"})
        self.assertEqual(code, 403)
        code, j = self.pedir("/api/chat", {"agent": "arquiteto", "text": "oi"}, {"Content-Type": "application/json"})
        self.assertEqual((code, j["ok"]), (200, True))


class DemandaDoLobbyTest(unittest.TestCase):
    def test_demanda_escrita_pelo_alex_nasce_aprovada(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config()
            cfg.lobby_dir = tmp
            hub = ChatHub.__new__(ChatHub)
            hub.cfg = cfg
            caminho = Path(ChatHub._write_demand(hub, "Quero um relatório semanal de uso por município"))
            cab = caminho.read_text(encoding="utf-8").split("\n\n", 1)[0]
            self.assertIn("status: novo", cab)
            self.assertRegex(cab, r"(?m)^aprovado: \d{2}/\d{2}/\d{4} \d{2}:\d{2} \(Alex, pelo lobby\)$")


if __name__ == "__main__":
    unittest.main()
