"""Talk to an agent from the lobby.

A message is answered by `hermes -p <profile> chat --query-file <tmp> -Q --oneshot` in a
background thread (one conversation per agent at a time). While it runs, the agent shows as
"working" in the office. History is kept per agent in ~/.my3dlobby/chats/<agent>.jsonl.

For "demand" agents (the Arquiteto, by default) a message can also be registered as a demand
file in the office chain (`<lobby>/arquiteto/demandas/`), so the plan it writes flows to the
Dev and the Reviewer through the queue scripts.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import threading
import time
import unicodedata
from datetime import datetime
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")
MAX_HISTORY = 60
TIMEOUT = 30 * 60


def _slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:40] or "demanda"


class ChatHub:
    def __init__(self, cfg, hermes_bin: str):
        self.cfg = cfg
        self.hermes_bin = hermes_bin
        self.lock = threading.RLock()
        self.history: dict[str, list[dict]] = {}
        self.running: dict[str, dict] = {}  # agent -> {"since": ts, "text": ...}
        self.dir = Path("~/.my3dlobby/chats").expanduser()
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        self._load()

    # ------------------------------------------------------------ persistence
    def _load(self) -> None:
        for f in self.dir.glob("*.jsonl"):
            msgs = []
            try:
                for line in f.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        msgs.append(json.loads(line))
            except (OSError, ValueError):
                continue
            self.history[f.stem] = msgs[-MAX_HISTORY:]

    def _append(self, agent: str, msg: dict) -> None:
        with self.lock:
            self.history.setdefault(agent, []).append(msg)
            del self.history[agent][:-MAX_HISTORY]
        try:
            with (self.dir / f"{agent}.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        except OSError:
            pass

    # ------------------------------------------------------------ API
    def state(self, agent: str) -> dict:
        with self.lock:
            return {"agent": agent, "messages": list(self.history.get(agent, [])),
                    "running": agent in self.running,
                    "since": self.running.get(agent, {}).get("since", "")}

    def busy(self, agent: str) -> bool:
        with self.lock:
            return agent in self.running

    def send(self, agent: str, text: str, as_demand: bool = False) -> dict:
        text = text.strip()
        if not text:
            return {"ok": False, "erro": "mensagem vazia"}
        with self.lock:
            if agent in self.running:
                return {"ok": False, "erro": "o agente ainda está respondendo a mensagem anterior"}
            self.running[agent] = {"since": datetime.now().astimezone().isoformat(timespec="seconds"), "text": text}
        demand_path = ""
        if as_demand and agent in self.cfg.demand_agents:
            demand_path = self._write_demand(text)
        self._append(agent, {"role": "alex", "text": text, "time": datetime.now().astimezone().isoformat(timespec="seconds"),
                             "demanda": demand_path})
        threading.Thread(target=self._run, args=(agent, text, demand_path), daemon=True).start()
        return {"ok": True, "demanda": demand_path}

    # ------------------------------------------------------------ work
    def _write_demand(self, text: str) -> str:
        base = Path(self.cfg.lobby_dir).expanduser() / "arquiteto" / "demandas"
        try:
            base.mkdir(parents=True, exist_ok=True)
        except OSError:
            return ""
        now = datetime.now()
        title = text.splitlines()[0][:80]
        slug = _slug(title)
        path = base / f"{now:%Y-%m-%d-%H%M}-{slug}.md"
        n = 2
        while path.exists():
            path = base / f"{now:%Y-%m-%d-%H%M}-{slug}-{n}.md"
            n += 1
        body = "\n".join([
            "status: novo", f"id: D-{now:%Y%m%d-%H%M}-{slug}", f"titulo: {title}", "quem: Alex (pelo lobby)",
            "prioridade: media", f"quando: {now:%d/%m/%Y %H:%M}", "", "## Pedido", "", text, ""])
        try:
            path.write_text(body, encoding="utf-8")
        except OSError:
            return ""
        return str(path)

    def _run(self, agent: str, text: str, demand_path: str) -> None:
        prompt = text
        if demand_path:
            prompt += (f"\n\n[Esta ordem já foi registrada como demanda em {demand_path} (status: novo). "
                       "Trate-a agora como item da sua fila: escreva o plano em arquiteto/planos/PLANO-<id>.md, "
                       "mude a demanda para status: avaliado com a linha plano:, registre em decisoes.md e responda "
                       "em até 8 linhas: tipo, status do plano, arquivo e próximo passo.]")
        reply, ok = self._hermes_chat(agent, prompt)
        with self.lock:
            self.running.pop(agent, None)
        self._append(agent, {"role": agent, "text": reply, "ok": ok,
                             "time": datetime.now().astimezone().isoformat(timespec="seconds")})

    def _hermes_chat(self, agent: str, prompt: str) -> tuple[str, bool]:
        env = dict(os.environ)
        env.setdefault("NO_COLOR", "1")
        env["TERM"] = "dumb"
        env["PATH"] = os.path.expanduser("~/.local/bin") + ":/opt/homebrew/bin:/usr/local/bin:" + env.get("PATH", "")
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
                f.write(prompt)
                qfile = f.name
        except OSError as e:
            return f"não consegui preparar a mensagem: {e}", False
        try:
            out = subprocess.run([self.hermes_bin, "-p", agent, "chat", "--query-file", qfile, "-Q", "--oneshot"],
                                 capture_output=True, text=True, timeout=TIMEOUT, env=env, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "o agente não respondeu em 30 minutos", False
        except OSError as e:
            return f"não consegui chamar o hermes: {e}", False
        finally:
            try:
                os.unlink(qfile)
            except OSError:
                pass
        text = ANSI.sub("", out.stdout or "").strip()
        if not text:
            err = ANSI.sub("", out.stderr or "").strip()
            return (err[-1500:] if err else "(sem resposta)"), out.returncode == 0 and bool(err)
        return text, out.returncode == 0
