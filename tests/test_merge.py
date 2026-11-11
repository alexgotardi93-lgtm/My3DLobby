"""PRs waiting for Alex's merge, the merge button and "back to the Dev": one list of what waits for Alex.

Run: python3 -m unittest discover -s tests

GitHub is played by a fake `gh` (a small script first on PATH) that keeps the PRs in a JSON file and logs calls.
"""
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from my3dlobby.aprovacao import AprovacaoReader  # noqa: E402
from my3dlobby.atividade import CadeiaReader  # noqa: E402

PROGRAMA = '''
import os, re
from pathlib import Path
PROJETO = Path("/nao/existe")
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
    for p in sorted((ARQ / "planos").glob("PLANO-*.md")):
        d = cab(p.read_text())
        if d.get("status") in ("aguardando-alex", "escalar-arquiteto"):
            dep = d.get("depende-de", "")
            dd = cab((ARQ / "planos" / ("PLANO-" + dep + ".md")).read_text()) if dep else {}
            out.append({"tipo": "plano", "arquivo": p, "id": d.get("id", p.stem[6:]), "status": d["status"],
                        "titulo": d.get("titulo", ""), "quem": "", "quando": "", "pr": d.get("pr", ""), "anterior": "",
                        "sugestao": "", "resumo": "x", "depende": dep, "dep_status": dd.get("status", ""),
                        "dep_pr": dd.get("pr", ""), "dep_titulo": dd.get("titulo", "")})
    return out

def decidir(p, acao, motivo=""):
    novo = {"a": "pronto", "r": "descartado", "b": "backlog", "d": "pronto"}[acao]
    t = re.sub(r"^status: .*$", "status: " + novo, p["arquivo"].read_text(), count=1, flags=re.M)
    p["arquivo"].write_text(t)
    return acao + ": " + p["id"]
'''

GH = r'''#!/usr/bin/env python3
import json, sys
from pathlib import Path
base = Path(__file__).resolve().parent
estado = json.loads((base / "prs.json").read_text())
with open(base / "chamadas.log", "a") as fh:
    fh.write(" ".join(sys.argv[1:]) + "\n")
a = sys.argv[1:]
if a[:2] == ["pr", "view"]:
    pr = estado.get(a[2])
    if not pr:
        print("no pull requests found", file=sys.stderr); sys.exit(1)
    print(json.dumps({"state": pr["state"], "mergeStateStatus": pr.get("merge", "CLEAN"), "headRefName": pr["head"],
                      "baseRefName": pr.get("base", "main"), "url": "https://github.com/dono/repo/pull/" + a[2]}))
elif a[:2] == ["pr", "merge"]:
    estado[a[2]]["state"] = "MERGED"
    (base / "prs.json").write_text(json.dumps(estado))
else:
    sys.exit(2)
'''


def escrever(p: Path, texto: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8")
    return p


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        raiz = Path(self.tmp.name)
        self.lobby = raiz / "Lobby"
        self.planos = self.lobby / "arquiteto" / "planos"
        escrever(self.lobby / "perfis" / "cadeia" / "fila_aprovacao.py", PROGRAMA)
        escrever(self.planos / "PLANO-D-juiz.md", "status: aprovado\nid: D-juiz\ntitulo: Juiz\ntipo: codigo\npr: 499\n"
                 "revisado: 11/11/2026 01:40 (Reviewer, commit 97b097a)\nconferencia: ok 97b097a\n\nx\n")
        escrever(self.planos / "PLANO-D-relatorio.md", "status: escalar-arquiteto\nid: D-relatorio\ntitulo: Relatório\n"
                 "depende-de: D-juiz\n\nx\n")
        escrever(self.planos / "PLANO-D-runner.md", "status: aprovado\nid: D-runner\ntitulo: Runner\npr: 494\n\nx\n")
        escrever(self.planos / "PLANO-D-sonda.md", "status: pronto\nid: D-sonda\ntitulo: Sonda\ndepende-de: D-runner\n\nx\n")
        escrever(self.planos / "PLANO-SENT-a2.md", "status: aprovado\nid: SENT-a2\ntitulo: Limiar\ntipo: falso-positivo\n\nx\n")
        escrever(self.planos / "PLANO-D-fim.md", "status: concluido\nid: D-fim\ntitulo: Fim\npr: 470\n\nx\n")
        escrever(self.planos / "PLANO-D-decidir.md", "status: aguardando-alex\nid: D-decidir\ntitulo: Decidir\n\nx\n")
        self.repo = raiz / "super-cota-licitacao"
        escrever(self.repo / ".git" / "config", '[remote "origin"]\n\turl = https://github.com/dono/repo.git\n')
        self.bin = raiz / "bin"
        gh = escrever(self.bin / "gh", GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.prs({"499": {"state": "OPEN", "head": "plano/D-juiz"}, "494": {"state": "MERGED", "head": "plano/D-runner"}})
        self.path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{self.bin}{os.pathsep}{self.path}"
        self.r = AprovacaoReader(self.lobby, repo_dir=self.repo)
        self.ler()

    def tearDown(self):
        os.environ["PATH"] = self.path
        self.tmp.cleanup()

    def prs(self, estado: dict) -> None:
        (self.bin / "prs.json").write_text(json.dumps(estado))

    def ler(self) -> None:
        """Read, let the background GitHub check finish, read again."""
        self.r.atualizar(forcar=True)
        fim = time.time() + 10
        while self.r.prs.trabalhando and time.time() < fim:
            time.sleep(0.02)
        self.r.atualizar(forcar=True)

    def chamadas(self) -> list:
        f = self.bin / "chamadas.log"
        return f.read_text().splitlines() if f.exists() else []

    def test_uma_lista_so_decisoes_e_merges(self):
        v = self.r.vista()
        self.assertTrue(v["pode_merge"])
        self.assertEqual([m["pr"] for m in v["merges"]], ["499"])   # 494 already merged; SENT-a2 has nothing to merge
        self.assertEqual((v["n_aprovar"], v["n_merge"], v["n"]), (2, 1, 3))
        m = v["merges"][0]
        self.assertEqual((m["chave"], m["branch"], m["libera"]), ("arquiteto/planos/PLANO-D-juiz.md", "plano/D-juiz", ["Relatório"]))
        self.assertEqual(self.r.prs.slug(), "dono/repo")  # from the Dev's clone

    def test_plano_que_voltou_diz_se_a_dependencia_ja_entrou(self):
        rel = next(i for i in self.r.vista()["itens"] if i["id"] == "D-relatorio")
        self.assertEqual((rel["depende"], rel["dep_status"], rel["dep_pr"], rel["dep_ok"]), ("D-juiz", "aprovado", "499", False))

    def test_merge_pelo_lobby(self):
        res = self.r.decidir("arquiteto/planos/PLANO-D-juiz.md", "m")
        self.assertTrue(res["ok"], res)
        self.assertIn("merge do PR 499 feito", res["feito"])
        self.assertIn("libera: Relatório", res["feito"])
        self.assertIn("pr merge 499 --repo dono/repo --merge", self.chamadas())
        self.assertIn("status: aprovado", (self.planos / "PLANO-D-juiz.md").read_text())  # the Entrega marks concluido
        self.assertIn("D-juiz · merge · PR 499 na main (Alex, pelo lobby)", (self.lobby / "arquiteto" / "decisoes.md").read_text())
        v = self.r.vista()
        self.assertEqual((v["n_merge"], v["n"]), (0, 2))
        rel = next(i for i in v["itens"] if i["id"] == "D-relatorio")
        self.assertTrue(rel["dep_ok"])  # now "back to the Dev" is the way
        self.assertFalse(self.r.decidir("arquiteto/planos/PLANO-D-juiz.md", "m")["ok"])  # not twice

    def test_merge_confere_o_pr_antes(self):
        for estado, erro in (({"state": "OPEN", "head": "outra-branch"}, "não da branch do plano"),
                             ({"state": "OPEN", "head": "plano/D-juiz", "base": "dev"}, "não para a main"),
                             ({"state": "OPEN", "head": "plano/D-juiz", "merge": "DIRTY"}, "conflito"),
                             ({"state": "CLOSED", "head": "plano/D-juiz"}, "fechado sem merge")):
            self.prs({"499": estado, "494": {"state": "MERGED", "head": "plano/D-runner"}})
            self.r.prs.estados.pop("499", None)
            res = self.r.decidir("arquiteto/planos/PLANO-D-juiz.md", "m")
            self.assertFalse(res["ok"])
            self.assertIn(erro, res["erro"])
        self.assertFalse(any(c.startswith("pr merge") for c in self.chamadas()))

    def test_merge_so_do_que_esta_na_lista(self):
        for chave in ("arquiteto/planos/PLANO-D-sonda.md", "arquiteto/planos/PLANO-SENT-a2.md", "../etc/passwd"):
            self.assertFalse(self.r.decidir(chave, "m")["ok"])
        self.assertFalse(any(c.startswith("pr merge") for c in self.chamadas()))

    def test_devolver_ao_dev_so_plano_que_voltou(self):
        self.assertFalse(self.r.decidir("arquiteto/planos/PLANO-D-decidir.md", "d")["ok"])
        res = self.r.decidir("arquiteto/planos/PLANO-D-relatorio.md", "d")
        self.assertTrue(res["ok"], res)
        self.assertIn("status: pronto", (self.planos / "PLANO-D-relatorio.md").read_text())

    def test_sem_gh_lista_mas_nao_faz_merge(self):
        os.environ["PATH"] = "/nao/existe"
        r = AprovacaoReader(self.lobby, repo_dir=self.repo)
        r.prs.gh = lambda: ""
        r.atualizar(forcar=True)
        v = r.vista()
        self.assertFalse(v["pode_merge"])
        self.assertEqual(sorted(m["pr"] for m in v["merges"]), ["494", "499"])  # no GitHub state: both still listed
        res = r.decidir("arquiteto/planos/PLANO-D-juiz.md", "m")
        self.assertFalse(res["ok"])
        self.assertIn("gh", res["erro"])

    def test_quadro_voce_e_a_mesma_lista(self):
        c = CadeiaReader(self.lobby, store=Path(self.tmp.name) / "store")
        c.atualizar()
        itens = {i["id"]: i for i in c.vista(self.r.para_quadro())["itens"]}
        voce = sorted(i for i, x in itens.items() if x["dono"] == "alex")
        self.assertEqual(voce, ["D-decidir", "D-juiz", "D-relatorio"])
        self.assertEqual(len(voce), self.r.vista()["n"])
        self.assertEqual(itens["D-juiz"]["merge"], "arquiteto/planos/PLANO-D-juiz.md")
        self.assertEqual(itens["D-relatorio"]["chave"], "arquiteto/planos/PLANO-D-relatorio.md")
        self.assertEqual((itens["D-runner"]["dono"], itens["D-runner"]["etapa"]), ("fim", "merge-feito"))  # merged on GitHub
        self.assertEqual((itens["D-sonda"]["dono"], itens["D-sonda"]["etapa"]), ("dev", "fila-dev"))  # its dependency entered
        self.assertEqual(itens["SENT-a2"]["dono"], "fim")
        # what waits for Alex's turn carries the same buttons in its "Espera" box
        escrever(self.planos / "PLANO-D-x.md", "status: pronto\nid: D-x\ntitulo: X\ndepende-de: D-juiz\n\nx\n")
        escrever(self.planos / "PLANO-D-y.md", "status: pronto\nid: D-y\ntitulo: Y\ndepende-de: D-relatorio\n\nx\n")
        c.atualizar()
        itens = {i["id"]: i for i in c.vista(self.r.para_quadro())["itens"]}
        self.assertEqual((itens["D-x"]["espera"]["etapa"], itens["D-x"]["espera"]["merge"]), ("merge", "arquiteto/planos/PLANO-D-juiz.md"))
        self.assertEqual(itens["D-y"]["espera"]["chave"], "arquiteto/planos/PLANO-D-relatorio.md")
        # without the Fila (another office) the board keeps its own rules
        sem = {i["id"]: i for i in c.vista()["itens"]}
        self.assertEqual(sem["D-sonda"]["etapa"], "bloqueado")

    def test_voltou_parado_que_a_fila_nao_lista_nao_fica_com_voce(self):
        # the Fila sees an open retorno the board missed: the board must not say "only moves with your yes"
        para = {"pendentes": {}, "merges": {}, "mergeados": []}
        c = CadeiaReader(self.lobby, store=Path(self.tmp.name) / "store2")
        c.atualizar()
        itens = {i["id"]: i for i in c.vista(para)["itens"]}
        self.assertEqual((itens["D-relatorio"]["dono"], itens["D-relatorio"]["etapa"]), ("arquiteto", "voltou-corrigir"))
        self.assertNotIn("voltou-parado", [i["etapa"] for i in itens.values()])


if __name__ == "__main__":
    unittest.main()
