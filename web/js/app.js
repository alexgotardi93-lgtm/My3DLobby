// My3DLobby by BPG — main loop: scene, polling /api/state, HUD.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildOffice } from './office.js';
import { Character } from './characters.js';
import { initialLang, setLang, lang, t } from './i18n.js';
import { setupConversas, updateConversas, openConversas, conversasKey, markSeen, agoraLine, agoraBox, tickSince } from './conversas.js';
import { setupUso, updateUsoPill, usoKey, openUso, refreshUso, fmtUsd, fmtTok } from './uso.js';
import { setupAprovacao, updateAprovacao, openAprovacao, aprovacaoKey, filaResumo, refreshAprovacao } from './aprovacao.js';
import { setupCadeia, updateCadeia, openCadeia, cadeiaKey, refreshCadeia } from './cadeia.js';

const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1f2a');
scene.fog = new THREE.Fog('#1b1f2a', 45, 90);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 120);
const OVERVIEW = { pos: new THREE.Vector3(17, 12.5, 18), target: new THREE.Vector3(2.2, 0.6, 0.2) };
camera.position.copy(OVERVIEW.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(OVERVIEW.target);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 3;
controls.maxDistance = 60;
controls.zoomSpeed = 0.45;   // trackpads send many wheel events: slower, steadier zoom
controls.rotateSpeed = 0.7;
controls.panSpeed = 0.7;
controls.update();

// lights
const hemi = new THREE.HemisphereLight('#dfe8ff', '#5a4a3a', 0.75); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(8, 14, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const warm = new THREE.PointLight('#ffb86b', 6, 12); warm.position.set(10.8, 3.4, -6); scene.add(warm);
const lamp2 = new THREE.PointLight('#ffd9a0', 4, 12); lamp2.position.set(1.2, 3.6, 6.2); scene.add(lamp2);

// ---------------------------------------------------------------- state
let office = null;
const characters = {};
window.__characters = characters;
let selected = null;
let follow = false;
let lastState = null;
let online = false;
let knownFeed = new Set();
const clock = new THREE.Clock();

// ---------------------------------------------------------------- floors (andares): one room per floor
let floors = [];
let floorId = null;
try { floorId = localStorage.getItem('my3dlobby.andar'); } catch (_) {}
const tf = (k, n, nome) => String(t(k)).replace('{n}', n).replace('{nome}', nome ?? '');
function floorsOf(s) {
  if (s && s.andares && s.andares.length) return s.andares;
  const ags = s ? s.agents : [];
  return [{ id: '_', nome: s ? s.office.name : '', numero: 1, agentes: ags.map((a) => a.id), trabalhando: ags.filter((a) => a.status === 'working').length }];
}
function floorOfAgent(a) { return a.andar || (floors[0] && floors[0].id); }
function currentFloor() { return floors.find((f) => f.id === floorId) || floors[0]; }
function onFloor(a) { const f = currentFloor(); return !!f && floorOfAgent(a) === f.id; }
function desksNeeded(s) { return Math.min(8, Math.max(2, ...floorsOf(s).map((f) => f.agentes.length))); }
function rememberFloor() { try { localStorage.setItem('my3dlobby.andar', floorId); } catch (_) {} }

// ---------------------------------------------------------------- boot
async function boot() {
  setLang(initialLang());
  const first = await fetchState();
  const n = first ? desksNeeded(first) : 3;  // desks of the busiest floor
  office = buildOffice(scene, n);
  if (first) applyState(first);
  $('loading').classList.add('gone');
  setInterval(poll, POLL_MS);
  animate();
}

async function fetchState() {
  try {
    const r = await fetch('api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    online = true;
    return await r.json();
  } catch (e) {
    online = false;
    return null;
  }
}

async function poll() {
  const s = await fetchState();
  if (s) applyState(s);
  renderConn();
}

function setMonitor(m, st) {
  const on = st === 'working';
  m.mat.color.set(on ? '#5fb3ff' : (st === 'error' ? '#ff6b6b' : '#141821'));
  m.mat.emissive.set(on ? '#4aa3ff' : (st === 'error' ? '#ff3b3b' : '#000000'));
  m.mat.emissiveIntensity = on || st === 'error' ? 0.9 : 0;
  m.light.intensity = on ? 6 : 0;
}

function applyState(s) {
  lastState = s;
  if (s.office && s.office.language && !localStorage.getItem('my3dlobby.lang') && s.office.language !== 'auto' && s.office.language !== lang) setLang(s.office.language);
  floors = floorsOf(s);
  if (!floors.find((f) => f.id === floorId)) floorId = floors[0].id;
  // a floor with more people than desks in the room: build the room again, once, with more desks
  if (desksNeeded(s) > office.spots.desks.length && !window.__reloading) { window.__reloading = true; location.reload(); return; }
  const fl = currentFloor();
  const multi = floors.length > 1;
  $('office-name').textContent = multi ? fl.nome : s.office.name;
  office.setFloor(fl.numero, tf('floor_plate', fl.numero, fl.nome.toUpperCase()), multi);
  setNight(!s.office.open);
  // characters: everyone exists, only the people of this floor are in the room
  const seen = new Set();
  const desks = office.spots.desks;
  const deskState = new Map();
  s.agents.forEach((a, i) => {
    seen.add(a.id);
    let c = characters[a.id];
    if (!c) { c = characters[a.id] = new Character({ ...a, desk: a.desk ?? i }, scene, office); }
    c.setStatus(a.status, agoraLine(a.agora) || a.activity, { ...a, desk: a.desk ?? i });  // bubble: the exact step when Hermes tells it
    const here = onFloor(a);
    c.setVisible(here);
    if (here) {
      const k = (a.desk ?? i) % desks.length;
      const rank = { working: 2, error: 1 }[a.status] || 0;
      if (!deskState.has(k) || rank > deskState.get(k).rank) deskState.set(k, { rank, st: a.status });
    }
  });
  desks.forEach((d, k) => setMonitor(d.monitor, (deskState.get(k) || {}).st));
  for (const id of Object.keys(characters)) if (!seen.has(id)) { characters[id].dispose(); delete characters[id]; }
  if (selected) { const a = s.agents.find((x) => x.id === selected); if (!a || !onFloor(a)) select(null); }
  renderFloors();
  updateAprovacao(s);
  const fila = filaResumo();  // the Arquiteto carries a sign with what waits for Alex's approval
  for (const [id, c] of Object.entries(characters)) c.setBadge(fila && fila.agente === id && fila.n > 0 ? fmt(t('ap_badge'), { n: fila.n }) : null);
  renderChips(s);
  renderFeed(s);
  if (selected) renderPanel(selected);
  updateConversas(s);
  updateUsoPill(s);
  updateCadeia(s);
}

// ---------------------------------------------------------------- floors UI
function renderFloors() {
  const nav = $('andares');
  const cur = currentFloor();
  const parts = [...floors].reverse().map((f) => `<button class="andar${f.id === cur.id ? ' on' : ''}" data-id="${esc(f.id)}" title="${esc(tf('floor_go', f.numero, f.nome))}">`
    + `<span class="n">${esc(tf('floor_short', f.numero))}</span><span class="nm">${esc(f.nome)}</span>${f.trabalhando ? '<span class="dot working"></span>' : ''}</button>`);
  parts.push(`<button class="andar edit" data-act="edit" title="${esc(t('floor_edit'))}">✎</button>`);
  parts.push(`<button class="andar novo" data-act="novo">${esc(t('new_floor'))}</button>`);
  const html = parts.join('');
  if (nav.__html !== html) { nav.innerHTML = html; nav.__html = html; }
}

function goFloor(id, keepSelection) {
  if (!floors.find((f) => f.id === id)) return;
  if (id !== floorId) {
    floorId = id;
    rememberFloor();
    if (!keepSelection) { select(null); goOverview(); }
  }
  if (lastState) applyState(lastState);
}

async function postFloors(body) {
  try {
    const r = await fetch('api/andares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, erro: String(r.status) }));
  } catch (e) { return { ok: false, erro: e.message }; }
}

let amFloor = null;      // null: new floor
let amArmed = false;     // "remove" needs a second click
function floorModalOpen() { return !$('am').classList.contains('hidden'); }
function openFloorModal(id) {
  amFloor = id; amArmed = false;
  const f = id ? floors.find((x) => x.id === id) : null;
  const first = !!f && f.id === floors[0].id;
  $('am-title').textContent = t(f ? 'floor_edit_title' : 'floor_new_title');
  $('am-ok').textContent = t(f ? 'floor_save' : 'floor_create');
  $('am-nome').value = f ? f.nome : '';
  $('am-remover').classList.toggle('hidden', !f || first);
  $('am-remover').textContent = t('floor_remove');
  $('am-note').textContent = first ? t('floor_first_note') : '';
  const ul = $('am-agentes'); ul.innerHTML = '';
  for (const a of (lastState ? lastState.agents : [])) {
    const fa = floors.find((x) => x.id === floorOfAgent(a));
    const here = !!f && !!fa && fa.id === f.id;
    const lock = first && here;  // agents of floor 1 only leave it when put on another floor
    const li = document.createElement('li');
    li.innerHTML = `<label class="${lock ? 'lock' : ''}"><input type="checkbox" value="${esc(a.id)}"${here ? ' checked' : ''}${lock ? ' disabled' : ''}>`
      + `<span class="swatch" style="background:${a.color}"></span><b>${esc(a.name)}</b><small>${fa && !here ? esc(tf('floor_now_on', fa.numero, fa.nome)) : ''}</small></label>`;
    ul.appendChild(li);
  }
  $('am').classList.remove('hidden');
  setTimeout(() => $('am-nome').focus(), 30);
}
function closeFloorModal() { $('am').classList.add('hidden'); }
async function saveFloorModal() {
  const nome = $('am-nome').value.trim();
  if (!nome) { $('am-note').textContent = t('floor_need_name'); $('am-nome').focus(); return; }
  const agentes = [...$('am-agentes').querySelectorAll('input:checked')].map((i) => i.value);
  $('am-ok').disabled = true;
  const res = await postFloors(amFloor ? { acao: 'editar', andar: amFloor, nome, agentes } : { acao: 'criar', nome, agentes });
  $('am-ok').disabled = false;
  if (!res.ok) { $('am-note').textContent = t('floor_err') + (res.erro || ''); return; }
  closeFloorModal();
  if (res.andar) { floorId = res.andar; rememberFloor(); select(null); goOverview(); }
  await poll();
}
async function removeFloor() {
  if (!amFloor) return;
  if (!amArmed) { amArmed = true; $('am-remover').textContent = t('floor_remove_confirm'); return; }
  const res = await postFloors({ acao: 'remover', andar: amFloor });
  if (!res.ok) { $('am-note').textContent = t('floor_err') + (res.erro || ''); return; }
  closeFloorModal();
  floorId = res.andar || floors[0].id; rememberFloor(); select(null); goOverview();
  await poll();
}
$('andares').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.id) goFloor(b.dataset.id);
  else if (b.dataset.act === 'novo') openFloorModal(null);
  else if (b.dataset.act === 'edit') openFloorModal(currentFloor().id);
};
$('am-close').onclick = closeFloorModal;
$('am-cancel').onclick = closeFloorModal;
$('am-ok').onclick = saveFloorModal;
$('am-remover').onclick = removeFloor;
$('am').addEventListener('pointerdown', (e) => { if (e.target === $('am')) closeFloorModal(); });
$('am-nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveFloorModal(); } });
$('panel-andar').onchange = async (e) => {
  const id = selected; const destino = e.target.value;
  if (!id) return;
  const res = await postFloors({ acao: 'mover', agente: id, andar: destino });
  if (!res.ok) { $('panel-andar-note').textContent = t('floor_err') + (res.erro || ''); return; }
  const f = floors.find((x) => x.id === destino);
  $('panel-andar-note').textContent = f ? tf('floor_moved', f.numero, f.nome) : '';
  floorId = destino; rememberFloor();   // follow the agent to its new floor
  await poll();
  select(id);
};

function setNight(night) {
  const k = night ? 0.25 : 1;
  sun.intensity = 2.2 * k; hemi.intensity = 0.75 * (night ? 0.5 : 1);
  warm.intensity = night ? 10 : 6; lamp2.intensity = night ? 8 : 4;
  office.setNight(night);
  scene.background.set(night ? '#0d1019' : '#1b1f2a'); scene.fog.color.copy(scene.background);
}

// ---------------------------------------------------------------- HUD
function statusLabel(st) { return t('status')[st] || st; }

function renderChips(s) {
  const nav = $('chips');
  nav.innerHTML = '';
  const here = s.agents.filter(onFloor);
  if (!here.length) {
    const el = document.createElement('div');
    el.className = 'chip vazio';
    el.textContent = t('floor_empty');
    nav.appendChild(el);
  }
  for (const a of here) {
    const el = document.createElement('div');
    el.className = 'chip' + (selected === a.id ? ' selected' : '');
    el.innerHTML = `<span class="swatch" style="background:${a.color}"></span><span class="name">${esc(a.name)}</span><span class="st"><span class="dot ${a.status}"></span>${esc(statusLabel(a.status))}</span>`;
    el.onclick = () => select(selected === a.id ? null : a.id);
    nav.appendChild(el);
  }
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const fl = currentFloor();
  $('office-open').textContent = (floors.length > 1 && fl ? tf('floor_n', fl.numero) + ' · ' : '') + (s.office.open ? t('open') : t('closed')) + ' · ' + s.office.hours;
}

function renderConn() {
  const c = $('conn');
  c.className = 'conn ' + (online ? 'ok' : 'bad');
  let text = online ? t('connected') : t('disconnected');
  if (online && lastState && lastState.hermes) {
    const h = lastState.hermes;
    if (h.errors && h.errors.length) text += ' · ⚠ ' + h.errors[h.errors.length - 1];
    else if (h.last_cron_poll) text += ' · hermes ✓';
  }
  $('conn-text').textContent = text;
}

function renderFeed(s) {
  const ul = $('feed-list');
  const colors = Object.fromEntries(s.agents.map((a) => [a.id, a.color]));
  const names = Object.fromEntries(s.agents.map((a) => [a.id, a.name]));
  const daqui = new Set(s.agents.filter(onFloor).map((a) => a.id));  // the feed of this floor
  const items = s.feed.filter((f) => daqui.has(f.agent)).slice(0, 40);
  const nextKnown = new Set();
  ul.innerHTML = '';
  for (const f of items) {
    const key = f.time + '|' + f.agent + '|' + f.text;
    nextKnown.add(key);
    const li = document.createElement('li');
    if (knownFeed.size && !knownFeed.has(key)) li.className = 'fresh';
    const extra = f.seconds ? ` <small>${f.seconds}s${f.api_calls ? ' · ' + f.api_calls + ' calls' : ''}</small>` : '';
    li.innerHTML = `<time>${hhmm(f.time)}</time><span class="sw" style="background:${colors[f.agent] || '#888'}"></span><span class="t"><b>${esc(names[f.agent] || f.agent)}</b> ${esc(f.text)}${extra}</span>`;
    ul.appendChild(li);
  }
  knownFeed = nextKnown;
}

function renderPanel(id) {
  const a = lastState && lastState.agents.find((x) => x.id === id);
  const p = $('panel');
  if (!a) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  $('panel-avatar').style.background = a.color;
  $('panel-name').textContent = a.name;
  $('panel-role').textContent = a.role || a.id;
  $('panel-dot').className = 'dot ' + a.status;
  $('panel-status').textContent = statusLabel(a.status);
  $('panel-activity').textContent = a.activity || '';
  const box = agoraBox(a);
  const ag = $('panel-agora');
  ag.classList.toggle('hidden', !box);
  if (box) {
    ag.className = 'agora' + (box.live ? '' : ' idle');
    const html = box.html + `<button class="a-open" data-agent="${esc(a.id)}">${esc(t('cv_open_chat'))}</button>`;
    if (ag.__html !== html) { ag.innerHTML = html; ag.__html = html; tickSince(ag); }
  }
  const fila = filaResumo();
  const pf = $('panel-fila');
  const temFila = !!(fila && fila.agente === a.id);
  pf.classList.toggle('hidden', !temFila);
  if (temFila) {
    const html = `<div class="pf-top"><b>${esc(t('ap_panel'))}</b><span class="pf-n${fila.n ? ' has' : ''}">${esc(fila.n ? fmt(t('ap_panel_n'), { n: fila.n }) : t('ap_panel_0'))}</span></div>`
      + `<div class="pf-sub">${esc(fila.trava ? t('ap_trava_on') : t('ap_trava_off'))}</div>`
      + `<button class="pf-open${fila.n ? ' primary' : ''}">${esc(t('ap_panel_abrir'))}</button>`;
    if (pf.__html !== html) { pf.innerHTML = html; pf.__html = html; }
  }
  $('panel-model').textContent = (a.model || '—') + (a.model && a.model_local ? ` (${t('cv_local')})` : '');
  $('panel-runs').textContent = a.runs_today;
  $('panel-msgs').textContent = a.messages_today;
  $('panel-uso').textContent = a.uso_hoje ? `${fmtUsd(a.uso_hoje.usd)} · ${fmtTok(a.uso_hoje.tokens)} ${t('uso_tok')}` : '—';
  $('panel-last').textContent = a.last_activity ? fmtDate(a.last_activity) : t('never');
  const sel = $('panel-andar');
  const opts = floors.map((f) => `<option value="${esc(f.id)}"${f.id === floorOfAgent(a) ? ' selected' : ''}>${esc(tf('floor_short', f.numero) + ' · ' + f.nome)}</option>`).join('');
  if (sel.__html !== opts || sel.__agent !== a.id) { sel.innerHTML = opts; sel.__html = opts; sel.__agent = a.id; $('panel-andar-note').textContent = ''; }
  const crons = $('panel-crons'); crons.innerHTML = '';
  if (!a.crons.length) crons.innerHTML = `<li><span class="t">${t('none')}</span></li>`;
  for (const c of a.crons) {
    const li = document.createElement('li');
    li.className = c.last_ok === false ? 'bad' : (c.last_ok ? 'ok' : '');
    li.innerHTML = `<span class="t"><b>${esc(c.name || c.id)}</b> <small>${esc(c.schedule)}</small><br><small>${t('next')} ${esc(fmtDate(c.next_run))}</small></span>`;
    crons.appendChild(li);
  }
  const rec = $('panel-recent'); rec.innerHTML = '';
  if (!a.recent.length) rec.innerHTML = `<li><span class="t">${t('none')}</span></li>`;
  for (const r of a.recent) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${hhmm(r.time)}</time><span class="k ${r.kind}">${r.kind}</span><span class="t">${esc(r.text)}${r.seconds ? ` <small>${r.seconds}s</small>` : ''}</span>`;
    rec.appendChild(li);
  }
}

// ---------------------------------------------------------------- chat
let chatTimer = null;
let chatSeen = 0;
async function loadChat(id) {
  if (!id) return;
  try {
    const r = await fetch('api/chat?agent=' + encodeURIComponent(id), { cache: 'no-store' });
    const st = await r.json();
    if (selected !== id) return;
    renderChat(st);
  } catch (e) { /* offline */ }
}
function renderChat(st) {
  const ul = $('chat-list');
  const a = lastState && lastState.agents.find((x) => x.id === st.agent);
  const name = a ? a.name : st.agent;
  ul.innerHTML = '';
  for (const m of st.messages) {
    const li = document.createElement('li');
    li.className = m.role === 'alex' ? 'alex' : 'agent' + (m.ok === false ? ' bad' : '');
    li.innerHTML = `<time>${esc(m.role === 'alex' ? 'Alex' : name)} · ${hhmm(m.time)}</time>${esc(m.text)}${m.demanda ? `<span class="dem">↳ ${t('sent_demand')}${esc(m.demanda.split('/').pop())}</span>` : ''}`;
    ul.appendChild(li);
  }
  if (st.messages.length !== chatSeen) { ul.scrollTop = ul.scrollHeight; chatSeen = st.messages.length; }
  markSeen(st.agent);
  $('chat-typing').classList.toggle('hidden', !st.running);
  $('chat-send').disabled = !!st.running || st.allowed === false;
  $('chat-demand-row').classList.toggle('hidden', !st.demand_agent);
  $('chat-note').textContent = st.allowed === false ? t('chat_remote') : '';
}
async function sendChat() {
  const text = $('chat-text').value.trim();
  if (!text || !selected) return;
  $('chat-send').disabled = true;
  try {
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: selected, text, demanda: !$('chat-demand-row').classList.contains('hidden') && $('chat-demand').checked }) });
    const res = await r.json();
    if (res.ok) { $('chat-text').value = ''; $('chat-note').textContent = res.demanda ? t('sent_demand') + res.demanda.split('/').pop() : ''; }
    else $('chat-note').textContent = t('chat_err') + (res.erro || r.status);
  } catch (e) { $('chat-note').textContent = t('chat_err') + e.message; }
  loadChat(selected);
}
$('chat-send').onclick = sendChat;
$('chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

function select(id) {
  if (id && lastState) {  // an agent on another floor: take the elevator first
    const a = lastState.agents.find((x) => x.id === id);
    if (a && !onFloor(a)) { floorId = floorOfAgent(a); rememberFloor(); applyState(lastState); }
  }
  selected = id;
  chatSeen = -1;
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  if (id) { loadChat(id); chatTimer = setInterval(() => loadChat(id), 3000); }
  if (lastState) renderChips(lastState);
  renderPanel(id);
  if (id) focusOn(id); else follow = false;
  $('btn-follow').classList.toggle('active', follow);
}

function focusOn(id) {
  const c = characters[id];
  if (!c) return;
  follow = true;
  $('btn-follow').classList.add('active');
  // one approach move when the camera is far; afterwards the user's distance/angle is kept
  const p = c.root.position;
  if (camera.position.distanceTo(p) > 12) {
    camGoal.target.set(p.x, 1.2, p.z);
    camGoal.pos.copy(camGoal.target).add(new THREE.Vector3(4.5, 4.2, 5.5));
    camGoal.active = true;
  }
}

// camera helpers
const camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3(), active: false };
function goOverview() {
  follow = false; $('btn-follow').classList.remove('active');
  camGoal.pos.copy(OVERVIEW.pos); camGoal.target.copy(OVERVIEW.target); camGoal.active = true;
}

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const visiveis = Object.values(characters).filter((c) => c.visible !== false);
  const badges = visiveis.map((c) => c.badge).filter(Boolean);
  const signHit = badges.length ? ray.intersectObjects(badges, false) : [];
  if (signHit.length) { openAprovacao(); return; }
  const hits = ray.intersectObjects(visiveis.map((c) => c.model), true);
  if (hits.length) {
    let o = hits[0].object; while (o && !o.userData.agentId) o = o.parent;
    if (o) select(o.userData.agentId === selected ? null : o.userData.agentId);
  }
});

// ---------------------------------------------------------------- UI wiring
$('panel-close').onclick = () => select(null);
$('panel-agora').onclick = (e) => { const b = e.target.closest('.a-open'); if (b) openConversas(b.dataset.agent); };
setupConversas({ onShow: (id) => select(id), onCadeia: () => openCadeia() });
setupUso();
setupAprovacao({ onDecidiu: () => poll(), onAbrirAgente: (id) => select(id) });
setupCadeia({ onAbrirFila: () => openAprovacao(), onVerAgente: (id) => select(id) });
$('panel-fila').onclick = (e) => { if (e.target.closest('.pf-open')) openAprovacao(); };
$('btn-overview').onclick = goOverview;
$('btn-follow').onclick = () => { if (!selected) return; follow = !follow; $('btn-follow').classList.toggle('active', follow); };
$('feed-toggle').onclick = () => { const f = $('feed'); f.classList.toggle('collapsed'); $('feed-toggle').textContent = f.classList.contains('collapsed') ? '+' : '–'; };
$('btn-lang').onclick = () => { setLang(lang === 'pt' ? 'en' : 'pt'); $('btn-lang').textContent = lang === 'pt' ? 'EN' : 'PT'; $('andares').__html = ''; if (lastState) applyState(lastState); renderConn(); refreshUso(); refreshAprovacao(); refreshCadeia(); };
$('btn-lang').textContent = lang === 'pt' ? 'EN' : 'PT';
window.addEventListener('keydown', (e) => {
  if (floorModalOpen()) { if (e.key === 'Escape') closeFloorModal(); return; }
  if (conversasKey(e) || usoKey(e) || aprovacaoKey(e) || cadeiaKey(e)) return;
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') select(null);
  if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openConversas(selected); return; }
  if (e.key === 'u' || e.key === 'U') { e.preventDefault(); openUso(); return; }
  if ((e.key === 'a' || e.key === 'A') && filaResumo()) { e.preventDefault(); openAprovacao(); return; }
  if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); openCadeia(); return; }
  if (e.key === 'f' || e.key === 'F') $('btn-follow').click();
  if (e.key === 'o' || e.key === 'O') goOverview();
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    const i = floors.findIndex((f) => f.id === (currentFloor() || {}).id);
    const j = i + (e.key === 'PageUp' ? 1 : -1);
    if (floors[j]) goFloor(floors[j].id);
    return;
  }
  const n = parseInt(e.key, 10);
  const daqui = lastState ? lastState.agents.filter(onFloor) : [];
  if (n >= 1 && n <= 9 && daqui[n - 1]) select(daqui[n - 1].id);
});
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// any user input stops an automatic camera move, so the view stays where the user left it
canvas.addEventListener('pointerdown', () => { camGoal.active = false; });
canvas.addEventListener('wheel', () => { camGoal.active = false; }, { passive: true });

// ---------------------------------------------------------------- loop
const tmp = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;
  for (const c of Object.values(characters)) c.update(dt, now);
  if (follow && selected && characters[selected] && !camGoal.active) {
    const p = characters[selected].root.position;
    tmp.set(p.x, 1.2, p.z);
    // follow: move target and camera together, keeping whatever distance/angle the user chose
    const before = controls.target.clone();
    controls.target.lerp(tmp, Math.min(1, dt * 3));
    camera.position.add(controls.target.clone().sub(before));
  } else if (camGoal.active) {
    if (follow && selected && characters[selected]) {
      const p = characters[selected].root.position;
      camGoal.target.set(p.x, 1.2, p.z);
      camGoal.pos.copy(camGoal.target).add(new THREE.Vector3(4.5, 4.2, 5.5));
    }
    camera.position.lerp(camGoal.pos, Math.min(1, dt * 2.5));
    controls.target.lerp(camGoal.target, Math.min(1, dt * 2.5));
    if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal.active = false;
  }
  controls.update();
  renderer.render(scene, camera);
  window.__frames = (window.__frames || 0) + 1;
}

// debug/test hook: place the camera programmatically
window.__setCam = (pos, tgt) => { follow = false; camGoal.active = false; camera.position.set(...pos); controls.target.set(...tgt); controls.update(); };

// ---------------------------------------------------------------- utils
function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? '')); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hhmm(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso.slice(11, 16) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso; const today = new Date(); const same = d.toDateString() === today.toDateString(); return (same ? '' : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }

boot().catch((e) => { console.error(e); $('loading').innerHTML = '<div style="color:#ff5c5c">' + esc(e.message || e) + '</div>'; });
