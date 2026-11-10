"""What each agent is doing right now, and where each plan is in the agent chain.

Agora (one per agent) - a read-only look at the agent's Hermes session store:
  ~/.hermes/profiles/<p>/state.db (SQLite in WAL mode), opened with mode=ro + query_only.
  The most recent session gives the step being executed (the last tool call: the command in
  the terminal, the file being read or edited, the skill being consulted), the steps before
  it, how many steps so far and Hermes' own activity line ("waiting for stream response").
  Only tool *calls* are shown, never tool *results* (outputs), and every text goes through
  `redigir()`, which masks tokens, keys, passwords and long secret-looking strings.

Cadeia - the headers of <lobby>/arquiteto/planos/PLANO-*.md and arquiteto/demandas/*.md
  (status, titulo, pr, ciclos, em-execucao-desde, revisando-desde, depende-de). Each status
  change becomes an event, kept in ~/.my3dlobby/cadeia-eventos.jsonl.

Nothing here writes to ~/.hermes or to the lobby folder.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Optional

STORE = Path("~/.my3dlobby").expanduser()
HOME = str(Path("~").expanduser())

# ----------------------------------------------------------------------------- secrets
_SEGREDOS = [
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}"), r"\1 •••"),
    (re.compile(r"(?i)\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|senha|api[_-]?key|access[_-]?key|private[_-]?key|"
                r"credential|authorization|cookie)[A-Za-z0-9_.-]*)(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s\"';&|]+)"), r"\1\2•••"),
    (re.compile(r"(?i)(\s--?(?:token|password|passwd|senha|secret|api-?key|key|pass)(?:=|\s+))(\"[^\"]*\"|'[^']*'|\S+)"), r"\1•••"),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}"), "•••"),
    (re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"), "•••"),
    (re.compile(r"\bsbp_[A-Za-z0-9]{20,}"), "•••"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}"), "•••"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "•••"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "•••"),
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://[^/\s:@]+):[^@\s/]+@"), r"\1:•••@"),
    (re.compile(r"(?<![\w/.~-])[A-Za-z0-9+_=-]{40,}(?![\w/.~-])"), "•••"),
]


def redigir(texto: str) -> str:
    """Masks anything that looks like a credential. Over-masking is fine; leaking is not."""
    s = str(texto or "")
    for rx, sub in _SEGREDOS:
        s = rx.sub(sub, s)
    return s


def curto(texto: str, n: int = 160) -> str:
    texto = " ".join(str(texto or "").split())
    return texto if len(texto) <= n else texto[: n - 1] + "…"


def _iso(ts) -> str:
    try:
        return datetime.fromtimestamp(float(ts)).astimezone().isoformat(timespec="seconds") if ts else ""
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def _f(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


# ----------------------------------------------------------------------------- tool calls -> "what"
_ACOES = {
    "terminal": "terminal", "shell": "terminal", "bash": "terminal", "run_command": "terminal", "execute_command": "terminal",
    "read_file": "ler", "file_read": "ler", "view_file": "ler",
    "write_file": "escrever", "create_file": "escrever",
    "patch": "editar", "edit_file": "editar", "apply_patch": "editar", "str_replace": "editar", "replace_in_file": "editar",
    "search_files": "procurar", "grep": "procurar", "find_files": "procurar", "glob": "procurar", "search": "procurar",
    "skill_view": "skill", "skills_list": "skills", "skill_manage": "skills",
    "todo": "tarefas", "todo_write": "tarefas",
    "process": "processo",
    "execute_code": "codigo", "python": "codigo",
    "memory": "memoria",
    "session_search": "conversas",
    "web_search": "web", "web_extract": "pagina", "web_fetch": "pagina",
    "delegate_task": "delegar",
    "send_message": "mensagem",
    "clarify": "perguntar",
    "vision_analyze": "imagem",
    "cronjob": "agenda",
}


def _caminho(p: str) -> str:
    p = str(p or "").strip()
    if p.startswith(HOME):
        p = "~" + p[len(HOME):]
    if len(p) > 70:
        partes = p.split("/")
        p = "…/" + "/".join(partes[-3:])
    return p


def _comando(cmd: str) -> str:
    linhas = [l for l in str(cmd or "").strip().splitlines() if l.strip()]
    if not linhas:
        return ""
    s = linhas[0].strip()
    s = re.sub(r"^cd\s+(\"[^\"]+\"|'[^']+'|\S+)\s*(&&|;)\s*", "", s)
    s = s.replace(HOME, "~")
    if len(linhas) > 1:
        s += f"  (+{len(linhas) - 1})"
    return s


def _arg(a: dict, *chaves) -> str:
    for k in chaves:
        v = a.get(k)
        if v not in (None, "", [], {}):
            if isinstance(v, (list, tuple)):
                return ", ".join(str(x) for x in v[:3])
            return str(v)
    return ""


def _resumo_tarefas(todos: dict) -> Optional[dict]:
    if not todos:
        return None
    itens = list(todos.values())
    feitas = sum(1 for t in itens if t.get("status") in ("completed", "done", "cancelled"))
    agora = next((t.get("content", "") for t in itens if t.get("status") == "in_progress"), "")
    return {"feitas": feitas, "total": len(itens), "agora": curto(redigir(agora), 120)}


def descrever(nome: str, args, todos: dict) -> dict:
    """Turns one tool call into {acao, alvo} (the sentence is built by the page, in its language)."""
    a = args if isinstance(args, dict) else {}
    nome = str(nome or "?")
    acao = _ACOES.get(nome, "navegador" if nome.startswith("browser") else "outro")
    alvo = ""
    if acao == "terminal":
        alvo = _comando(_arg(a, "command", "cmd", "script"))
    elif acao in ("ler", "escrever"):
        alvo = _caminho(_arg(a, "path", "file_path", "filename", "file"))
    elif acao == "editar":
        alvo = _caminho(_arg(a, "path", "file_path", "filename", "file"))
        if not alvo:
            arquivos = re.findall(r"\*\*\* (?:Update|Add|Delete) File: (\S+)", _arg(a, "patch", "input", "diff"))
            alvo = ", ".join(_caminho(x) for x in arquivos[:3])
    elif acao == "procurar":
        padrao = _arg(a, "pattern", "query", "regex", "glob", "name")
        onde = _caminho(_arg(a, "path", "directory", "dir"))
        alvo = (f"“{padrao}”" if padrao else "") + (f" · {onde}" if onde else "")
    elif acao == "skill":
        alvo = _arg(a, "name", "skill", "skill_name")
    elif acao == "tarefas":
        lista = a.get("todos") if isinstance(a.get("todos"), list) else []
        if not a.get("merge"):
            todos.clear()
        for i, t in enumerate(lista):
            if isinstance(t, dict):
                chave = str(t.get("id") or f"_{len(todos) + i}")
                todos[chave] = {**todos.get(chave, {}), **{k: t[k] for k in ("content", "status") if k in t}}
        r = _resumo_tarefas(todos)
        if r:
            alvo = f"{r['feitas']}/{r['total']}" + (f" · {r['agora']}" if r["agora"] else "")
    elif acao == "processo":
        alvo = _arg(a, "action", "mode")
    elif acao == "codigo":
        alvo = _comando(_arg(a, "code", "script"))
    elif acao == "memoria":
        alvo = _arg(a, "action", "target")
    elif acao in ("conversas", "web"):
        alvo = _arg(a, "query", "q")
    elif acao == "pagina":
        alvo = _arg(a, "urls", "url")
    elif acao == "navegador":
        alvo = nome.replace("browser_", "") + (" " + _arg(a, "url") if _arg(a, "url") else "")
    elif acao == "delegar":
        alvo = _arg(a, "goal", "task", "prompt")
    elif acao == "mensagem":
        alvo = _arg(a, "target", "to", "chat")
    elif acao == "perguntar":
        alvo = _arg(a, "question", "prompt")
    elif acao == "imagem":
        alvo = _caminho(_arg(a, "image_url", "path", "url"))
    elif acao == "agenda":
        alvo = _arg(a, "action", "name")
    else:
        primeiro = next((str(v) for v in a.values() if isinstance(v, (str, int, float)) and str(v).strip()), "")
        alvo = nome + (f": {primeiro}" if primeiro else "")
    return {"acao": acao, "alvo": curto(redigir(alvo), 220), "tool": nome}


def _resultado(conteudo) -> str:
    """ok | erro, looking only at exit codes / error flags - the output itself is never kept."""
    s = str(conteudo or "").strip()
    if s.startswith("\x00json:"):
        s = s[6:]
    if s.startswith("{"):
        try:
            d = json.loads(s)
        except ValueError:
            d = None
        if isinstance(d, dict):
            code = d.get("exit_code", d.get("returncode", d.get("exitCode")))
            if isinstance(code, int):
                return "ok" if code == 0 else "erro"
            if d.get("success") is False or d.get("ok") is False:
                return "erro"
            if d.get("error") not in (None, "", False):
                return "erro"
            return "ok"
    low = s[:80].lower()
    if low.startswith(("error", "erro", "traceback", "exception", "failed", "[error")):
        return "erro"
    return "ok"


def _texto(conteudo) -> str:
    s = conteudo if isinstance(conteudo, str) else ("" if conteudo is None else str(conteudo))
    if s.startswith("\x00json:"):
        try:
            d = json.loads(s[6:])
        except ValueError:
            return ""
        if isinstance(d, str):
            return d
        partes = d if isinstance(d, list) else [d]
        return " ".join(str(p.get("text", "")) for p in partes if isinstance(p, dict) and p.get("type", "text") == "text")
    return s


def _chamada(c) -> tuple[str, object]:
    if not isinstance(c, dict):
        return "?", {}
    fn = c.get("function") if isinstance(c.get("function"), dict) else {}
    nome = fn.get("name") or c.get("name") or "?"
    bruto = fn.get("arguments", c.get("arguments", c.get("input", {})))
    if isinstance(bruto, str):
        try:
            bruto = json.loads(bruto) if bruto.strip() else {}
        except ValueError:
            bruto = {"_": bruto}
    return str(nome), bruto


# ----------------------------------------------------------------------------- state.db
def _abrir(path: Path) -> sqlite3.Connection:
    uri = "file:" + urllib.parse.quote(str(path)) + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=1.5, check_same_thread=False)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA query_only = 1")
    except sqlite3.Error:
        pass
    return con


def _colunas(con, tabela: str) -> set:
    return {r[1] for r in con.execute(f"PRAGMA table_info({tabela})")}


def _dict(row) -> dict:
    return {k: row[k] for k in row.keys()} if row is not None else {}


def ler_sessao(path: Path, perfil: Optional[str] = None) -> Optional[dict]:
    """The most recently active session in one state.db (optionally only rows of one profile)."""
    con = _abrir(path)
    try:
        cs, cm = _colunas(con, "sessions"), _colunas(con, "messages")
        if not {"id", "started_at"} <= cs or not {"session_id", "role"} <= cm:
            return None
        campos = [c for c in ("id", "source", "model", "started_at", "ended_at", "end_reason", "last_activity_at",
                              "last_activity_description", "tool_call_count", "api_call_count", "title") if c in cs]
        ordem = "COALESCE(last_activity_at, started_at) DESC, started_at DESC" if "last_activity_at" in cs else "started_at DESC"
        # Only sessions with at least one message: a cron check whose script said "nothing to do"
        # (wakeAgent=false) leaves, in some Hermes versions, an empty session row that is never closed.
        # It is not work, and counting it made idle agents look busy every few minutes.
        onde, params = "WHERE EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id)", []
        if perfil is not None:
            if "profile_name" not in cs:
                return None
            onde, params = onde + " AND profile_name = ?", [perfil]
        cands = [_dict(r) for r in con.execute(f"SELECT {', '.join(campos)} FROM sessions {onde} ORDER BY {ordem} LIMIT 6", params)]
        if not cands:
            return None
        tem_ts = "timestamp" in cm
        melhor, melhor_t = None, -1.0
        for s in cands:
            r = con.execute("SELECT MAX(id) AS mid" + (", MAX(timestamp) AS mts" if tem_ts else "") +
                            " FROM messages WHERE session_id = ?", (s["id"],)).fetchone()
            t = max(_f(s.get("last_activity_at")), _f(s.get("started_at")), _f(r["mts"]) if tem_ts else 0.0)
            if t > melhor_t:
                melhor, melhor_t = s, t
        s = melhor
        mc = [c for c in ("id", "role", "content", "tool_calls", "tool_name", "tool_call_id", "timestamp") if c in cm]
        ativo = " AND active = 1" if "active" in cm else ""
        msgs = [_dict(r) for r in con.execute(
            f"SELECT {', '.join(mc)} FROM messages WHERE session_id = ?{ativo} ORDER BY id DESC LIMIT 120", (s["id"],))]
        msgs.reverse()
        total_passos = s.get("tool_call_count")
        if not total_passos:
            total_passos = con.execute("SELECT COUNT(*) FROM messages WHERE session_id = ? AND role = 'tool'", (s["id"],)).fetchone()[0]
    finally:
        con.close()

    passos: list[dict] = []
    pend: dict[str, dict] = {}
    todos: dict = {}
    da_ultima: list[dict] = []  # steps asked by the most recent assistant message
    fala, fala_ts = "", 0.0
    for m in msgs:
        papel, ts = m.get("role"), _f(m.get("timestamp"))
        if papel == "assistant":
            txt = _texto(m.get("content"))
            if txt.strip():
                fala, fala_ts = txt, ts
            try:
                chamadas = json.loads(m.get("tool_calls") or "[]")
            except ValueError:
                chamadas = []
            da_ultima = []
            for c in chamadas if isinstance(chamadas, list) else []:
                nome, args = _chamada(c)
                p = {"ts": ts, **descrever(nome, args, todos), "estado": "rodando", "fim": 0.0}
                passos.append(p)
                da_ultima.append(p)
                cid = str(c.get("id") or c.get("call_id") or f"_{len(passos)}") if isinstance(c, dict) else f"_{len(passos)}"
                pend[cid] = p
        elif papel == "tool":
            p = pend.pop(str(m.get("tool_call_id") or ""), None)
            if p is None and pend:  # ids missing or reused: close the oldest open step
                p = pend.pop(next(iter(pend)))
            if p is not None:
                p["estado"], p["fim"] = _resultado(m.get("content")), ts
    ultimo = msgs[-1] if msgs else {}
    return {
        "sessao": {"id": s.get("id"), "fonte": s.get("source") or "", "modelo": s.get("model") or "",
                   "titulo": curto(redigir(s.get("title") or ""), 90), "inicio": _f(s.get("started_at")),
                   "fim": _f(s.get("ended_at")), "motivo": s.get("end_reason") or "",
                   "passos": int(total_passos or 0), "chamadas": int(s.get("api_call_count") or 0)},
        "passos": passos[-12:],
        "pendente": any(p["estado"] == "rodando" for p in da_ultima),
        "n_ultima": len(da_ultima),
        "ultimo_papel": ultimo.get("role", ""),
        "ultimo_ts": _f(ultimo.get("timestamp")),
        "fala": curto(redigir(fala), 240), "fala_ts": fala_ts,
        "hermes": curto(redigir(s.get("last_activity_description") or ""), 120),
        "hermes_ts": _f(s.get("last_activity_at")),
        "atividade_ts": melhor_t,
        "tarefas": _resumo_tarefas(todos),
    }


class AgoraReader:
    """Keeps, per profile, the latest session read from state.db (re-read only when the db changes)."""

    SILENCIO = 6 * 60  # an open session with no sign of life for this long is "parado"

    def __init__(self, home: Path):
        self.home = home
        self.cache: dict[str, dict] = {}
        self.sig: dict[str, tuple] = {}
        self.erros: dict[str, str] = {}
        self.lock = threading.Lock()

    def bancos(self, perfil: str) -> list:
        out = [(self.home / "state.db", None)] if perfil == "default" else \
              [(self.home / "profiles" / perfil / "state.db", None), (self.home / "state.db", perfil)]
        return [(p, f) for p, f in out if p.is_file()]

    @staticmethod
    def _assinatura(bancos) -> tuple:
        sig = []
        for p, _ in bancos:
            for q in (p, p.with_name(p.name + "-wal")):
                try:
                    st = q.stat()
                    sig.append((st.st_mtime_ns, st.st_size))
                except OSError:
                    sig.append((0, 0))
        return tuple(sig)

    def atualizar(self, perfil: str) -> None:
        bancos = self.bancos(perfil)
        sig = self._assinatura(bancos)
        if bancos and self.sig.get(perfil) == sig:
            return
        melhor = None
        for path, filtro in bancos:
            try:
                r = ler_sessao(path, filtro)
            except sqlite3.Error as e:
                self.erros[perfil] = f"{path.name}: {e}"
                continue
            if r and (melhor is None or r["atividade_ts"] > melhor["atividade_ts"]):
                melhor = r
        with self.lock:
            self.sig[perfil] = sig
            if melhor:
                self.cache[perfil] = melhor
                self.erros.pop(perfil, None)
            else:
                self.cache.pop(perfil, None)

    def vista(self, perfil: str, agora: Optional[float] = None) -> Optional[dict]:
        with self.lock:
            raw = self.cache.get(perfil)
        if not raw:
            return None
        now = agora or time.time()
        ses = raw["sessao"]
        fim = ses["fim"]
        ult = max(raw["ultimo_ts"], raw["hermes_ts"], ses["inicio"])
        turno_acabou = raw["ultimo_papel"] == "assistant" and not raw["pendente"]
        passos = [dict(p) for p in raw["passos"]]
        ativo = False
        if fim or turno_acabou:
            estado, desde = ("terminou", fim) if fim else ("respondeu", raw["ultimo_ts"])
        elif now - ult > self.SILENCIO:
            estado, desde = "parado", ult
        else:
            ativo = True
            if raw["pendente"]:
                estado, desde = "executando", (passos[-1]["ts"] if passos else raw["ultimo_ts"])
            elif raw["ultimo_papel"] == "tool":
                estado, desde = "pensando", raw["ultimo_ts"]
            else:
                estado, desde = "lendo", raw["ultimo_ts"] or ses["inicio"]
        n_ult = raw.get("n_ultima", 0)
        for i, p in enumerate(passos):
            # only the calls of the latest assistant message can still be running; older open ones were cut
            if p["estado"] == "rodando" and (not ativo or i < len(passos) - n_ult):
                p["estado"] = "parou"
            ts0, fim_p = p.pop("ts"), p.pop("fim", 0.0)
            p["t"] = _iso(ts0)
            p["seg"] = round(fim_p - ts0, 1) if fim_p and ts0 else None
        hermes = raw["hermes"] if (ativo and raw["hermes_ts"] and now - raw["hermes_ts"] < 180) else ""
        return {
            "ativo": ativo, "estado": estado, "desde": _iso(desde), "segundos": int(max(0, now - desde)) if desde else None,
            "passo": passos[-1] if passos else None,
            "passos": passos[-10:],
            "fala": raw["fala"], "fala_t": _iso(raw["fala_ts"]),
            "hermes": hermes,
            "tarefas": raw["tarefas"],
            "sessao": {**ses, "inicio": _iso(ses["inicio"]), "fim": _iso(fim)},
        }


# ----------------------------------------------------------------------------- the chain
FINAIS = {"concluido", "descartado", "backlog"}
DEMANDA_VIVA = {"novo", "em-avaliacao"}
ORDEM = {"aprovado": 0, "aguardando-alex": 1, "aguardando-aprovacao": 1, "em-execucao": 2, "devolvido": 3, "revisando": 4,
         "em-revisao": 5, "pronto": 6, "escalar-arquiteto": 7, "rascunho": 8, "em-avaliacao": 9, "novo": 10, "concluido": 20}
FASE = {"aprovado": "alex", "aguardando-alex": "alex", "aguardando-aprovacao": "alex", "em-execucao": "dev", "devolvido": "dev", "pronto": "fila",
        "revisando": "reviewer", "em-revisao": "reviewer", "escalar-arquiteto": "arquiteto", "rascunho": "arquiteto",
        "em-avaliacao": "arquiteto", "novo": "arquiteto", "concluido": "fim"}
CONCLUIDO_VISIVEL = 12 * 3600


def cabecalho(f: Path) -> dict:
    """`chave: valor` lines up to the first blank line (the same rule the queue scripts use)."""
    dados = {}
    with f.open("r", encoding="utf-8", errors="replace") as fh:
        for i, linha in enumerate(fh):
            if i > 40 or not linha.strip():
                break
            m = re.match(r"^([a-zA-Z_-]+):\s*(.*)$", linha.rstrip("\n"))
            if m:
                dados[m.group(1).lower()] = m.group(2).strip()
    return dados


def _quando(texto: str) -> str:
    """'08/11/2026 19:50' -> ISO (local)."""
    try:
        return datetime.strptime(texto.strip(), "%d/%m/%Y %H:%M").astimezone().isoformat(timespec="minutes")
    except (ValueError, AttributeError):
        return ""


class CadeiaReader:
    def __init__(self, lobby: Path, store: Path = STORE):
        self.lobby = lobby
        self.planos = lobby / "arquiteto" / "planos"
        self.demandas = lobby / "arquiteto" / "demandas"
        self.store = store
        self.cache: dict[str, tuple] = {}
        self.itens: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.estado_path = store / "cadeia-estado.json"
        self.eventos_path = store / "cadeia-eventos.jsonl"
        self.conhecido = self._json(self.estado_path, {})
        self.eventos = self._jsonl(self.eventos_path)[-300:]
        self.iniciado = False
        self.erro = ""

    @staticmethod
    def _json(p: Path, padrao):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return padrao

    @staticmethod
    def _jsonl(p: Path) -> list:
        out = []
        try:
            for linha in p.read_text(encoding="utf-8").splitlines():
                if linha.strip():
                    try:
                        out.append(json.loads(linha))
                    except ValueError:
                        pass
        except OSError:
            pass
        return out

    def _ler(self) -> dict:
        atuais: dict[str, dict] = {}
        vistos = set()
        for tipo, pasta, padrao in (("plano", self.planos, "PLANO-*.md"), ("demanda", self.demandas, "*.md")):
            if not pasta.is_dir():
                continue
            for f in pasta.glob(padrao):
                chave_arq = str(f)
                vistos.add(chave_arq)
                try:
                    mt = f.stat().st_mtime
                except OSError:
                    continue
                c = self.cache.get(chave_arq)
                if c and c[0] == mt:
                    d = c[1]
                else:
                    try:
                        d = cabecalho(f)
                    except OSError:
                        continue
                    self.cache[chave_arq] = (mt, d)
                st = d.get("status", "").strip().lower()
                if not st:
                    continue
                ident = d.get("id") or (f.stem[6:] if f.stem.startswith("PLANO-") else f.stem)
                desde = _quando(d.get("revisando-desde", "")) if st == "revisando" else \
                    _quando(d.get("em-execucao-desde", "")) if st == "em-execucao" else ""
                atuais[f"{tipo}:{ident}"] = {
                    "tipo": tipo, "id": ident, "titulo": curto(d.get("titulo") or ident, 90), "status": st,
                    "pr": d.get("pr", "").lstrip("#").strip(), "ciclos": d.get("ciclos", "").strip(),
                    "depende": d.get("depende-de", "").strip(), "desde": desde or _iso(mt), "mtime": mt,
                    "arquivo": f.name,
                }
        for k in list(self.cache):
            if k not in vistos:
                del self.cache[k]
        return atuais

    def atualizar(self) -> None:
        try:
            atuais = self._ler()
        except OSError as e:
            self.erro = str(e)
            return
        primeira_vez = not self.conhecido and not self.eventos
        agora = time.time()
        novos = []
        if primeira_vez:
            vivos = sum(1 for it in atuais.values() if it["status"] not in FINAIS and
                        (it["tipo"] == "plano" or it["status"] in DEMANDA_VIVA))
            novos.append({"t": _iso(agora), "tipo": "inicio", "n": vivos})
        else:
            for chave, it in atuais.items():
                antes = self.conhecido.get(chave)
                if antes is not None and antes.get("status") == it["status"]:
                    continue
                if antes is None and it["status"] in FINAIS:
                    continue  # an old finished plan we never saw moving
                quando = agora if self.iniciado else it["mtime"]
                novos.append({"t": _iso(quando), "tipo": it["tipo"], "id": it["id"], "titulo": it["titulo"],
                              "de": (antes or {}).get("status", ""), "para": it["status"], "pr": it["pr"],
                              "ciclos": it["ciclos"]})
        novos.sort(key=lambda e: e["t"])
        conhecido = {k: {"status": v["status"], "pr": v["pr"]} for k, v in atuais.items()}
        with self.lock:
            self.itens = atuais
            self.eventos.extend(novos)
            del self.eventos[:-300]
        self.iniciado = True
        if conhecido != self.conhecido or novos:
            self.conhecido = conhecido
            self._gravar(novos)

    def _gravar(self, novos: list) -> None:
        try:
            self.store.mkdir(parents=True, exist_ok=True)
            tmp = self.estado_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.conhecido, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.estado_path)
            if novos:
                with self.eventos_path.open("a", encoding="utf-8") as fh:
                    for e in novos:
                        fh.write(json.dumps(e, ensure_ascii=False) + "\n")
                if self.eventos_path.stat().st_size > 400_000:
                    self.eventos_path.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in self.eventos),
                                                 encoding="utf-8")
        except OSError as e:
            self.erro = str(e)

    def vista(self) -> dict:
        agora = time.time()
        with self.lock:
            itens = list(self.itens.values())
            eventos = list(self.eventos[-80:])
        por_id = {it["id"]: it["status"] for it in itens if it["tipo"] == "plano"}
        quadro = []
        for it in itens:
            st = it["status"]
            if it["tipo"] == "demanda":
                if st not in DEMANDA_VIVA:
                    continue
            elif st in ("backlog", "descartado"):
                continue
            elif st == "concluido" and agora - it["mtime"] > CONCLUIDO_VISIVEL:
                continue
            item = {k: v for k, v in it.items() if k != "mtime"}
            item["fase"] = FASE.get(st, "outro")
            if st == "pronto" and it["depende"] and por_id.get(it["depende"]) not in ("aprovado", "concluido"):
                item["bloqueado"] = True
            quadro.append(item)
        quadro.sort(key=lambda x: (ORDEM.get(x["status"], 15), x["desde"]))
        return {"quadro": quadro, "eventos": eventos, "ok": self.planos.is_dir(), "erro": self.erro}

    def plano_de(self, status: str) -> Optional[dict]:
        with self.lock:
            achados = [it for it in self.itens.values() if it["tipo"] == "plano" and it["status"] == status]
        if not achados:
            return None
        it = max(achados, key=lambda x: x["mtime"])
        return {"id": it["id"], "titulo": it["titulo"], "desde": it["desde"], "pr": it["pr"], "status": it["status"]}
