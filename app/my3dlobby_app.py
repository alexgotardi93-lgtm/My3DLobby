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
import os
import sys
import threading
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
            # port busy: probably another lobby is already running — just open it
            url = f"http://127.0.0.1:{cfg.port}/"
        else:
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
