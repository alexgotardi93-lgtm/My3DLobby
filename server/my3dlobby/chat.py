"""Talk to an agent from the lobby.

A message is answered by `hermes -p <profile> chat [--toolsets ...] --query-file <tmp> -Q --oneshot` in a
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
import urllib.request
from datetime import datetime
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")
MAX_HISTORY = 200
TIMEOUT = 30 * 60
# Agents on a small local model get only the tools of their job: every extra tool is more prompt to read on
# each turn and one more way to pick the wrong one. The others keep Hermes's default set.
TOOLSETS = {"alex": "browser,terminal,file,skills"}   # Hermes drops the browser without the terminal toolset
# An agent that works in a Chrome of its own (Hermes reaches it through `browser.cdp_url`): the lobby opens that
# browser before the message and closes it when the answer is back, so no window stays open between uses. What the
# user did in it (a login) stays saved in the profile folder.
# The lock file is shared with the office's `alex/chamar-alex.py` (another agent calling this one): one request
# at a time uses the browser, and nobody closes it under somebody else.
BROWSERS = {"alex": {"port": 9224, "profile": "~/.local/share/bpg-alex/navegador-instagram",
                     "lock": "~/.local/share/bpg-alex/navegador.lock", "title": "Alex (agente) precisa de você"}}
# The agent ends its answer with this line when it needs the user at its browser window (e.g. to type the code of
# an image the agent must not type): the browser is left open and the user is notified.
WAITING = "AGUARDANDO O ALEX NO NAVEGADOR"
CHROMES = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
           "/Applications/Chromium.app/Contents/MacOS/Chromium",
           "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser")


def _browser_up(port: int) -> bool:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/json/version", timeout=2) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


def browser_open(spec: dict) -> bool:
    """Make sure the agent's Chrome answers on its port; True when it does."""
    if _browser_up(spec["port"]):
        return True
    app = next((c for c in CHROMES if os.access(c, os.X_OK)), None)
    if not app:
        return False
    profile = os.path.expanduser(spec["profile"])
    try:
        os.makedirs(profile, exist_ok=True)
        subprocess.Popen([app, f"--remote-debugging-port={spec['port']}", f"--user-data-dir={profile}",
                          "--no-first-run", "--no-default-browser-check", "--disable-backgrounding-occluded-windows",
                          "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError:
        return False
    for _ in range(30):
        if _browser_up(spec["port"]):
            return True
        time.sleep(0.5)
    return False


def _lock(path):
    """Wait for the turn on a lock file (flock); None where there is no lock or no fcntl (Windows)."""
    if not path:
        return None
    try:
        import fcntl
        path = os.path.expanduser(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fh = open(path, "w")
        fcntl.flock(fh, fcntl.LOCK_EX)
        return fh
    except (ImportError, OSError):
        return None


def _unlock(fh) -> None:
    if fh is None:
        return
    try:
        import fcntl
        fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()
    except (ImportError, OSError):
        pass


def notify(text: str, title: str) -> None:
    """A macOS notification (does nothing elsewhere)."""
    msg = " ".join((text or "").split()).replace("\\", "").replace('"', "'")[:180] or "Preciso de você no meu navegador."
    try:
        subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "{title}" sound name "Glass"'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        pass


def browser_close(spec: dict) -> None:
    """Close the agent's Chrome (only that one: it is the only process with this profile folder)."""
    profile = os.path.expanduser(spec["profile"])
    try:
        subprocess.run(["pkill", "-f", f"user-data-dir={profile}"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:40] or "demanda"


def _fold(text: str) -> str:
    """Lower case without accents, keeping one char per char (so positions match the original)."""
    return "".join((unicodedata.normalize("NFKD", c)[:1] or c) for c in text).lower()


def _preview(text: str, n: int = 140) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


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

    def resumo(self) -> dict:
        """Per agent: the last message (preview), when the agent last answered and whether it is answering now."""
        with self.lock:
            out = {}
            for agent, msgs in self.history.items():
                if not msgs:
                    continue
                last = msgs[-1]
                out[agent] = {
                    "role": last.get("role", ""), "text": _preview(last.get("text", "")), "time": last.get("time", ""),
                    "ok": last.get("ok", True), "total": len(msgs),
                    "replies": [m.get("time", "") for m in msgs[-30:] if m.get("role") != "alex"],
                    "running": agent in self.running,
                }
            for agent, run in self.running.items():
                out.setdefault(agent, {"role": "alex", "text": _preview(run.get("text", "")), "time": run.get("since", ""),
                                       "ok": True, "total": 0, "replies": [], "running": True})
            return out

    def buscar(self, q: str, limite: int = 40) -> list:
        """Messages containing `q` (case and accent insensitive), newest first, with a snippet."""
        alvo = _fold(q.strip())
        if len(alvo) < 2:
            return []
        achados = []
        with self.lock:
            for agent, msgs in self.history.items():
                for i, m in enumerate(msgs):
                    texto = str(m.get("text", ""))
                    pos = _fold(texto).find(alvo)
                    if pos < 0:
                        continue
                    ini, fim = max(0, pos - 50), min(len(texto), pos + len(alvo) + 70)
                    achados.append({
                        "agent": agent, "index": i, "role": m.get("role", ""), "time": m.get("time", ""),
                        "before": ("…" if ini > 0 else "") + re.sub(r"\s+", " ", texto[ini:pos]).lstrip(),
                        "match": texto[pos:pos + len(alvo)],
                        "after": re.sub(r"\s+", " ", texto[pos + len(alvo):fim]).rstrip() + ("…" if fim < len(texto) else ""),
                    })
        achados.sort(key=lambda a: a["time"], reverse=True)
        return achados[:limite]

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
        # Alex writes it himself, so it is born approved: with the chain's approval lock on
        # (arquiteto/.trava-aprovacao), only items carrying `aprovado:` reach the Arquiteto.
        body = "\n".join([
            "status: novo", f"id: D-{now:%Y%m%d-%H%M}-{slug}", f"titulo: {title}", "quem: Alex (pelo lobby)",
            f"aprovado: {now:%d/%m/%Y %H:%M} (Alex, pelo lobby)",
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
        """One message to the agent. An agent with a browser of its own gets it opened before and closed after —
        unless its answer ends asking for the user at that window (WAITING): then the browser stays open and the
        Mac shows a notification."""
        navegador = BROWSERS.get(agent)
        if not navegador:
            return self._hermes_run(agent, prompt)
        trava = _lock(navegador.get("lock"))
        reply = ""
        try:
            browser_open(navegador)
            reply, ok = self._hermes_run(agent, prompt)
            return reply, ok
        finally:
            if WAITING in reply:
                notify(reply.split("session_id:")[0].replace(WAITING, "").strip(), navegador.get("title", "O agente precisa de você"))
            else:
                browser_close(navegador)
            _unlock(trava)

    def _hermes_run(self, agent: str, prompt: str) -> tuple[str, bool]:
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
        # stdout goes to a file, not a pipe: a child the agent leaves behind (gateway, browser)
        # could keep a pipe open forever; with a file we only wait for hermes itself to exit.
        log = qfile + ".out"
        try:
            with open(log, "w", encoding="utf-8") as fh:
                so = ["--toolsets", TOOLSETS[agent]] if agent in TOOLSETS else []
                proc = subprocess.Popen([self.hermes_bin, "-p", agent, "chat"] + so + ["--query-file", qfile, "-Q", "--oneshot"],
                                        stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env,
                                        start_new_session=True)
                try:
                    code = proc.wait(timeout=TIMEOUT)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    return "o agente não respondeu em 30 minutos", False
        except OSError as e:
            return f"não consegui chamar o hermes: {e}", False
        finally:
            try:
                os.unlink(qfile)
            except OSError:
                pass
        try:
            raw = open(log, encoding="utf-8", errors="replace").read()
            os.unlink(log)
        except OSError:
            raw = ""

        class _Out:  # keeps the parsing below unchanged
            stdout = raw
            stderr = ""
            returncode = code
        out = _Out()
        text = ANSI.sub("", out.stdout or "").strip()
        if not text:
            err = ANSI.sub("", out.stderr or "").strip()
            return (err[-1500:] if err else "(sem resposta)"), out.returncode == 0 and bool(err)
        return text, out.returncode == 0
