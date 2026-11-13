"""The certidões section of "Esperando você": reads the Financeiro program's estado.json and runs its --downloads."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from my3dlobby.aprovacao import AprovacaoReader, ler_certidoes  # noqa: E402

ESTADO = {
    "tipos": {"federal": {"nome": "Federal (Receita e PGFN)", "auto": False, "ordem": 1, "link": "https://servicos.receitafederal.gov.br/x"},
              "fgts": {"nome": "FGTS (CRF da Caixa)", "auto": True, "ordem": 4, "link": "javascript:alert(1)"}},
    "certidoes": {"fgts": {"validade": "2026-12-08", "situacao": "regular"}},
    "pendencias": [{"tipo": "federal", "nome": "Federal (Receita e PGFN)", "motivo": "ainda não tem certidão guardada: emita a primeira",
                    "link": "https://servicos.receitafederal.gov.br/x", "vence": "", "urgente": True, "auto": False, "verificacao": "hCaptcha"}],
    "atualizado": "2026-11-13T10:00:00",
}


class TestCertidoes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.lobby = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sem_programa_nem_estado(self):
        c = ler_certidoes(self.lobby)
        self.assertFalse(c["disponivel"])
        self.assertEqual(c["pendencias"], [])

    def test_le_estado(self):
        pasta = self.lobby / "financeiro" / "certidoes"
        pasta.mkdir(parents=True)
        (pasta / "estado.json").write_text(json.dumps(ESTADO), encoding="utf-8")
        c = ler_certidoes(self.lobby)
        self.assertTrue(c["disponivel"])
        self.assertEqual([p["chave"] for p in c["pendencias"]], ["certidao:federal"])
        self.assertEqual([x["tipo"] for x in c["lista"]], ["federal", "fgts"])
        self.assertEqual(c["lista"][1]["validade"], "2026-12-08")
        self.assertEqual(c["lista"][1]["link"], "")          # only https links reach the page

    def test_vista_conta_separado(self):
        pasta = self.lobby / "financeiro" / "certidoes"
        pasta.mkdir(parents=True)
        (pasta / "estado.json").write_text(json.dumps(ESTADO), encoding="utf-8")
        r = AprovacaoReader(self.lobby)
        r.atualizar(forcar=True)
        v = r.vista()
        self.assertEqual(v["n_cert"], 1)
        self.assertEqual(v["n"], 0)                            # the Arquiteto's count does not include certidões

    def test_ja_baixei_roda_o_programa(self):
        prog = self.lobby / "perfis" / "financeiro-scripts" / "certidoes.py"
        prog.parent.mkdir(parents=True)
        prog.write_text("import sys, json\nassert sys.argv[1:] == ['--downloads']\n"
                        "print('RESULTADO: ' + json.dumps({'feito': ['Federal: negativa, válida até 12/05/2027']}))\n", encoding="utf-8")
        r = AprovacaoReader(self.lobby)
        res = r.decidir("certidao:federal", "c")
        self.assertTrue(res["ok"], res)
        self.assertIn("12/05/2027", res["feito"])


if __name__ == "__main__":
    unittest.main()
