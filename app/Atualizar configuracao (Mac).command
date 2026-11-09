#!/bin/bash
# Atualiza ~/.my3dlobby.toml com o que mudou no exemplo, sem perder o que você editou:
# - deixa de ignorar o perfil "dev" (padrão antigo)
# - acrescenta o agente Dev se ainda não existir
# - acrescenta os agentes da Mesa WIN (2º andar) se ainda não existirem
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
if ! grep -q '^profile = "win-vigia"' "$CFG"; then
  printf '\n# ---- 2º andar: Mesa WIN (operação de day trade com agentes)\n' >> "$CFG"
  printf '\n[[agent]]\nprofile = "win-pesquisador"\nname = "Pesquisador"\nrole = "Plano do dia (Opus 5.5)"\ncolor = "#2aa3b3"\n' >> "$CFG"
  printf '\n[[agent]]\nprofile = "win-estrategista"\nname = "Estrategista"\nrole = "Laboratório de estratégias"\ncolor = "#d84b7a"\n' >> "$CFG"
  printf '\n[[agent]]\nprofile = "win-vigia"\nname = "Vigia"\nrole = "Vigia do pregão (Sonnet 5.5)"\ncolor = "#6b7f3b"\n' >> "$CFG"
  printf '\n[[agent]]\nprofile = "win-revisor"\nname = "Revisor"\nrole = "Revisão do dia"\ncolor = "#c9a227"\n' >> "$CFG"
  echo "Agentes da Mesa WIN adicionados (eles ficam no 2º andar)."
fi
echo "Configuração atualizada: $CFG"
echo "Feche e abra o My3DLobby para valer."
