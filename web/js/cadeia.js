// Cadeia — where every item of the agent chain is and who has it now.
// One column per owner (Você, Arquiteto, Dev, Revisão, Concluído, Backlog), each in the agent's own colour; a plan
// that cannot start says which plan it waits for and who has that one. The data comes with /api/state (cadeia.itens,
// built by the same rules as the queue scripts) and the history with cadeia.eventos.
// "Você" is exactly the "Esperando você" list (decisions + PRs to merge), and its cards carry the same buttons:
// they act through aprovacao.js, so a click here and a click in the queue window are the same thing.
import { t } from './i18n.js';
import { acaoFila, itemFila, mergeFila, estadoAcao, botoesDecisao, botoesMerge, depTexto, aoMudar, pedirMerge, cancelarMerge } from './aprovacao.js';

const $ = (id) => document.getElementById(id);
const fmt = (s, o = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fold(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function ler(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function gravar(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }

let S = null;
let busca = '';
let comHistorico = ler('my3dlobby.cadeia.hist', '1') !== '0';
const abertos = new Set();
let confirmaRecusa = null;   // chave whose "refuse?" confirmation is open
let aoAbrirFila = null;
let aoVerAgente = null;

const COLUNAS = [
  { id: 'alex', donos: ['alex'] },
  { id: 'arquiteto', donos: ['arquiteto'] },
  { id: 'dev', donos: ['dev'] },
  { id: 'revisao', donos: ['conferente', 'reviewer'] },
  { id: 'fim', donos: ['fim', 'backlog'] },  // done and backlog share the last column (both are out of the flow)
];
const COR_FIXA = { alex: '#f2c14e', fim: '#35d07f', backlog: '#7b8496' };
const COR_PADRAO = { arquiteto: '#d8663b', dev: '#c9a227', reviewer: '#8c5bd8', conferente: '#3fa7a0', zap: '#2f8f6f', financeiro: '#3b6fd8' };
// order inside a column: what is moving first, then what waits, oldest first
const PESO = {
  merge: 0, decidir: 1, 'voltou-parado': 2, segurado: 3, aprovar: 4, 'aprovar-volta': 5,
  avaliando: 0, escrevendo: 1, corrigindo: 2, 'voltou-corrigir': 3, corrigir: 4, 'fila-arquiteto': 5,
  executando: 0, devolvido: 1, 'fila-dev': 2, bloqueado: 3,
  revisando: 0, 'fila-reviewer': 1, conferindo: 2, 'pr-aberto': 3, triagem: 4,
};
const AO_VIVO = new Set(['executando', 'revisando', 'conferindo', 'avaliando', 'escrevendo', 'corrigindo', 'triagem']);
const PEDE_ALEX = new Set(['aprovar', 'aprovar-volta', 'decidir', 'segurado', 'voltou-parado', 'merge']);

function agente(id) { return ((S && S.agents) || []).find((a) => a.id === id); }
export function corDono(dono) { return COR_FIXA[dono] || (agente(dono) || {}).color || COR_PADRAO[dono] || '#7c8cff'; }
function nomeDono(dono) {
  if (dono === 'alex') return t('cd_voce');
  const a = agente(dono);
  return a ? a.name : ((t('cd_nomes') || {})[dono] || dono || '?');
}
function etapaTexto(it) {
  return fmt((t('cd_etapa') || {})[it.etapa] || it.etapa || it.status, { pr: it.pr ? '#' + it.pr : '', c: it.ciclos || '1' });
}
function ha(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const v = min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : fmt(t('ap_dias'), { n: Math.round(min / 1440) });
  return fmt(t('cv_ago'), { t: v });
}
function hhmm(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hoje = d.toDateString() === new Date().toDateString();
  return (hoje ? '' : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function prLink(pr) {
  if (!pr) return '';
  const repo = S && S.cadeia && S.cadeia.github;
  return repo ? `<a class="cd-pr" href="https://github.com/${esc(repo)}/pull/${esc(pr)}" target="_blank" rel="noopener">PR #${esc(pr)}</a>` : `<span class="cd-pr">PR #${esc(pr)}</span>`;
}

// ---------------------------------------------------------------- history: who did what
const ORIGEM_ITEM = (e) => (String(e.id).startsWith('SENT') ? 'sentinela' : 'zap');
export function evento(e) {
  const T = t('cd_ev') || {};
  const tt = e.titulo || e.id;
  const pr = e.pr ? '#' + e.pr : '';
  const de = e.de || '';
  let quem = '';
  let txt = '';
  if (e.tipo === 'inicio') return { quem: '', txt: fmt(T.inicio, { n: e.n }) };
  if (e.tipo === 'item' || e.tipo === 'demanda') {
    if (e.para === 'novo') { quem = e.tipo === 'item' ? ORIGEM_ITEM(e) : 'alex'; txt = T.chegou; }
    else if (e.para === 'em-triagem') { quem = 'conferente'; txt = T.triagem; }
    else if (e.para === 'em-avaliacao') { quem = 'arquiteto'; txt = T.avaliando; }
    else if (e.para === 'avaliado') { quem = 'arquiteto'; txt = T.avaliado; }
    else if (e.para === 'descartado') { quem = 'alex'; txt = T.recusou; }
    else if (e.para === 'backlog') { quem = 'alex'; txt = T.backlog; }
  } else if (e.tipo === 'retorno') {
    if (e.para === 'novo') { quem = 'alex'; txt = T.volta_nova; }
    else if (e.para === 'em-avaliacao') { quem = 'arquiteto'; txt = T.corrigindo; }
    else if (e.para === 'avaliado') { quem = 'arquiteto'; txt = T.corrigiu; }
  } else {
    const p = e.para;
    if (p === 'rascunho') { quem = 'arquiteto'; txt = T.rascunho; }
    else if (p === 'pronto') {
      if (de === 'aguardando-alex' || de === 'aguardando-aprovacao') { quem = 'alex'; txt = T.aprovou_dev; }
      else if (de === 'escalar-arquiteto') { quem = 'arquiteto'; txt = T.de_volta_dev; }
      else { quem = 'arquiteto'; txt = T.pronto; }
    } else if (p === 'em-execucao') { quem = 'dev'; txt = T.dev_comecou; }
    else if (p === 'em-revisao') {
      if (de === 'aguardando-alex' || de === 'aguardando-aprovacao') { quem = 'alex'; txt = T.aprovou_rev; }
      else { quem = 'dev'; txt = T.pr_aberto; }
    } else if (p === 'conferindo') { quem = 'conferente'; txt = T.conferindo; }
    else if (p === 'revisando') { quem = 'reviewer'; txt = T.revisando; }
    else if (p === 'devolvido') { quem = 'reviewer'; txt = T.devolvido; }
    else if (p === 'aprovado') { quem = 'reviewer'; txt = T.aprovado; }
    else if (p === 'escalar-arquiteto') {
      if (de === 'revisando' || de === 'em-revisao' || de === 'conferindo') { quem = 'reviewer'; txt = T.reviewer_voltou; }
      else { quem = 'dev'; txt = T.dev_voltou; }
    } else if (p === 'aguardando-alex') { quem = de === 'em-execucao' ? 'dev' : 'arquiteto'; txt = T.pede; }
    else if (p === 'aguardando-aprovacao') { quem = 'alex'; txt = T.segurado; }
    else if (p === 'concluido') { quem = 'alex'; txt = T.concluido; }
    else if (p === 'descartado') {
      if (['aguardando-alex', 'aguardando-aprovacao', 'escalar-arquiteto'].includes(de)) { quem = 'alex'; txt = T.recusou; }
      else { quem = 'arquiteto'; txt = T.descartado; }
    } else if (p === 'backlog') { quem = 'alex'; txt = T.backlog; }
  }
  if (!txt) { txt = T.outro; quem = quem || ''; }
  return { quem, txt: fmt(esc(txt), { t: '<b>' + esc(tt) + '</b>', pr: esc(pr), c: esc(e.ciclos || '1'), de: esc(de || '—'), para: esc(e.para) }) };
}

// ---------------------------------------------------------------- render
function itens() {
  const todos = (S && S.cadeia && S.cadeia.itens) || [];
  if (!busca) return todos;
  const q = fold(busca);
  return todos.filter((i) => fold(`${i.titulo} ${i.id} ${i.pr ? '#' + i.pr : ''} ${i.origem}`).includes(q));
}

function cartao(it) {
  const k = `${it.tipo}:${it.id}`;
  const aberto = abertos.has(k);
  const vivo = AO_VIVO.has(it.etapa);
  const cls = ['cd-card', aberto ? 'open' : '', it.etapa === 'bloqueado' ? 'blocked' : '', vivo ? 'live' : '', PEDE_ALEX.has(it.etapa) ? 'ask' : ''].filter(Boolean).join(' ');
  const alvo = it.chave ? ` data-chave="${esc(it.chave)}"` : it.merge ? ` data-merge="${esc(it.merge)}"` : '';
  let h = `<article class="${cls}" data-k="${esc(k)}"${alvo} style="--c:${corDono(it.dono)}" tabindex="0">`;
  h += `<div class="cd-etapa">${vivo ? '<span class="cd-live"></span>' : ''}<span>${esc(etapaTexto(it))}</span>`;
  if (it.posicao) h += `<span class="cd-pos">${esc(fmt(t('cd_pos'), { n: it.posicao }))}</span>`;
  h += '</div>';
  h += `<div class="cd-titulo">${esc(it.titulo)}</div>`;
  if (it.espera) {
    const e = it.espera;
    const quem = e.dono ? `<span class="cd-chip" style="--c:${corDono(e.dono)}">${esc(nomeDono(e.dono))} · ${esc(etapaTexto(e))}</span>` : `<span class="cd-chip">${esc(t('cd_sumiu'))}</span>`;
    h += `<div class="cd-espera"><span class="cd-espera-l">${esc(t('cd_espera'))}</span> ${esc(e.titulo)} ${quem}</div>`;
  }
  const meta = [`<span class="cd-tipo">${esc((t('cd_tipo') || {})[it.tipo] || it.tipo)}</span>`];
  if (it.desde) meta.push(`<span title="${esc(hhmm(it.desde))}">${esc(ha(it.desde))}</span>`);
  if (it.pr) meta.push(prLink(it.pr));
  if (+it.ciclos > 0) meta.push(esc(fmt(t('cd_ciclo'), { c: it.ciclos })));
  h += `<div class="cd-meta">${meta.join('<i>·</i>')}</div>`;
  h += acoes(it);
  if (aberto) h += detalhe(it);
  return h + '</article>';
}

/** Buttons right on the card for what waits for Alex (decide, back to the Dev, merge). */
function acoes(it) {
  const chave = it.chave || it.merge;
  if (!chave) return '';
  const st = estadoAcao(chave);
  if (st.feito) {
    return `<div class="cd-feito"><b>${esc((t('ap_feito') || {})[st.feito.acao] || '')}</b> <span>${esc(st.feito.texto)}</span></div>`;
  }
  let h = '';
  if (it.merge) {
    const m = mergeFila(it.merge);
    if (!m) return '';
    const aviso = (t('ap_merge_estado') || {})[m.estado];
    if (aviso) h += `<div class="cd-aviso">${esc(aviso)}</div>`;
    if (m.libera && m.libera.length) h += `<div class="cd-dep"><b>${esc(t('ap_libera'))}</b> ${esc(m.libera.join(' · '))}</div>`;
    h += `<div class="cd-acts">${botoesMerge(m, 'cd-b')}</div>`;
  } else {
    const f = itemFila(it.chave);
    if (!f) return '';
    if (f.depende) h += `<div class="cd-dep">${depTexto(f)}</div>`;
    h += confirmaRecusa === it.chave
      ? `<div class="cd-acts"><span class="cd-conf-t">${esc(t('ap_recusar'))}?</span><button class="cd-b" data-x="recusa-nao">${esc(t('ap_cancelar'))}</button>`
        + `<button class="cd-b danger" data-x="recusa-sim">${esc(t('cd_confirmar'))}</button></div>`
      : `<div class="cd-acts">${botoesDecisao(f, 'cd-b')}</div>`;
  }
  if (st.erro) h += `<div class="cd-erro">${esc(st.erro)}</div>`;
  return h;
}

function detalhe(it) {
  const evs = ((S && S.cadeia && S.cadeia.eventos) || []).filter((e) => e.id === it.id).slice(-8).reverse();
  let h = '<div class="cd-det">';
  h += `<div class="cd-det-l">${esc(t('cd_id'))} <code>${esc(it.id)}</code></div>`;
  if (it.origem) h += `<div class="cd-det-l">${esc(t('cd_origem'))} ${esc(it.origem)}</div>`;
  if (evs.length) {
    h += `<div class="cd-det-h">${esc(t('cd_linha'))}</div><ul class="cd-mini">`;
    for (const e of evs) { const v = evento(e); h += `<li><time>${esc(hhmm(e.t))}</time><i style="background:${corDono(v.quem)}"></i><span>${v.txt}</span></li>`; }
    h += '</ul>';
  }
  const botoes = [];
  if (PEDE_ALEX.has(it.etapa)) botoes.push(`<button class="cd-b primary" data-x="fila">${esc(t('ap_panel_abrir'))}</button>`);
  if (agente(it.dono)) botoes.push(`<button class="cd-b" data-x="agente" data-a="${esc(it.dono)}">${esc(fmt(t('cd_ver'), { n: nomeDono(it.dono) }))}</button>`);
  if (botoes.length) h += `<div class="cd-det-b">${botoes.join('')}</div>`;
  return h + '</div>';
}

function cabecaColuna(col, lista) {
  const titulo = (t('cd_col') || {})[col.id] || col.id;
  const sub = (t('cd_col_sub') || {})[col.id] || '';
  const pontos = col.donos.map((d) => `<i style="background:${corDono(d)}"></i>`).join('');
  const nomes = col.id === 'revisao' ? col.donos.map(nomeDono).join(' + ') : col.id === 'fim' ? (t('cd_col_fim2') || titulo) : titulo;
  let extra = '';
  if (col.id === 'alex') {
    const m = lista.filter((i) => i.merge || i.etapa === 'merge').length;
    if (lista.length) extra = fmt(t('ap_n_det'), { a: lista.length - m, m });
  }
  if (col.id === 'dev') {
    const ex = lista.filter((i) => i.etapa === 'executando' || i.etapa === 'devolvido').length;
    const fi = lista.filter((i) => i.etapa === 'fila-dev').length;
    const pa = lista.filter((i) => i.etapa === 'bloqueado').length;
    extra = [ex ? fmt(t('cd_dev_ex'), { n: ex }) : '', fi ? fmt(t('cd_dev_fila'), { n: fi }) : '', pa ? fmt(t('cd_dev_parados'), { n: pa }) : ''].filter(Boolean).join(' · ');
  }
  return `<header class="cd-col-h"><div class="cd-col-t"><span class="cd-dots">${pontos}</span><b>${esc(nomes)}</b><span class="cd-n">${lista.length}</span></div>`
    + `<small>${esc(extra || sub)}</small></header>`;
}

function render() {
  if (!isCadeiaOpen()) return;
  const c = (S && S.cadeia) || {};
  const todos = itens();
  const cols = $('cd-cols');
  const vazio = !(c.itens || []).length;
  $('cd-msg').classList.toggle('hidden', !vazio && c.ok !== false);
  $('cd-msg').textContent = c.ok === false ? fmt(t('cv_board_off'), { p: '' }) : t('cd_vazio');
  let html = '';
  for (const col of COLUNAS) {
    const lista = todos.filter((i) => col.donos.includes(i.dono));
    lista.sort((a, b) => {
      if (col.id === 'fim' || col.id === 'backlog') return String(b.desde).localeCompare(String(a.desde));
      const pa = PESO[a.etapa] ?? 9, pb = PESO[b.etapa] ?? 9;
      if (pa !== pb) return pa - pb;
      if (a.posicao && b.posicao) return a.posicao - b.posicao;
      return String(a.desde).localeCompare(String(b.desde));
    });
    let corpo;
    if (col.id === 'fim') {
      const sec = (dono) => {
        const l = lista.filter((i) => i.dono === dono);
        return `<div class="cd-sub" style="--c:${corDono(dono)}"><i></i>${esc((t('cd_col') || {})[dono] || dono)}<span>${l.length}</span></div>`
          + (l.length ? l.map(cartao).join('') : `<div class="cd-nada">${esc(t('cd_nada'))}</div>`);
      };
      corpo = sec('fim') + sec('backlog');
    } else {
      corpo = lista.length ? lista.map(cartao).join('') : `<div class="cd-nada">${esc(t('cd_nada'))}</div>`;
    }
    html += `<section class="cd-col c-${col.id}" style="--c:${corDono(col.donos[0])}">${cabecaColuna(col, lista)}<div class="cd-col-b">${corpo}</div></section>`;
  }
  if (cols.__html !== html) {
    const scrolls = [...cols.querySelectorAll('.cd-col-b')].map((e) => e.scrollTop);
    cols.innerHTML = html;
    cols.__html = html;
    [...cols.querySelectorAll('.cd-col-b')].forEach((e, i) => { e.scrollTop = scrolls[i] || 0; });
  }
  const trava = $('cd-trava');
  trava.className = 'ap-trava ' + (c.trava ? 'on' : 'off');
  trava.innerHTML = `<span class="pdot"></span>${esc(c.trava ? t('ap_trava_on') : t('ap_trava_off'))}`;
  const hist = $('cd-hist');
  hist.classList.toggle('hidden', !comHistorico);
  $('cd-hist-btn').classList.toggle('on', comHistorico);
  if (comHistorico) {
    const evs = (c.eventos || []).filter((e) => e.tipo !== 'inicio').slice(-60).reverse();
    let hh = `<h4>${esc(t('cd_hist'))}</h4>`;
    hh += evs.length ? '<ul class="cd-ev">' + evs.map((e) => {
      const v = evento(e);
      return `<li><time>${esc(hhmm(e.t))}</time><span class="cd-ev-q" style="--c:${corDono(v.quem)}">${esc(v.quem ? nomeDono(v.quem) : '—')}</span><span class="cd-ev-t">${v.txt}</span></li>`;
    }).join('') + '</ul>' : `<div class="cd-nada">${esc(t('cd_nada'))}</div>`;
    if (hist.__html !== hh) { hist.innerHTML = hh; hist.__html = hh; }
  }
}

// ---------------------------------------------------------------- public
export function isCadeiaOpen() { return !$('cadeia').classList.contains('hidden'); }
export function openCadeia() { $('cadeia').classList.remove('hidden'); render(); setTimeout(() => $('cd-close').focus(), 0); }
export function closeCadeia() { $('cadeia').classList.add('hidden'); }
export function refreshCadeia() { const c = $('cd-cols'); if (c) c.__html = null; render(); }
export function updateCadeia(state) { S = state; render(); }
export function cadeiaKey(e) {
  if (!isCadeiaOpen()) return false;
  if (e.target && e.target.id === 'cd-q') { if (e.key === 'Escape') { e.target.blur(); return true; } return true; }
  if (e.key === 'Escape') { closeCadeia(); return true; }
  return true;
}
export function setupCadeia({ onAbrirFila, onVerAgente } = {}) {
  aoAbrirFila = onAbrirFila || null;
  aoVerAgente = onVerAgente || null;
  $('cd-close').onclick = closeCadeia;
  $('cadeia').addEventListener('mousedown', (e) => { if (e.target.id === 'cadeia') closeCadeia(); });
  $('cd-q').addEventListener('input', () => { busca = $('cd-q').value.trim(); render(); });
  $('cd-hist-btn').onclick = () => { comHistorico = !comHistorico; gravar('my3dlobby.cadeia.hist', comHistorico ? '1' : '0'); render(); };
  aoMudar(() => refreshCadeia());
  $('cd-cols').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const b = e.target.closest('button');
    if (b) {
      const card = b.closest('article[data-k]');
      const chave = card && (card.dataset.chave || card.dataset.merge);
      if (b.disabled) return;
      if (b.dataset.x === 'fila' && aoAbrirFila) { closeCadeia(); aoAbrirFila(); }
      else if (b.dataset.x === 'agente' && aoVerAgente) { closeCadeia(); aoVerAgente(b.dataset.a); }
      else if (b.dataset.x === 'recusa-nao') { confirmaRecusa = null; refreshCadeia(); }
      else if (b.dataset.x === 'recusa-sim' && chave) { confirmaRecusa = null; acaoFila(chave, 'r'); }
      else if (b.dataset.x === 'merge-nao') { cancelarMerge(); }
      else if (b.dataset.x === 'merge-sim' && chave) { acaoFila(chave, 'm'); }
      else if (b.dataset.a === 'm' && chave) { pedirMerge(chave); }
      else if (b.dataset.a === 'r' && chave) { confirmaRecusa = chave; refreshCadeia(); }
      else if (b.dataset.a && chave) { acaoFila(chave, b.dataset.a); }
      return;
    }
    if (String(window.getSelection ? window.getSelection() : '').trim()) return;
    const card = e.target.closest('article[data-k]');
    if (!card) return;
    const k = card.dataset.k;
    if (abertos.has(k)) abertos.delete(k); else abertos.add(k);
    render();
  });
  $('cd-cols').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('article[data-k]');
    if (!card || e.target !== card) return;
    e.preventDefault();
    card.click();
  });
}
