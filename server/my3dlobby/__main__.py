"""python -m my3dlobby [--demo] [--config PATH] [--host 0.0.0.0] [--port 4455] [--open]"""
from __future__ import annotations

import argparse
import sys
import time
import webbrowser

from . import __version__
from .config import load
from .servidor import build


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="my3dlobby", description="My3DLobby by BPG — 3D office for Hermes agents")
    ap.add_argument("--config", help="path to my3dlobby.toml")
    ap.add_argument("--demo", action="store_true", help="fake agents, no Hermes needed")
    ap.add_argument("--host", help="bind address (0.0.0.0 to share on the LAN)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--open", action="store_true", help="open the lobby in the default browser")
    ap.add_argument("--version", action="version", version=__version__)
    args = ap.parse_args(argv)

    cfg = load(args.config)
    if args.host:
        cfg.host = args.host
    if args.port:
        cfg.port = args.port

    server = build(cfg, demo=args.demo)
    server.start()
    print(f"My3DLobby {__version__} — {cfg.office_name}")
    print(f"  lobby:  {server.url}")
    print(f"  config: {cfg.source_path or '(defaults)'}")
    if cfg.host in ("0.0.0.0", ""):
        print("  shared on the LAN: other computers can open http://<this-ip>:%d/" % server.httpd.server_address[1])
    if args.open:
        webbrowser.open(server.url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
