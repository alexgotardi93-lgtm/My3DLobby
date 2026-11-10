"""My3DLobby desktop window (pywebview).

  python app/my3dlobby_app.py                 # local Hermes on this machine
  python app/my3dlobby_app.py --demo          # fake agents
  python app/my3dlobby_app.py --remote http://192.168.0.10:4455/   # the Mac's lobby, from a Windows notebook
  python app/my3dlobby_app.py --lan           # also share on the network (0.0.0.0)

Works unfrozen (from the repo) and frozen (PyInstaller): the web/ folder is
looked up next to the executable or inside the bundle.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def repo_root() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        return base
    return HERE.parent


ROOT = repo_root()
sys.path.insert(0, str(ROOT / "server"))

import my3dlobby.config as cfgmod  # noqa: E402

cfgmod.REPO = ROOT  # so web/ and my3dlobby.toml resolve inside the bundle too
import my3dlobby.servidor as servidor  # noqa: E402

servidor.WEB = ROOT / "web"
from my3dlobby import __version__  # noqa: E402
from my3dlobby.config import load  # noqa: E402


def versao_no_ar(porta: int) -> str:
    """Version of the lobby answering on this port ('' when nothing answers)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{porta}/api/health", timeout=2) as r:
            return str(json.loads(r.read().decode("utf-8")).get("version", ""))
    except Exception:
        return ""


def lobbies_na_porta(porta: int) -> list:
    """PIDs of My3DLobby processes holding the port: Python running my3dlobby_app.py or -m my3dlobby.
    Empty when anything else holds it (then it is left alone) or on a system without lsof (Windows)."""
    if os.name != "posix" or not shutil.which("lsof"):
        return []
    try:
        pids = subprocess.run(["lsof", "-nP", f"-iTCP:{porta}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True,
                              timeout=5).stdout.split()
        achados = []
        for pid in pids:
            if not pid.isdigit() or int(pid) == os.getpid():
                continue
            # program name without its path (the app's Python lives in "Application Support", with a space)
            prog = subprocess.run(["ps", "-o", "ucomm=", "-p", pid], capture_output=True, text=True, timeout=5).stdout.strip()
            cmd = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, text=True, timeout=5).stdout
            if not (prog.lower().startswith("python") and ("my3dlobby_app.py" in cmd or "-m my3dlobby" in cmd)):
                return []
            achados.append(int(pid))
        return achados
    except (OSError, subprocess.SubprocessError):
        return []


def porta_livre(host: str, porta: int) -> bool:
    with socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, porta))
            return True
        except OSError:
            return False


def assumir_porta(cfg) -> bool:
    """An older My3DLobby still holds the port (a window that was never quit, a run from the Terminal): stop it so
    this version starts, instead of opening the old one. The same version is left running. True when the port is free."""
    rodando = versao_no_ar(cfg.port)
    if not rodando or rodando == __version__:
        return False
    antigos = lobbies_na_porta(cfg.port)
    if not antigos:
        return False
    print(f"My3DLobby {rodando} ainda estava rodando (processo {', '.join(map(str, antigos))}): fechando para abrir o {__version__}")
    for pid in antigos:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    for _ in range(40):
        time.sleep(0.2)
        if porta_livre(cfg.host or "127.0.0.1", cfg.port):
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(prog="My3DLobby")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--remote", help="URL of a lobby running elsewhere (e.g. the Mac) — no local server")
    ap.add_argument("--lan", action="store_true", help="share the local server on the network")
    ap.add_argument("--config")
    ap.add_argument("--port", type=int)
    args = ap.parse_args()

    try:
        import webview  # pywebview
    except ImportError:
        print("pywebview is not installed. Run the installer script in app/ (or: pip install pywebview).")
        return 2

    url = args.remote
    if not url:
        # a Windows notebook (or any second computer) keeps the Mac's address in remote.txt
        for cand in (ROOT / "remote.txt", HERE / "remote.txt", Path("~/.my3dlobby-remote.txt").expanduser()):
            if cand.is_file():
                text = cand.read_text(encoding="utf-8").strip()
                if text and not text.startswith("#"):
                    url = text.splitlines()[0].strip()
                    break
    server = None
    if not url:
        cfg = load(args.config)
        if args.lan:
            cfg.host = "0.0.0.0"
        if args.port:
            cfg.port = args.port
        try:
            server = servidor.build(cfg, demo=args.demo)
        except OSError:
            server = None
            # port busy: an older lobby is stopped and this one starts; the same version is just opened
            if assumir_porta(cfg):
                try:
                    server = servidor.build(cfg, demo=args.demo)
                except OSError:
                    server = None
            if server is None:
                url = f"http://127.0.0.1:{cfg.port}/"
                print(f"My3DLobby {__version__}: a porta {cfg.port} já está em uso ({versao_no_ar(cfg.port) or 'sem resposta'}); abrindo o que está lá")
        if server is not None:
            server.start()
            url = server.url
            print(f"My3DLobby {__version__} serving {url}" + ("  (shared on the LAN)" if args.lan else ""))

    window = webview.create_window(
        "My3DLobby by BPG",
        url,
        width=1440,
        height=880,
        min_size=(900, 600),
        background_color="#121622",
        text_select=False,
    )

    def on_closed():
        if server:
            threading.Thread(target=server.stop, daemon=True).start()

    window.events.closed += on_closed
    webview.start(debug=bool(os.environ.get("MY3DLOBBY_DEBUG")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
