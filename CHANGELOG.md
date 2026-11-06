# Changelog

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
