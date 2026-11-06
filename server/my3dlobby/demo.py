"""Demo office: fake agents that work, rest and sleep on a timer.

Used by `python -m my3dlobby --demo` so the lobby can be tried (and the 3D
scene developed) on a machine without Hermes.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from .config import Config
from .hermes import now_local

DEMO_AGENTS = [
    {"id": "zap", "name": "Zap", "role": "Atendimento WhatsApp", "color": "#2f8f6f", "model": "claude-haiku-5-5"},
    {"id": "financeiro", "name": "Financeiro", "role": "Notas fiscais", "color": "#3b6fd8", "model": "claude-sonnet-5-5"},
    {"id": "arquiteto", "name": "Arquiteto", "role": "Planos e melhorias", "color": "#d8663b", "model": "claude-opus-5-5"},
    {"id": "pesquisa", "name": "Pesquisa", "role": "Preços e licitações", "color": "#8c5bd8", "model": "claude-sonnet-5-5"},
]

TASKS = {
    "zap": ["Lendo grupo Colaboradores SuperCota", "Respondendo Tiago: campos opcionais", "Vigia do Zap", "Enviando relato por e-mail"],
    "financeiro": ["Emitindo NFS-e 114", "Conferindo pedidos pendentes", "Enviando nota por e-mail"],
    "arquiteto": ["Avaliando melhoria: gerador de proposta", "Escrevendo plano de ação", "Revisando backlog"],
    "pesquisa": ["Buscando preços no PNCP", "Comparando cotações", "Resumindo edital"],
}


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
        return {
            "generated_at": when.isoformat(timespec="seconds"),
            "office": {"name": self.cfg.office_name + " (demo)", "hours": self.cfg.hours, "open": True, "language": self.cfg.language},
            "hermes": {"home": "(demo)", "bin": "", "gateway": "demo mode", "last_cron_poll": 0, "errors": []},
            "agents": agents,
            "feed": self.feed[:60],
        }
