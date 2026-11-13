# Changelog

## 0.4.10 — 2026-11-13

- **Certidões da BPG in "Esperando você".** The Financeiro's certidões program (no AI, in the agent chain) keeps the five certidões negativas of BPG Sistemas and renews them 7 days before they expire: Municipal and FGTS directly, Federal and Estadual through a normal Chrome. The Trabalhista (TST) asks for the letters of an image, so Alex issues it; that one, and any automatic issue that failed or met a captcha, shows up here as a card with **Abrir o site**, **Copiar CNPJ** and **Já baixei**. "Já baixei" brings the certidões of the BPG downloaded in the last two days from Downloads (macOS asks once), checks them and files them. Under the cards, the five with their validity. The count shows on the Aprovar pill and as a sign over the Financeiro, never on the Arquiteto's.
- **The Conferente no longer waits.** A PR that reaches the Conferente is checked in the next round (every 10 minutes), without waiting for the CI or the Tester's report (13/11/2026); the card says so.

## 0.4.9 — 2026-11-12

- **The second Arquiteto has his name.** The security Arquiteto shows as **Arquiteto Segurança** (it was only "Segurança", easy to miss as a second Arquiteto), and the Cadeia column is **Arquitetos**, "geral (Fable) e segurança (Opus)".
- **A dorm.** A row of seven beds at the front-left of the room. Outside office hours a sleeping agent walks to a free bed and lies down (name and a small "Zzz..." just above the bed); with no bed free he takes a sofa, and only then his desk.
- **More sofa.** A second three-seat sofa with a small table at the front-right, so idle agents have room during the day.

## 0.4.8 — 2026-11-12

- **Two Arquitetos.** The chain now has a security Arquiteto (Hermes profile `seguranca`, Claude Opus 5.5) beside the general one (Claude Fable 5.2). The office shows him as **Segurança** (red) even without an `[[agent]]` entry, and the Cadeia board puts both in one column, **Arquiteto + Segurança**, each card in its owner's color. Who has an item follows the chain's own rule: the `area:` in the header (the log monitor sends security alerts in their own daily item; the Conferente marks the area at triage); a return follows its plan; with no mark, security words in the title and the start of the text. Only while `arquiteto/.seguranca-ativo` exists; without it, everything stays with the Arquiteto, as before.

## 0.4.7 — 2026-11-11

- **"Espera: … Você" now comes with the buttons.** When a stopped card waits for a plan that is with you (to decide, to approve its return, or to merge), the "Espera" box carries the same buttons as the **Você** column, so the "yes" is right where the card asks for it.
- The board never says "voltou e parou: só anda com o seu sim" for a plan the Fila does not list: that plan has a return open with the Arquiteto, and the board says so (on its own card and in the "Espera" box of what waits for it).

## 0.4.6 — 2026-11-11

- **Cadeia: one card per job.** A plan that came back (`escalar-arquiteto`) with an open retorno is shown only by the retorno card (the Arquiteto's work, or your approval), not twice; the retorno card carries the plan's PR. What waits for that plan says the retorno's state.
- Fix: when an old and a new retorno of the same plan have the same `id`, the open one counts. Before, a plan the Reviewer sent back a second time could show as "voltou e parou, só anda com o seu sim" under **Você** while the Fila had nothing to decide.
- Queued work says when it starts: the Arquiteto's and the Dev's queues run every 10 minutes, so a card waiting for them shows "começa até 11:40" (the Dev's first in the queue only; nothing while the agent is still busy).

## 0.4.5 — 2026-11-11

- **One list of what waits for you, the same number everywhere.** The queue window is now **Esperando você**: what may become a plan, plans that ask for a decision or came back, and a new part, **PRs esperando seu merge** (plans the Reviewer approved). The **Aprovar** counter, the sign over the Arquiteto and the **Você** column of the Cadeia board count exactly the same things ("3 para decidir · 3 para merge").
- **The board operates.** Cards under **Você** carry the buttons: approve, refuse (asks to confirm), backlog, **Devolver ao Dev** and **Fazer merge**. They act through the same code as the queue window, so both always agree.
- **Fazer merge**: merges the plan's PR into main with a merge commit (like GitHub's button), using the Mac's `gh` (the one the Dev already uses). Before merging it checks the PR is open, goes to main, comes from the plan's own branch and has no conflict, and it asks you to confirm. The merge is a line in `decisoes.md`; the plan file stays `aprovado` for the Entrega to mark `concluido` and follow the deploy. Without `gh`, the card links to the PR.
- **Devolver ao Dev**: a plan the Dev stopped on goes back to his queue as it is, without the Arquiteto (no Opus). The card says what the plan waits for and whether it is on main already; when the Dev stopped only because the dependency had no merge, this is the main button.
- The board checks the state of approved PRs on GitHub every 2 minutes: a PR merged on GitHub leaves **Você** and unblocks the plans that wait for it, even before the Entrega marks the plan `concluido`.
- An approved plan with no PR (a Sentinela false positive, infra you do yourself) counts as finished; a plan with no steps for the Dev waiting as `pronto` goes to the backlog column.

## 0.4.4 — 2026-11-11

- Cadeia: a plan whose dependency was approved but not merged yet shows as **stuck, waiting for your merge** (with the PR), not "in the Dev's queue": the Dev's branch starts from `origin/main`, so an approved PR is not enough (the chain's Dev queue now waits for the merge too).
- Cadeia: plans with no steps for the Dev (`tipo: infra`, `falso-positivo`, `backlog`) no longer show in the Dev's queue: a ready one sits with **Você** (the chain's Dev queue skips them now), and an approved Sentinela false positive counts as finished (the Sentinela only watches the signal).

## 0.4.3 — 2026-11-10

- **Quadro da Cadeia — where everything is and who has it.** The chain pill in the bottom bar, key `Q` or **Cadeia** in Conversas open a board with one column per owner: **Você** (approve, decide, merge), **Arquiteto**, **Dev**, **Conferente + Reviewer** and **Concluído e backlog**. Columns and cards wear the owner agent's own colour. Each card says what is happening in plain words ("Dev executando", "1º na fila", "PR #484 aberto: CI e Conferente", "Reviewer aprovou: falta o seu merge"), since when, the PR and the cycle; a plan that cannot start says **which plan it waits for and who has that one**. Click a card for its timeline and a shortcut to the queue or the agent. On the right, the **Histórico** says who did what ("Você aprovou…", "Dev parou … e devolveu ao Arquiteto").
- The chain reader now also reads `entrada/*/item.md` and `retornos/*.md`, and works out the owner with the same rules as the queue scripts (the approval lock, open returns, `depende-de`, the Dev's queue order by priority and age).
- **Fila do Arquiteto in two parts:** **Pode virar plano?** (what arrived: approving lets the Arquiteto create the plan — button **Pode planejar**) and **Planos esperando você** (the plan already exists: **Sim, pode seguir**, **Liberar** or, for a plan the Dev sent back, **Corrigir (Arquiteto)**).
- Events say who acted: an approval of yours is no longer told as "o Dev abriu o PR".

## 0.4.2 — 2026-11-10

- **Fila do Arquiteto — approve from the office.** A new window (bottom bar button **Aprovar** with a counter, key `A`, the amber sign over the Arquiteto, or **Abrir a fila** in his card) lists everything that reached the Arquiteto and waits for Alex's decision: WhatsApp items, Sentinela/Sentry reports, demands, plans sent back and plans that ask something. Each card has its origin, time, PR link, the Conferente's suggestion and summary, **Ver tudo** (the whole file, secrets masked) and **Aprovar** / **Recusar** (optional reason) / **Backlog**. The decided card shows the result for a moment and leaves; typing a reason survives the 3-second refresh.
- **One source of truth.** `aprovacao.py` loads the chain's own `perfis/cadeia/fila_aprovacao.py` and uses its `pendentes()` and `decidir()`, so a click does exactly what `Aprovar fila do Arquiteto.command` does (status changes, the `aprovado:` line, `decisoes.md`). Only files in the queue can be read or decided; without the program the feature stays hidden. `GET/POST /api/aprovacao`, `GET /api/aprovacao/detalhe`.
- **Demands written in the lobby are born approved** (`aprovado: … (Alex, pelo lobby)`), like the ones from `Nova demanda.command`: with the chain's approval lock on, the Arquiteto picks them up without a second click.
- **Safer POSTs.** `/api/chat` and `/api/aprovacao` accept only JSON from the lobby's own page (Origin must match the Host): a page from another site can no longer make the browser talk to the agents or decide for you.
- Chain board: `aguardando-aprovacao` (plan on hold for approval) counts as waiting for you.
- **Reopening brings the new version.** When an older My3DLobby still holds the port (a window never quit, a run from the Terminal), the app now stops it — only Python processes running My3DLobby, and only when the version differs — and starts the new one, instead of silently opening the old office. Anything else on the port is left alone.
- If the chain program is there but fails, the **Aprovar** button still shows and the window says what went wrong.
- First tests on this line: `python3 -m unittest discover -s tests` (adapter, endpoints, born-approved demands, port takeover).

## 0.4.1 — 2026-11-10

- **Fix: the whiteboard on the left wall stuck out through the wall.** It was built with its width along the room's X axis, as if it hung on the back wall, so it stood edge-on to the left wall with half of it outside the office (and the agent "thinking at the board" stood inside it). It now lies flat on the left wall, inside its frame, with the marker lines starting at its left edge; the filing cabinet's drawer handles sit on its front instead of poking into it.

## 0.4.0 — 2026-11-09

- **Controle de uso — tokens and US$ per agent.** A new window (bottom bar button **Uso**, or `U`) with period presets (today, 7 days, this month, 30 days) and a US$ / tokens switch: a hero total with the 30-day pace, tiles for tokens (input / cache / output), sessions and model calls and who spent the most; ranked bars per agent in its own colour; a stacked chart per day (per hour for today) with a legend, hover and keyboard readouts; a per-agent table (models, sessions, input, cache read, cache write, output, tokens, cost, share). The colours are the agents' own, with the OKLCH lightness kept in the band that reads evenly on the dark surface, and the stacking order is chosen so touching segments stay apart for colour-blind readers too (checked with the dataviz palette validator).
- **New `uso.py`.** Reads each profile's Hermes `state.db` read-only: session token counters and, when present, `session_model_usage` (per model and per task, so auxiliary calls such as compression and titles count too), reconciled the way `hermes insights` does; a session counts on the day it started; the same session in two stores counts once. Cost of each piece: what the provider billed, else tokens × the Claude 5.5 table (Opus 4/20, Sonnet 2/10, Haiku 0.10/0.50 US$ per million, cache read 5–10 % and cache write 125 % of input, Haiku's 5× tier above 100K-token prompts), else Hermes' own estimate, local models US$ 0, otherwise flagged "sem preço". `GET /api/uso?periodo=…`; today's figures also in `/api/state` (bottom bar, agent card "Custo hoje").
- Demo: the Dev runs on Claude Sonnet 5.5 (on the local Qwen, at US$ 0, in older days) and every demo agent has a month of plausible usage.
- Bottom bar: buttons no longer wrap on narrow windows; the help text and the chain summary shrink first.

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
