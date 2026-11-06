#!/bin/bash
# My3DLobby by BPG — instalador para macOS
# Cria um ambiente Python próprio, instala o pywebview e monta
# ~/Applications/My3DLobby.app (abre numa janela própria, sem navegador).
set -e
cd "$(dirname "$0")/.."
REPO="$(pwd)"
APPDIR="$HOME/Library/Application Support/My3DLobby"
VENV="$APPDIR/venv"
APP="$HOME/Applications/My3DLobby.app"

echo "=== My3DLobby by BPG — instalação no Mac ==="
echo "Pasta do projeto: $REPO"

PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then PY="$(command -v "$c")"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.9 ou mais novo não encontrado. Instale pelo site python.org ou com: brew install python"
  exit 1
fi
echo "Python: $PY ($("$PY" --version))"

mkdir -p "$APPDIR" "$HOME/Applications"
if [ ! -x "$VENV/bin/python" ]; then
  echo "Criando ambiente em $VENV …"
  "$PY" -m venv "$VENV"
fi
echo "Instalando pywebview …"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet "pywebview>=5.0"

# configuração inicial
if [ ! -f "$HOME/.my3dlobby.toml" ]; then
  cp "$REPO/my3dlobby.example.toml" "$HOME/.my3dlobby.toml"
  echo "Configuração criada em ~/.my3dlobby.toml (edite nomes, cores e horário à vontade)."
fi
# para abrir também no notebook Windows: dois cliques em "Compartilhar na rede (Mac).command"
LANFLAG=""

# ícone
ICON=""
if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  TMP="$(mktemp -d)"; mkdir -p "$TMP/icon.iconset"
  for s in 16 32 64 128 256 512; do
    sips -z $s $s "$REPO/app/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
    d=$((s*2)); sips -z $d $d "$REPO/app/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP/icon.iconset" -o "$TMP/My3DLobby.icns" 2>/dev/null && ICON="$TMP/My3DLobby.icns"
fi

# app de verdade: um applet (osacompile) que dispara o Python do ambiente
rm -rf "$APP"
LAUNCHER="$APPDIR/abrir.sh"
cat > "$LAUNCHER" <<LAUNCH
#!/bin/bash
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
cd "$REPO"
exec "$VENV/bin/python" "$REPO/app/my3dlobby_app.py" $LANFLAG >> "$APPDIR/my3dlobby.log" 2>&1
LAUNCH
chmod +x "$LAUNCHER"
if command -v osacompile >/dev/null 2>&1 && osacompile -o "$APP" -e "do shell script \"'$LAUNCHER' > /dev/null 2>&1 &\"" 2>/dev/null; then
  [ -n "$ICON" ] && cp "$ICON" "$APP/Contents/Resources/applet.icns" 2>/dev/null
  /usr/libexec/PlistBuddy -c "Set :CFBundleName My3DLobby" "$APP/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string br.com.bpgsistemas.my3dlobby" "$APP/Contents/Info.plist" 2>/dev/null || true
  touch "$APP"
else
  echo "Não consegui montar o .app (osacompile). Use \"Abrir My3DLobby (Mac).command\" para abrir."
fi

echo
echo "Pronto! O app está em: $APP"
echo "Abra pelo Finder (Aplicativos do usuário) ou pelo Launchpad. Arraste para o Dock se quiser."
echo "Para abrir também no notebook Windows: dois cliques em \"Compartilhar na rede (Mac).command\"."
echo "Abrindo o My3DLobby…"
open "$APP" 2>/dev/null || "$LAUNCHER" &
sleep 1
