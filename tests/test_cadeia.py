"""Cadeia board: who has each item of the chain, what it means and what a stuck plan waits for.

Run: python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from my3dlobby.atividade import CadeiaReader  # noqa: E402


def escrever(p: Path, texto: str, idade_h: float = 0) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8")
    if idade_h:
        t = time.time() - idade_h * 3600
        os.utime(p, (t, t))


class QuadroTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        raiz = Path(self.tmp.name)
        self.lobby = raiz / "Lobby"
        a = self.lobby / "arquiteto"
        escrever(a / "entrada" / "2026-11-10-0802-cesta" / "item.md", "status: novo\ntitulo: Cesta\nquem: Cliente\n\nx\n")
        escrever(a / "entrada" / "SENT-20261110-1940-diario" / "item.md", "status: em-triagem\ntitulo: Sentinela\n\nx\n")
        escrever(a / "entrada" / "velho" / "item.md", "status: avaliado\ntitulo: Velho\n\nx\n")
        escrever(a / "demandas" / "2026-11-10-0930-relatorio.md", "status: em-avaliacao\nid: D-rel\ntitulo: Relatório\n"
                 "aprovado: 10/11/2026 09:30 (Alex)\nem-avaliacao-desde: 10/11/2026 09:31\n\nx\n")
        escrever(a / "retornos" / "D-edge-volta-20261110-1250.md", "status: novo\naprovado: 10/11/2026 12:50 (Alex)\n"
                 "plano: planos/PLANO-D-edge.md\ntitulo: Refazer: edge\n\nx\n")
        escrever(a / "planos" / "PLANO-D-edge.md", "status: escalar-arquiteto\nid: D-edge\ntitulo: Edge\npr: 480\n\nx\n")
        escrever(a / "planos" / "PLANO-D-runner.md", "status: escalar-arquiteto\nid: D-runner\ntitulo: Runner\n\nx\n")
        escrever(a / "planos" / "PLANO-D-juiz.md", "status: pronto\nid: D-juiz\ntitulo: Juiz\ndepende-de: D-runner\n\nx\n")
        escrever(a / "planos" / "PLANO-D-funcoes.md", "status: pronto\nid: D-funcoes\ntitulo: Funções\ndepende-de: D-edge\n\nx\n")
        escrever(a / "planos" / "PLANO-D-b.md", "status: pronto\nid: D-b\ntitulo: B\nprioridade: media\n\nx\n", idade_h=1)
        escrever(a / "planos" / "PLANO-D-a.md", "status: pronto\nid: D-a\ntitulo: A\nprioridade: alta\n\nx\n")
        escrever(a / "planos" / "PLANO-D-c.md", "status: pronto\nid: D-c\ntitulo: C\n\nx\n", idade_h=2)
        escrever(a / "planos" / "PLANO-D-exec.md", "status: em-execucao\nid: D-exec\ntitulo: Exec\n"
                 "em-execucao-desde: 10/11/2026 12:40\n\nx\n")
        escrever(a / "planos" / "PLANO-D-pr.md", "status: em-revisao\nid: D-pr\ntitulo: PR\npr: 484\n\nx\n")
        escrever(a / "planos" / "PLANO-D-conf.md", "status: em-revisao\nid: D-conf\ntitulo: Conferido\npr: 485\n"
                 "conferencia: ok 1234 10/11/2026 12:00\n\nx\n")
        escrever(a / "planos" / "PLANO-D-merge.md", "status: aprovado\nid: D-merge\ntitulo: Merge\npr: 471\n\nx\n")
        escrever(a / "planos" / "PLANO-D-fim.md", "status: concluido\nid: D-fim\ntitulo: Fim\n\nx\n", idade_h=3)
        escrever(a / "planos" / "PLANO-D-fim-velho.md", "status: concluido\nid: D-fim-velho\ntitulo: Fim velho\n\nx\n", idade_h=72)
        escrever(a / "planos" / "PLANO-D-back.md", "status: backlog\nid: D-back\ntitulo: Back\n\nx\n")
        escrever(a / "planos" / "PLANO-D-desc.md", "status: descartado\nid: D-desc\ntitulo: Desc\n\nx\n")
        escrever(a / "planos" / "PLANO-D-decidir.md", "status: aguardando-alex\nid: D-decidir\ntitulo: Decidir\n\nx\n")
        self.r = CadeiaReader(self.lobby, store=raiz / "store")
        self.r.atualizar()

    def tearDown(self):
        self.tmp.cleanup()

    def quadro(self):
        return {i["id"]: i for i in self.r.vista()["itens"]}

    def test_quem_tem_cada_coisa(self):
        q = self.quadro()
        esperado = {
            "2026-11-10-0802-cesta": ("arquiteto", "fila-arquiteto"),   # trava desligada: o Arquiteto pega
            "SENT-20261110-1940-diario": ("conferente", "triagem"),
            "D-rel": ("arquiteto", "avaliando"),
            "D-edge-volta-20261110-1250": ("arquiteto", "corrigir"),
            "D-runner": ("alex", "voltou-parado"),                     # ninguém pegou
            "D-juiz": ("dev", "bloqueado"),
            "D-funcoes": ("dev", "bloqueado"),
            "D-a": ("dev", "fila-dev"), "D-b": ("dev", "fila-dev"), "D-c": ("dev", "fila-dev"),
            "D-exec": ("dev", "executando"),
            "D-pr": ("conferente", "pr-aberto"),
            "D-conf": ("reviewer", "fila-reviewer"),
            "D-merge": ("alex", "merge"),
            "D-fim": ("fim", "concluido"),
            "D-back": ("backlog", "backlog"),
            "D-decidir": ("alex", "decidir"),
        }
        self.assertEqual({k: (v["dono"], v["etapa"]) for k, v in q.items()}, esperado)

    def test_um_cartao_por_trabalho(self):
        q = self.quadro()
        self.assertNotIn("D-edge", q)   # the plan that came back is shown by its retorno, not twice
        self.assertEqual((q["D-edge-volta-20261110-1250"]["plano"], q["D-edge-volta-20261110-1250"]["pr"]), ("D-edge", "480"))

    def test_retorno_antigo_com_o_mesmo_id_nao_esconde_o_aberto(self):
        a = self.lobby / "arquiteto"
        escrever(a / "planos" / "PLANO-D-rpc.md", "status: escalar-arquiteto\nid: D-rpc\ntitulo: RPC\npr: 484\n\nx\n")
        escrever(a / "retornos" / "D-rpc-desenho.md", "status: em-avaliacao\nid: D-rpc\nplano: planos/PLANO-D-rpc.md\n"
                 "titulo: Bug de desenho\naprovado: 11/11/2026 11:21 (Alex)\n\nx\n")
        escrever(a / "retornos" / "D-rpc-execucao.md", "status: avaliado\nid: D-rpc\nplano: planos/PLANO-D-rpc.md\n"
                 "titulo: Execução\n\nx\n")
        escrever(a / "planos" / "PLANO-D-sonda.md", "status: pronto\nid: D-sonda\ntitulo: Sonda\ndepende-de: D-rpc\n\nx\n")
        self.r.atualizar()
        itens = [i for i in self.r.vista()["itens"] if i["id"] in ("D-rpc", "D-sonda")]
        self.assertEqual(sorted((i["tipo"], i["dono"], i["etapa"]) for i in itens),
                         [("plano", "dev", "bloqueado"), ("retorno", "arquiteto", "corrigindo")])
        sonda = next(i for i in itens if i["id"] == "D-sonda")
        self.assertEqual((sonda["espera"]["dono"], sonda["espera"]["etapa"]), ("arquiteto", "corrigindo"))

    def test_parado_diz_o_que_espera_e_com_quem_esta(self):
        q = self.quadro()
        self.assertEqual(q["D-juiz"]["espera"]["id"], "D-runner")
        self.assertEqual((q["D-juiz"]["espera"]["dono"], q["D-juiz"]["espera"]["etapa"]), ("alex", "voltou-parado"))
        self.assertEqual(q["D-funcoes"]["espera"]["dono"], "arquiteto")

    def test_dependencia_aprovada_sem_merge_ainda_segura(self):
        a = self.lobby / "arquiteto" / "planos"
        escrever(a / "PLANO-D-runner2.md", "status: aprovado\nid: D-runner2\ntitulo: Runner 2\npr: 494\n\nx\n")
        escrever(a / "PLANO-D-juiz2.md", "status: pronto\nid: D-juiz2\ntitulo: Juiz 2\ndepende-de: D-runner2\n\nx\n")
        self.r.atualizar()
        q = self.quadro()
        self.assertEqual(q["D-juiz2"]["etapa"], "bloqueado")
        self.assertEqual((q["D-juiz2"]["espera"]["dono"], q["D-juiz2"]["espera"]["etapa"]), ("alex", "merge"))

    def test_planos_sem_passos_para_o_dev_nao_entram_na_fila_dele(self):
        a = self.lobby / "arquiteto" / "planos"
        escrever(a / "PLANO-D-infra.md", "status: pronto\nid: D-infra\ntipo: infra\ntitulo: Infra\n\nx\n")
        escrever(a / "PLANO-SENT-a2.md", "status: aprovado\nid: SENT-a2\ntipo: falso-positivo\ntitulo: Limiar\n\nx\n")
        self.r.atualizar()
        q = self.quadro()
        self.assertEqual((q["D-infra"]["dono"], q["D-infra"]["etapa"]), ("backlog", "backlog"))  # nobody to do it but you, later
        self.assertNotIn("posicao", q["D-infra"])
        self.assertEqual((q["SENT-a2"]["dono"], q["SENT-a2"]["etapa"]), ("fim", "concluido"))

    def test_fila_do_dev_na_ordem_da_fila(self):
        q = self.quadro()
        self.assertEqual([q[i]["posicao"] for i in ("D-a", "D-c", "D-b")], [1, 2, 3])  # prioridade, depois o mais antigo
        self.assertNotIn("posicao", q["D-juiz"])

    def test_trava_ligada_manda_o_que_chegou_para_o_alex(self):
        (self.lobby / "arquiteto" / ".trava-aprovacao").write_text("x")
        q = self.quadro()
        self.assertEqual((q["2026-11-10-0802-cesta"]["dono"], q["2026-11-10-0802-cesta"]["etapa"]), ("alex", "aprovar"))
        self.assertEqual(q["D-rel"]["dono"], "arquiteto")  # demanda aprovada continua com ele
        self.assertTrue(self.r.vista()["trava"])

    def test_eventos_incluem_entradas_e_retornos(self):
        f = self.lobby / "arquiteto" / "entrada" / "2026-11-10-0802-cesta" / "item.md"
        f.write_text(f.read_text().replace("status: novo", "status: em-avaliacao"))
        os.utime(f, (time.time() + 5, time.time() + 5))
        self.r.atualizar()
        ev = [e for e in self.r.vista()["eventos"] if e.get("id") == "2026-11-10-0802-cesta"]
        self.assertEqual((ev[-1]["tipo"], ev[-1]["de"], ev[-1]["para"]), ("item", "novo", "em-avaliacao"))

    def test_quadro_antigo_continua_so_com_planos_e_demandas(self):
        tipos = {i["tipo"] for i in self.r.vista()["quadro"]}
        self.assertTrue(tipos <= {"plano", "demanda"})


if __name__ == "__main__":
    unittest.main()
