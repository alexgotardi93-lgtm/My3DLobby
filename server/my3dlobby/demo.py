"""Demo office: fake agents that work, rest and sleep on a timer.

Used by `python -m my3dlobby --demo` so the lobby can be tried (and the 3D
scene developed) on a machine without Hermes.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from .chat import ChatHub
from .config import Config
from .hermes import now_local

DEMO_AGENTS = [
    {"id": "zap", "name": "Zap", "role": "Atendimento WhatsApp", "color": "#2f8f6f", "model": "claude-haiku-5-5"},
    {"id": "financeiro", "name": "Financeiro", "role": "Notas fiscais", "color": "#3b6fd8", "model": "claude-sonnet-5-5"},
    {"id": "dev", "name": "Dev", "role": "Desenvolvimento", "color": "#c9a227", "model": "dev-qwen27", "model_local": True},
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
            "conversas": self.chat.resumo(),
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
