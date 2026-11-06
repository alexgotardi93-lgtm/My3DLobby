#!/bin/bash
# Liga/desliga o compartilhamento do escritório na rede local (para o notebook Windows).
CFG="$HOME/.my3dlobby.toml"
cd "$(dirname "$0")/.."
[ -f "$CFG" ] || cp my3dlobby.example.toml "$CFG"
if grep -q '^host = "0.0.0.0"' "$CFG"; then
  sed -i '' 's/^host = "0.0.0.0"/host = "127.0.0.1"/' "$CFG"
  echo "Compartilhamento DESLIGADO (só este Mac abre o escritório)."
else
  sed -i '' 's/^host = "127.0.0.1"/host = "0.0.0.0"/' "$CFG"
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<ip-do-mac>')"
  PORT="$(grep -E '^port = ' "$CFG" | head -1 | tr -dc '0-9')"
  echo "Compartilhamento LIGADO. No notebook Windows, use: http://$IP:${PORT:-4455}/"
fi
echo "Feche e abra o My3DLobby de novo para valer."
