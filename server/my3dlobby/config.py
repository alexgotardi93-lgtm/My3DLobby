"""Configuration: a small TOML subset parser (so Python 3.9+ works without
tomllib) plus defaults.

Config file lookup order:
  1. --config PATH
  2. $MY3DLOBBY_CONFIG
  3. ~/.my3dlobby.toml
  4. <repo>/my3dlobby.toml
  5. built-in defaults (every Hermes profile found becomes an agent)
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]

PALETTE = ["#2f8f6f", "#3b6fd8", "#d8663b", "#8c5bd8", "#c9a227", "#d84b7a", "#2aa3b3", "#6b7f3b"]


# ----------------------------------------------------------------------------- TOML subset
def _value(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"'):
        return bytes(raw[1:-1], "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
    if raw.startswith("'") and raw.endswith("'"):
        return raw[1:-1]
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_value(p) for p in _split_list(inner)]
    if raw in ("true", "false"):
        return raw == "true"
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def _split_list(inner: str) -> list[str]:
    parts, cur, quote = [], "", None
    for ch in inner:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == ",":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def parse_toml(text: str) -> dict:
    """Parse the subset we use: [section], [[array.of.tables]], key = value."""
    try:  # real parser when available (Python 3.11+)
        import tomllib  # type: ignore

        return tomllib.loads(text)
    except Exception:
        pass
    root: dict = {}
    current = root
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip() if not line.strip().startswith('"') else line.strip()
        if not line:
            continue
        m = re.match(r"^\[\[(.+?)\]\]$", line)
        if m:
            path = [p.strip() for p in m.group(1).split(".")]
            node = root
            for p in path[:-1]:
                node = node.setdefault(p, {})
            node.setdefault(path[-1], []).append({})
            current = node[path[-1]][-1]
            continue
        m = re.match(r"^\[(.+?)\]$", line)
        if m:
            path = [p.strip() for p in m.group(1).split(".")]
            node = root
            for p in path:
                node = node.setdefault(p, {})
            current = node
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            current[k.strip().strip('"')] = _value(v)
    return root


# ----------------------------------------------------------------------------- model
@dataclass
class AgentConfig:
    profile: str
    name: str = ""
    role: str = ""
    color: str = ""
    desk: int = -1  # -1 = automatic
    hidden: bool = False


@dataclass
class SignalConfig:
    """A file whose modification means an agent is busy, or a log to feed."""

    agent: str
    path: str
    label: str = ""
    kind: str = "touch"  # touch | log
    busy_seconds: int = 30


@dataclass
class Config:
    office_name: str = "My3DLobby by BPG"
    hours: str = "08:00-20:00"  # agents sleep outside this window
    timezone: str = ""  # empty = local
    language: str = "auto"  # pt | en | auto
    hermes_home: str = "~/.hermes"
    hermes_bin: str = ""  # auto-detect
    include_default_profile: bool = False
    ignore_profiles: list = field(default_factory=list)
    poll_seconds: int = 5
    cron_poll_seconds: int = 60
    cron_busy_seconds: int = 45  # a cron run keeps the agent at the PC this long
    stale_run_seconds: int = 900  # an inbound with no response for this long is considered done
    host: str = "127.0.0.1"
    port: int = 4455
    chat_lan: bool = False  # allow /api/chat from other computers on the LAN
    lobby_dir: str = "~/repos/BPG Sistemas Lobby"  # where the agent chain keeps arquiteto/demandas
    demand_agents: list = field(default_factory=lambda: ["arquiteto"])
    github_repo: str = ""  # "owner/repo" of the chain's PRs: the Cadeia board links "#471" to GitHub
    agents: list = field(default_factory=list)  # AgentConfig
    signals: list = field(default_factory=list)  # SignalConfig
    source_path: str = ""

    @property
    def hours_tuple(self) -> tuple[int, int, int, int]:
        m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$", self.hours or "")
        if not m:
            return (0, 0, 23, 59)
        return tuple(int(x) for x in m.groups())  # type: ignore

    def agent_for(self, profile: str) -> AgentConfig | None:
        for a in self.agents:
            if a.profile == profile:
                return a
        return None


def _candidates(explicit: str | None) -> list[Path]:
    out: list[Path] = []
    if explicit:
        out.append(Path(explicit).expanduser())
    env = os.environ.get("MY3DLOBBY_CONFIG")
    if env:
        out.append(Path(env).expanduser())
    out.append(Path("~/.my3dlobby.toml").expanduser())
    out.append(REPO / "my3dlobby.toml")
    return out


def load(explicit: str | None = None) -> Config:
    cfg = Config()
    for path in _candidates(explicit):
        if path.is_file():
            data = parse_toml(path.read_text(encoding="utf-8"))
            _apply(cfg, data)
            cfg.source_path = str(path)
            break
    return cfg


def _apply(cfg: Config, data: dict) -> None:
    office = data.get("office", {})
    cfg.office_name = office.get("name", cfg.office_name)
    cfg.hours = office.get("hours", cfg.hours)
    cfg.timezone = office.get("timezone", cfg.timezone)
    cfg.language = office.get("language", cfg.language)

    hermes = data.get("hermes", {})
    cfg.hermes_home = hermes.get("home", cfg.hermes_home)
    cfg.hermes_bin = hermes.get("bin", cfg.hermes_bin)
    cfg.include_default_profile = bool(hermes.get("include_default_profile", cfg.include_default_profile))
    cfg.ignore_profiles = list(hermes.get("ignore_profiles", cfg.ignore_profiles))
    cfg.poll_seconds = int(hermes.get("poll_seconds", cfg.poll_seconds))
    cfg.cron_poll_seconds = int(hermes.get("cron_poll_seconds", cfg.cron_poll_seconds))
    cfg.cron_busy_seconds = int(hermes.get("cron_busy_seconds", cfg.cron_busy_seconds))
    cfg.stale_run_seconds = int(hermes.get("stale_run_seconds", cfg.stale_run_seconds))

    server = data.get("server", {})
    cfg.host = server.get("host", cfg.host)
    cfg.port = int(server.get("port", cfg.port))
    cfg.chat_lan = bool(server.get("chat_lan", cfg.chat_lan))
    chain = data.get("chain", {})
    cfg.lobby_dir = chain.get("lobby", cfg.lobby_dir)
    cfg.demand_agents = list(chain.get("demand_agents", cfg.demand_agents))
    cfg.github_repo = str(chain.get("github", cfg.github_repo)).strip().strip("/")

    cfg.agents = [
        AgentConfig(
            profile=str(a.get("profile", "")),
            name=a.get("name", ""),
            role=a.get("role", ""),
            color=a.get("color", ""),
            desk=int(a.get("desk", -1)),
            hidden=bool(a.get("hidden", False)),
        )
        for a in data.get("agent", [])
        if a.get("profile")
    ]
    cfg.signals = [
        SignalConfig(
            agent=str(s.get("agent", "")),
            path=str(s.get("path", "")),
            label=s.get("label", ""),
            kind=s.get("kind", "touch"),
            busy_seconds=int(s.get("busy_seconds", 30)),
        )
        for s in data.get("signal", [])
        if s.get("agent") and s.get("path")
    ]
