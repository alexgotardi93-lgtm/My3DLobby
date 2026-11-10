// Fila do Arquiteto — what reached the Arquiteto and waits for Alex to decide whether it becomes a plan.
// The list comes with /api/state (aprovacao) every few seconds; a click is POST /api/aprovacao, which runs the
// chain's own fila_aprovacao.py (the same program as "Aprovar fila do Arquiteto.command").
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const tr = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));

let S = null;                 // last aprovacao view
let repo = '';                // owner/repo for PR links ([chain] github)
let permitido = true;         // false when this computer may not decide (LAN without chat_lan)
let ultimoN = null;
const aberto = new Set();     // cards with "Ver tudo" open
const detalhes = {};          // chave -> { texto, erro }
const enviando = new Set();   // chaves with a decision in flight
const feitos = new Map();     // chave -> { item, acao, texto } shown briefly after a decision
let pedindo = null;           // { chave, acao } while the reason box is open (recusar / backlog)
let aoDecidir = null;
let aoAbrirAgente = null;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function quandoCurto(q) {  // '10/11/2026 08:24' -> '10/11 08:24'
  const m = /^(\d{2}\/\d{2})\/\d{4}\s+(\d{2}:\d{2})/.exec(q || '');
  return m ? `${m[1]} ${m[2]}` : (q || '');
}
function ha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  let v;
  if (min < 60) v = `${min} min`;
  else if (min < 48 * 60) v = `${Math.round(min / 60)} h`;
  else v = tr(t('ap_dias'), { n: Math.round(min / 1440) });
  return tr(t('cv_ago'), { t: v });
}

function rotulo(it) {
  if (it.tipo === 'plano') return it.status === 'aguardando-aprovacao' ? t('ap_o').plano_segurado : t('ap_o').plano;
  return t('ap_o')[it.origem] || it.origem;
}

function prLink(pr) {
  if (!pr) return '';
  return repo ? `<a class="ap-pr" href="https://github.com/${esc(repo)}/pull/${esc(pr)}" target="_blank" rel="noopener">PR ${esc(pr)}</a>`
    : `<span class="ap-pr">PR ${esc(pr)}</span>`;
}

function textoDetalhe(texto) {  // header lines dimmed, '## ' headings bold
  let cab = true;
  return String(texto).split('\n').map((l) => {
    if (cab && !l.trim()) { cab = false; return ''; }
    if (cab) return `<span class="ap-h">${esc(l)}</span>`;
    if (/^#{1,4}\s/.test(l)) return `<b>${esc(l.replace(/^#{1,4}\s/, ''))}</b>`;
    return esc(l);
  }).join('\n');
}

function dica(it) {
  if (it.tipo === 'plano' && it.status === 'aguardando-alex') return t('ap_dica_plano');
  if (it.tipo === 'plano') return t('ap_dica_segurado');
  if (it.tipo === 'retorno') return t('ap_dica_retorno');
  return '';
}

function htmlCartao(it) {
  const f = feitos.get(it.chave);
  if (f) {
    return `<article class="ap-card done ${esc(f.acao)}" data-chave="${esc(it.chave)}"><div class="ap-done">`
      + `<span class="ap-done-ic">${f.acao === 'a' ? '✓' : f.acao === 'r' ? '×' : '↓'}</span>`
      + `<b>${esc(t('ap_feito')[f.acao])}</b> <span>${esc(it.titulo)}</span><small>${esc(f.texto)}</small></div></article>`;
  }
  const ocupado = enviando.has(it.chave);
  const abrir = aberto.has(it.chave);
  const det = detalhes[it.chave];
  const ped = pedindo && pedindo.chave === it.chave ? pedindo : null;
  const de = it.de ? ` <span class="ap-de">${esc(tr(t('ap_de_origem'), { o: t('ap_o')[it.de] || it.de }))}</span>` : '';
  const quando = [quandoCurto(it.quando), ha(it.quando_iso)].filter(Boolean).join(' · ');
  let h = `<article class="ap-card${ocupado ? ' busy' : ''}" data-chave="${esc(it.chave)}">`;
  h += `<div class="ap-top"><span class="ap-tag o-${esc(it.tipo === 'plano' ? 'plano' : it.origem)}">${esc(rotulo(it))}</span>${de}`;
  h += `${prLink(it.pr)}<span class="ap-when">${esc(quando)}</span></div>`;
  h += `<h3 class="ap-title">${esc(it.titulo)}</h3>`;
  if (it.quem) h += `<div class="ap-from">${esc(t('ap_de'))} ${esc(it.quem)}</div>`;
  if (it.status === 'em-triagem') h += `<div class="ap-flag">${esc(t('ap_triando'))}</div>`;
  if (it.sugestao) h += `<div class="ap-sug"><b>${esc(t('ap_sugestao'))}</b> ${esc(it.sugestao)}</div>`;
  if (it.resumo) h += `<p class="ap-resumo">${esc(it.resumo)}</p>`;
  if (abrir) {
    h += `<div class="ap-full">${det ? (det.erro ? `<div class="ap-err">${esc(det.erro)}</div>` : `<pre class="ap-pre">${textoDetalhe(det.texto)}</pre>`
      + (det.cortado ? `<small class="ap-cut">${esc(t('ap_cortado'))}</small>` : '')) : `<div class="ap-loading">${esc(t('ap_lendo'))}</div>`}</div>`;
  }
  const d = dica(it);
  if (d) h += `<div class="ap-hint">${esc(d)}</div>`;
  if (ped) {
    h += `<div class="ap-confirm"><input class="ap-motivo" type="text" maxlength="300" placeholder="${esc(t('ap_motivo_ph'))}" value="${esc(ped.motivo || '')}">`
      + `<button class="ap-b" data-x="cancelar">${esc(t('ap_cancelar'))}</button>`
      + `<button class="ap-b ${ped.acao === 'r' ? 'danger' : 'primary'}" data-x="confirmar">${esc(ped.acao === 'r' ? t('ap_confirma_r') : t('ap_confirma_b'))}</button></div>`;
  } else {
    const dis = ocupado || !permitido ? ' disabled' : '';
    h += `<div class="ap-actions"><button class="ap-link" data-x="ver">${esc(abrir ? t('ap_menos') : t('ap_ver'))}</button><span class="ap-sp"></span>`
      + `<button class="ap-b" data-a="b"${dis}>${esc(t('ap_backlog'))}</button>`
      + `<button class="ap-b danger-outline" data-a="r"${dis}>${esc(t('ap_recusar'))}</button>`
      + `<button class="ap-b primary" data-a="a"${dis}>${ocupado ? `<span class="spinner small"></span>` : ''}${esc(t('ap_aprovar'))}</button></div>`;
  }
  if (it.erro) h += `<div class="ap-err">${esc(it.erro)}</div>`;
  return h + '</article>';
}

const erros = {};  // chave -> last error of a decision

function itensVisiveis() {
  const lista = (S && S.itens ? S.itens : []).map((i) => ({ ...i, erro: erros[i.chave] || '' }));
  for (const [chave, f] of feitos) if (!lista.some((i) => i.chave === chave)) lista.push(f.item);  // decided: stays a moment
  return lista;
}

function render() {
  if (!isAprovacaoOpen()) return;
  const n = S ? S.n : 0;
  $('ap-count').textContent = S && S.disponivel ? (n ? tr(t('ap_n'), { n }) : t('ap_n0')) : '';
  const trava = $('ap-trava');
  trava.className = 'ap-trava ' + (S && S.trava ? 'on' : 'off');
  trava.innerHTML = S && S.disponivel ? `<span class="pdot"></span>${esc(S.trava ? t('ap_trava_on') : t('ap_trava_off'))}` : '';
  trava.title = S && !S.trava ? t('ap_trava_off_dica') : '';
  const msg = $('ap-msg');
  const lista = $('ap-list');
  let aviso = '';
  if (!S) aviso = t('ap_lendo');
  else if (!S.disponivel) aviso = tr(t('ap_indisponivel'), { p: S.programa || '' });
  else if (S.erro) aviso = tr(t('ap_erro_ler'), { e: S.erro });
  if (!permitido) aviso = (aviso ? aviso + ' · ' : '') + t('ap_remoto');
  msg.textContent = aviso;
  msg.classList.toggle('hidden', !aviso);
  const itens = S && S.disponivel ? itensVisiveis() : [];
  $('ap-empty').classList.toggle('hidden', !(S && S.disponivel && !itens.length));
  // keyed update: untouched cards keep their DOM (focus in the reason box and text selection survive the poll)
  const vistos = new Set();
  let antes = null;
  for (let k = itens.length - 1; k >= 0; k--) {
    const it = itens[k];
    vistos.add(it.chave);
    const html = htmlCartao(it);
    let el = lista.querySelector(`article[data-chave="${CSS.escape(it.chave)}"]`);
    if (!el || el.__html !== html) {
      const novo = document.createElement('div');
      novo.innerHTML = html;
      const card = novo.firstElementChild;
      card.__html = html;
      if (el) el.replaceWith(card); else lista.insertBefore(card, antes);
      el = card;
      if (pedindo && pedindo.chave === it.chave) {
        const inp = el.querySelector('.ap-motivo');
        if (inp && document.activeElement !== inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }
    } else if (el.nextElementSibling !== antes) {
      lista.insertBefore(el, antes);
    }
    antes = el;
  }
  for (const el of [...lista.querySelectorAll('article[data-chave]')]) if (!vistos.has(el.dataset.chave)) el.remove();
}

function renderPill() {
  const b = $('btn-aprovar');
  const ok = !!(S && S.disponivel);
  b.classList.toggle('hidden', !ok);
  const n = ok ? S.n : 0;
  const badge = $('ap-badge');
  badge.textContent = String(n);
  badge.classList.toggle('hidden', !n);
  b.classList.toggle('has', n > 0);
  if (ultimoN !== null && n > ultimoN) { badge.classList.remove('pulse'); void badge.offsetWidth; badge.classList.add('pulse'); }
  ultimoN = n;
}

async function carregarDetalhe(chave) {
  try {
    const r = await fetch('api/aprovacao/detalhe?chave=' + encodeURIComponent(chave), { cache: 'no-store' });
    const j = await r.json();
    detalhes[chave] = j.ok ? { texto: j.texto, cortado: j.cortado } : { erro: j.erro || String(r.status) };
  } catch (e) {
    detalhes[chave] = { erro: e.message || String(e) };
  }
  render();
}

async function decidir(chave, acao, motivo = '') {
  if (enviando.has(chave)) return;
  const item = (S && S.itens || []).find((i) => i.chave === chave);
  enviando.add(chave);
  delete erros[chave];
  pedindo = null;
  render();
  try {
    const r = await fetch('api/aprovacao', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, acao, motivo }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || r.status);
    if (item) {
      feitos.set(chave, { item, acao, texto: j.feito || '' });
      setTimeout(() => { feitos.delete(chave); render(); }, 2600);
    }
    if (S && S.itens) { S.itens = S.itens.filter((i) => i.chave !== chave); S.n = S.itens.length; }
    renderPill();
    if (aoDecidir) aoDecidir();
  } catch (e) {
    erros[chave] = t('ap_erro') + (e.message || e);
  }
  enviando.delete(chave);
  render();
}

// ---------------------------------------------------------------- public
export function isAprovacaoOpen() { return !$('aprovacao').classList.contains('hidden'); }

export async function openAprovacao() {
  $('aprovacao').classList.remove('hidden');
  render();
  setTimeout(() => $('ap-close').focus(), 0);
  try {  // whether this computer may decide (the state poll does not say)
    const r = await fetch('api/aprovacao', { cache: 'no-store' });
    const j = await r.json();
    permitido = j.allowed !== false;
    S = { ...j };
  } catch (_) { /* offline: the poll will tell */ }
  renderPill();
  render();
}

export function closeAprovacao() {
  $('aprovacao').classList.add('hidden');
  pedindo = null;
}

export function refreshAprovacao() { renderPill(); render(); }

export function aprovacaoKey(e) {  // keyboard while the window is open; true when handled
  if (!isAprovacaoOpen()) return false;
  if (e.target && e.target.classList && e.target.classList.contains('ap-motivo')) {
    if (e.key === 'Escape') { pedindo = null; render(); e.preventDefault(); return true; }
    if (e.key === 'Enter') { e.preventDefault(); const p = pedindo; if (p) decidir(p.chave, p.acao, e.target.value); return true; }
    if (pedindo) pedindo.motivo = e.target.value;
    return true;
  }
  if (e.key === 'Escape') { closeAprovacao(); return true; }
  return true;  // office shortcuts stay off while the window is open
}

/** For the 3D scene and the agent card: who gets the badge and how many wait. */
export function filaResumo() {
  return S && S.disponivel ? { agente: S.agente || 'arquiteto', n: S.n || 0, trava: !!S.trava } : null;
}

export function updateAprovacao(state) {
  if (!state) return;
  repo = (state.cadeia && state.cadeia.github) || '';
  if (state.aprovacao) {
    S = state.aprovacao;
    for (const k of Object.keys(erros)) if (!S.itens.some((i) => i.chave === k)) delete erros[k];
    for (const k of [...aberto]) if (!S.itens.some((i) => i.chave === k) && !feitos.has(k)) { aberto.delete(k); delete detalhes[k]; }
    if (pedindo && !S.itens.some((i) => i.chave === pedindo.chave)) pedindo = null;
  }
  renderPill();
  render();
}

export function setupAprovacao({ onDecidiu, onAbrirAgente } = {}) {
  aoDecidir = onDecidiu || null;
  aoAbrirAgente = onAbrirAgente || null;
  $('btn-aprovar').onclick = () => (isAprovacaoOpen() ? closeAprovacao() : openAprovacao());
  $('ap-close').onclick = closeAprovacao;
  $('ap-arch').onclick = () => { closeAprovacao(); if (aoAbrirAgente) aoAbrirAgente(S && S.agente || 'arquiteto'); };
  $('aprovacao').addEventListener('mousedown', (e) => { if (e.target.id === 'aprovacao') closeAprovacao(); });
  $('ap-list').addEventListener('input', (e) => { if (e.target.classList.contains('ap-motivo') && pedindo) pedindo.motivo = e.target.value; });
  $('ap-list').addEventListener('click', (e) => {
    const card = e.target.closest('article[data-chave]');
    if (!card || card.classList.contains('done')) return;
    const chave = card.dataset.chave;
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.x === 'ver') {
      if (aberto.has(chave)) aberto.delete(chave);
      else { aberto.add(chave); if (!detalhes[chave]) carregarDetalhe(chave); }
      render();
      return;
    }
    if (b.dataset.x === 'cancelar') { pedindo = null; render(); return; }
    if (b.dataset.x === 'confirmar') { const inp = card.querySelector('.ap-motivo'); decidir(chave, pedindo ? pedindo.acao : 'r', inp ? inp.value : ''); return; }
    if (b.dataset.a === 'a') { decidir(chave, 'a'); return; }
    if (b.dataset.a === 'r' || b.dataset.a === 'b') { pedindo = { chave, acao: b.dataset.a, motivo: '' }; render(); }
  });
}
