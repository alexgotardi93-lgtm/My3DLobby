"""The lobby opens the local agent's own Chrome before a message and closes it after the answer."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from my3dlobby import chat  # noqa: E402


class TestNavegador(unittest.TestCase):
    def test_sem_chrome_instalado_nao_quebra(self):
        with mock.patch.object(chat, "CHROMES", ("/nao/existe",)), mock.patch.object(chat, "_browser_up", return_value=False):
            self.assertFalse(chat.browser_open({"port": 9, "profile": "/tmp/x"}))

    def test_ja_aberto_nao_abre_outro(self):
        with mock.patch.object(chat, "_browser_up", return_value=True), mock.patch.object(chat.subprocess, "Popen") as popen:
            self.assertTrue(chat.browser_open({"port": 9224, "profile": "/tmp/x"}))
            popen.assert_not_called()

    def test_fecha_so_o_navegador_do_perfil(self):
        with mock.patch.object(chat.subprocess, "run") as run:
            chat.browser_close({"port": 9224, "profile": "/tmp/perfil-do-alex"})
            self.assertEqual(run.call_args[0][0], ["pkill", "-f", "user-data-dir=/tmp/perfil-do-alex"])

    def test_abre_antes_e_fecha_depois_da_mensagem(self):
        hub = chat.ChatHub.__new__(chat.ChatHub)
        hub.hermes_bin = "/bin/echo"
        ordem = []
        with mock.patch.object(chat, "browser_open", side_effect=lambda s: ordem.append("abre") or True), \
             mock.patch.object(chat, "browser_close", side_effect=lambda s: ordem.append("fecha")):
            hub._hermes_chat("alex", "oi")
            hub._hermes_chat("zap", "oi")
        self.assertEqual(ordem, ["abre", "fecha"])   # only the agent with a browser of its own


if __name__ == "__main__":
    unittest.main()
