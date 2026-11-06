// My3DLobby by BPG — main loop: scene, polling /api/state, HUD.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildOffice } from './office.js';
import { Character } from './characters.js';
import { initialLang, setLang, lang, t } from './i18n.js';

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
scene.fog = new THREE.Fog('#1b1f2a', 28, 50);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 120);
const OVERVIEW = { pos: new THREE.Vector3(17, 12.5, 18), target: new THREE.Vector3(2.2, 0.6, 0.2) };
camera.position.copy(OVERVIEW.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(OVERVIEW.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 3;
controls.maxDistance = 40;
controls.update();

// lights
const hemi = new THREE.HemisphereLight('#dfe8ff', '#5a4a3a', 0.75); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(8, 14, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const warm = new THREE.PointLight('#ffb86b', 14, 12); warm.position.set(10, 3.2, 2); scene.add(warm);
const lamp2 = new THREE.PointLight('#ffd9a0', 10, 12); lamp2.position.set(1.5, 3.4, 7); scene.add(lamp2);

// ---------------------------------------------------------------- state
let office = null;
let gltf = null;
const characters = {};
window.__characters = characters;
let selected = null;
let follow = false;
let lastState = null;
let online = false;
let knownFeed = new Set();
const clock = new THREE.Clock();

// ---------------------------------------------------------------- boot
async function boot() {
  setLang(initialLang());
  const [g, first] = await Promise.all([new GLTFLoader().loadAsync('assets/RobotExpressive.glb'), fetchState()]);
  gltf = g;
  const n = first ? first.agents.length : 3;
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

function applyState(s) {
  lastState = s;
  if (s.office && s.office.language && !localStorage.getItem('my3dlobby.lang') && s.office.language !== 'auto' && s.office.language !== lang) setLang(s.office.language);
  $('office-name').textContent = s.office.name;
  setNight(!s.office.open);
  // characters
  const seen = new Set();
  s.agents.forEach((a, i) => {
    seen.add(a.id);
    let c = characters[a.id];
    if (!c) { c = characters[a.id] = new Character({ ...a, desk: a.desk ?? i }, gltf, scene, office); }
    c.setStatus(a.status, a.activity, { ...a, desk: a.desk ?? i });
    const m = office.spots.desks[(a.desk ?? i) % office.spots.desks.length].monitor;
    const on = a.status === 'working';
    m.mat.color.set(on ? '#5fb3ff' : (a.status === 'error' ? '#ff6b6b' : '#141821'));
    m.mat.emissive.set(on ? '#4aa3ff' : (a.status === 'error' ? '#ff3b3b' : '#000000'));
    m.mat.emissiveIntensity = on || a.status === 'error' ? 0.9 : 0;
    m.light.intensity = on ? 6 : 0;
  });
  for (const id of Object.keys(characters)) if (!seen.has(id)) { characters[id].dispose(); delete characters[id]; }
  renderChips(s);
  renderFeed(s);
  if (selected) renderPanel(selected);
}

function setNight(night) {
  const k = night ? 0.25 : 1;
  sun.intensity = 2.2 * k; hemi.intensity = 0.75 * (night ? 0.5 : 1);
  warm.intensity = night ? 22 : 14; lamp2.intensity = night ? 16 : 10;
  for (const w of office.windows) { w.material.color.set(night ? '#223055' : '#9fd3ff'); w.material.emissive.set(night ? '#223055' : '#9fd3ff'); }
  scene.background.set(night ? '#0d1019' : '#1b1f2a'); scene.fog.color.copy(scene.background);
}

// ---------------------------------------------------------------- HUD
function statusLabel(st) { return t('status')[st] || st; }

function renderChips(s) {
  const nav = $('chips');
  nav.innerHTML = '';
  for (const a of s.agents) {
    const el = document.createElement('div');
    el.className = 'chip' + (selected === a.id ? ' selected' : '');
    el.innerHTML = `<span class="swatch" style="background:${a.color}"></span><span class="name">${esc(a.name)}</span><span class="st"><span class="dot ${a.status}"></span>${esc(statusLabel(a.status))}</span>`;
    el.onclick = () => select(selected === a.id ? null : a.id);
    nav.appendChild(el);
  }
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  $('office-open').textContent = (s.office.open ? t('open') : t('closed')) + ' · ' + s.office.hours;
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
  const items = s.feed.slice(0, 40);
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
  $('panel-model').textContent = a.model || '—';
  $('panel-runs').textContent = a.runs_today;
  $('panel-msgs').textContent = a.messages_today;
  $('panel-last').textContent = a.last_activity ? fmtDate(a.last_activity) : t('never');
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

function select(id) {
  selected = id;
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
  const hits = ray.intersectObjects(Object.values(characters).map((c) => c.model), true);
  if (hits.length) {
    let o = hits[0].object; while (o && !o.userData.agentId) o = o.parent;
    if (o) select(o.userData.agentId === selected ? null : o.userData.agentId);
  }
});

// ---------------------------------------------------------------- UI wiring
$('panel-close').onclick = () => select(null);
$('btn-overview').onclick = goOverview;
$('btn-follow').onclick = () => { if (!selected) return; follow = !follow; $('btn-follow').classList.toggle('active', follow); };
$('feed-toggle').onclick = () => { const f = $('feed'); f.classList.toggle('collapsed'); $('feed-toggle').textContent = f.classList.contains('collapsed') ? '+' : '–'; };
$('btn-lang').onclick = () => { setLang(lang === 'pt' ? 'en' : 'pt'); $('btn-lang').textContent = lang === 'pt' ? 'EN' : 'PT'; if (lastState) applyState(lastState); renderConn(); };
$('btn-lang').textContent = lang === 'pt' ? 'EN' : 'PT';
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') select(null);
  if (e.key === 'f' || e.key === 'F') $('btn-follow').click();
  if (e.key === 'o' || e.key === 'O') goOverview();
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && lastState && lastState.agents[n - 1]) select(lastState.agents[n - 1].id);
});
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
canvas.addEventListener('pointerdown', () => { camGoal.active = false; if (follow && selected) { /* user takes over orbit; keep following target */ } });

// ---------------------------------------------------------------- loop
const tmp = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;
  for (const c of Object.values(characters)) c.update(dt, now);
  if (follow && selected && characters[selected]) {
    const p = characters[selected].root.position;
    tmp.set(p.x, 1.2, p.z);
    controls.target.lerp(tmp, Math.min(1, dt * 3));
    const want = tmp.clone().add(new THREE.Vector3(4.5, 4.2, 5.5));
    if (camera.position.distanceTo(want) > 9) camera.position.lerp(want, Math.min(1, dt * 1.5));
  } else if (camGoal.active) {
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
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hhmm(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso.slice(11, 16) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso; const today = new Date(); const same = d.toDateString() === today.toDateString(); return (same ? '' : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }

boot().catch((e) => { console.error(e); $('loading').innerHTML = '<div style="color:#ff5c5c">' + esc(e.message || e) + '</div>'; });
