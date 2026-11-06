"""Reads what the Hermes agents are doing — without touching any secret.

Sources (all read-only):
  * ~/.hermes/profiles/<p>/            -> which agents exist
  * ~/.hermes/profiles/<p>/config.yaml -> only the `model:` line is read
  * ~/.hermes/profiles/<p>/logs/gateway.log
        "inbound message: platform=... chat=... msg=..."  -> the agent starts working
        "response ready: ... time=15.7s api_calls=5 ..."  -> the agent finished
  * `hermes -p <p> cron list` / `hermes -p <p> cron runs` -> scheduled jobs and their runs
  * optional [[signal]] files from the config -> "busy" marks or extra feed lines

Nothing here writes to ~/.hermes, and nothing reads .env, keys or tokens.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .chat import ChatHub
from .config import PALETTE, AgentConfig, Config, SignalConfig

LOG_LINE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3}) (\w+) ([\w.\-]+): (.*)$")
INBOUND = re.compile(r"inbound message: platform=(\S+)(?: user=(\S+))? chat=(\S+) msg=(.*)$")
RESPONSE = re.compile(r"response ready: platform=(\S+) chat=(\S+)(?: session=\S+)?(?: time=([\d.]+)s)?(?: api_calls=(\d+))?(?: response=(\d+) chars)?")
RUN_LINE = re.compile(r"^([0-9a-f]{6,})\s+(\w+)\s+job=([0-9a-f]+)\s+source=(\S+)\s+(\S+)")
JOB_HEAD = re.compile(r"^\s*([0-9a-f]{6,})\s+\[(\w+)\]")
JOB_FIELD = re.compile(r"^\s+([A-Za-z ]+):\s+(.*)$")


def now_local() -> datetime:
    return datetime.now().astimezone()


def parse_iso(s: str) -> Optional[datetime]:
    s = s.strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.astimezone()
    return d


def _strip_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1]
    return s


def short(text: str, n: int = 110) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


# ----------------------------------------------------------------------------- data
@dataclass
class Event:
    time: datetime
    agent: str
    kind: str  # message | response | cron | signal | error
    text: str
    extra: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "time": self.time.isoformat(timespec="seconds"),
            "agent": self.agent,
            "kind": self.kind,
            "text": self.text,
            **self.extra,
        }


@dataclass
class OpenRun:
    started: datetime
    chat: str
    platform: str
    text: str


@dataclass
class CronJob:
    id: str
    state: str
    name: str = ""
    schedule: str = ""
    next_run: str = ""
    last_run: str = ""
    last_ok: Optional[bool] = None
    script: str = ""
    execution: str = ""

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "name": self.name,
            "schedule": self.schedule,
            "next_run": self.next_run,
            "last_run": self.last_run,
            "last_ok": self.last_ok,
            "script": self.script,
        }


@dataclass
class CronRun:
    id: str
    status: str
    job: str
    source: str
    time: datetime


class LogTail:
    """Incremental reader for one gateway.log (handles rotation)."""

    def __init__(self, path: Path):
        self.path = path
        self.offset = 0
        self.inode = None
        self.primed = False

    def read_new(self) -> list[str]:
        try:
            st = self.path.stat()
        except OSError:
            return []
        first = not self.primed
        if self.inode != st.st_ino or st.st_size < self.offset:
            # first time or rotated: start from the last 256 KB
            self.inode = st.st_ino
            self.offset = max(0, st.st_size - 256 * 1024) if first else 0
        if st.st_size == self.offset:
            self.primed = True
            return []
        with self.path.open("rb") as f:
            f.seek(self.offset)
            data = f.read()
            self.offset = f.tell()
        self.primed = True
        lines = data.decode("utf-8", "replace").splitlines()
        if first and self.offset > len(data) and lines:
            lines = lines[1:]  # we started mid-file: drop the half line
        return lines


# ----------------------------------------------------------------------------- the reader
class AgentState:
    def __init__(self, profile: str, acfg: Optional[AgentConfig], index: int, home: Path):
        self.profile = profile
        self.name = (acfg.name if acfg and acfg.name else profile.capitalize())
        self.role = acfg.role if acfg else ""
        self.color = (acfg.color if acfg and acfg.color else PALETTE[index % len(PALETTE)])
        self.desk = acfg.desk if acfg else -1
        self.home = home
        self.model = ""
        self.open_runs: dict[str, OpenRun] = {}
        self.events: list[Event] = []
        self.jobs: list[CronJob] = []
        self.runs: list[CronRun] = []
        self.signal_busy_until: Optional[datetime] = None
        self.signal_label = ""
        self.error_until: Optional[datetime] = None
        self.error_text = ""
        self.last_activity: Optional[datetime] = None
        self.runs_today = 0
        self.messages_today = 0
        self.tail = LogTail(self.log_path)
        self.signal_tails: dict[str, LogTail] = {}
        self.signal_mtimes: dict[str, float] = {}

    @property
    def log_path(self) -> Path:
        if self.profile == "default":
            return self.home / "logs" / "gateway.log"
        return self.home / "profiles" / self.profile / "logs" / "gateway.log"

    @property
    def config_path(self) -> Path:
        if self.profile == "default":
            return self.home / "config.yaml"
        return self.home / "profiles" / self.profile / "config.yaml"

    def add_event(self, ev: Event) -> None:
        self.events.append(ev)
        if len(self.events) > 200:
            del self.events[:-200]
        if ev.time > (self.last_activity or ev.time - timedelta(seconds=1)):
            self.last_activity = ev.time

    def read_model(self) -> None:
        """Only the `model:` line is read; the rest of config.yaml is never loaded."""
        try:
            with self.config_path.open("r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        except OSError:
            return
        for i, line in enumerate(lines):
            m = re.match(r"^\s*(?:default_)?model:\s*(.*?)\s*$", line)
            if not m:
                continue
            value = _strip_quotes(m.group(1).split("#", 1)[0])
            if value and not value.startswith("{"):
                self.model = value
                return
            # block form:  model:\n    default: claude-...  (or name:/id:)
            for nxt in lines[i + 1:i + 8]:
                mm = re.match(r"^\s+(?:default|name|id|model):\s*(.+?)\s*$", nxt)
                if mm:
                    self.model = _strip_quotes(mm.group(1).split("#", 1)[0])
                    return
            if value.startswith("{"):
                mm = re.search(r"(?:default|name|id)\s*:\s*['\"]?([^,'\"}]+)", value)
                if mm:
                    self.model = mm.group(1).strip()
                    return


class HermesReader:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.home = Path(cfg.hermes_home).expanduser()
        self.agents: dict[str, AgentState] = {}
        self.lock = threading.RLock()
        self.hermes_bin = self._find_hermes()
        self.gateway_text = ""
        self.last_cron_poll = 0.0
        self.last_discovery = 0.0
        self.errors: list[str] = []
        self._stop = threading.Event()
        self.chat = ChatHub(cfg, self.hermes_bin)

    def agent_ids(self) -> list[str]:
        with self.lock:
            return list(self.agents)

    # ---------------------------------------------------------------- discovery
    def _find_hermes(self) -> str:
        if self.cfg.hermes_bin:
            return str(Path(self.cfg.hermes_bin).expanduser())
        found = shutil.which("hermes")
        if found:
            return found
        for cand in ("~/.local/bin/hermes", "/opt/homebrew/bin/hermes", "/usr/local/bin/hermes",
                     "~/.hermes/venv/bin/hermes", "~/.hermes/bin/hermes"):
            p = Path(cand).expanduser()
            if p.exists():
                return str(p)
        return "hermes"

    def discover(self) -> None:
        profiles: list[str] = []
        pdir = self.home / "profiles"
        if pdir.is_dir():
            for d in sorted(pdir.iterdir()):
                if d.is_dir() and not d.name.startswith(".") and (d / "config.yaml").exists():
                    profiles.append(d.name)
        if self.cfg.include_default_profile and (self.home / "config.yaml").exists():
            profiles.insert(0, "default")
        # explicit agents first, in config order
        ordered = [a.profile for a in self.cfg.agents if a.profile in profiles or a.profile == "default"]
        for p in profiles:
            if p not in ordered:
                ordered.append(p)
        with self.lock:
            for i, p in enumerate(ordered):
                acfg = self.cfg.agent_for(p)
                if acfg and acfg.hidden:
                    continue
                if p in self.cfg.ignore_profiles and not acfg:
                    continue
                if p not in self.agents:
                    st = AgentState(p, acfg, len(self.agents), self.home)
                    st.read_model()
                    self.agents[p] = st
            for st in self.agents.values():
                if not st.model:
                    st.read_model()
        self.last_discovery = time.time()

    # ---------------------------------------------------------------- logs
    def poll_logs(self) -> None:
        with self.lock:
            for st in self.agents.values():
                for line in st.tail.read_new():
                    self._ingest_log_line(st, line)
                self._poll_signals(st)
                self._expire(st)

    def _ingest_log_line(self, st: AgentState, line: str) -> None:
        m = LOG_LINE.match(line)
        if not m:
            return
        when = parse_iso(m.group(1).replace(" ", "T"))
        if not when:
            return
        level, logger, msg = m.group(3), m.group(4), m.group(5)
        mi = INBOUND.search(msg)
        if mi:
            platform, _user, chat, text = mi.groups()
            text = _strip_quotes(text.split(" reply_to_id=")[0].split(" reply_text=")[0])
            st.open_runs[chat] = OpenRun(when, chat, platform, text)
            st.messages_today += 1 if when.date() == now_local().date() else 0
            st.add_event(Event(when, st.profile, "message", short(text), {"platform": platform}))
            return
        mr = RESPONSE.search(msg)
        if mr:
            platform, chat, secs, calls, chars = mr.groups()
            run = st.open_runs.pop(chat, None)
            extra = {"platform": platform}
            if secs:
                extra["seconds"] = float(secs)
            if calls:
                extra["api_calls"] = int(calls)
            if chars:
                extra["chars"] = int(chars)
            label = "Resposta pronta" if not run else "Respondeu: " + short(run.text, 60)
            st.add_event(Event(when, st.profile, "response", label, extra))
            return
        if level in ("ERROR", "CRITICAL") and (now_local() - when) < timedelta(minutes=10):
            st.error_until = when + timedelta(minutes=3)
            st.error_text = short(msg, 120)
            st.add_event(Event(when, st.profile, "error", short(msg, 120)))

    def _expire(self, st: AgentState) -> None:
        limit = now_local() - timedelta(seconds=self.cfg.stale_run_seconds)
        for chat in list(st.open_runs):
            if st.open_runs[chat].started < limit:
                del st.open_runs[chat]

    # ---------------------------------------------------------------- signals
    def _poll_signals(self, st: AgentState) -> None:
        for sig in self.cfg.signals:
            if sig.agent != st.profile:
                continue
            path = Path(sig.path).expanduser()
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            key = str(path)
            prev = st.signal_mtimes.get(key)
            st.signal_mtimes[key] = mtime
            if sig.kind == "log":
                tail = st.signal_tails.get(key)
                if tail is None:
                    tail = st.signal_tails[key] = LogTail(path)
                    tail.read_new()  # prime: skip history
                    continue
                for line in tail.read_new():
                    line = line.strip()
                    if line:
                        st.add_event(Event(now_local(), st.profile, "signal", short(line, 140), {"label": sig.label}))
                        st.signal_busy_until = now_local() + timedelta(seconds=sig.busy_seconds)
                        st.signal_label = sig.label or path.name
            else:
                if prev is not None and mtime > prev:
                    st.signal_busy_until = now_local() + timedelta(seconds=sig.busy_seconds)
                    st.signal_label = sig.label or path.name
                    st.add_event(Event(now_local(), st.profile, "signal", sig.label or f"{path.name} atualizado"))

    # ---------------------------------------------------------------- cron (subprocess)
    def _hermes(self, *args: str, timeout: int = 25) -> str:
        env = dict(os.environ)
        env.setdefault("NO_COLOR", "1")
        env["TERM"] = "dumb"
        try:
            out = subprocess.run([self.hermes_bin, *args], capture_output=True, text=True, timeout=timeout, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            self._note_error(f"hermes {' '.join(args)}: {e}")
            return ""
        return _strip_ansi(out.stdout + ("\n" + out.stderr if out.returncode else ""))

    def _note_error(self, text: str) -> None:
        self.errors.append(f"{now_local():%H:%M:%S} {text}")
        del self.errors[:-20]

    def poll_cron(self) -> None:
        with self.lock:
            agents = list(self.agents.values())
        for st in agents:
            jobs = parse_cron_list(self._hermes("-p", st.profile, "cron", "list"))
            runs = parse_cron_runs(self._hermes("-p", st.profile, "cron", "runs"))
            with self.lock:
                st.jobs = jobs
                known = {(r.id) for r in st.runs}
                for r in runs:
                    if r.id not in known and st.runs:  # new run since last poll -> feed
                        job = next((j for j in jobs if j.id == r.job), None)
                        st.add_event(Event(r.time, st.profile, "cron", (job.name if job else r.job), {"status": r.status}))
                        if r.status in ("failed", "error", "errored", "timeout", "timed_out", "cancelled", "canceled", "crashed"):
                            st.error_until = r.time + timedelta(minutes=3)
                            st.error_text = f"{job.name if job else r.job}: {r.status}"
                st.runs = runs
                today = now_local().date()
                st.runs_today = sum(1 for r in runs if r.time.date() == today)
        self.gateway_text = short(self._hermes("gateway", "status", timeout=20), 300)
        self.last_cron_poll = time.time()

    # ---------------------------------------------------------------- status
    def office_open(self, when: Optional[datetime] = None) -> bool:
        when = when or now_local()
        h1, m1, h2, m2 = self.cfg.hours_tuple
        start = when.replace(hour=h1, minute=m1, second=0, microsecond=0)
        end = when.replace(hour=h2, minute=m2, second=59, microsecond=0)
        return start <= when <= end

    def status_of(self, st: AgentState, when: datetime) -> tuple[str, str]:
        """Returns (status, activity). status: working | error | idle | sleeping | offline."""
        if not st.log_path.parent.exists() and not st.config_path.exists():
            return "offline", ""
        if st.error_until and when < st.error_until:
            return "error", st.error_text
        if self.chat.busy(st.profile):
            return "working", "Respondendo ao Alex"
        if st.open_runs:
            run = max(st.open_runs.values(), key=lambda r: r.started)
            return "working", short(run.text, 70)
        if st.signal_busy_until and when < st.signal_busy_until:
            return "working", st.signal_label
        busy = timedelta(seconds=self.cfg.cron_busy_seconds)
        for r in st.runs[:5]:
            job = next((j for j in st.jobs if j.id == r.job), None)
            if r.status in ("running", "started", "in_progress", "queued", "pending") and when < r.time + timedelta(hours=3):
                return "working", (job.name if job else "Agendamento") + " (executando)"
            if r.time <= when < r.time + busy:
                return "working", (job.name if job else "Agendamento")
        if not self.office_open(when):
            return "sleeping", ""
        return "idle", ""

    def snapshot(self) -> dict:
        when = now_local()
        with self.lock:
            agents = []
            feed: list[Event] = []
            for i, st in enumerate(self.agents.values()):
                status, activity = self.status_of(st, when)
                recent = sorted(st.events, key=lambda e: e.time)[-12:]
                feed.extend(st.events[-30:])
                agents.append({
                    "id": st.profile,
                    "name": st.name,
                    "role": st.role,
                    "color": st.color,
                    "desk": st.desk if st.desk >= 0 else i,
                    "model": st.model,
                    "status": status,
                    "activity": activity,
                    "last_activity": st.last_activity.isoformat(timespec="seconds") if st.last_activity else "",
                    "runs_today": st.runs_today,
                    "messages_today": st.messages_today,
                    "crons": [j.to_json() for j in st.jobs],
                    "recent": [e.to_json() for e in reversed(recent)],
                })
            feed.sort(key=lambda e: e.time, reverse=True)
            return {
                "generated_at": when.isoformat(timespec="seconds"),
                "office": {
                    "name": self.cfg.office_name,
                    "hours": self.cfg.hours,
                    "open": self.office_open(when),
                    "language": self.cfg.language,
                },
                "hermes": {
                    "home": str(self.home),
                    "bin": self.hermes_bin,
                    "gateway": self.gateway_text,
                    "last_cron_poll": self.last_cron_poll,
                    "errors": self.errors[-5:],
                },
                "agents": agents,
                "feed": [e.to_json() for e in feed[:60]],
            }

    # ---------------------------------------------------------------- loop
    def start(self) -> None:
        threading.Thread(target=self._log_loop, name="my3dlobby-logs", daemon=True).start()
        threading.Thread(target=self._cron_loop, name="my3dlobby-cron", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def _log_loop(self) -> None:
        self.discover()
        while not self._stop.is_set():
            try:
                if time.time() - self.last_discovery > 60:
                    self.discover()
                self.poll_logs()
            except Exception as e:  # keep the loop alive
                self._note_error(f"logs: {e}")
            self._stop.wait(self.cfg.poll_seconds)

    def _cron_loop(self) -> None:
        while not self._stop.is_set():
            try:
                if self.agents:
                    self.poll_cron()
            except Exception as e:
                self._note_error(f"cron: {e}")
            self._stop.wait(self.cfg.cron_poll_seconds)


# ----------------------------------------------------------------------------- parsers
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def _strip_ansi(s: str) -> str:
    return ANSI.sub("", s or "")


def parse_cron_list(text: str) -> list[CronJob]:
    jobs: list[CronJob] = []
    cur: Optional[CronJob] = None
    for line in text.splitlines():
        line = line.replace("│", "").rstrip()
        m = JOB_HEAD.match(line)
        if m:
            cur = CronJob(id=m.group(1), state=m.group(2))
            jobs.append(cur)
            continue
        if cur is None:
            continue
        f = JOB_FIELD.match(line)
        if not f:
            continue
        key, val = f.group(1).strip().lower(), f.group(2).strip()
        if key == "name":
            cur.name = val
        elif key == "schedule":
            cur.schedule = val
        elif key == "next run":
            cur.next_run = val
        elif key == "last run":
            parts = val.split()
            cur.last_run = parts[0] if parts else ""
            if len(parts) > 1:
                cur.last_ok = parts[1].lower() in ("ok", "success", "completed")
        elif key == "script":
            cur.script = val
        elif key == "execution":
            cur.execution = val
    return jobs


def parse_cron_runs(text: str) -> list[CronRun]:
    runs: list[CronRun] = []
    for line in text.splitlines():
        m = RUN_LINE.match(line.strip())
        if not m:
            continue
        when = parse_iso(m.group(5))
        if not when:
            continue
        runs.append(CronRun(m.group(1), m.group(2), m.group(3), m.group(4), when))
    runs.sort(key=lambda r: r.time, reverse=True)
    return runs
