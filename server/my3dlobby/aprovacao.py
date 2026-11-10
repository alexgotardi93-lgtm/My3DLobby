"""Fila do Arquiteto: what reached the Arquiteto and waits for Alex to decide whether it becomes a plan.

The rules live in the agent chain itself, in `<lobby>/perfis/cadeia/fila_aprovacao.py` (the program the
"Aprovar fila do Arquiteto.command" runs). This module loads that program and uses its own `pendentes()`
to list what waits and its own `decidir()` to record a decision, so the office and the Terminal tool can
never disagree about what is pending or what a click does:

  a = aprovar  -> the item gets `aprovado:` (the Arquiteto picks it up); a plan that asked for a decision
                  goes on (to review when it has a PR, to the Dev otherwise)
  r = recusar  -> `status: descartado`
  b = backlog  -> `status: backlog`
Every decision is a line in `<lobby>/arquiteto/decisoes.md`.

Nothing here touches ~/.hermes. The lobby folder is written only when Alex clicks, and only from the office
computer (the same rule as the chat). Texts go through `redigir()`, which masks anything that looks like a
credential. Without the chain program (someone else's Hermes) the feature simply stays hidden.
"""
from __future__ import annotations

import importlib.util
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from .atividade import _quando, curto, redigir

PROGRAMA = Path("perfis") / "cadeia" / "fila_aprovacao.py"
INTERVALO = 8.0          # seconds between scans of the lobby folder
DETALHE_MAX = 60_000     # characters of an item shown by "Ver tudo"
ACOES = ("a", "r", "b")


def origem(p: dict) -> str:
    """Where the item came from, for the label: whatsapp, sentinela, sentry, demanda, retorno or plano."""
    tipo = p.get("tipo", "")
    ident = str(p.get("id", ""))
    if tipo == "item":
        if ident.startswith("SENTRY-"):
            return "sentry"
        if ident.startswith("SENT-"):
            return "sentinela"
        return "whatsapp"
    return tipo if tipo in ("demanda", "retorno", "plano") else "item"


def de_onde(p: dict) -> str:
    """For a plan: what originated it (the `origem:` header is 'zap:…', 'sentinela:…' or 'demanda:…')."""
    quem = str(p.get("quem", ""))
    for prefixo, nome in (("zap:", "whatsapp"), ("sentinela:", "sentinela"), ("sentry:", "sentry"), ("demanda:", "demanda")):
        if quem.startswith(prefixo):
            return nome
    return ""


def montar_item(p: dict, chave: str) -> dict:
    """One entry of `pendentes()` as the page sees it. `chave` (the file, relative to the lobby) identifies it."""
    return {
        "chave": chave,
        "tipo": p.get("tipo", ""),
        "origem": origem(p),
        "de": de_onde(p) if p.get("tipo") == "plano" else "",
        "id": str(p.get("id", "")),
        "status": str(p.get("status", "")),
        "titulo": redigir(curto(p.get("titulo") or p.get("id", ""), 180)),
        "quem": redigir(curto(p.get("quem", ""), 200)),
        "quando": str(p.get("quando", "")),
        "quando_iso": _quando(str(p.get("quando", ""))[:16]),
        "sugestao": redigir(curto(p.get("sugestao", ""), 260)),
        "resumo": redigir(str(p.get("resumo", ""))),
        "pr": str(p.get("pr", "")).lstrip("#").strip(),
        "anterior": str(p.get("anterior", "")),
    }


class AprovacaoReader:
    def __init__(self, lobby: Path, agente: str = "arquiteto"):
        self.lobby = Path(lobby)
        self.arq = self.lobby / "arquiteto"
        self.programa = self.lobby / PROGRAMA
        self.agente = agente
        self._mod = None
        self._mod_assinatura: Optional[tuple] = None
        self.decisao = threading.Lock()   # one decision at a time
        self.lock = threading.Lock()      # the view
        self.itens: list = []
        self.trava = False
        self.disponivel = False
        self.erro = ""
        self.atualizado = ""
        self.ultima = 0.0

    # ------------------------------------------------------------------ the chain program
    def _modulo(self):
        try:
            st = self.programa.stat()
        except OSError:
            self._mod = None
            return None
        assinatura = (st.st_mtime_ns, st.st_size)  # size too: a same-second rewrite still reloads
        if self._mod is None or assinatura != self._mod_assinatura:
            spec = importlib.util.spec_from_file_location("bpg_fila_aprovacao", self.programa)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)   # only definitions run: main() is behind __name__ == "__main__"
            mod.PROJETO = self.lobby       # the lobby from ~/.my3dlobby.toml wins over the program's default
            mod.ARQ = self.arq
            self._mod, self._mod_assinatura = mod, assinatura
        return self._mod

    def _chave(self, p: dict) -> str:
        arquivo = Path(p["arquivo"])
        try:
            return arquivo.relative_to(self.lobby).as_posix()
        except ValueError:
            return arquivo.name

    def _item(self, p: dict) -> dict:
        return montar_item(p, self._chave(p))

    # ------------------------------------------------------------------ reading
    def atualizar(self, forcar: bool = False) -> None:
        if not forcar and time.time() - self.ultima < INTERVALO:
            return
        self.ultima = time.time()
        try:
            mod = self._modulo()
            if mod is None:
                with self.lock:
                    self.disponivel, self.itens, self.trava, self.erro = False, [], False, ""
                return
            itens = [self._item(p) for p in mod.pendentes()]
            trava = (self.arq / ".trava-aprovacao").exists()
        except Exception as e:  # a half-written file or a broken program must not take the office down
            with self.lock:
                # the program is there, so the button stays visible and the window says what went wrong
                self.disponivel = self.programa.is_file()
                self.erro = f"{type(e).__name__}: {e}"
            return
        with self.lock:
            self.disponivel, self.itens, self.trava, self.erro = True, itens, trava, ""
            self.atualizado = datetime.now().astimezone().isoformat(timespec="seconds")

    def vista(self) -> dict:
        with self.lock:
            return {"disponivel": self.disponivel, "trava": self.trava, "n": len(self.itens), "itens": list(self.itens),
                    "agente": self.agente, "erro": self.erro, "atualizado": self.atualizado,
                    "programa": PROGRAMA.as_posix()}

    def detalhe(self, chave: str) -> dict:
        """The whole text of one pending item (only files that are in the queue can be read)."""
        with self.lock:
            achou = any(i["chave"] == chave for i in self.itens)
        if not achou:
            return {"ok": False, "erro": "este item não está mais na fila"}
        caminho = self.lobby / chave
        try:
            texto = caminho.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            return {"ok": False, "erro": f"não consegui ler: {e}"}
        return {"ok": True, "chave": chave, "texto": redigir(texto[:DETALHE_MAX]), "cortado": len(texto) > DETALHE_MAX}

    # ------------------------------------------------------------------ deciding
    def decidir(self, chave: str, acao: str, motivo: str = "") -> dict:
        acao = str(acao or "").strip().lower()[:1]
        if acao not in ACOES:
            return {"ok": False, "erro": "ação inválida (a, r ou b)"}
        motivo = re.sub(r"\s+", " ", str(motivo or "")).strip()[:300]
        with self.decisao:
            mod = self._modulo()
            if mod is None:
                return {"ok": False, "erro": f"programa da fila não encontrado ({PROGRAMA.as_posix()})"}
            alvo = next((p for p in mod.pendentes() if self._chave(p) == chave), None)
            if alvo is None:
                self.atualizar(forcar=True)
                return {"ok": False, "erro": "este item não está mais na fila (já foi decidido ou mudou de status)"}
            try:
                feito = mod.decidir(alvo, acao, motivo)
            except OSError as e:
                return {"ok": False, "erro": f"não consegui gravar: {e}"}
            self.atualizar(forcar=True)
        return {"ok": True, "acao": acao, "chave": chave, "feito": feito}
