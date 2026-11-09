// My3DLobby — "Controle de uso": tokens and US$ per agent (GET /api/uso), each agent in its own color.
// Ranked bars per agent, stacked columns per day (or per hour, for today), stat tiles and a table.
import { t, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const REFRESH_MS = 30000;
const PERIODOS = ['hoje', '7d', 'mes', '30d'];

let dados = null;
let periodo = ler('my3dlobby.uso.periodo', 'mes');
let metrica = ler('my3dlobby.uso.metrica', 'usd');
let timer = null;
let pedido = 0;
let erro = '';
let cores = [];     // chart color per agent (same index as dados.agentes)
let pilha = [];     // stacking order (agent indexes), bottom to top

function ler(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
function gravar(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
if (!PERIODOS.includes(periodo)) periodo = 'mes';
if (metrica !== 'usd' && metrica !== 'tokens') metrica = 'usd';

// ---------------------------------------------------------------- numbers
const loc = () => (lang === 'pt' ? 'pt-BR' : 'en-US');
export function fmtUsd(v, { curto = false } = {}) {
  v = Number(v) || 0;
  if (v > 0 && v < 0.01) return '< ' + new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD' }).format(0.01);
  const o = { style: 'currency', currency: 'USD' };
  if (curto && v >= 1000) Object.assign(o, { notation: 'compact', maximumFractionDigits: 1 });
  else if (curto && v >= 10) Object.assign(o, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return new Intl.NumberFormat(loc(), o).format(v);
}
export function fmtTok(v) {
  v = Number(v) || 0;
  if (v < 1000) return new Intl.NumberFormat(loc()).format(v);
  return new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: v < 1e5 || (v >= 1e6 && v < 1e8) ? 1 : 0 }).format(v);
}
const fmtInt = (v) => new Intl.NumberFormat(loc()).format(Number(v) || 0);
const fmtPct = (p) => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: p > 0 && p < 0.1 ? 1 : 0 }).format(p);
const fmtVal = (v, curto) => (metrica === 'usd' ? fmtUsd(v, { curto }) : fmtTok(v));
const tr = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));
const valorAgente = (a) => (metrica === 'usd' ? a.usd : a.tokens.total);
const valorBalde = (b, i) => (metrica === 'usd' ? b.usd[i] : b.tokens[i]);

// ---------------------------------------------------------------- color
// The agent's own color, with its OKLCH lightness kept inside the band that reads evenly on this dark
// surface (0.50-0.66): same hue, so the Dev's gold is still gold, just not the one mark that shouts.
function lin(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
}
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function hexDe([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return '#' + [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map((c) => {
    c = Math.max(0, Math.min(1, c));
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(c * 255).toString(16).padStart(2, '0');
  }).join('');
}
export function corGrafico(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#8a93a6';
  const [L, a, b] = oklab(lin(hex));
  const L2 = Math.min(0.66, Math.max(0.5, L));
  return L2 === L ? hex : hexDe([L2, a, b]);
}
// Machado-Oliveira-Fernandes (2009) protan/deutan at full severity, as in the dataviz palette validator.
const CVD = [
  [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
];
function separacao(c1, c2) {  // >= 1 when the pair passes both floors (normal vision 15, colorblind 8)
  const d = (x, y) => 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  const l1 = lin(c1), l2 = lin(c2);
  const sim = (l, M) => M.map((r) => Math.max(0, Math.min(1, r[0] * l[0] + r[1] * l[1] + r[2] * l[2])));
  const cvd = Math.min(...CVD.map((M) => d(oklab(sim(l1, M)), oklab(sim(l2, M)))));
  return Math.min(d(oklab(l1), oklab(l2)) / 15, cvd / 8);
}
// Stacking order: touching segments must stay apart. The office order when it already passes;
// otherwise the passing order closest to it; otherwise the most separated one. Depends only on the
// colors, never on the values, so a segment never moves when the numbers change.
export function ordemPilha(cs) {
  const n = cs.length;
  const ids = [...Array(n).keys()];
  if (n < 3 || n > 7) return ids;
  const sep = cs.map((a) => cs.map((b) => separacao(a, b)));
  let melhor = ids, chave = [-1, 0];
  const visita = (pre, resto) => {
    if (!resto.length) {
      let s = Infinity, dist = 0;
      for (let i = 0; i < pre.length; i++) { dist += Math.abs(pre[i] - i); if (i) s = Math.min(s, sep[pre[i - 1]][pre[i]]); }
      const k = s >= 1 ? [1, -dist] : [0, s];
      if (k[0] > chave[0] || (k[0] === chave[0] && k[1] > chave[1] + 1e-9)) { chave = k; melhor = pre; }
      return;
    }
    resto.forEach((x, i) => visita([...pre, x], [...resto.slice(0, i), ...resto.slice(i + 1)]));
  };
  visita([], ids);
  return melhor;
}

// ---------------------------------------------------------------- DOM helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
function chave(cor) {  // tooltip row key: a short stroke of the series color
  const k = el('span', 'uk');
  k.style.background = cor;
  return k;
}

// ---------------------------------------------------------------- tooltip
let tipDono = null;
function mostrarTip(conteudo, x, y, dono) {
  const tip = $('uso-tip');
  tip.replaceChildren(...conteudo);
  tip.classList.remove('hidden');
  tipDono = dono;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function esconderTip(dono) {
  if (dono && tipDono !== dono) return;
  $('uso-tip').classList.add('hidden');
  tipDono = null;
}
function linhaTip(cor, valor, rotulo, forte) {
  const row = el('div', 'ut-row' + (forte ? ' on' : ''));
  if (cor) row.append(chave(cor));
  row.append(el('b', '', valor), el('span', '', rotulo));
  return row;
}
function tipAgente(i) {
  const a = dados.agentes[i];
  const tk = a.tokens;
  const out = [el('div', 'ut-head', a.name)];
  out.push(linhaTip(cores[i], fmtUsd(a.usd), t('uso_t_custo')));
  out.push(linhaTip(null, fmtTok(tk.total), t('uso_t_tokens')));
  out.push(el('div', 'ut-sub', tr(t('uso_t_detalhe'), { a: fmtTok(tk.entrada), b: fmtTok(tk.cache_lido), c: fmtTok(tk.cache_gravado), d: fmtTok(tk.saida) })));
  out.push(el('div', 'ut-sub', tr(t('uso_t_sess'), { s: fmtInt(a.sessoes), c: fmtInt(a.chamadas) })));
  if (a.modelos.length === 1) out.push(el('div', 'ut-sub', a.modelos[0].nome + (a.modelos[0].local ? ` · ${t('uso_local_free')}` : '')));
  else for (const m of a.modelos.slice(0, 4)) {
    out.push(el('div', 'ut-sub', `${m.nome}: ${m.local ? t('uso_local_free') : fmtUsd(m.usd)} · ${fmtTok(m.tokens)} ${t('uso_tok')}`));
  }
  if (a.aux && a.aux.tokens) out.push(el('div', 'ut-sub', tr(t('uso_t_aux'), { v: fmtUsd(a.aux.usd), t: a.aux.tarefas.map(nomeTarefa).join(', ') })));
  return out;
}
function nomeTarefa(x) { const m = t('uso_tarefas'); return (m && m[x]) || x.replace(/_/g, ' '); }

// ---------------------------------------------------------------- render
function rotuloBalde(b, longo) {
  if (dados.granularidade === 'hora') {
    const h = parseInt(b.chave, 10);
    return longo ? `${h}h – ${h + 1}h` : (lang === 'pt' ? `${h}h` : `${h}:00`);
  }
  const d = new Date(b.chave + 'T12:00:00');
  if (longo) return d.toLocaleDateString(loc(), { weekday: 'short', day: '2-digit', month: '2-digit' });
  if (dados.periodo === '7d') {
    const dia = new Intl.DateTimeFormat(loc(), { weekday: 'short' }).format(d).replace(/[.,]/g, '');
    return `${dia} ${d.getDate()}`;
  }
  return d.toLocaleDateString(loc(), { day: '2-digit', month: '2-digit' });
}
function baldeAtual(b) {
  const agora = new Date();
  if (dados.granularidade === 'hora') return parseInt(b.chave, 10) === agora.getHours();
  const p = (n) => String(n).padStart(2, '0');
  return b.chave === `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}
function ranking() {
  return dados.agentes.map((a, i) => i).sort((x, y) => valorAgente(dados.agentes[y]) - valorAgente(dados.agentes[x])
    || dados.agentes[x].name.localeCompare(dados.agentes[y].name));
}

function render() {
  const body = $('uso-body');
  for (const b of $('uso-periodos').querySelectorAll('button')) b.classList.toggle('on', b.dataset.p === periodo);
  for (const b of $('uso-metrica').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === metrica);
  $('uso-msg').textContent = erro ? tr(t('uso_erro'), { e: erro }) : (dados ? '' : t('uso_carregando'));
  $('uso-msg').classList.toggle('hidden', !!dados && !erro);
  body.classList.toggle('hidden', !dados);
  if (!dados) return;
  cores = dados.agentes.map((a) => corGrafico(a.color));
  pilha = ordemPilha(cores);
  $('uso-stamp').textContent = tr(t('uso_atualizado'), { h: new Date(dados.gerado_em).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) });
  renderKpis();
  renderRanking();
  renderLegenda();
  renderTempo();
  renderTabela();
  renderNota();
}

function renderKpis() {
  const tot = dados.total;
  const box = $('uso-kpis');
  const tile = (rotulo, valor, sub, hero) => {
    const d = el('div', 'uk-tile' + (hero ? ' hero' : ''));
    d.append(el('div', 'uk-label', rotulo), el('div', 'uk-value', valor));
    if (sub) d.append(el('div', 'uk-sub', sub));
    return d;
  };
  let subGasto = dados.periodo === 'hoje' ? t('uso_desde_0h') : (dados.ritmo_30d != null ? tr(t('uso_ritmo'), { v: fmtUsd(dados.ritmo_30d) }) : '');
  if (tot.usd_incluido > 0) subGasto += (subGasto ? ' · ' : '') + tr(t('uso_incluido'), { v: fmtUsd(tot.usd_incluido) });
  const tk = tot.tokens;
  const topo = ranking()[0];
  const ta = topo !== undefined ? dados.agentes[topo] : null;
  const totalMet = metrica === 'usd' ? tot.usd : tk.total;
  const topoTile = tile(t(metrica === 'usd' ? 'uso_k_top_usd' : 'uso_k_top_tok'), ta && valorAgente(ta) > 0 ? ta.name : '—',
    ta && valorAgente(ta) > 0 ? tr(t('uso_share'), { v: fmtVal(valorAgente(ta)), p: fmtPct(valorAgente(ta) / (totalMet || 1)) }) : '');
  if (ta && valorAgente(ta) > 0) topoTile.querySelector('.uk-value').prepend(chave(cores[topo]));
  box.replaceChildren(
    tile(t('uso_k_gasto'), fmtUsd(tot.usd), subGasto, true),
    tile(t('uso_k_tokens'), fmtTok(tk.total), tr(t('uso_tok_sub'), { a: fmtTok(tk.entrada), b: fmtTok(tk.cache_lido + tk.cache_gravado), c: fmtTok(tk.saida) })),
    tile(t('uso_k_sessoes'), fmtInt(tot.sessoes), tr(t('uso_chamadas'), { n: fmtInt(tot.chamadas) })),
    topoTile,
  );
}

function renderRanking() {
  const box = $('uso-rank');
  const ordem = ranking();
  const max = Math.max(0, ...ordem.map((i) => valorAgente(dados.agentes[i])));
  const total = ordem.reduce((s, i) => s + valorAgente(dados.agentes[i]), 0);
  $('uso-h-rank').textContent = t(metrica === 'usd' ? 'uso_por_agente_usd' : 'uso_por_agente_tok');
  const linhas = ordem.map((i) => {
    const a = dados.agentes[i];
    const v = valorAgente(a);
    const row = el('div', 'rk-row');
    row.tabIndex = 0;
    row.dataset.i = i;
    const nome = el('span', 'rk-name', a.name);
    const trilho = el('div', 'rk-track');
    const barra = el('div', 'rk-bar');
    barra.style.background = cores[i];
    barra.style.width = max > 0 && v > 0 ? `max(3px, ${(v / max) * 100}%)` : '0';
    trilho.append(barra);
    const val = el('span', 'rk-val');
    val.append(el('b', '', fmtVal(v)), el('small', '', total > 0 ? fmtPct(v / total) : ''));
    row.append(nome, trilho, val);
    row.setAttribute('aria-label', `${a.name}: ${fmtUsd(a.usd)}, ${fmtTok(a.tokens.total)} ${t('uso_tok')}`);
    return row;
  });
  box.replaceChildren(...linhas);
}

function renderLegenda() {
  const box = $('uso-legend');
  box.replaceChildren(...pilha.map((i) => {
    const it = el('span', 'lg-item');
    const sw = el('span', 'lg-sw');
    sw.style.background = cores[i];
    it.append(sw, document.createTextNode(dados.agentes[i].name));
    return it;
  }));
}

function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function topoArredondado(x, y, w, h, r) {  // column with the 4px rounded data end on top, square at the baseline
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

let tempoLayout = null;
function renderTempo() {
  const box = $('uso-chart');
  $('uso-h-tempo').textContent = t(dados.granularidade === 'hora' ? 'uso_por_hora' : 'uso_por_dia');
  const W = Math.max(280, box.clientWidth), H = 236;
  const baldes = dados.baldes;
  const totais = baldes.map((b) => pilha.reduce((s, i) => s + valorBalde(b, i), 0));
  const maxDado = Math.max(0, ...totais);
  const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
  s.setAttribute('aria-label', `${t(dados.granularidade === 'hora' ? 'uso_por_hora' : 'uso_por_dia')}: ${fmtVal(totais.reduce((a, b) => a + b, 0))}`);
  const passo = niceStep(maxDado / 4);
  const topo = maxDado > 0 ? Math.ceil(maxDado / passo - 1e-9) * passo : passo * 4;
  const ticks = [];
  for (let v = 0; v <= topo + passo * 1e-6; v += passo) ticks.push(v);
  const casas = passo >= 1 ? 0 : 2;  // every tick with the same decimals: $0, $5, $10 or $0.00, $0.25, $0.50
  const yLabel = (v) => (metrica === 'usd'
    ? new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v)
    : fmtTok(v));
  const m = { l: 12 + Math.max(...ticks.map((v) => yLabel(v).length)) * 6.6, r: 6, t: 10, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const y = (v) => m.t + ph - (v / topo) * ph;
  for (const v of ticks) {
    s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'ax-base' : 'ax-grid' }));
    s.append(svg('text', { x: m.l - 8, y: y(v) + 4, class: 'ax-y' }, yLabel(v)));
  }
  const n = baldes.length;
  const slot = pw / n;
  const bw = Math.max(3, Math.min(24, slot * 0.64));
  const realce = svg('rect', { x: 0, y: m.t, width: slot, height: ph, class: 'col-hi', visibility: 'hidden' });
  s.append(realce);
  const maxRotulos = Math.max(2, Math.floor(pw / (dados.periodo === '7d' ? 56 : 46)));
  const cada = Math.ceil(n / maxRotulos);
  baldes.forEach((b, j) => {
    const x0 = m.l + j * slot, x = x0 + (slot - bw) / 2;
    let base = m.t + ph, primeiro = true;
    const segs = pilha.filter((i) => valorBalde(b, i) > 0);
    segs.forEach((i, k) => {
      const h = (valorBalde(b, i) / topo) * ph;
      const fundo = base - (primeiro ? 0 : 2);  // 2px surface gap between touching segments
      const alto = fundo - (base - h);
      base -= h;
      if (alto < 0.6) return;
      primeiro = false;
      const ultimo = k === segs.length - 1;
      s.append(svg('path', { d: ultimo ? topoArredondado(x, fundo - alto, bw, alto, 4) : `M${x},${fundo}V${fundo - alto}H${x + bw}V${fundo}Z`,
        fill: cores[i], class: 'seg', 'data-j': j, 'data-i': i }));
    });
    if (j % cada === 0 || (j === n - 1 && n - 1 - Math.floor((n - 1) / cada) * cada >= cada * 0.6)) {
      s.append(svg('text', { x: x0 + slot / 2, y: H - 7, class: 'ax-x' + (baldeAtual(b) ? ' now' : '') }, rotuloBalde(b, false)));
    }
  });
  if (maxDado <= 0) s.append(svg('text', { x: m.l + pw / 2, y: m.t + ph / 2, class: 'ax-empty' }, t('uso_vazio')));
  const hit = svg('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent', class: 'hit', tabindex: 0 });
  s.append(hit);
  tempoLayout = { m, slot, ph, topo, n, realce, svg: s, foco: -1 };
  box.replaceChildren(s);
}
function tipBalde(j, iSob) {
  const b = dados.baldes[j];
  const out = [el('div', 'ut-head', rotuloBalde(b, true))];
  const presentes = [...pilha].reverse().filter((i) => valorBalde(b, i) > 0);
  if (!presentes.length) out.push(el('div', 'ut-sub', t('uso_sem_uso')));
  for (const i of presentes) out.push(linhaTip(cores[i], fmtVal(valorBalde(b, i)), dados.agentes[i].name, i === iSob));
  if (presentes.length > 1) out.push(linhaTip(null, fmtVal(presentes.reduce((sm, i) => sm + valorBalde(b, i), 0)), t('uso_t_total')));
  return out;
}
function tempoEm(ev) {
  const L = tempoLayout;
  if (!L) return;
  const r = L.svg.getBoundingClientRect();
  const x = ev.clientX - r.left, yy = ev.clientY - r.top;
  const j = Math.floor((x - L.m.l) / L.slot);
  if (j < 0 || j >= L.n || yy < L.m.t - 4 || yy > L.m.t + L.ph + 20) { sairTempo(); return; }
  let iSob = null, acc = 0;  // which segment is under the pointer
  const v = ((L.m.t + L.ph - yy) / L.ph) * L.topo;
  for (const i of pilha) { const w = valorBalde(dados.baldes[j], i); if (w > 0 && v >= acc && v <= acc + w) iSob = i; acc += w; }
  marcarBalde(j, iSob);
  mostrarTip(tipBalde(j, iSob), ev.clientX, ev.clientY, 'tempo');
}
function marcarBalde(j, iSob) {
  const L = tempoLayout;
  L.realce.setAttribute('x', L.m.l + j * L.slot);
  L.realce.setAttribute('visibility', 'visible');
  for (const p of L.svg.querySelectorAll('.seg')) {
    p.classList.toggle('lift', +p.dataset.j === j && (iSob === null || +p.dataset.i === iSob));
  }
}
function sairTempo() {
  if (!tempoLayout) return;
  tempoLayout.realce.setAttribute('visibility', 'hidden');
  for (const p of tempoLayout.svg.querySelectorAll('.seg.lift')) p.classList.remove('lift');
  esconderTip('tempo');
}

function renderTabela() {
  const ordem = ranking();
  const tab = $('uso-table');
  const C = t('uso_col');
  const cols = ['sessoes', 'entrada', 'cache_lido', 'cache_gravado', 'saida', 'total', 'usd', 'pct'];
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', 'l', C.agente), ...cols.map((c) => el('th', '', C[c])));
  thead.append(hr);
  const total = metrica === 'usd' ? dados.total.usd : dados.total.tokens.total;
  const celulas = (a) => [fmtInt(a.sessoes), fmtTok(a.tokens.entrada), fmtTok(a.tokens.cache_lido), fmtTok(a.tokens.cache_gravado),
    fmtTok(a.tokens.saida), fmtTok(a.tokens.total), fmtUsd(a.usd), total > 0 ? fmtPct(valorAgente(a) / total) : '—'];
  const titulos = (a) => [null, fmtInt(a.tokens.entrada), fmtInt(a.tokens.cache_lido), fmtInt(a.tokens.cache_gravado), fmtInt(a.tokens.saida),
    fmtInt(a.tokens.total), a.usd ? '$' + Number(a.usd).toFixed(4) : null, null];
  const tbody = el('tbody');
  for (const i of ordem) {
    const a = dados.agentes[i];
    const tr_ = el('tr');
    const td = el('td', 'l');
    const nome = el('div', 'tb-name');
    nome.append(chave(cores[i]), document.createTextNode(a.name));
    const mods = a.modelos.length ? a.modelos.map((x) => x.nome).join(' · ') : (a.modelo_atual || '—');
    td.append(nome, el('div', 'tb-mod', mods));
    tr_.append(td);
    celulas(a).forEach((v, k) => {
      const c = el('td', cols[k] === 'usd' ? 'strong' : '', v);
      const tt = titulos(a)[k];
      if (tt) c.title = tt;
      tr_.append(c);
    });
    tbody.append(tr_);
  }
  const tfoot = el('tfoot');
  const fr = el('tr');
  const tt = dados.total;
  fr.append(el('td', 'l', t('uso_total')), ...[fmtInt(tt.sessoes), fmtTok(tt.tokens.entrada), fmtTok(tt.tokens.cache_lido), fmtTok(tt.tokens.cache_gravado),
    fmtTok(tt.tokens.saida), fmtTok(tt.tokens.total), fmtUsd(tt.usd), total > 0 ? fmtPct(1) : '—'].map((v, k) => el('td', cols[k] === 'usd' ? 'strong' : '', v)));
  tfoot.append(fr);
  tab.replaceChildren(thead, tbody, tfoot);
}

function renderNota() {
  const box = $('uso-note');
  const precos = (dados.precos || []).map((p) => tr(t('uso_preco_item'), { n: p.nome, e: num(p.entrada), s: num(p.saida) })).join(' · ');
  const extra = (dados.precos || []).filter((p) => p.acima).map((p) => tr(t('uso_preco_faixa'), { n: p.nome, k: Math.round(p.acima / 1000), x: num(p.acima_mult) }));
  const partes = [el('p', '', tr(t('uso_nota'), { precos })), ...extra.map((x) => el('p', '', x))];
  for (const a of dados.avisos || []) {
    if (a.tipo === 'sem_preco') partes.push(el('p', 'warn', tr(t('uso_aviso_sem_preco'), { m: a.modelo, t: fmtTok(a.tokens) })));
    else if (a.tipo === 'erro') partes.push(el('p', 'warn', tr(t('uso_aviso_erro'), { a: a.agente, x: a.texto })));
  }
  box.replaceChildren(...partes);
}
const num = (v) => new Intl.NumberFormat(loc(), v < 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 3 } : { maximumFractionDigits: 2 }).format(v);

// ---------------------------------------------------------------- data
async function carregar() {
  const meu = ++pedido;
  $('uso-body').classList.add('loading');
  try {
    const r = await fetch('api/uso?periodo=' + encodeURIComponent(periodo), { cache: 'no-store' });
    const j = await r.json();
    if (meu !== pedido) return;
    if (!r.ok || j.ok === false) throw new Error(j.erro || r.status);
    dados = j;
    erro = '';
  } catch (e) {
    if (meu !== pedido) return;
    erro = e.message || String(e);
  }
  $('uso-body').classList.remove('loading');
  if (isUsoOpen()) render();
}

// ---------------------------------------------------------------- open / close
export function isUsoOpen() { return !$('uso').classList.contains('hidden'); }
export function openUso() {
  $('uso').classList.remove('hidden');
  render();
  carregar();
  clearInterval(timer);
  timer = setInterval(carregar, REFRESH_MS);
  setTimeout(() => $('uso-close').focus(), 0);
}
export function closeUso() {
  $('uso').classList.add('hidden');
  clearInterval(timer);
  timer = null;
  esconderTip();
}
export function refreshUso() { if (isUsoOpen()) render(); }
export function usoKey(e) {  // keyboard while the window is open; true when handled
  if (!isUsoOpen()) return false;
  if (e.key === 'Escape') { closeUso(); return true; }
  return true;  // office shortcuts stay off
}
export function updateUsoPill(state) {
  const u = state && state.uso;
  $('uso-hoje').textContent = u && u.usd != null ? tr(t('uso_hoje_pill'), { v: fmtUsd(u.usd) }) : '';
}
export function setupUso() {
  $('btn-uso').onclick = () => (isUsoOpen() ? closeUso() : openUso());
  $('uso-close').onclick = closeUso;
  $('uso').addEventListener('mousedown', (e) => { if (e.target.id === 'uso') closeUso(); });
  $('uso-periodos').onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.dataset.p === periodo) return;
    periodo = b.dataset.p;
    gravar('my3dlobby.uso.periodo', periodo);
    render();
    carregar();
  };
  $('uso-metrica').onclick = (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b || b.dataset.m === metrica) return;
    metrica = b.dataset.m;
    gravar('my3dlobby.uso.metrica', metrica);
    render();
  };
  const rank = $('uso-rank');
  const rankTip = (ev, row) => {
    const r = row.getBoundingClientRect();
    mostrarTip(tipAgente(+row.dataset.i), ev && ev.clientX != null ? ev.clientX : r.left + r.width * 0.55, ev && ev.clientY != null ? ev.clientY : r.bottom, 'rank');
  };
  rank.addEventListener('pointermove', (ev) => { const row = ev.target.closest('.rk-row'); if (row) rankTip(ev, row); else esconderTip('rank'); });
  rank.addEventListener('pointerleave', () => esconderTip('rank'));
  rank.addEventListener('focusin', (ev) => { const row = ev.target.closest('.rk-row'); if (row) rankTip(null, row); });
  rank.addEventListener('focusout', () => esconderTip('rank'));
  const chart = $('uso-chart');
  chart.addEventListener('pointermove', tempoEm);
  chart.addEventListener('pointerleave', sairTempo);
  chart.addEventListener('keydown', (ev) => {  // arrows walk the columns, with the same readout as hover
    const L = tempoLayout;
    if (!L || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
    ev.preventDefault();
    L.foco = Math.max(0, Math.min(L.n - 1, (L.foco < 0 ? L.n : L.foco) + (ev.key === 'ArrowRight' ? 1 : -1)));
    marcarBalde(L.foco, null);
    const r = L.svg.getBoundingClientRect();
    mostrarTip(tipBalde(L.foco, null), r.left + L.m.l + (L.foco + 0.5) * L.slot, r.top + L.m.t + 10, 'tempo');
  });
  chart.addEventListener('focusout', sairTempo);
  let w = 0;
  new ResizeObserver(() => {
    const nw = chart.clientWidth;
    if (dados && isUsoOpen() && Math.abs(nw - w) > 4) { w = nw; renderTempo(); }
  }).observe(chart);
}
