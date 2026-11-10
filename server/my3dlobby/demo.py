"""Demo office: fake agents that work, rest and sleep on a timer.

Used by `python -m my3dlobby --demo` so the lobby can be tried (and the 3D
scene developed) on a machine without Hermes.
"""
from __future__ import annotations

import random
import time
from datetime import datetime, time as dtime, timedelta

from .chat import ChatHub
from .config import Config
from .hermes import now_local
from .uso import PERIODOS, agregar, janela, pecas_da_sessao

DEMO_AGENTS = [
    {"id": "zap", "name": "Zap", "role": "Atendimento WhatsApp", "color": "#2f8f6f", "model": "claude-haiku-5-5"},
    {"id": "financeiro", "name": "Financeiro", "role": "Notas fiscais", "color": "#3b6fd8", "model": "claude-sonnet-5-5"},
    {"id": "dev", "name": "Dev", "role": "Desenvolvimento", "color": "#c9a227", "model": "claude-sonnet-5-5"},
    {"id": "arquiteto", "name": "Arquiteto", "role": "Planos e melhorias", "color": "#d8663b", "model": "claude-opus-5-5"},
    {"id": "reviewer", "name": "Reviewer", "role": "Revisão de PR", "color": "#8c5bd8", "model": "claude-opus-5-5"},
]

TASKS = {
    "zap": ["Lendo grupo Colaboradores SuperCota", "Respondendo Tiago: campos opcionais", "Vigia do Zap", "Enviando relato por e-mail"],
    "financeiro": ["Emitindo NFS-e 114", "Conferindo pedidos pendentes", "Enviando nota por e-mail"],
    "dev": ["Dev - fila (executando)"],
    "arquiteto": ["Avaliando melhoria: gerador de proposta", "Escrevendo plano de ação", "Revisando backlog"],
    "reviewer": ["Reviewer - fila (executando)"],
}

# fake Hermes steps (what atividade.AgoraReader reads from state.db on a real office)
STEPS = {
    "dev": [("skill", "dev-ler-plano"), ("ler", "arquiteto/planos/PLANO-D-20261108-1921-faxina-b-guia.md"),
            ("terminal", "git checkout -b plano/faxina-b-guia origin/main"), ("procurar", "“cestaManual” · src/"),
            ("ler", "src/pages/Cesta.tsx"), ("editar", "src/pages/Cesta.tsx"), ("editar", "docs/guia-cesta.md"),
            ("terminal", "npx vitest run src/__tests__/cestaNovidade.test.tsx"), ("terminal", "git add -A && git commit -m \"faxina b: guia\""),
            ("terminal", "npx vitest run --reporter=dot"), ("terminal", "git push -u origin plano/faxina-b-guia")],
    "reviewer": [("skill", "revisao-supercota"), ("terminal", "gh pr view 471 --json files,checks"), ("terminal", "gh pr diff 471"),
                 ("skill", "ler-relatorio-tester"), ("ler", "tester/relatorios/pr-471.md")],
    "arquiteto": [("ler", "arquiteto/demandas/2026-11-08-2013-vigia-de-logs.md"), ("skill", "plano-rota-segura"),
                  ("escrever", "arquiteto/planos/PLANO-D-20261108-2013-vigia.md")],
}

DEMO_BOARD = [
    {"tipo": "plano", "id": "D-20261108-1502-cesta-manual-a", "titulo": "Remover a cesta manual (parte a)", "status": "aprovado",
     "pr": "471", "ciclos": "0", "depende": "", "fase": "alex", "minutos": 34},
    {"tipo": "plano", "id": "D-20261108-1921-faxina-b-guia", "titulo": "Faxina parte b — guia", "status": "em-execucao",
     "pr": "", "ciclos": "0", "depende": "", "fase": "dev", "minutos": 23},
    {"tipo": "plano", "id": "D-20261108-1921-faxina-b-codigo", "titulo": "Faxina parte b — código", "status": "pronto",
     "pr": "", "ciclos": "0", "depende": "D-20261108-1921-faxina-b-guia", "fase": "fila", "minutos": 23, "bloqueado": True},
    {"tipo": "demanda", "id": "D-20261108-2013-vigia-de-logs", "titulo": "Vigia de logs: SuperCota, Consultec e BPGCompras",
     "status": "em-avaliacao", "pr": "", "ciclos": "", "depende": "", "fase": "arquiteto", "minutos": 4},
]

DEMO_EVENTS = [
    (95, "plano", "D-20261108-1502-cesta-manual-a", "Remover a cesta manual (parte a)", "em-execucao", "em-revisao", "471"),
    (80, "plano", "D-20261108-1502-cesta-manual-a", "Remover a cesta manual (parte a)", "em-revisao", "revisando", "471"),
    (34, "plano", "D-20261108-1502-cesta-manual-a", "Remover a cesta manual (parte a)", "revisando", "aprovado", "471"),
    (30, "plano", "D-20261108-1921-faxina-b-guia", "Faxina parte b — guia", "", "pronto", ""),
    (30, "plano", "D-20261108-1921-faxina-b-codigo", "Faxina parte b — código", "", "pronto", ""),
    (23, "plano", "D-20261108-1921-faxina-b-guia", "Faxina parte b — guia", "pronto", "em-execucao", ""),
    (4, "demanda", "D-20261108-2013-vigia-de-logs", "Vigia de logs: SuperCota, Consultec e BPGCompras", "novo", "em-avaliacao", ""),
]


# fake "Fila do Arquiteto": what waits for Alex's approval (aprovacao.AprovacaoReader reads the real one)
DEMO_FILA = [
    {"tipo": "item", "id": "2026-11-10-0802-cesta-arredondamento", "status": "novo", "minutos": 96,
     "titulo": "Cesta de preços: a Metodologia passa a explicar o arredondamento do valor de referência",
     "quem": "Cliente da prefeitura (WhatsApp, conversa individual)",
     "sugestao": "plano — pedido claro, mexe só no texto da Metodologia",
     "resumo": "No relatório diário a cesta deu R$ 1.200.110,00 no SuperCota e R$ 1.200.087,00 na conta da cliente. "
               "Ela quer entender a diferença de R$ 23,00 antes de mandar o processo ao controle interno."},
    {"tipo": "item", "id": "SENT-20261109-1940-diario", "status": "em-triagem", "minutos": 790,
     "titulo": "Sentinela: 546 de CPU na extrair-anexos e lentidão nas notificações",
     "quem": "Monitor de logs (Sentinela)", "sugestao": "",
     "resumo": "Relatório do Conferente: A1 extrair-anexos estourou a CPU 7 vezes em 1.095 chamadas (0,6%), S3, novo. "
               "A2 notificacoes_listar falhou por tempo em 46 de 370 chamadas (12%), S2, novo."},
    {"tipo": "demanda", "id": "D-20261110-0930-relatorio-semanal-por-municipio", "status": "novo", "minutos": 38,
     "titulo": "Relatório semanal de uso por município", "quem": "Claude (pedido do Alex no chat)", "sugestao": "",
     "resumo": "Toda segunda de manhã, uma linha por município: usuários ativos, demandas na semana contra a média das "
               "4 semanas anteriores e erros de tela. Só leitura."},
    {"tipo": "retorno", "id": "D-20261110-0110-coletor-de-erros-sentry-edge", "status": "novo", "minutos": 450,
     "titulo": "Sentry nas funções: o Dev parou num passo impossível do plano", "quem": "Dev", "sugestao": "",
     "resumo": "O passo 4 manda importar sentrySdk.ts em todas as funções, mas 3 delas são legado sem withAuth. "
               "Refazer o plano custa uma rodada do Opus."},
    {"tipo": "plano", "id": "D-20261110-0235-saude-por-municipio-contrato", "status": "aguardando-alex", "minutos": 460,
     "titulo": "Saúde por município: guardar o vencimento do contrato de cada prefeitura",
     "quem": "demanda:2026-11-10-0235-saude-por-municipio.md", "sugestao": "",
     "resumo": "Perguntas para o Alex: 1. A data fica numa coluna nova, municipalities.contrato_vence_em? "
               "2. O admin preenche na tela de municípios? Com sim às duas, o plano segue para o Dev."},
    {"tipo": "plano", "id": "D-20261110-0235-saude-por-municipio-rpc", "status": "aguardando-alex", "minutos": 460, "pr": "484",
     "titulo": "Saúde por município: função só de leitura com os números da semana por prefeitura",
     "quem": "demanda:2026-11-10-0235-saude-por-municipio.md", "sugestao": "",
     "resumo": "A função lê usuários ativos, demandas e erros por município na semana. Precisa do seu sim porque "
               "abre uma função nova para o papel admin."},
]


class DemoAprovacao:
    """Same interface as aprovacao.AprovacaoReader, in memory (decisions only last until the demo restarts)."""

    def __init__(self):
        import threading
        from .aprovacao import montar_item
        self.lock = threading.Lock()
        t0 = now_local()
        pasta = {"item": "arquiteto/entrada/{id}/item.md", "demanda": "arquiteto/demandas/{id}.md",
                 "retorno": "arquiteto/retornos/{id}.md", "plano": "arquiteto/planos/PLANO-{id}.md"}
        self.itens = []
        for it in DEMO_FILA:
            p = {**it, "quando": (t0 - timedelta(minutes=it["minutos"])).strftime("%d/%m/%Y %H:%M")}
            self.itens.append(montar_item(p, pasta[it["tipo"]].format(id=it["id"])))

    def atualizar(self, forcar: bool = False) -> None:
        pass

    def vista(self) -> dict:
        with self.lock:
            return {"disponivel": True, "trava": True, "n": len(self.itens), "itens": list(self.itens), "agente": "arquiteto",
                    "erro": "", "atualizado": now_local().isoformat(timespec="seconds"), "programa": "perfis/cadeia/fila_aprovacao.py"}

    def detalhe(self, chave: str) -> dict:
        with self.lock:
            it = next((i for i in self.itens if i["chave"] == chave), None)
        if not it:
            return {"ok": False, "erro": "este item não está mais na fila"}
        texto = "\n".join([f"status: {it['status']}", f"id: {it['id']}", f"titulo: {it['titulo']}", f"quem: {it['quem']}",
                           f"quando: {it['quando']}", "", "## Pedido", "", it["resumo"], "",
                           "## Contexto", "", "(demo) Aqui aparece o arquivo inteiro do item: a mensagem original, os anexos "
                           "citados e o que o Conferente anotou."])
        return {"ok": True, "chave": chave, "texto": texto, "cortado": False}

    def decidir(self, chave: str, acao: str, motivo: str = "") -> dict:
        acao = str(acao or "").strip().lower()[:1]
        if acao not in ("a", "r", "b"):
            return {"ok": False, "erro": "ação inválida (a, r ou b)"}
        with self.lock:
            it = next((i for i in self.itens if i["chave"] == chave), None)
            if not it:
                return {"ok": False, "erro": "este item não está mais na fila (já foi decidido ou mudou de status)"}
            self.itens.remove(it)
        nome = {"a": "aprovado", "r": "recusado", "b": "backlog"}[acao]
        return {"ok": True, "acao": acao, "chave": chave, "feito": f"(demo) {nome}: {it['id']}"}


# fake usage per agent: sessions per weekday (min, max), API calls per session, prompt tokens per call,
# output tokens per call, model. The Dev ran on a local model (free) until four days ago.
USO_DEMO = {
    "zap": ((14, 30), (3, 12), (18_000, 55_000), 350, "claude-haiku-5-5"),
    "financeiro": ((5, 10), (6, 18), (25_000, 50_000), 550, "claude-sonnet-5-5"),
    "dev": ((1, 3), (50, 140), (45_000, 95_000), 1300, "claude-sonnet-5-5"),
    "arquiteto": ((2, 6), (12, 38), (35_000, 85_000), 1100, "claude-opus-5-5"),
    "reviewer": ((1, 5), (8, 26), (28_000, 70_000), 750, "claude-opus-5-5"),
}


def sessoes_demo(agente: str, desde: float, ate: float) -> list:
    """Deterministic fake sessions (same numbers on every refresh), as uso.pecas_da_sessao() dicts."""
    por_dia, chamadas, prompt, saida, modelo = USO_DEMO[agente]
    out = []
    dia, fim = datetime.fromtimestamp(desde).date(), datetime.fromtimestamp(ate).date()
    while dia <= fim:
        rng = random.Random(f"{agente}-{dia.isoformat()}")
        lo, hi = por_dia
        n = rng.randint(lo, hi) if dia.weekday() < 5 else rng.randint(0, max(1, lo // 2))
        local = agente == "dev" and (fim - dia).days >= 4
        for k in range(n):
            ts = datetime.combine(dia, dtime(8)) + timedelta(hours=rng.uniform(0, 12))
            c = rng.randint(*chamadas)
            p = rng.randint(*prompt)
            o = int(saida * rng.uniform(0.6, 1.4))
            if not desde <= ts.timestamp() < ate:
                continue
            if local:  # Ollama: no prompt cache, nothing billed
                linha = {"model": "dev-qwen27", "billing_provider": "custom", "billing_base_url": "http://127.0.0.1:11434/v1",
                         "billing_mode": "unknown", "input_tokens": c * p, "output_tokens": c * o, "cache_read_tokens": 0,
                         "cache_write_tokens": 0, "reasoning_tokens": 0, "api_call_count": c, "cost_status": "unknown"}
            else:
                linha = {"model": modelo, "billing_provider": "anthropic", "billing_base_url": "", "billing_mode": "official_docs_snapshot",
                         "input_tokens": int(c * p * 0.035), "cache_write_tokens": int(c * p * 0.06), "cache_read_tokens": int(c * p * 0.905),
                         "output_tokens": c * o, "reasoning_tokens": 0, "api_call_count": c, "cost_status": "unknown"}
            sid = f"demo-{agente}-{dia.isoformat()}-{k}"
            aux = [{"session_id": sid, "model": "claude-haiku-5-5", "task": "title_generation", "billing_provider": "anthropic",
                    "input_tokens": 900, "output_tokens": 18, "api_call_count": 1, "cost_status": "unknown"}] if not local else []
            out.append(pecas_da_sessao({"id": sid, "started_at": ts.timestamp(), **linha}, aux))
        dia += timedelta(days=1)
    return out


class DemoChat:
    """Answers after a few seconds, without Hermes."""

    def __init__(self):
        import threading
        self.lock = threading.Lock()
        self.history: dict[str, list] = {}
        self.running: dict[str, dict] = {}

    def state(self, agent):
        with self.lock:
            return {"agent": agent, "messages": list(self.history.get(agent, [])), "running": agent in self.running,
                    "since": self.running.get(agent, {}).get("since", "")}

    def busy(self, agent):
        with self.lock:
            return agent in self.running

    def resumo(self):
        hub = ChatHub.__new__(ChatHub)
        hub.lock, hub.history, hub.running = self.lock, self.history, self.running
        return ChatHub.resumo(hub)

    def buscar(self, q, limite=40):
        hub = ChatHub.__new__(ChatHub)
        hub.lock, hub.history, hub.running = self.lock, self.history, self.running
        return ChatHub.buscar(hub, q, limite)

    def send(self, agent, text, as_demand=False):
        import threading, time as _t
        text = text.strip()
        if not text:
            return {"ok": False, "erro": "mensagem vazia"}
        with self.lock:
            if agent in self.running:
                return {"ok": False, "erro": "o agente ainda está respondendo"}
            self.running[agent] = {"since": now_local().isoformat(timespec="seconds")}
            self.history.setdefault(agent, []).append({"role": "alex", "text": text, "time": now_local().isoformat(timespec="seconds"), "demanda": "arquiteto/demandas/demo.md" if as_demand else ""})

        def reply():
            _t.sleep(6)
            with self.lock:
                self.running.pop(agent, None)
                self.history[agent].append({"role": agent, "ok": True, "time": now_local().isoformat(timespec="seconds"),
                                            "text": f"(demo) Entendido: \"{text[:60]}\". " + ("Plano escrito em arquiteto/planos/PLANO-demo.md; status pronto, o Dev pega na próxima rodada." if as_demand else "Respondido.")})
        threading.Thread(target=reply, daemon=True).start()
        return {"ok": True, "demanda": "arquiteto/demandas/demo.md" if as_demand else ""}


class DemoReader:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.chat = DemoChat()
        self.aprovacao = DemoAprovacao()
        t0 = now_local()
        def ago(minutes):
            return (t0 - timedelta(minutes=minutes)).isoformat(timespec="seconds")
        self.chat.history = {
            "arquiteto": [
                {"role": "alex", "text": "Crie o plano da faxina parte b, com rota segura para o Dev.", "time": ago(40), "demanda": ""},
                {"role": "arquiteto", "ok": True, "time": ago(31), "text": "Feito. Dois planos, um depois do outro:\n1. PLANO-D-20261108-1921-faxina-b-guia (status pronto)\n2. PLANO-D-20261108-1921-faxina-b-codigo (depende do primeiro)\nO Dev pega o primeiro na próxima rodada."},
                {"role": "alex", "text": "Quero um vigia de logs para SuperCota, Consultec e BPGCompras.", "time": ago(5), "demanda": "arquiteto/demandas/2026-11-08-2013-vigia-de-logs.md"},
            ],
            "financeiro": [
                {"role": "alex", "text": "Quantas notas saíram hoje?", "time": ago(180), "demanda": ""},
                {"role": "financeiro", "ok": True, "time": ago(179), "text": "3 notas emitidas hoje (112, 113 e 114), todas enviadas por e-mail."},
            ],
            "dev": [
                {"role": "alex", "text": "Rode os testes da cesta e me diga se passam.", "time": ago(300), "demanda": ""},
                {"role": "dev", "ok": True, "time": ago(296), "text": "Rodei `npx vitest run src/__tests__/cestaNovidade.test.tsx`: 12 de 12 passaram."},
            ],
        }
        self.rng = random.Random(7)
        self.state: dict[str, dict] = {}
        self.feed: list[dict] = []
        t = now_local()
        for i, a in enumerate(DEMO_AGENTS):
            self.state[a["id"]] = {"status": "idle", "until": t + timedelta(seconds=5 + 6 * i), "activity": "", "runs": 0}

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def agent_ids(self):
        return [a["id"] for a in DEMO_AGENTS]

    def uso_resumo(self, periodo: str) -> dict:
        periodo = periodo if periodo in PERIODOS else "mes"
        agora = time.time()
        desde, ate, _, _ = janela(periodo, agora)
        agentes = [{k: a.get(k) for k in ("id", "name", "color", "role", "model", "model_local")} for a in DEMO_AGENTS]
        return agregar(agentes, {a["id"]: sessoes_demo(a["id"], desde, ate) for a in DEMO_AGENTS}, periodo, agora)

    def _uso_hoje(self) -> dict:
        if time.time() - getattr(self, "_uso_t", 0) > 30:
            r = self.uso_resumo("hoje")
            self._uso = {"usd": r["total"]["usd"], "tokens": r["total"]["tokens"]["total"],
                         "agentes": {a["id"]: {"usd": a["usd"], "tokens": a["tokens"]["total"]} for a in r["agentes"]}}
            self._uso_t = time.time()
        return self._uso

    def _tick(self, when: datetime) -> None:
        for a in DEMO_AGENTS:
            s = self.state[a["id"]]
            if when < s["until"]:
                continue
            if s["status"] == "working":
                s["status"] = "idle"
                s["activity"] = ""
                s["until"] = when + timedelta(seconds=self.rng.randint(15, 45))
                self.feed.insert(0, {"time": when.isoformat(timespec="seconds"), "agent": a["id"], "kind": "response",
                                     "text": "Resposta pronta", "seconds": round(self.rng.uniform(4, 40), 1),
                                     "api_calls": self.rng.randint(1, 9)})
            else:
                s["status"] = "working"
                s["activity"] = self.rng.choice(TASKS[a["id"]])
                s["runs"] += 1
                s["until"] = when + timedelta(seconds=self.rng.randint(12, 35))
                self.feed.insert(0, {"time": when.isoformat(timespec="seconds"), "agent": a["id"], "kind": "message",
                                     "text": s["activity"]})
        del self.feed[60:]

    def snapshot(self) -> dict:
        when = now_local()
        self._tick(when)
        uso = self._uso_hoje()
        agents = []
        for i, a in enumerate(DEMO_AGENTS):
            s = self.state[a["id"]]
            chatting = self.chat.busy(a["id"])
            agents.append({
                **a,
                "desk": i,
                "status": "working" if chatting else s["status"],
                "activity": "Respondendo ao Alex" if chatting else s["activity"],
                "last_activity": when.isoformat(timespec="seconds"),
                "runs_today": s["runs"],
                "messages_today": s["runs"],
                "uso_hoje": uso["agentes"].get(a["id"]),
                "crons": [{"id": "demo", "state": "active", "name": f"{a['name']} - rotina", "schedule": "*/5 8-20 * * *",
                           "next_run": (when + timedelta(minutes=3)).isoformat(timespec="minutes"), "last_run": when.isoformat(timespec="minutes"),
                           "last_ok": True, "script": "rotina.py"}],
                "recent": [f for f in self.feed if f["agent"] == a["id"]][:8],
            })
        for a in agents:
            a["agora"] = self._agora(a, when)
            a.setdefault("model_local", False)
            if a["agora"] and a["agora"]["ativo"]:
                a["status"] = "working"
        return {
            "generated_at": when.isoformat(timespec="seconds"),
            "office": {"name": self.cfg.office_name + " (demo)", "hours": self.cfg.hours, "open": True, "language": self.cfg.language},
            "hermes": {"home": "(demo)", "bin": "", "gateway": "demo mode", "last_cron_poll": 0, "errors": []},
            "agents": agents,
            "feed": self.feed[:60],
            "cadeia": self._cadeia(when),
            "aprovacao": self.aprovacao.vista(),
            "conversas": self.chat.resumo(),
            "uso": {"usd": uso["usd"], "tokens": uso["tokens"]},
        }

    def _agora(self, a: dict, when: datetime):
        steps = STEPS.get(a["id"])
        if not steps:
            return None
        period = 9
        n = int(when.timestamp() // period)
        live = a["id"] == "dev" or a["status"] == "working"
        cur = n % len(steps) if live else len(steps) - 1
        passos = []
        for k in range(max(0, cur - 7), cur + 1):
            acao, alvo = steps[k]
            ts = when - timedelta(seconds=(cur - k) * period + (when.timestamp() % period))
            running = live and k == cur
            passos.append({"t": ts.isoformat(timespec="seconds"), "acao": acao, "alvo": alvo, "tool": acao,
                           "estado": "rodando" if running else ("erro" if k == 3 and a["id"] == "dev" else "ok"),
                           "seg": None if running else round(period * 0.7, 1)})
        plano = None
        if a["id"] == "dev":
            plano = {"id": DEMO_BOARD[1]["id"], "titulo": DEMO_BOARD[1]["titulo"], "status": "em-execucao", "pr": "",
                     "desde": (when - timedelta(minutes=23)).isoformat(timespec="minutes")}
        inicio = when - timedelta(minutes=23 if a["id"] == "dev" else 3)
        return {
            "ativo": live, "estado": "executando" if live else "terminou",
            "desde": passos[-1]["t"], "segundos": int(when.timestamp() % period),
            "passo": passos[-1], "passos": passos,
            "fala": "Vou rodar os testes da cesta antes do commit." if a["id"] == "dev" else "",
            "fala_t": passos[-1]["t"], "hermes": "", "tarefas": {"feitas": 3, "total": 7, "agora": "Rodar os testes"} if a["id"] == "dev" else None,
            "sessao": {"id": "demo", "fonte": "cron", "modelo": a["model"], "titulo": "Faxina parte b — guia" if a["id"] == "dev" else "",
                       "inicio": inicio.isoformat(timespec="seconds"), "fim": "" if live else when.isoformat(timespec="seconds"),
                       "motivo": "", "passos": 20 + cur, "chamadas": 22 + cur},
            "limite": 120 if a["id"] == "dev" else None,
            **({"plano": plano} if plano else {}),
        }

    def _cadeia(self, when: datetime) -> dict:
        quadro = []
        for it in DEMO_BOARD:
            item = {k: v for k, v in it.items() if k != "minutos"}
            item["desde"] = (when - timedelta(minutes=it["minutos"])).isoformat(timespec="minutes")
            item["arquivo"] = "PLANO-" + it["id"] + ".md"
            quadro.append(item)
        eventos = [{"t": (when - timedelta(minutes=m)).isoformat(timespec="seconds"), "tipo": tipo, "id": i, "titulo": tt,
                    "de": de, "para": para, "pr": pr, "ciclos": "0"} for m, tipo, i, tt, de, para, pr in DEMO_EVENTS]
        return {"quadro": quadro, "eventos": eventos, "ok": True, "erro": ""}
