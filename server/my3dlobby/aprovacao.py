"""Fila do Arquiteto: what reached the Arquiteto and waits for Alex to decide whether it becomes a plan.

The rules live in the agent chain itself, in `<lobby>/perfis/cadeia/fila_aprovacao.py` (the program the
"Aprovar fila do Arquiteto.command" runs). This module loads that program and uses its own `pendentes()`
to list what waits and its own `decidir()` to record a decision, so the office and the Terminal tool can
never disagree about what is pending or what a click does:

  a = aprovar  -> the item gets `aprovado:` (the Arquiteto picks it up); a plan that asked for a decision
                  goes on (to review when it has a PR, to the Dev otherwise)
  r = recusar  -> `status: descartado`
  b = backlog  -> `status: backlog`
  d = devolver ao Dev -> a plan that stopped and came back goes to `pronto` as it is, without the Arquiteto
                  (the case of a plan that only stopped because the plan it depends on had no merge yet)
Every decision is a line in `<lobby>/arquiteto/decisoes.md`.

PRs waiting for Alex's merge (plans `aprovado` with a PR: the Reviewer approved) are listed here too, so the
office shows ONE list of what waits for Alex. Their state on GitHub comes from the `gh` the Dev already uses
(a few calls every 2 minutes, in the background); `m` merges one PR with a merge commit, like the GitHub
button, after checking it is the plan's own open PR into main. The plan file is not changed: marking it
`concluido` is the Entrega's job (it also follows the deploy); the merge is a line in decisoes.md.

Nothing here touches ~/.hermes. The lobby folder is written only when Alex clicks, and only from the office
computer (the same rule as the chat). Texts go through `redigir()`, which masks anything that looks like a
credential. Without the chain program (someone else's Hermes) the feature simply stays hidden.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from .atividade import _quando, curto, redigir

PROGRAMA = Path("perfis") / "cadeia" / "fila_aprovacao.py"
CERT_ESTADO = Path("financeiro") / "certidoes" / "estado.json"        # written by the Financeiro's program
CERT_PROGRAMA = Path("perfis") / "financeiro-scripts" / "certidoes.py"
INTERVALO = 8.0          # seconds between scans of the lobby folder
DETALHE_MAX = 60_000     # characters of an item shown by "Ver tudo"
ACOES = ("a", "r", "b", "d", "m", "c")   # c = certidões: look in Downloads for the ones Alex just issued
SEM_MERGE = ("falso-positivo", "infra")   # approved plans with nothing to merge
PR_REVISITA = 120.0      # seconds between GitHub checks of an open PR (merged/closed ones are final)
GH_EXTRA = ("/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".local" / "bin"))


class PRs:
    """State of the chain's PRs on GitHub, read with `gh` (the Dev's, already signed in) in a background thread."""

    def __init__(self, slug: str = "", repo_dir: Optional[Path] = None):
        self._slug = slug.strip().strip("/")
        self.repo_dir = Path(repo_dir).expanduser() if repo_dir else Path.home() / "repos" / "super-cota-licitacao"
        self.estados: dict = {}          # "499" -> {"state", "merge", "head", "base", "url", "t"}
        self.lock = threading.Lock()
        self.trabalhando = False
        self.erro = ""

    def _env(self) -> dict:
        env = dict(os.environ)
        env["PATH"] = os.pathsep.join([env.get("PATH", "")] + [d for d in GH_EXTRA if d not in env.get("PATH", "")])
        env.setdefault("GH_PROMPT_DISABLED", "1")
        return env

    def gh(self) -> str:
        return shutil.which("gh", path=self._env()["PATH"]) or ""

    def slug(self) -> str:
        if self._slug:
            return self._slug
        try:  # the Dev's clone of the product repo knows where the PRs live
            cfg = (self.repo_dir / ".git" / "config").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        m = re.search(r"url\s*=\s*\S*github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?\s*$", cfg, re.M)
        return m.group(1) if m else ""

    def pode(self) -> bool:
        return bool(self.gh() and self.slug())

    def _rodar(self, args: list, timeout: float = 25) -> subprocess.CompletedProcess:
        return subprocess.run([self.gh()] + args, capture_output=True, text=True, timeout=timeout, env=self._env(),
                              cwd=str(Path.home()))

    def _ver(self, pr: str) -> Optional[dict]:
        r = self._rodar(["pr", "view", pr, "--repo", self.slug(), "--json",
                         "state,mergeStateStatus,headRefName,baseRefName,url"])
        if r.returncode != 0:
            self.erro = (r.stderr or r.stdout).strip()[:200]
            return None
        j = json.loads(r.stdout or "{}")
        return {"state": j.get("state", ""), "merge": j.get("mergeStateStatus", ""), "head": j.get("headRefName", ""),
                "base": j.get("baseRefName", ""), "url": j.get("url", ""), "t": time.time()}

    def estado(self, pr: str) -> dict:
        with self.lock:
            return dict(self.estados.get(str(pr)) or {})

    def mergeados(self) -> set:
        with self.lock:
            return {n for n, e in self.estados.items() if e.get("state") == "MERGED"}

    def pedir(self, prs: list) -> None:
        """Refresh these PRs in the background (open ones every PR_REVISITA s; merged/closed are final)."""
        if self.trabalhando or not self.pode():
            return
        agora = time.time()
        with self.lock:
            faltam = [n for n in dict.fromkeys(str(x) for x in prs if str(x).isdigit())
                      if self.estados.get(n, {}).get("state") not in ("MERGED", "CLOSED")
                      and agora - self.estados.get(n, {}).get("t", 0) > PR_REVISITA]
        if not faltam:
            return
        self.trabalhando = True

        def trabalho():
            try:
                for n in faltam[:12]:
                    try:
                        e = self._ver(n)
                    except (OSError, ValueError, subprocess.SubprocessError) as ex:
                        self.erro = f"{type(ex).__name__}: {ex}"[:200]
                        e = None
                    if e:
                        with self.lock:
                            self.estados[n] = e
            finally:
                self.trabalhando = False

        threading.Thread(target=trabalho, name="my3dlobby-prs", daemon=True).start()

    def merge(self, pr: str, branch: str) -> tuple:
        """(ok, text). Merge commit (the GitHub button's default), only the plan's own open PR into main."""
        if not self.gh():
            return False, "o gh não foi encontrado neste Mac (é o mesmo que o Dev usa para abrir os PRs)"
        if not self.slug():
            return False, "não sei o repositório dos PRs: ponha github = \"dono/repo\" em [chain] no ~/.my3dlobby.toml"
        try:
            e = self._ver(pr)
        except (OSError, ValueError, subprocess.SubprocessError) as ex:
            return False, f"não consegui ver o PR {pr}: {ex}"
        if not e:
            return False, f"não consegui ver o PR {pr}: {self.erro}"
        with self.lock:
            self.estados[str(pr)] = e
        if e["state"] == "MERGED":
            return True, f"o PR {pr} já tinha merge"
        if e["state"] != "OPEN":
            return False, f"o PR {pr} está fechado sem merge"
        if e["base"] != "main":
            return False, f"o PR {pr} vai para {e['base']}, não para a main"
        if branch and e["head"] != branch:
            return False, f"o PR {pr} é da branch {e['head']}, não da branch do plano ({branch})"
        if e["merge"] == "DIRTY":
            return False, f"o PR {pr} tem conflito com a main: o Dev precisa atualizar a branch"
        try:
            r = self._rodar(["pr", "merge", pr, "--repo", self.slug(), "--merge"], timeout=120)
        except (OSError, subprocess.SubprocessError) as ex:
            return False, f"o merge não rodou: {ex}"
        if r.returncode != 0:
            return False, "o GitHub recusou o merge: " + (r.stderr or r.stdout).strip()[:300]
        with self.lock:
            self.estados[str(pr)] = {**e, "state": "MERGED", "t": time.time()}
        return True, f"merge do PR {pr} feito"


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
        "depende": str(p.get("depende", "")),
        "dep_status": str(p.get("dep_status", "")),
        "dep_pr": str(p.get("dep_pr", "")),
        "dep_titulo": redigir(curto(p.get("dep_titulo", ""), 140)),
    }


def _cab(f: Path) -> dict:
    """`chave: valor` lines up to the first blank line."""
    dados = {}
    try:
        with f.open("r", encoding="utf-8", errors="replace") as fh:
            for i, linha in enumerate(fh):
                if i > 40 or not linha.strip():
                    break
                m = re.match(r"^([a-zA-Z_-]+):\s*(.*)$", linha.rstrip("\n"))
                if m:
                    dados[m.group(1).lower()] = m.group(2).strip()
    except OSError:
        pass
    return dados


def _link_seguro(u: str) -> str:
    return u if isinstance(u, str) and u.startswith("https://") and len(u) < 300 else ""


def ler_certidoes(lobby: Path) -> dict:
    """The BPG certidões as the Financeiro's program left them (estado.json): the five, and what waits for Alex
    (the ones a person must issue because the site has an anti-robot check, or an automatic one that failed)."""
    vazio = {"disponivel": (Path(lobby) / CERT_PROGRAMA).is_file(), "pendencias": [], "lista": [], "atualizado": ""}
    try:
        e = json.loads((Path(lobby) / CERT_ESTADO).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return vazio
    if not isinstance(e, dict):
        return vazio
    tipos = e.get("tipos") if isinstance(e.get("tipos"), dict) else {}
    guardadas = e.get("certidoes") if isinstance(e.get("certidoes"), dict) else {}
    lista = []
    for tipo, cfg in sorted(tipos.items(), key=lambda kv: (kv[1] or {}).get("ordem", 9)):
        c = guardadas.get(tipo) or {}
        lista.append({"tipo": str(tipo), "nome": redigir(curto(str(cfg.get("nome", tipo)), 60)), "auto": bool(cfg.get("auto")),
                      "link": _link_seguro(cfg.get("link", "")), "validade": str(c.get("validade", ""))[:10],
                      "situacao": redigir(curto(str(c.get("situacao", "")), 60)), "presumida": bool(c.get("validade_presumida"))})
    pend = []
    for p in e.get("pendencias") or []:
        if not isinstance(p, dict) or not p.get("tipo"):
            continue
        pend.append({"chave": "certidao:" + str(p["tipo"]), "tipo": str(p["tipo"]), "nome": redigir(curto(str(p.get("nome", "")), 60)),
                     "motivo": redigir(curto(str(p.get("motivo", "")), 300)), "link": _link_seguro(p.get("link", "")),
                     "vence": str(p.get("vence", ""))[:10], "urgente": bool(p.get("urgente")), "auto": bool(p.get("auto")),
                     "verificacao": redigir(curto(str(p.get("verificacao", "")), 40))})
    return {"disponivel": True, "pendencias": pend, "lista": lista, "atualizado": str(e.get("atualizado", ""))[:25]}


class AprovacaoReader:
    def __init__(self, lobby: Path, agente: str = "arquiteto", github: str = "", repo_dir: Optional[Path] = None):
        self.lobby = Path(lobby)
        self.arq = self.lobby / "arquiteto"
        self.programa = self.lobby / PROGRAMA
        self.agente = agente
        self._mod = None
        self._mod_assinatura: Optional[tuple] = None
        self.decisao = threading.Lock()   # one decision at a time
        self.lock = threading.Lock()      # the view
        self.itens: list = []
        self.merges: list = []
        self.prs = PRs(github, repo_dir)
        self.trava = False
        self.disponivel = False
        self.erro = ""
        self.atualizado = ""
        self.ultima = 0.0
        self.certidoes = ler_certidoes(self.lobby)

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
        cert = ler_certidoes(self.lobby)
        with self.lock:
            self.certidoes = cert
        try:
            mod = self._modulo()
            if mod is None:
                with self.lock:
                    self.disponivel, self.itens, self.trava, self.erro = False, [], False, ""
                return
            itens = [self._item(p) for p in mod.pendentes()]
            trava = (self.arq / ".trava-aprovacao").exists()
            merges = self._merges()
            self._dependencias(itens)
        except Exception as e:  # a half-written file or a broken program must not take the office down
            with self.lock:
                # the program is there, so the button stays visible and the window says what went wrong
                self.disponivel = self.programa.is_file()
                self.erro = f"{type(e).__name__}: {e}"
            return
        with self.lock:
            self.disponivel, self.itens, self.merges, self.trava, self.erro = True, itens, merges, trava, ""
            self.atualizado = datetime.now().astimezone().isoformat(timespec="seconds")

    # ------------------------------------------------------------------ PRs waiting for the merge
    def _planos(self) -> list:
        out = []
        for f in sorted((self.arq / "planos").glob("PLANO-*.md")):
            d = _cab(f)
            d["_arquivo"], d["_id"] = f, d.get("id") or f.stem[6:]
            d["_pr"] = d.get("pr", "").lstrip("#").strip().split(" ")[0]
            out.append(d)
        return out

    def _merges(self) -> list:
        planos = self._planos()
        candidatos = [d for d in planos if d.get("status") == "aprovado" and d["_pr"].isdigit()
                      and d.get("tipo", "codigo") not in SEM_MERGE]
        self.prs.pedir([d["_pr"] for d in candidatos])
        lista = []
        for d in candidatos:
            e = self.prs.estado(d["_pr"])
            if e.get("state") in ("MERGED", "CLOSED"):
                continue
            libera = [x.get("titulo") or x["_id"] for x in planos if x.get("depende-de", "").strip() == d["_id"]
                      and x.get("status") not in ("concluido", "descartado")]
            lista.append({
                "chave": d["_arquivo"].relative_to(self.lobby).as_posix(), "tipo": "merge", "id": d["_id"],
                "titulo": redigir(curto(d.get("titulo") or d["_id"], 180)), "pr": d["_pr"],
                "branch": d.get("branch", "").strip() or f"plano/{d['_id']}",
                "revisado": redigir(curto(d.get("revisado", ""), 120)), "conferencia": d.get("conferencia", "")[:40],
                "quando_iso": _quando(d.get("revisado", "")[:16]),
                "estado": e.get("merge", ""), "url": e.get("url", ""), "libera": [redigir(curto(x, 120)) for x in libera],
            })
        return lista

    def _dependencias(self, itens: list) -> None:
        """A plan that came back says whether the plan it waits for is merged (then: back to the Dev)."""
        mergeados = self.prs.mergeados()
        for it in itens:
            if it["tipo"] == "plano" and it["status"] == "escalar-arquiteto" and it.get("depende"):
                it["dep_ok"] = it.get("dep_status") == "concluido" or (
                    it.get("dep_status") == "aprovado" and it.get("dep_pr", "") in mergeados)

    def para_quadro(self) -> Optional[dict]:
        """What the Cadeia board needs to show exactly this list under "Você" (None without the program)."""
        with self.lock:
            if not self.disponivel:
                return None
            return {"pendentes": {f"{i['tipo']}:{i['id']}": i["chave"] for i in self.itens},
                    "merges": {m["id"]: m["chave"] for m in self.merges}, "mergeados": sorted(self.prs.mergeados())}

    def vista(self) -> dict:
        with self.lock:
            return {"disponivel": self.disponivel, "trava": self.trava, "n": len(self.itens) + len(self.merges),
                    "n_aprovar": len(self.itens), "n_merge": len(self.merges), "itens": list(self.itens),
                    "certidoes": self.certidoes, "n_cert": len(self.certidoes.get("pendencias") or []),
                    "merges": list(self.merges), "pode_merge": self.prs.pode(), "agente": self.agente,
                    "erro": self.erro, "atualizado": self.atualizado, "programa": PROGRAMA.as_posix()}

    def detalhe(self, chave: str) -> dict:
        """The whole text of one pending item (only files that are in the queue can be read)."""
        with self.lock:
            achou = any(i["chave"] == chave for i in self.itens + self.merges)
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
            return {"ok": False, "erro": "ação inválida (a, r, b, d ou m)"}
        motivo = re.sub(r"\s+", " ", str(motivo or "")).strip()[:300]
        if acao == "m":
            return self._merge(chave)
        if acao == "c":
            return self._certidoes_buscar(chave)
        with self.decisao:
            mod = self._modulo()
            if mod is None:
                return {"ok": False, "erro": f"programa da fila não encontrado ({PROGRAMA.as_posix()})"}
            alvo = next((p for p in mod.pendentes() if self._chave(p) == chave), None)
            if alvo is None:
                self.atualizar(forcar=True)
                return {"ok": False, "erro": "este item não está mais na fila (já foi decidido ou mudou de status)"}
            if acao == "d" and not (alvo["tipo"] == "plano" and alvo["status"] == "escalar-arquiteto"):
                return {"ok": False, "erro": "só um plano que voltou e parou pode ser devolvido ao Dev"}
            try:
                feito = mod.decidir(alvo, acao, motivo)
            except OSError as e:
                return {"ok": False, "erro": f"não consegui gravar: {e}"}
            self.atualizar(forcar=True)
        return {"ok": True, "acao": acao, "chave": chave, "feito": feito}

    def _certidoes_buscar(self, chave: str) -> dict:
        """'Já baixei': the Financeiro's program looks in ~/Downloads for certidões of the BPG issued in the last two
        days, copies the ones it recognizes to financeiro/certidoes/entrada and files them. It runs from the office app
        (macOS asks once to let it read Downloads; the background agents are not allowed to)."""
        prog = self.lobby / CERT_PROGRAMA
        if not prog.is_file():
            return {"ok": False, "erro": f"programa de certidões não encontrado ({CERT_PROGRAMA.as_posix()})"}
        env = dict(os.environ, BPG_LOBBY_PROJETO=str(self.lobby), PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        with self.decisao:
            try:
                r = subprocess.run([sys.executable, str(prog), "--downloads"], capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=180, env=env, stdin=subprocess.DEVNULL)
            except (OSError, subprocess.TimeoutExpired) as e:
                return {"ok": False, "erro": f"não consegui rodar o programa de certidões: {e}"}
        m = re.search(r"^RESULTADO: (.*)$", r.stdout or "", re.M)
        try:
            res = json.loads(m.group(1)) if m else {}
        except ValueError:
            res = {}
        self.atualizar(forcar=True)
        if not m:
            return {"ok": False, "erro": redigir(curto((r.stderr or r.stdout or "sem resposta").strip()[-300:], 300))}
        feito = [redigir(curto(str(x), 200)) for x in (res.get("feito") or [])]
        return {"ok": True, "acao": "c", "chave": chave, "feito": " · ".join(feito) or "nenhuma certidão nova em Downloads"}

    def _merge(self, chave: str) -> dict:
        with self.decisao:
            m = next((x for x in self._merges() if x["chave"] == chave), None)
            if m is None:
                self.atualizar(forcar=True)
                return {"ok": False, "erro": "este PR não está mais esperando merge (já entrou ou o plano mudou)"}
            ok, texto = self.prs.merge(m["pr"], m["branch"])
            if not ok:
                return {"ok": False, "erro": texto}
            linha = (f"{datetime.now():%d/%m/%Y %H:%M} · {m['id']} · merge · PR {m['pr']} na main (Alex, pelo lobby)"
                     + (f" · libera: {', '.join(m['libera'])}" if m["libera"] else ""))
            try:
                with open(self.arq / "decisoes.md", "a", encoding="utf-8") as fh:
                    fh.write(linha + "\n")
            except OSError:
                pass
            self.atualizar(forcar=True)
        extra = f" · libera: {', '.join(m['libera'])}" if m["libera"] else ""
        return {"ok": True, "acao": "m", "chave": chave, "feito": texto + extra}
