#!/bin/bash
# Abre o My3DLobby mostrando as mensagens no Terminal (bom para diagnosticar).
cd "$(dirname "$0")/.."
VENV="$HOME/Library/Application Support/My3DLobby/venv"
PY="$VENV/bin/python"; [ -x "$PY" ] || PY="$(command -v python3)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "=== My3DLobby by BPG ==="
echo "Python: $PY"
exec "$PY" app/my3dlobby_app.py "$@"
