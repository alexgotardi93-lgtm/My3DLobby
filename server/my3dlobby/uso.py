"""Usage and cost per agent: tokens and US$ read from each agent's Hermes session store.

Source (read-only, like atividade.py): ~/.hermes/profiles/<p>/state.db - and the rows of
~/.hermes/state.db whose profile_name is <p> - opened with mode=ro + query_only.

  * sessions             -> token counters and cost columns of each session (the main agent loop)
  * session_model_usage  -> (Hermes schema v20+) one row per session x model x task, including the
                            auxiliary calls (compression, titles, vision...) that never reach the
                            session counters
Same reconciliation as `hermes insights`: the per-model rows, plus whatever the session counters
hold beyond the main-loop rows (sessions recorded before that table existed). A session counts on
the day (or hour) it started, also like `hermes insights`.

Cost of each piece, first match wins:
  1. what the provider billed (actual_cost_usd);
  2. tokens x PRECOS below - the Claude 5.5 generation (Hermes v0.22 has no price for Sonnet and
     Haiku 5.5; for Opus 5.5 it uses these same numbers);
  3. the estimate Hermes itself stored (any other model it knows);
  4. local models (Ollama, LM Studio, anything on localhost) cost US$ 0;
  5. otherwise "sem preço": the tokens are counted, the cost stays 0 and the panel says so.

Nothing here writes anywhere, and nothing reads messages, .env, keys or tokens.
"""
from __future__ import annotations

import re
import sqlite3
import threading
import time
from collections import Counter
from datetime import datetime, time as dtime, timedelta
from pathlib import Path
from typing import Optional

from .atividade import _abrir, _colunas, _f

PERIODOS = ("hoje", "7d", "mes", "30d")

# US$ per million tokens: (input without cache, cache write - 5 min, cache read, output).
# Output includes the thinking tokens (Anthropic bills them as output).
PRECOS = (
    # pattern on the normalized model id, name, rates, (average prompt per request above which, rates)
    (re.compile(r"^claude-opus-5-5(?!\d)"), "Opus 5.5", (4.00, 5.00, 0.20, 20.00), None),
    (re.compile(r"^claude-sonnet-5-5(?!\d)"), "Sonnet 5.5", (2.00, 2.50, 0.10, 10.00), None),
    # Haiku 5.5: a request whose prompt passes 100K tokens is billed at 5x, whole request. Only the session
    # totals are known, so the higher tier applies when the average prompt per call passes 100K.
    (re.compile(r"^claude-haiku-5-5(?!\d)"), "Haiku 5.5", (0.10, 0.125, 0.01, 0.50), (100_000, (0.50, 0.625, 0.05, 2.50))),
)
TOKENS = ("input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens", "reasoning_tokens")
CHAVES = {"input_tokens": "entrada", "cache_write_tokens": "cache_gravado", "cache_read_tokens": "cache_lido",
          "output_tokens": "saida", "reasoning_tokens": "raciocinio"}

_SESSAO = ("id", "started_at", "model", "billing_provider", "billing_base_url", "billing_mode", *TOKENS,
           "estimated_cost_usd", "actual_cost_usd", "cost_status", "cost_source", "api_call_count", "message_count")
_LINHA = ("session_id", "model", "billing_provider", "billing_base_url", "billing_mode", "task", "api_call_count",
          *TOKENS, "estimated_cost_usd", "actual_cost_usd", "cost_status", "cost_source")
_FAMILIA = re.compile(r"claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)")
_PROVEDOR_LOCAL = {"ollama", "lmstudio", "lm-studio", "local", "llamacpp", "llama.cpp", "llama-cpp", "mlx", "vllm-local"}
_URL_LOCAL = re.compile(r"//(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|/|$)|:11434\b")
_NOME_LOCAL = re.compile(r"(qwen|gpt-oss|llama|gemma|mistral|mixtral|phi-?\d|deepseek-r1|granite|ollama|mlx)", re.I)


# ----------------------------------------------------------------------------- models and prices
def modelo_id(modelo: str) -> str:
    """'anthropic/claude-opus-5.5-20261015' -> 'claude-opus-5-5-20261015'."""
    m = (modelo or "").strip().lower()
    if "claude-" in m:
        m = m[m.index("claude-"):]
    else:
        m = m.rsplit("/", 1)[-1]
    return re.sub(r"(\d+)\.(\d+)", r"\1-\2", m)


def eh_local(modelo, provedor, base_url) -> bool:
    p, b, m = (provedor or "").strip().lower(), (base_url or "").strip().lower(), (modelo or "").strip().lower()
    if p in _PROVEDOR_LOCAL or _URL_LOCAL.search(b):
        return True
    if "claude" in m or "gpt-5" in m or "gpt-6" in m or "gemini" in m:
        return False
    return p in ("", "custom", "unknown") and not b and bool(_NOME_LOCAL.search(m))


def nome_modelo(modelo: str, local: bool = False) -> str:
    f = _FAMILIA.search(modelo_id(modelo))
    if f:
        nome = f.group(1).capitalize() + " " + f.group(2) + ("." + f.group(3) if f.group(3) else "")
    else:
        nome = (modelo or "").strip() or "?"
    return nome + (" (local)" if local else "")


def preco(modelo: str):
    mid = modelo_id(modelo)
    for padrao, nome, taxas, faixa in PRECOS:
        if padrao.search(mid):
            return nome, taxas, faixa
    return None


def custo(peca: dict) -> tuple:
    """(US$, fonte, US$ at API prices) of one piece of usage.

    fonte: real | tabela | hermes | local | incluido | sem_preco | zero"""
    tok = [int(peca.get(k) or 0) for k in ("input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens")]
    real, est = _f(peca.get("actual_cost_usd")), _f(peca.get("estimated_cost_usd"))
    if not any(tok) and not real and not est:
        return 0.0, "zero", 0.0
    if real > 0:
        return real, "real", real
    tabela = None
    p = preco(peca.get("model") or "")
    if p:
        _, taxas, faixa = p
        if faixa and (tok[0] + tok[1] + tok[2]) / max(1, int(peca.get("api_call_count") or 0)) > faixa[0]:
            taxas = faixa[1]
        tabela = sum(t * r for t, r in zip(tok, taxas)) / 1e6
    if (peca.get("billing_mode") or "").lower() == "subscription_included" or (peca.get("cost_status") or "").lower() == "included":
        return 0.0, "incluido", tabela if tabela is not None else 0.0
    if tabela is not None:
        return tabela, "tabela", tabela
    if est > 0:
        return est, "hermes", est
    if eh_local(peca.get("model"), peca.get("billing_provider"), peca.get("billing_base_url")):
        return 0.0, "local", 0.0
    return 0.0, "sem_preco", 0.0


# ----------------------------------------------------------------------------- state.db
def _campos(querer, tem, alias: str) -> str:
    return ", ".join(f"{alias}{c}" if c in tem else f"NULL AS {c}" for c in querer)


def pecas_da_sessao(s: dict, linhas: list) -> dict:
    """The session's usage as pieces: its per-model rows plus what the counters hold beyond them."""
    principais = [x for x in linhas if not (x.get("task") or "")]
    pecas = [dict(x, aux=bool(x.get("task") or "")) for x in linhas]
    resto = {k: max(0, int(s.get(k) or 0) - sum(int(x.get(k) or 0) for x in principais)) for k in TOKENS + ("api_call_count",)}
    resto_est = max(0.0, _f(s.get("estimated_cost_usd")) - sum(_f(x.get("estimated_cost_usd")) for x in principais))
    resto_real = max(0.0, _f(s.get("actual_cost_usd")) - sum(_f(x.get("actual_cost_usd")) for x in principais))
    if any(resto[k] for k in TOKENS) or resto_est > 1e-9 or resto_real > 1e-9:
        pecas.append({**{k: s.get(k) for k in ("model", "billing_provider", "billing_base_url", "billing_mode",
                                                "cost_status", "cost_source")},
                      **resto, "estimated_cost_usd": resto_est, "actual_cost_usd": resto_real, "task": "", "aux": False})
    return {"id": s["id"], "started_at": _f(s.get("started_at")), "model": s.get("model") or "", "pecas": pecas}


def ler_banco(path: Path, perfil: Optional[str], desde: float, ate: float) -> list:
    """Sessions of one state.db that started in [desde, ate), as pecas_da_sessao() dicts.

    perfil: None = every row; "default" = rows without a profile; other = rows of that profile."""
    con = _abrir(path)
    try:
        cs = _colunas(con, "sessions")
        if not {"id", "started_at"} <= cs:
            return []
        onde, params = "WHERE s.started_at >= ? AND s.started_at < ?", [desde, ate]
        if perfil is not None:
            if "profile_name" not in cs:
                return []
            if perfil == "default":
                onde += " AND (s.profile_name IS NULL OR s.profile_name IN ('', 'default'))"
            else:
                onde, params = onde + " AND s.profile_name = ?", params + [perfil]
        sessoes = {r["id"]: dict(r) for r in con.execute(f"SELECT {_campos(_SESSAO, cs, 's.')} FROM sessions s {onde}", params)}
        linhas: dict = {}
        tabelas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if sessoes and "session_model_usage" in tabelas:
            cu = _colunas(con, "session_model_usage")
            if {"session_id", "model"} <= cu:
                for r in con.execute(f"SELECT {_campos(_LINHA, cu, 'u.')} FROM session_model_usage u "
                                     f"JOIN sessions s ON s.id = u.session_id {onde}", params):
                    linhas.setdefault(r["session_id"], []).append(dict(r))
    finally:
        con.close()
    return [pecas_da_sessao(s, linhas.get(sid, [])) for sid, s in sessoes.items()]


# ----------------------------------------------------------------------------- aggregation
def janela(periodo: str, agora: float) -> tuple:
    """(start timestamp, end timestamp, granularity, bucket keys) in local time."""
    hoje = datetime.fromtimestamp(agora).date()
    inicio = {"hoje": hoje, "7d": hoje - timedelta(days=6), "30d": hoje - timedelta(days=29)}.get(periodo, hoje.replace(day=1))
    desde = datetime.combine(inicio, dtime.min).timestamp()
    if periodo == "hoje":
        return desde, agora + 1, "hora", [f"{h:02d}" for h in range(24)]
    chaves, d = [], inicio
    while d <= hoje:
        chaves.append(d.isoformat())
        d += timedelta(days=1)
    return desde, agora + 1, "dia", chaves


def _tokens_vazios() -> dict:
    return {"entrada": 0, "cache_lido": 0, "cache_gravado": 0, "saida": 0, "raciocinio": 0, "total": 0}


def _somar_tokens(alvo: dict, peca: dict) -> int:
    total = 0
    for k, nome in CHAVES.items():
        v = int(peca.get(k) or 0)
        alvo[nome] += v
        if k != "reasoning_tokens":  # thinking is already inside output
            total += v
    alvo["total"] += total
    return total


def agregar(agentes: list, sessoes: dict, periodo: str, agora: float, avisos: Optional[list] = None) -> dict:
    """agentes: [{id, name, color, role, model}] in display order; sessoes: {id: [pecas_da_sessao(), ...]}."""
    desde, _, gran, chaves = janela(periodo, agora)
    pos = {c: i for i, c in enumerate(chaves)}
    n = len(agentes)
    baldes = [{"chave": c, "usd": [0.0] * n, "tokens": [0] * n} for c in chaves]
    sem_preco: Counter = Counter()
    saida = []
    for i, a in enumerate(agentes):
        ag = {"id": a["id"], "name": a.get("name") or a["id"], "color": a.get("color") or "", "role": a.get("role") or "",
              "modelo_atual": nome_modelo(a.get("model") or "", bool(a.get("model_local"))) if a.get("model") else "",
              "usd": 0.0, "usd_incluido": 0.0, "hermes_usd": 0.0, "tokens": _tokens_vazios(),
              "sessoes": 0, "chamadas": 0}
        modelos: dict = {}
        fontes: Counter = Counter()
        aux = {"usd": 0.0, "tokens": 0, "tarefas": Counter()}
        for s in sessoes.get(a["id"], []):
            dt = datetime.fromtimestamp(s["started_at"])
            b = pos.get(f"{dt.hour:02d}" if gran == "hora" else dt.date().isoformat())
            teve = False
            for p in s["pecas"]:
                usd, fonte, api = custo(p)
                if fonte == "zero":
                    continue
                teve = True
                tok = _somar_tokens(ag["tokens"], p)
                ag["usd"] += usd
                ag["usd_incluido"] += api if fonte == "incluido" else 0.0
                ag["hermes_usd"] += _f(p.get("actual_cost_usd")) or _f(p.get("estimated_cost_usd"))
                ag["chamadas"] += int(p.get("api_call_count") or 0)
                fontes[fonte] += 1
                nome = nome_modelo(p.get("model") or s["model"], fonte == "local")
                if p.get("aux"):  # compression, titles, vision...: counted in the agent's total, listed apart
                    aux["usd"] += usd
                    aux["tokens"] += tok
                    aux["tarefas"][p.get("task") or "?"] += 1
                else:
                    m = modelos.setdefault(nome, {"nome": nome, "usd": 0.0, "tokens": 0, "sessoes": set(),
                                                  "local": fonte == "local", "fonte": fonte})
                    m["usd"] += usd
                    m["tokens"] += tok
                    m["sessoes"].add(s["id"])
                if fonte == "sem_preco":
                    sem_preco[nome] += tok
                if b is not None:
                    baldes[b]["usd"][i] += usd
                    baldes[b]["tokens"][i] += tok
            if teve:
                ag["sessoes"] += 1
        ag["modelos"] = sorted(({**m, "sessoes": len(m["sessoes"]), "usd": round(m["usd"], 6)} for m in modelos.values()),
                               key=lambda m: (-m["usd"], -m["tokens"]))
        ag["fontes"] = dict(fontes)
        ag["aux"] = {"usd": round(aux["usd"], 6), "tokens": aux["tokens"], "tarefas": [t for t, _ in aux["tarefas"].most_common()]}
        for k in ("usd", "usd_incluido", "hermes_usd"):
            ag[k] = round(ag[k], 6)
        saida.append(ag)
    for b in baldes:
        b["usd"] = [round(v, 6) for v in b["usd"]]
    total = {"usd": round(sum(a["usd"] for a in saida), 6), "usd_aux": round(sum(a["aux"]["usd"] for a in saida), 6),
             "usd_incluido": round(sum(a["usd_incluido"] for a in saida), 6), "tokens": _tokens_vazios(),
             "sessoes": sum(a["sessoes"] for a in saida), "chamadas": sum(a["chamadas"] for a in saida)}
    for a in saida:
        for k in total["tokens"]:
            total["tokens"][k] += a["tokens"][k]
    dias = max(1.0, (agora - desde) / 86400) if periodo != "hoje" else None
    avisos = list(avisos or [])
    for nome, tok in sem_preco.most_common():
        avisos.append({"tipo": "sem_preco", "modelo": nome, "tokens": tok})
    return {
        "periodo": periodo, "granularidade": gran,
        "desde": datetime.fromtimestamp(desde).astimezone().isoformat(timespec="seconds"),
        "gerado_em": datetime.fromtimestamp(agora).astimezone().isoformat(timespec="seconds"),
        "dias": round(dias, 3) if dias else None,
        "ritmo_30d": round(total["usd"] / dias * 30, 4) if dias else None,
        "agentes": saida, "baldes": baldes, "total": total, "avisos": avisos,
        "precos": [{"nome": nome, "entrada": t[0], "cache_gravado": t[1], "cache_lido": t[2], "saida": t[3],
                    **({"acima": f[0], "acima_mult": round(f[1][0] / t[0], 2)} if f else {})}
                   for _, nome, t, f in PRECOS],
    }


class UsoReader:
    """Caches the aggregate of each period for a few seconds (the window polls while open)."""

    TTL = 20

    def __init__(self, home: Path):
        self.home = home
        self.lock = threading.Lock()
        self.cache: dict = {}

    def bancos(self, perfil: str) -> list:
        out = [(self.home / "state.db", "default")] if perfil == "default" else \
              [(self.home / "profiles" / perfil / "state.db", None), (self.home / "state.db", perfil)]
        return [(p, f) for p, f in out if p.is_file()]

    def resumo(self, agentes: list, periodo: str, agora: Optional[float] = None) -> dict:
        periodo = periodo if periodo in PERIODOS else "mes"
        agora = agora or time.time()
        chave = (tuple((a["id"], a.get("model") or "") for a in agentes), datetime.fromtimestamp(agora).strftime("%Y-%m-%d %H"))
        with self.lock:
            c = self.cache.get(periodo)
            if c and c[1] == chave and agora - c[0] < self.TTL:
                return c[2]
        desde, ate, _, _ = janela(periodo, agora)
        sessoes, avisos = {}, []
        for a in agentes:
            vistas, lista = set(), []
            for path, filtro in self.bancos(a["id"]):
                try:
                    for s in ler_banco(path, filtro, desde, ate):
                        if s["id"] not in vistas:  # the same session in two stores counts once
                            vistas.add(s["id"])
                            lista.append(s)
                except sqlite3.Error as e:
                    avisos.append({"tipo": "erro", "agente": a.get("name") or a["id"], "texto": f"{path.name}: {e}"})
            sessoes[a["id"]] = lista
        dados = agregar(agentes, sessoes, periodo, agora, avisos)
        with self.lock:
            self.cache[periodo] = (agora, chave, dados)
        return dados

    def hoje(self, agentes: list) -> dict:
        """What the bottom bar and the agent panel show: today's US$ and tokens, per agent and in total."""
        r = self.resumo(agentes, "hoje")
        return {"usd": r["total"]["usd"], "tokens": r["total"]["tokens"]["total"],
                "agentes": {a["id"]: {"usd": a["usd"], "tokens": a["tokens"]["total"]} for a in r["agentes"]}}
