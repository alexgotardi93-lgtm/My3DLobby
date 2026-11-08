// My3DLobby by BPG — "Conversas": a messenger-style window. Every agent is a contact; on top of each
// chat stays pinned what the agent is doing right now (the exact step Hermes is executing), and the
// "Cadeia" thread follows each plan from the Arquiteto to the merge.
import { t, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const SEEN_KEY = 'my3dlobby.vistos';
const DEMAND_KEY = 'my3dlobby.demanda';
const POLL_CHAT_MS = 2500;
const FASE = {
  aprovado: 'alex', 'aguardando-alex': 'alex', 'em-execucao': 'dev', devolvido: 'dev', pronto: 'fila', revisando: 'reviewer',
  'em-revisao': 'reviewer', 'escalar-arquiteto': 'arquiteto', rascunho: 'arquiteto', 'em-avaliacao': 'arquiteto', novo: 'arquiteto',
  avaliado: 'arquiteto', concluido: 'fim', backlog: 'fim', descartado: 'fim',
};
const CHAIN_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PIN_SVG = '<svg class="cv-pinmark" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

let S = null;            // last /api/state
let cur = null;          // open thread: agent id | 'cadeia' | null
let filter = 'todos';
let query = '';
let hits = [];
let hitsFor = '';
let chat = null;         // /api/chat payload of the open agent
let chatTimer = null;
let searchTimer = null;
let pinPref = null;      // null = automatic (open while the agent works), true/false = the user's choice
let renderedKey = '';
let flashIndex = null;
let expanded = new Set();
let opts = { onShow: null };
let seen = {};
let seenLoaded = false;
let lastListHtml = null;
let lastHitsHtml = null;

// ---------------------------------------------------------------- helpers
export function fmt(s, v = {}) { return String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? '')); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function short(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function fold(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function loc() { return lang === 'pt' ? 'pt-BR' : 'en'; }
function dateOf(iso) { const d = new Date(iso); return isNaN(d) ? null : d; }
function hhmm(iso) { const d = dateOf(iso); return d ? d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
function isToday(d) { return d.toDateString() === new Date().toDateString(); }
function isYesterday(d) { const y = new Date(); y.setDate(y.getDate() - 1); return d.toDateString() === y.toDateString(); }
function dayLabel(iso) {
  const d = dateOf(iso); if (!d) return '';
  if (isToday(d)) return t('cv_today');
  if (isYesterday(d)) return t('cv_yesterday');
  return d.toLocaleDateString(loc(), { day: '2-digit', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function listTime(iso) {
  const d = dateOf(iso); if (!d) return '';
  if (isToday(d)) return hhmm(iso);
  if (isYesterday(d)) return t('cv_yesterday');
  return d.toLocaleDateString(loc(), { day: '2-digit', month: '2-digit' });
}
function whenLabel(iso) {  // "19:50" today, "07/11 19:50" otherwise
  const d = dateOf(iso); if (!d) return '';
  return isToday(d) ? hhmm(iso) : d.toLocaleDateString(loc(), { day: '2-digit', month: '2-digit' }) + ' ' + hhmm(iso);
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return sec + ' s';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}
function since(iso) { const d = dateOf(iso); return d ? (Date.now() - d.getTime()) / 1000 : 0; }
function ago(iso) { return `<span data-since="${esc(iso)}">${esc(fmt(t('cv_ago'), { t: fmtDur(since(iso)) }))}</span>`; }
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0][1] || ''))).toUpperCase(); }
function agents() { return (S && S.agents) || []; }
function agentById(id) { return agents().find((a) => a.id === id); }
function conv(id) { return (S && S.conversas && S.conversas[id]) || null; }
function rich(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return h;
}
function store(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }
function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }

// ---------------------------------------------------------------- what an agent is doing (shared with app.js)
export function stepText(p) {
  if (!p) return '';
  if (p.acao === 'outro') return p.alvo || p.tool || '';
  const verb = (t('acoes') || {})[p.acao] || p.acao;
  return p.alvo ? verb + ': ' + p.alvo : verb;
}
export function agoraLine(ag) {
  if (!ag || !ag.ativo) return '';
  if (ag.estado === 'executando' && ag.passo) return stepText(ag.passo);
  return (t('estado') || {})[ag.estado] || ag.estado;
}
function hermesText(s) {  // Hermes' own activity line, translated when it is a known one
  if (!s || lang !== 'pt') return s || '';
  let m;
  if ((m = s.match(/^waiting for (?:stream|non-streaming API) response(?: \((\d+)s)?/i))) return 'esperando o modelo' + (m[1] ? ` (${m[1]} s)` : '');
  if ((m = s.match(/^sequential tool running \((\d+)s\): (.+)/i))) return `ferramenta ${m[2]} rodando há ${m[1]} s`;
  if ((m = s.match(/^executing tool: (.+)/i))) return 'executando a ferramenta ' + m[1];
  if ((m = s.match(/^executing (\d+) tools concurrently: (.+)/i))) return `${m[1]} ferramentas ao mesmo tempo: ${m[2]}`;
  if ((m = s.match(/^tool completed: (\S+) \(([\d.]+)s\)/i))) return `ferramenta ${m[1]} terminou em ${m[2]} s`;
  if ((m = s.match(/^starting API call #(\d+)/i))) return `chamando o modelo (#${m[1]})`;
  if ((m = s.match(/^API call #(\d+) completed/i))) return `resposta do modelo recebida (#${m[1]})`;
  if ((m = s.match(/^tool results posted, continuing iteration #(\d+)/i))) return `resultados entregues ao modelo (passo ${m[1]})`;
  if (/^local model loading/i.test(s)) return 'carregando o modelo local';
  if (/^receiving stream response/i.test(s)) return 'recebendo a resposta do modelo';
  if (/^starting new turn/i.test(s)) return 'começando a rodada';
  return s;
}
export function agoraBox(a) {  // the pinned "Agora" box of the 3D panel
  const ag = a && a.agora;
  if (!ag) return a && a.status === 'working' && a.activity ? { live: true, html: `<div class="a-top"><span class="live-dot"></span><b>${esc(t('cv_now'))}</b></div><div class="a-main">${esc(a.activity)}</div>` } : null;
  if (ag.ativo) {
    const est = (t('estado') || {})[ag.estado] || ag.estado;
    const passo = ag.limite ? fmt(t('cv_step_lim'), { n: ag.sessao.chamadas || ag.sessao.passos, m: ag.limite }) : fmt(t('cv_step_n'), { n: ag.sessao.passos });
    const extra = ag.estado === 'pensando' && ag.hermes ? `<div class="a-sub">${esc(hermesText(ag.hermes))}</div>` : '';
    const plano = ag.plano ? `<div class="a-sub">${esc(t('cv_plan'))}: ${esc(ag.plano.titulo)}</div>` : '';
    return { live: true, html: `<div class="a-top"><span class="live-dot"></span><b>${esc(t('cv_now'))}</b><span>${esc(est)} · ${ago(ag.desde)}</span></div><div class="a-main">${esc(agoraLine(ag))}</div>${extra}${plano}<div class="a-sub">${esc(passo)}</div>` };
  }
  const txt = ag.estado === 'parado' ? fmt(t('cv_stalled'), { t: fmtDur(since(ag.desde)) })
    : fmt(t(ag.estado === 'terminou' ? 'cv_last_run' : 'cv_last_reply'), { h: whenLabel(ag.desde), n: ag.sessao.passos });
  return { live: false, html: `<div class="a-top"><b>${esc(t('cv_now'))}</b><span>${esc(t('cv_no_agent_now'))}</span></div><div class="a-sub">${esc(txt)}</div>` };
}

// ---------------------------------------------------------------- the chain
function boardText(it) {
  const key = it.bloqueado ? 'bloqueado' : it.status;
  return fmt((t('cad') || {})[key] || it.status, { pr: it.pr ? '#' + it.pr : '', c: it.ciclos || '?' });
}
export function chainSummary(c) {
  const q = (c && c.quadro) || [];
  const alex = q.filter((i) => i.fase === 'alex');
  const exec = q.find((i) => i.status === 'em-execucao');
  const rev = q.find((i) => i.status === 'revisando') || q.find((i) => i.status === 'em-revisao');
  const fila = q.filter((i) => i.status === 'pronto').length;
  const parts = [];
  if (alex.length) parts.push(fmt(t('cv_wait_you'), { n: alex.length }));
  if (exec) parts.push(fmt(t('cv_pill_exec'), { t: short(exec.titulo, 38) }));
  else if (rev) parts.push(boardText(rev));
  if (fila) parts.push(fmt(t('cv_in_queue'), { n: fila }));
  return { text: parts.join(' · ') || t('cv_chain_idle'), alex: alex.length > 0, live: !!(exec || rev) };
}
function faseColor(f) {
  const a = agentById(f);
  if (a) return a.color;
  return { alex: '#f2c14e', fila: '#5fb3ff', fim: '#35d07f', dev: '#c9a227', reviewer: '#8c5bd8', arquiteto: '#d8663b' }[f] || '#7c8cff';
}
function eventHtml(e) {
  const ev = t('ev') || {};
  if (e.tipo === 'inicio') return esc(fmt(ev.inicio, { n: e.n }));
  const tpl = ev[e.para] || ev.outro;
  return fmt(esc(tpl), { t: '<b>' + esc(e.titulo || e.id) + '</b>', pr: esc(e.pr ? '#' + e.pr : ''), c: esc(e.ciclos || '?'), de: esc(e.de || '—'), para: esc(e.para) });
}
function prLink(pr) {
  if (!pr) return '';
  const repo = S && S.cadeia && S.cadeia.github;
  return repo ? `<a class="b-pr" href="https://github.com/${esc(repo)}/pull/${esc(pr)}" target="_blank" rel="noopener">#${esc(pr)}</a>` : `<span class="b-pr">#${esc(pr)}</span>`;
}

// ---------------------------------------------------------------- unread
function lastReply(id) { const c = conv(id); const r = c && c.replies; return r && r.length ? r[r.length - 1] : ''; }
function lastEvent() { const ev = (S && S.cadeia && S.cadeia.eventos) || []; return ev.length ? ev[ev.length - 1].t : ''; }
function initSeen() {
  if (seenLoaded || !S) return;
  seenLoaded = true;
  let stored = null;
  try { stored = JSON.parse(read(SEEN_KEY) || 'null'); } catch (_) { stored = null; }
  if (stored && typeof stored === 'object') { seen = stored; return; }
  seen = {};  // first time here: what already exists counts as read
  for (const a of agents()) seen[a.id] = lastReply(a.id);
  seen.cadeia = lastEvent();
  store(SEEN_KEY, JSON.stringify(seen));
}
export function markSeen(id) {
  if (!S || !id) return;
  const v = id === 'cadeia' ? lastEvent() : lastReply(id);
  if (v && (seen[id] || '') < v) {
    seen[id] = v;
    store(SEEN_KEY, JSON.stringify(seen));
    renderBadge();
    if (isConversasOpen()) renderList();
  }
}
function unread(id) {
  if (!S) return 0;
  const s = seen[id] || '';
  if (id === 'cadeia') return ((S.cadeia && S.cadeia.eventos) || []).filter((e) => e.tipo !== 'inicio' && e.t > s).length;
  const c = conv(id);
  return c ? (c.replies || []).filter((x) => x > s).length : 0;
}

// ---------------------------------------------------------------- contacts
function contactRows() {
  const rows = [];
  if (S && S.cadeia) rows.push({ id: 'cadeia' });
  for (const a of agents()) rows.push({ id: a.id, a });
  return rows;
}
function previewFor(row) {
  if (row.id === 'cadeia') {
    const sm = chainSummary(S.cadeia);
    return { html: esc(sm.text), live: sm.live, time: lastEvent() };
  }
  const a = row.a;
  const c = conv(a.id);
  if (c && c.running) return { html: esc(t('cv_typing')), live: true, time: c.time };
  const line = agoraLine(a.agora) || (a.status === 'working' ? a.activity : '');
  if (line) return { html: esc(line), live: true, time: (a.agora && a.agora.desde) || a.last_activity };
  if (c && c.text) {
    const mine = c.role === 'alex';
    return { html: (mine ? `<span class="tick">✓✓</span>${esc(t('cv_you'))}: ` : '') + esc(c.text), live: false, time: c.time };
  }
  return { html: `<span class="muted">${esc(a.role || a.id)}</span>`, live: false, time: a.last_activity };
}
function rowMatches(row) {
  if (filter === 'trabalhando') {
    const busy = row.id === 'cadeia' ? chainSummary(S.cadeia).live : row.a.status === 'working';
    if (!busy) return false;
  }
  if (filter === 'naolidas' && !unread(row.id)) return false;
  if (!query) return true;
  const q = fold(query);
  const hay = row.id === 'cadeia'
    ? [t('cv_chain'), 'cadeia chain', ...(((S.cadeia && S.cadeia.quadro) || []).map((i) => i.titulo))]
    : [row.a.name, row.a.role, row.a.id, agoraLine(row.a.agora), row.a.activity, (conv(row.a.id) || {}).text];
  return hay.some((h) => fold(h).includes(q));
}
function rowHtml(row) {
  const n = unread(row.id);
  const isC = row.id === 'cadeia';
  const name = isC ? t('cv_chain') : row.a.name;
  const p = previewFor(row);
  const av = isC ? `<div class="cv-av chain">${CHAIN_SVG}</div>`
    : `<div class="cv-av" style="--c:${esc(row.a.color)}">${esc(initials(name))}<span class="st ${esc(row.a.status)}"></span></div>`;
  return `<li class="cv-item${cur === row.id ? ' on' : ''}${n ? ' unread' : ''}${isC ? ' pinned' : ''}" data-id="${esc(row.id)}">${av}`
    + `<div class="cv-mid"><div class="cv-top"><b>${esc(name)}</b><time>${esc(listTime(p.time))}</time></div>`
    + `<div class="cv-sub"><span class="cv-prev${p.live ? ' live' : ''}">${p.html}</span>${isC ? PIN_SVG : ''}`
    + `${n ? `<span class="cv-unread">${n > 99 ? '99+' : n}</span>` : ''}</div></div></li>`;
}
function renderList() {
  const rows = contactRows().filter(rowMatches);
  const head = query ? `<li class="cv-sec">${esc(t('cv_agents'))}</li>` : '';
  const html = rows.length ? head + rows.map(rowHtml).join('') : '';
  if (html !== lastListHtml) { $('cv-list').innerHTML = html; lastListHtml = html; }
}
function renderHits() {
  const box = $('cv-hits');
  if (!query || query.length < 2) { box.innerHTML = ''; lastHitsHtml = ''; return; }
  const q = fold(query);
  const evs = ((S && S.cadeia && S.cadeia.eventos) || []).filter((e) => e.tipo !== 'inicio' && fold((e.titulo || '') + ' ' + e.id).includes(q)).slice(-8).reverse();
  let html = '';
  if (hits.length) {
    html += `<div class="cv-sec">${esc(t('cv_messages'))}</div>` + hits.map((h) => {
      const a = agentById(h.agent);
      return `<div class="cv-hit" data-agent="${esc(h.agent)}" data-index="${h.index}"><div class="h-top"><span><i class="h-dot" style="background:${esc(a ? a.color : '#888')}"></i>${esc(a ? a.name : h.agent)}${h.role === 'alex' ? ' · ' + esc(t('cv_you')) : ''}</span><time>${esc(listTime(h.time))}</time></div><div class="h-txt">${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}</div></div>`;
    }).join('');
  }
  if (evs.length) {
    html += `<div class="cv-sec">${esc(t('cv_chain_hits'))}</div>` + evs.map((e) => `<div class="cv-hit" data-agent="cadeia"><div class="h-top"><span><i class="h-dot" style="background:${faseColor(FASE[e.para] || '')}"></i>${esc(t('cv_chain'))}</span><time>${esc(listTime(e.t))}</time></div><div class="h-txt">${eventHtml(e)}</div></div>`).join('');
  }
  if (!html && hitsFor === query && !contactRows().some(rowMatches)) html = `<div class="cv-none">${esc(fmt(t('cv_nothing'), { q: query }))}</div>`;
  if (html !== lastHitsHtml) { box.innerHTML = html; lastHitsHtml = html; }
}
async function fetchHits() {
  const q = query;
  try {
    const r = await fetch('api/conversas/busca?q=' + encodeURIComponent(q), { cache: 'no-store' });
    const d = await r.json();
    if (q !== query) return;
    hits = d.results || [];
  } catch (_) { hits = []; }
  hitsFor = q;
  renderHits();
}
function renderBadge() {
  if (!S) return;
  let n = unread('cadeia');
  for (const a of agents()) n += unread(a.id);
  const b = $('cv-badge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', !n);
}
function renderPill() {
  const pill = $('cadeia-pill');
  if (!S || !S.cadeia || (S.cadeia.ok === false && !(S.cadeia.quadro || []).length)) { pill.classList.add('hidden'); return; }
  const sm = chainSummary(S.cadeia);
  pill.classList.remove('hidden');
  pill.classList.toggle('live', sm.live);
  pill.classList.toggle('alex', sm.alex);
  $('cadeia-text').textContent = sm.text;
  pill.title = t('cv_chain') + ': ' + sm.text;
}

// ---------------------------------------------------------------- the open thread
function statusSub(a) {
  let s = (t('status') || {})[a.status] || a.status;
  if (a.status === 'working' && a.activity) s += ' · ' + a.activity;
  else if (a.status !== 'working' && a.last_activity) s += ' · ' + fmt(t('cv_seen'), { h: whenLabel(a.last_activity) });
  if (a.model) s += ' · ' + a.model + (a.model_local ? ` (${t('cv_local')})` : '');
  return s;
}
function renderHead() {
  if (!cur) return;
  const av = $('cv-head-av');
  if (cur === 'cadeia') {
    av.className = 'cv-av chain'; av.style.removeProperty('--c'); av.innerHTML = CHAIN_SVG;
    $('cv-head-name').textContent = t('cv_chain');
    $('cv-head-sub').textContent = t('cv_chain_sub');
    $('cv-show').classList.add('hidden');
    return;
  }
  const a = agentById(cur);
  if (!a) return;
  av.className = 'cv-av'; av.style.setProperty('--c', a.color);
  av.innerHTML = `${esc(initials(a.name))}<span class="st ${esc(a.status)}"></span>`;
  $('cv-head-name').textContent = a.name;
  $('cv-head-sub').textContent = statusSub(a);
  $('cv-show').classList.remove('hidden');
}
function pinIsOpen(a) {
  if (cur === 'cadeia') return pinPref === null ? true : pinPref;
  return pinPref === null ? !!(a && a.agora && a.agora.ativo) : pinPref;
}
function stepsHtml(passos) {
  if (!passos || !passos.length) return '';
  const icon = { ok: '✓', erro: '✗', rodando: '…', parou: '■' };
  const rows = passos.slice().reverse().map((p) => `<li><time>${esc(hhmm(p.t))}</time><span class="s-${esc(p.estado)}" title="${esc((t('passo_estado') || {})[p.estado] || p.estado)}">${icon[p.estado] || '·'}</span><span class="s-txt">${esc(stepText(p))}</span><small>${p.seg != null ? esc(p.seg + ' s') : ''}</small></li>`).join('');
  return `<div class="p-sec">${esc(t('cv_steps'))}</div><ul class="cv-steps">${rows}</ul>`;
}
function renderPin() {
  const box = $('cv-pin');
  if (!cur) { box.innerHTML = ''; return; }
  if (cur === 'cadeia') {
    const c = (S && S.cadeia) || {};
    const q = c.quadro || [];
    const items = q.length ? q.map((it) => `<li class="cv-b" style="--fc:${faseColor(it.fase)}"><div class="b-main"><b>${esc(it.titulo)}</b><small>${esc(boardText(it))} · ${esc(fmt(t('cv_since'), { h: whenLabel(it.desde) }))}</small></div>${prLink(it.pr)}</li>`).join('')
      : `<li class="cv-b-empty">${esc(c.ok === false ? fmt(t('cv_board_off'), { p: c.erro || 'arquiteto/planos' }) : t('cv_board_empty'))}</li>`;
    box.className = 'cv-pin board' + (pinIsOpen() ? ' open' : '');
    box.innerHTML = `<div class="p-top">${PIN_SVG}<span class="lbl">${esc(t('cv_board'))}</span><span>${q.length}</span><span class="chev">▾</span></div><div class="p-more"><ul class="cv-board">${items}</ul></div>`;
    return;
  }
  const a = agentById(cur);
  if (!a) { box.innerHTML = ''; return; }
  const ag = a.agora;
  const open = pinIsOpen(a);
  let top = '', main = '', more = '', right = '';
  if (ag && ag.ativo) {
    const est = (t('estado') || {})[ag.estado] || ag.estado;
    top = `<span class="live-dot"></span><span class="lbl">${esc(t('cv_now'))}</span><span>${esc(est)} · ${ago(ag.desde)}</span>`;
    main = ag.estado === 'executando' ? stepText(ag.passo) : est + (ag.hermes ? ' — ' + hermesText(ag.hermes) : '');
  } else if (ag) {
    top = `${PIN_SVG}<span class="lbl">${esc(t('cv_now'))}</span><span>${esc(a.status === 'working' ? (a.activity || t('cv_working_on')) : t('cv_free'))}</span>`;
    main = ag.estado === 'parado' ? fmt(t('cv_stalled'), { t: fmtDur(since(ag.desde)) })
      : fmt(t(ag.estado === 'terminou' ? 'cv_last_run' : 'cv_last_reply'), { h: whenLabel(ag.desde), n: ag.sessao.passos });
  } else {
    top = `${PIN_SVG}<span class="lbl">${esc(t('cv_now'))}</span><span>${esc((t('status') || {})[a.status] || a.status)}</span>`;
    main = a.status === 'working' ? (a.activity || t('cv_working_on')) : t('cv_no_data');
  }
  if (ag) {
    if (ag.ativo) right = ag.limite ? fmt(t('cv_step_lim'), { n: ag.sessao.chamadas || ag.sessao.passos, m: ag.limite }) : fmt(t('cv_step_n'), { n: ag.sessao.passos });
    const rows = [];
    if (ag.plano) rows.push(`${esc(t('cv_plan'))}: <b>${esc(ag.plano.titulo)}</b> · ${esc(fmt(t('cv_since'), { h: whenLabel(ag.plano.desde) }))}`);
    if (ag.tarefas) rows.push(esc(fmt(t('cv_tasks'), { a: ag.tarefas.feitas, b: ag.tarefas.total })) + (ag.tarefas.agora ? ' · ' + esc(fmt(t('cv_task_now'), { x: ag.tarefas.agora })) : ''));
    if (ag.fala) rows.push(`${esc(t('cv_said'))} (${esc(hhmm(ag.fala_t))}): <i>“${esc(ag.fala)}”</i>`);
    if (ag.hermes && ag.estado !== 'pensando') rows.push(`${esc(t('cv_hermes'))}: ${esc(hermesText(ag.hermes))}`);
    const s = ag.sessao || {};
    rows.push(`${esc(t('cv_session'))}: ${esc(s.titulo || s.fonte || s.id || '')} · ${esc(fmt(t('cv_started'), { h: whenLabel(s.inicio) }))}${s.modelo ? ' · ' + esc(t('cv_model')) + ' ' + esc(s.modelo) : ''}`);
    more = rows.map((r) => `<div class="p-row">${r}</div>`).join('') + stepsHtml(ag.passos);
  }
  box.className = 'cv-pin' + (ag && ag.ativo ? ' live' : '') + (open && more ? ' open' : '') + (more ? ' can' : '');
  box.innerHTML = `<div class="p-top">${top}<span class="p-right">${esc(right)}</span>${more ? '<span class="chev">▾</span>' : ''}</div>`
    + `<div class="p-main" title="${esc(main)}">${esc(main)}</div>${more ? `<div class="p-more">${more}</div>` : ''}`;
}
function renderMsgs() {
  const ul = $('cv-msgs');
  const wrap = ul.parentElement;
  const a = agentById(cur);
  const name = a ? a.name : cur;
  const msgs = (chat && chat.messages) || [];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const key = [cur, msgs.length, last ? last.time : '', [...expanded].join(','), lang].join('|');
  const first = !renderedKey;
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  if (key !== renderedKey) {
    let html = '';
    let lastDay = '';
    if (!msgs.length) html = `<li class="cv-day">${esc(fmt(t('cv_empty_chat'), { n: name }))}</li>`;
    msgs.forEach((m, i) => {
      const dk = (dateOf(m.time) || new Date(0)).toDateString();
      if (dk !== lastDay) { html += `<li class="cv-day">${esc(dayLabel(m.time))}</li>`; lastDay = dk; }
      const out = m.role === 'alex';
      const replied = out && msgs.slice(i + 1).some((x) => x.role !== 'alex');
      const text = String(m.text || '');
      const cut = text.length > 1400 && !expanded.has(i);
      const toggle = text.length > 1400 ? `<span class="more" data-toggle="${i}">${esc(t(cut ? 'cv_more' : 'cv_less'))}</span>` : '';
      const dem = m.demanda ? `<span class="dem">↳ ${esc(t('sent_demand'))}${esc(String(m.demanda).split('/').pop())}</span>` : '';
      const ticks = out ? `<span class="ticks${replied ? '' : ' one'}">${replied ? '✓✓' : '✓'}</span>` : '';
      html += `<li class="cv-m ${out ? 'out' : 'in'}${m.ok === false ? ' bad' : ''}" data-i="${i}">${rich(cut ? text.slice(0, 1200) + '…' : text)}${toggle}${dem}<span class="meta">${esc(hhmm(m.time))}${ticks}</span></li>`;
    });
    const grew = renderedKey && renderedKey.split('|')[1] !== String(msgs.length);
    ul.innerHTML = html;
    renderedKey = key;
    if (flashIndex !== null) {
      const li = ul.querySelector(`[data-i="${flashIndex}"]`);
      flashIndex = null;
      if (li) { li.scrollIntoView({ block: 'center' }); li.classList.add('flash'); }
    } else if (first || atBottom || grew) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }
  const running = !!(chat && chat.running);
  $('cv-typing').classList.toggle('hidden', !running);
  $('cv-send').disabled = running || (chat && chat.allowed === false);
  $('cv-demand-row').classList.toggle('hidden', !(chat && chat.demand_agent));
  if (chat && chat.allowed === false) $('cv-note').textContent = t('chat_remote');
}
function renderCadeiaMsgs() {
  const ul = $('cv-msgs');
  const wrap = ul.parentElement;
  const ev = (S && S.cadeia && S.cadeia.eventos) || [];
  const key = ['cadeia', ev.length, ev.length ? ev[ev.length - 1].t : '', lang].join('|');
  if (key === renderedKey) return;
  const first = !renderedKey;
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  let html = '';
  let lastDay = '';
  if (!ev.length) html = `<li class="cv-day">${esc(t('cv_board_empty'))}</li>`;
  for (const e of ev) {
    const dk = (dateOf(e.t) || new Date(0)).toDateString();
    if (dk !== lastDay) { html += `<li class="cv-day">${esc(dayLabel(e.t))}</li>`; lastDay = dk; }
    html += `<li class="cv-m in ev" style="--fc:${faseColor(FASE[e.para] || '')}">${eventHtml(e)}<span class="meta">${esc(hhmm(e.t))}</span></li>`;
  }
  ul.innerHTML = html;
  renderedKey = key;
  if (first || atBottom) wrap.scrollTop = wrap.scrollHeight;
}
async function loadChat() {
  const id = cur;
  if (!id || id === 'cadeia') return;
  try {
    const r = await fetch('api/chat?agent=' + encodeURIComponent(id), { cache: 'no-store' });
    const d = await r.json();
    if (cur !== id) return;
    chat = d;
    renderMsgs();
    markSeen(id);
  } catch (_) { /* offline: keep what is shown */ }
}
function autoGrow() {
  const ta = $('cv-text');
  ta.style.height = 'auto';
  ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px';
}
async function sendMsg() {
  const id = cur;
  const ta = $('cv-text');
  const text = ta.value.trim();
  if (!text || !id || id === 'cadeia' || $('cv-send').disabled) return;
  $('cv-send').disabled = true;
  try {
    const demanda = !!(chat && chat.demand_agent && $('cv-demand').checked);
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: id, text, demanda }) });
    const res = await r.json();
    if (res.ok) { ta.value = ''; autoGrow(); $('cv-note').textContent = res.demanda ? t('sent_demand') + res.demanda.split('/').pop() : ''; }
    else $('cv-note').textContent = t('chat_err') + (res.erro || r.status);
  } catch (e) { $('cv-note').textContent = t('chat_err') + e.message; }
  loadChat();
}
function showEmpty() {
  $('cv-win').classList.remove('chat');
  $('cv-empty').classList.remove('hidden');
  $('cv-chat').classList.add('hidden');
}
function openThread(id, index = null) {
  if (id !== 'cadeia' && !agentById(id)) return;
  if (cur !== id) {
    cur = id; chat = null; renderedKey = ''; expanded = new Set(); pinPref = null;
    $('cv-msgs').innerHTML = ''; $('cv-text').value = ''; $('cv-note').textContent = ''; autoGrow();
  }
  flashIndex = index;
  if (index !== null) renderedKey = '';
  $('cv-win').classList.add('chat');
  $('cv-empty').classList.add('hidden');
  $('cv-chat').classList.remove('hidden');
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  lastListHtml = null;
  renderList(); renderHead(); renderPin();
  const isC = id === 'cadeia';
  $('cv-compose').classList.toggle('hidden', isC);
  $('cv-readonly').classList.toggle('hidden', !isC);
  $('cv-typing').classList.add('hidden');
  if (isC) { renderCadeiaMsgs(); markSeen('cadeia'); }
  else { loadChat(); chatTimer = setInterval(loadChat, POLL_CHAT_MS); setTimeout(() => $('cv-text').focus(), 40); }
}

// ---------------------------------------------------------------- public API
export function isConversasOpen() { return !$('conversas').classList.contains('hidden'); }
export function openConversas(id) {
  $('conversas').classList.remove('hidden');
  initSeen();
  lastListHtml = null;
  renderList(); renderHits(); renderBadge();
  if (id) openThread(id);
  else if (cur) openThread(cur);
  else { showEmpty(); setTimeout(() => $('cv-q').focus(), 40); }
}
export function closeConversas() {
  $('conversas').classList.add('hidden');
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}
export function conversasKey(e) {  // keyboard while the window is open; returns true when handled
  if (!isConversasOpen()) return false;
  if (e.key === 'Escape') {
    if (document.activeElement === $('cv-q') && query) { $('cv-q').value = ''; onSearch(); }
    else closeConversas();
    return true;
  }
  return true;  // the office shortcuts stay off while chatting
}
export function updateConversas(state) {
  S = state;
  initSeen();
  renderBadge();
  renderPill();
  if (!isConversasOpen()) return;
  renderList();
  if (query.length >= 2) renderHits();
  if (cur) {
    renderHead(); renderPin();
    if (cur === 'cadeia') { renderCadeiaMsgs(); markSeen('cadeia'); }
  }
}
function onSearch() {
  query = $('cv-q').value.trim();
  lastListHtml = null;
  renderList();
  clearTimeout(searchTimer);
  if (query.length >= 2) searchTimer = setTimeout(fetchHits, 220);
  else { hits = []; hitsFor = ''; renderHits(); }
}
export function setupConversas(o = {}) {
  opts = { ...opts, ...o };
  $('btn-conversas').onclick = () => (isConversasOpen() ? closeConversas() : openConversas());
  $('cadeia-pill').onclick = () => openConversas('cadeia');
  $('cv-close').onclick = closeConversas;
  $('conversas').addEventListener('mousedown', (e) => { if (e.target.id === 'conversas') closeConversas(); });
  $('cv-q').addEventListener('input', onSearch);
  $('cv-filters').onclick = (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    for (const x of $('cv-filters').querySelectorAll('button')) x.classList.toggle('on', x === b);
    lastListHtml = null;
    renderList();
  };
  $('cv-list').onclick = (e) => { const li = e.target.closest('.cv-item'); if (li) openThread(li.dataset.id); };
  $('cv-hits').onclick = (e) => {
    const h = e.target.closest('.cv-hit');
    if (!h) return;
    openThread(h.dataset.agent, h.dataset.index != null ? parseInt(h.dataset.index, 10) : null);
  };
  $('cv-pin').onclick = (e) => {
    if (e.target.closest('a') || e.target.closest('.p-more')) return;
    if (!$('cv-pin').classList.contains('can') && cur !== 'cadeia') return;
    pinPref = !$('cv-pin').classList.contains('open');
    renderPin();
  };
  $('cv-msgs').onclick = (e) => {
    const m = e.target.closest('[data-toggle]');
    if (!m) return;
    const i = parseInt(m.dataset.toggle, 10);
    if (expanded.has(i)) expanded.delete(i); else expanded.add(i);
    renderMsgs();
  };
  $('cv-back').onclick = () => { $('cv-win').classList.remove('chat'); };
  $('cv-show').onclick = () => { const id = cur; closeConversas(); if (opts.onShow && id && id !== 'cadeia') opts.onShow(id); };
  $('cv-open-arch').onclick = () => openThread(agentById('arquiteto') ? 'arquiteto' : (agents()[0] || {}).id);
  $('cv-send').onclick = sendMsg;
  const ta = $('cv-text');
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); } });
  const dem = $('cv-demand');
  dem.checked = read(DEMAND_KEY) === '1';
  dem.onchange = () => store(DEMAND_KEY, dem.checked ? '1' : '0');
  // "há 35 s" keeps counting between two polls
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-since]')) el.textContent = fmt(t('cv_ago'), { t: fmtDur(since(el.dataset.since)) });
  }, 1000);
}
