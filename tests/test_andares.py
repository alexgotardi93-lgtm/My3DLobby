"""Floors (andares): defaults, [[floor]] config, changes from the UI and the HTTP endpoint.

Run: python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from my3dlobby.andares import MAX_ANDARES, Andares  # noqa: E402
from my3dlobby.config import Config, parse_toml, _apply  # noqa: E402

BPG = ["zap", "financeiro", "dev", "arquiteto", "reviewer"]
WIN = ["win-pesquisador", "win-estrategista", "win-vigia", "win-revisor"]


def agentes(ids, desks=None):
    desks = desks or {}
    return [{"id": i, "status": "working" if i == "dev" else "idle", "desk": desks.get(i),
             "desk_fixa": i in desks} for i in ids]


class AndaresTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arquivo = Path(self.tmp.name) / "andares.json"
        self.cfg = Config(office_name="BPG Sistemas")

    def tearDown(self):
        self.tmp.cleanup()

    def novo(self):
        return Andares(self.cfg, self.arquivo)

    def test_padrao_um_andar_e_mesa_win_no_segundo(self):
        a = self.novo()
        self.assertEqual([x["nome"] for x in a.lista(BPG)], ["BPG Sistemas"])
        ags = agentes(BPG + WIN)
        andares = a.aplicar(ags)
        self.assertEqual([(x["numero"], x["nome"]) for x in andares], [(1, "BPG Sistemas"), (2, "Mesa WIN")])
        self.assertEqual(andares[1]["agentes"], WIN)
        self.assertEqual(andares[0]["trabalhando"], 1)
        por_id = {x["id"]: x for x in ags}
        self.assertEqual([por_id[i]["desk"] for i in WIN], [0, 1, 2, 3])  # mesas contadas dentro do andar
        self.assertNotIn("desk_fixa", por_id["zap"])
        self.assertFalse(self.arquivo.exists())  # o padrão não grava nada

    def test_mesa_fixa_e_respeitada_dentro_do_andar(self):
        ags = agentes(BPG, desks={"dev": 0})
        self.novo().aplicar(ags)
        self.assertEqual({a["id"]: a["desk"] for a in ags},
                         {"zap": 1, "financeiro": 2, "dev": 0, "arquiteto": 3, "reviewer": 4})

    def test_floor_no_toml(self):
        _apply(self.cfg, parse_toml('[[floor]]\nname = "Diretoria"\nprofiles = ["arquiteto", "reviewer"]\n'
                                    '[[floor]]\nname = "Operação"\nprofiles = ["*"]\n'))
        andares = self.novo().aplicar(agentes(BPG))
        self.assertEqual([(x["nome"], x["agentes"]) for x in andares],
                         [("Diretoria", ["arquiteto", "reviewer"]), ("Operação", ["zap", "financeiro", "dev"])])

    def test_criar_mover_editar_remover(self):
        a = self.novo()
        todos = BPG + WIN
        r = a.executar({"acao": "criar", "nome": "  Laboratório   de   IA  ", "agentes": ["dev", "fantasma"]}, todos)
        self.assertTrue(r["ok"])
        self.assertTrue(self.arquivo.exists())
        lab = r["andar"]
        andares = self.novo().aplicar(agentes(todos))  # relê do arquivo
        nomes = {x["nome"]: x for x in andares}
        self.assertEqual(list(nomes), ["BPG Sistemas", "Mesa WIN", "Laboratório de IA"])
        self.assertEqual(nomes["Laboratório de IA"]["agentes"], ["dev"])  # "fantasma" não existe: ignorado
        self.assertEqual(nomes["Mesa WIN"]["agentes"], WIN)  # o curinga "win-*" do padrão ficou gravado
        # mover
        self.assertTrue(a.executar({"acao": "mover", "agente": "zap", "andar": lab}, todos)["ok"])
        self.assertEqual(Andares.andar_de(a.lista(todos), "zap"), lab)
        # editar: renomeia, traz o financeiro e tira o dev (volta para o 1º)
        r = a.executar({"acao": "editar", "andar": lab, "nome": "Lab", "agentes": ["zap", "financeiro"]}, todos)
        self.assertTrue(r["ok"])
        andares = a.aplicar(agentes(todos))
        lab_v = next(x for x in andares if x["id"] == lab)
        self.assertEqual((lab_v["nome"], lab_v["agentes"]), ("Lab", ["zap", "financeiro"]))
        self.assertIn("dev", andares[0]["agentes"])
        # tirar um agente do 1º andar pelo editar não faz nada (ele não teria para onde ir)
        a.executar({"acao": "editar", "andar": andares[0]["id"], "agentes": []}, todos)
        self.assertIn("dev", a.aplicar(agentes(todos))[0]["agentes"])
        # tirar do andar que pegou pelo curinga: volta para o 1º
        mesa = next(x for x in andares if x["nome"] == "Mesa WIN")["id"]
        a.executar({"acao": "editar", "andar": mesa, "agentes": ["win-vigia"]}, todos)
        andares = a.aplicar(agentes(todos))
        self.assertEqual(next(x for x in andares if x["id"] == mesa)["agentes"], ["win-vigia"])
        self.assertIn("win-revisor", andares[0]["agentes"])
        # remover: os agentes voltam pelo curinga/“*”
        self.assertFalse(a.executar({"acao": "remover", "andar": andares[0]["id"]}, todos)["ok"])
        self.assertTrue(a.executar({"acao": "remover", "andar": lab}, todos)["ok"])
        andares = a.aplicar(agentes(todos))
        self.assertIn("zap", andares[0]["agentes"])
        self.assertEqual(len(andares), 2)

    def test_pedidos_invalidos(self):
        a = self.novo()
        self.assertFalse(a.executar({"acao": "criar", "nome": "   "}, BPG)["ok"])
        self.assertFalse(a.executar({"acao": "mover", "agente": "zap", "andar": "a9"}, BPG)["ok"])
        self.assertFalse(a.executar({"acao": "mover", "agente": "ninguem", "andar": "a1"}, BPG)["ok"])
        self.assertFalse(a.executar({"acao": "voar"}, BPG)["ok"])
        for i in range(MAX_ANDARES - 1):
            self.assertTrue(a.executar({"acao": "criar", "nome": f"A{i}"}, BPG)["ok"])
        self.assertFalse(a.executar({"acao": "criar", "nome": "demais"}, BPG)["ok"])

    def test_arquivo_estragado_volta_ao_padrao(self):
        self.arquivo.write_text("{não é json", encoding="utf-8")
        self.assertEqual(len(self.novo().lista(BPG + WIN)), 2)


class HttpTest(unittest.TestCase):
    def test_endpoint(self):
        from my3dlobby import servidor

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Config(office_name="BPG Sistemas", port=0)
        srv = servidor.build(cfg, demo=True)
        srv.reader.andares = Andares(cfg, Path(tmp.name) / "andares.json")
        srv.start()
        self.addCleanup(srv.stop)
        base = srv.url

        def post(dado):
            req = urllib.request.Request(base + "api/andares", data=json.dumps(dado).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())

        with urllib.request.urlopen(base + "api/state", timeout=5) as r:
            estado = json.loads(r.read())
        self.assertEqual([x["nome"] for x in estado["andares"]], ["BPG Sistemas", "Mesa WIN"])
        codigo, res = post({"acao": "criar", "nome": "Diretoria", "agentes": ["arquiteto"]})
        self.assertEqual((codigo, res["ok"]), (200, True))
        codigo, res = post({"acao": "criar", "nome": ""})
        self.assertEqual((codigo, res["ok"]), (400, False))
        codigo, res = post(["lista"])
        self.assertEqual(codigo, 400)
        with urllib.request.urlopen(base + "api/state", timeout=5) as r:
            estado = json.loads(r.read())
        dire = next(x for x in estado["andares"] if x["nome"] == "Diretoria")
        self.assertEqual(dire["agentes"], ["arquiteto"])
        self.assertEqual(next(a for a in estado["agents"] if a["id"] == "arquiteto")["andar"], dire["id"])


if __name__ == "__main__":
    unittest.main()
