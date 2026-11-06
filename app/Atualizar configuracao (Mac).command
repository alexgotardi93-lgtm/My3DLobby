#!/bin/bash
# Atualiza ~/.my3dlobby.toml com o que mudou no exemplo, sem perder o que você editou:
# - deixa de ignorar o perfil "dev" (padrão antigo)
# - acrescenta o agente Dev se ainda não existir
CFG="$HOME/.my3dlobby.toml"
cd "$(dirname "$0")/.."
if [ ! -f "$CFG" ]; then cp my3dlobby.example.toml "$CFG"; echo "Configuração criada em $CFG"; exit 0; fi
sed -i '' 's/^ignore_profiles = \["dev"\]/ignore_profiles = []/' "$CFG"
if ! grep -q '^profile = "dev"' "$CFG"; then
  printf '\n[[agent]]\nprofile = "dev"\nname = "Dev"\nrole = "Desenvolvimento"\ncolor = "#c9a227"\n' >> "$CFG"
  echo "Agente Dev adicionado."
fi
if ! grep -q '^profile = "arquiteto"' "$CFG"; then
  printf '\n[[agent]]\nprofile = "arquiteto"\nname = "Arquiteto"\nrole = "Planos (Opus 5.5)"\ncolor = "#d8663b"\n' >> "$CFG"
  printf '\n[[agent]]\nprofile = "reviewer"\nname = "Reviewer"\nrole = "Revisão de PR (Opus 5.5)"\ncolor = "#8c5bd8"\n' >> "$CFG"
  printf '\n[[signal]]\nagent = "arquiteto"\npath = "~/repos/BPG Sistemas Lobby/arquiteto/decisoes.md"\nlabel = "Escrevendo um plano"\nkind = "log"\nbusy_seconds = 90\n' >> "$CFG"
  printf '\n[[signal]]\nagent = "dev"\npath = "~/repos/super-cota-licitacao/.git/index"\nlabel = "Programando"\nkind = "touch"\nbusy_seconds = 180\n' >> "$CFG"
  echo "Agentes Arquiteto e Reviewer adicionados (com sinais de atividade)."
fi
echo "Configuração atualizada: $CFG"
echo "Feche e abra o My3DLobby para valer."
