#!/bin/bash
# Atualiza ~/.my3dlobby.toml com o que mudou no exemplo, sem perder o que você editou:
# - deixa de ignorar o perfil "dev" (padrão antigo)
# - acrescenta o agente Dev se ainda não existir
CFG="$HOME/.my3dlobby.toml"
cd "$(dirname "$0")/.."
if [ ! -f "$CFG" ]; then cp my3dlobby.example.toml "$CFG"; echo "Configuração criada em $CFG"; exit 0; fi
sed -i '' 's/^ignore_profiles = \["dev"\]/ignore_profiles = []/' "$CFG"
if ! grep -q 'profile = "dev"' "$CFG"; then
  printf '\n[[agent]]\nprofile = "dev"\nname = "Dev"\nrole = "Desenvolvimento"\ncolor = "#c9a227"\n' >> "$CFG"
  echo "Agente Dev adicionado."
fi
echo "Configuração atualizada: $CFG"
echo "Feche e abra o My3DLobby para valer."
