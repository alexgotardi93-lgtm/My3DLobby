# Changelog

## 0.3.0 — 2026-11-08

- **Conversas.** A messenger-style window (bottom bar button or `C`): every agent is a contact with its status, what it is doing and the last message; search across agents and message text (accent-insensitive, `/api/conversas/busca`); filters (all / working / unread) and unread badges; chat bubbles with day separators, ✓/✓✓, "digitando…" while the agent answers, long answers folded; "Ver no escritório" jumps to the person in 3D. The demand checkbox for the Arquiteto starts unchecked here and remembers your choice.
- **Agora — what the agent is doing right now.** New `atividade.py` reads each profile's Hermes `state.db` read-only (mode=ro, query_only) and turns the latest session's tool calls into "Rodando: git status", "Editando: src/x.tsx", "Lendo a skill: dev-ler-plano"…, with the state (executando / pensando / lendo / terminou / sem sinal), how long, the step count against `agent.max_turns`, the agent's to-do list, the plan it is on and the last 10 steps with ✓/✗ (from exit codes only — outputs are never read into the page). Shown pinned on top of the chat, in the agent card and in the 3D speech bubble. Secrets in commands are masked.
- **Cadeia.** The headers of `<chain.lobby>/arquiteto/planos/*.md` and `demandas/*.md` become a board (needs you / Dev / Reviewer / queue / Arquiteto, PR links with `[chain] github = "owner/repo"`) and every status change an event (kept in `~/.my3dlobby/cadeia-eventos.jsonl`, so changes made while the lobby was closed show up too). A one-line summary sits in the bottom bar.
- **Fix: the model shown was stale.** `config.yaml` is re-read whenever it changes (the card kept showing the old model after the Dev moved to another one), and only the top-level `model:` block counts — a nested `model:` (auxiliary, compression) no longer wins. Local models are tagged "(local)".
- A live Hermes session counts as work even when there is no log or cron signal; "Última atividade" also uses it.

## 0.2.0 — 2026-11-06

- **Talk to agents from the lobby.** Chat panel in every agent card; messages go through `hermes -p <profile> chat --query-file … -Q --oneshot` in the background, the person sits down with "Respondendo ao Alex" while it answers, history is kept per agent in `~/.my3dlobby/chats/`. For demand agents (`[chain] demand_agents`, default `arquiteto`) a message can be registered as a demand in the agent chain (`<chain.lobby>/arquiteto/demandas/`), so the plan flows to the Dev and the Reviewer. Local-only unless `[server] chat_lan = true`. (`/api/chat`)
- **Low-poly office people built in code** replace the RobotExpressive robot: shirt in the agent's colour, skin and hair per agent, badge, two-segment arms and legs; poses for walking, sitting, typing, coffee, water, phone, thinking, waving, nodding, sleeping and a greyed-out "offline". No more bouncing when seated. No external 3D models in the repo any more.
- **Nicer office:** kitchenette (copa) with tiled floor, counter, sink, coffee machine, microwave, fridge, water cooler, snack shelf and a round table with stools (new leisure spots: water, table); lounge with two sofas in an L, round table, TV, floor lamp and bookshelf; posters, clock, runner rug, baseboards, pendant lamps that light up at night, desk lamps/plants/papers/mouse/bins; windows with a painted view that switches between day and night.
- **Every Hermes profile shows by default** (`ignore_profiles = []`); `dev` is no longer hidden. Agents `arquiteto` and `reviewer` in the example config with activity signals (`decisoes.md` log, `.git/index` touch).
- **Mac helpers:** `Atualizar configuracao (Mac).command` (merges new agents/signals into an existing config), `Compartilhar na rede (Mac).command`, `Abrir My3DLobby (Mac).command`; the installer builds the `.app` as an applet (no more "cannot be opened" on launch).
- Hermes reader: `cron list` blocks with leading spaces are parsed; `model:` in block form (`model:` / `default:`) is detected; Hermes health in the bottom bar.
- Fixes: speech bubbles no longer use emoji (WebKit canvas rendered them as boxes); 24-hour clock in the feed.

## 0.1.0 — 2026-11-05

- First release: Three.js office, Hermes reader (`gateway.log`, `cron list/runs`, file signals), stdlib HTTP server with `/api/state`, demo mode, pywebview desktop app, installers for macOS and Windows (remote mode over the LAN), bilingual UI (PT/EN).
