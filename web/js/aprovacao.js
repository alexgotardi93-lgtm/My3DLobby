// Esperando você — everything that waits for Alex: what reached the Arquiteto (may it become a plan?), plans that
// ask for a decision or came back, and PRs the Reviewer approved, waiting for his merge.
// The list comes with /api/state (aprovacao) every few seconds; a click is POST /api/aprovacao, which runs the
// chain's own fila_aprovacao.py (the same program as "Aprovar fila do Arquiteto.command"), or merges the PR with
// the Mac's gh. The Cadeia board shows the same list under "Você" and uses acaoFila() for its buttons.
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
let confirmaMerge = null;     // chave whose "merge into main?" confirmation is open
const ouvintes = [];          // the board re-renders when a decision starts or ends
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
  if (it.tipo === 'plano') {
    if (it.status === 'aguardando-aprovacao') return t('ap_o').plano_segurado;
    if (it.status === 'escalar-arquiteto') return t('ap_o').plano_volta;
    return t('ap_o').plano;
  }
  return t('ap_o')[it.origem] || it.origem;
}
const ehPlano = (it) => it.tipo === 'plano';
const voltou = (it) => it.tipo === 'plano' && it.status === 'escalar-arquiteto';
export function rotuloAprovar(it) { return (t('ap_ok') || {})[ehPlano(it) ? it.status : it.tipo] || t('ap_aprovar'); }
const ICONE = { a: '✓', r: '×', b: '↓', d: '↺', m: '⇥' };

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

export function dica(it) {
  if (it.tipo === 'plano' && it.status === 'aguardando-alex') return t('ap_dica_plano');
  if (voltou(it) && it.depende && it.dep_ok) return t('ap_dica_volta_ok');
  if (voltou(it) && it.depende && it.dep_status === 'aprovado' && it.dep_pr) return tr(t('ap_dica_volta_merge'), { pr: '#' + it.dep_pr });
  if (voltou(it)) return t('ap_dica_volta');
  if (it.tipo === 'plano') return t('ap_dica_segurado');
  if (it.tipo === 'retorno') return t('ap_dica_retorno');
  return t('ap_dica_item');
}

function htmlCartao(it) {
  const f = feitos.get(it.chave);
  if (f) {
    return `<article class="ap-card done ${esc(f.acao)}" data-chave="${esc(it.chave)}"><div class="ap-done">`
      + `<span class="ap-done-ic">${ICONE[f.acao] || '✓'}</span>`
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
  if (it.depende) h += `<div class="ap-dep">${depTexto(it)}</div>`;
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
    h += `<div class="ap-actions"><button class="ap-link" data-x="ver">${esc(abrir ? t('ap_menos') : t('ap_ver'))}</button><span class="ap-sp"></span>`
      + botoesDecisao(it, 'ap-b') + '</div>';
  }
  if (it.erro) h += `<div class="ap-err">${esc(it.erro)}</div>`;
  return h + '</article>';
}

/** Dependency line of a plan that came back: what it waits for and whether that is on main already. */
export function depTexto(it) {
  const nome = esc(it.dep_titulo || it.depende);
  const st = it.dep_ok ? `<span class="ap-ok">✓ ${esc(t('ap_dep_ok'))}</span>`
    : it.dep_status === 'aprovado' && it.dep_pr ? `<span class="ap-warn">${esc(tr(t('ap_dep_merge'), { pr: '#' + it.dep_pr }))}</span>`
      : `<span class="ap-warn">${esc(it.dep_status || '?')}</span>`;
  return `<b>${esc(t('ap_dep'))}</b> ${nome} · ${st}`;
}

/** The decision buttons of one item (shared with the board). `cls` is the button class of the host. */
export function botoesDecisao(it, cls) {
  const ocupado = enviando.has(it.chave);
  const dis = ocupado || !permitido ? ' disabled' : '';
  const spin = ocupado ? '<span class="spinner small"></span>' : '';
  let h = `<button class="${cls}" data-a="b"${dis}>${esc(t('ap_backlog'))}</button>`
    + `<button class="${cls} danger-outline" data-a="r"${dis}>${esc(t('ap_recusar'))}</button>`;
  if (voltou(it)) {
    // stopped on a dependency: once it is on main, trying again costs no Opus; before the merge, neither button is
    // the obvious one (merge first, the hint says so); with no dependency, the plan itself needs fixing
    const dep = !!it.depende;
    const corrigirP = !dep, devolverP = dep && !!it.dep_ok;
    h += `<button class="${cls}${corrigirP ? ' primary' : ''}" data-a="a"${dis}>${corrigirP ? spin : ''}${esc(t('ap_corrigir'))}</button>`
      + `<button class="${cls}${devolverP ? ' primary' : ''}" data-a="d"${dis}>${corrigirP ? '' : spin}${esc(t('ap_devolver'))}</button>`;
  } else {
    h += `<button class="${cls} primary" data-a="a"${dis}>${spin}${esc(rotuloAprovar(it))}</button>`;
  }
  return h;
}

/** The merge buttons of one PR (shared with the board): View PR, Merge -> confirmation -> merge. */
export function botoesMerge(m, cls) {
  const ocupado = enviando.has(m.chave);
  const url = m.url || (repo ? `https://github.com/${repo}/pull/${m.pr}` : '');
  const ver = url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('ap_ver_pr'))}</a>` : '';
  if (!S || !S.pode_merge) return ver;
  if (confirmaMerge === m.chave && !ocupado) {
    return `<span class="ap-conf-t">${esc(tr(t('ap_merge_conf'), { pr: '#' + m.pr }))}</span>`
      + `<button class="${cls}" data-x="merge-nao">${esc(t('ap_cancelar'))}</button>`
      + `<button class="${cls} primary" data-x="merge-sim">${esc(t('ap_merge_ok'))}</button>`;
  }
  const dis = ocupado || !permitido || m.estado === 'DIRTY' ? ' disabled' : '';
  return ver + `<button class="${cls} primary" data-a="m"${dis}>${ocupado ? '<span class="spinner small"></span>' : ''}${esc(t('ap_merge'))}</button>`;
}

function htmlMerge(m) {
  const f = feitos.get(m.chave);
  if (f) {
    return `<article class="ap-card done ${esc(f.acao)}" data-chave="${esc(m.chave)}"><div class="ap-done">`
      + `<span class="ap-done-ic">${ICONE[f.acao] || '✓'}</span><b>${esc(t('ap_feito')[f.acao])}</b> <span>${esc(m.titulo)}</span>`
      + `<small>${esc(f.texto)}</small></div></article>`;
  }
  let h = `<article class="ap-card merge${enviando.has(m.chave) ? ' busy' : ''}" data-chave="${esc(m.chave)}">`;
  h += `<div class="ap-top"><span class="ap-tag o-merge">${esc(t('ap_merge_tag'))}</span>${prLink(m.pr)}`
    + `<span class="ap-when">${esc(ha(m.quando_iso))}</span></div>`;
  h += `<h3 class="ap-title">${esc(m.titulo)}</h3>`;
  if (m.revisado) h += `<div class="ap-from">${esc(t('ap_revisado'))} ${esc(m.revisado)}</div>`;
  const aviso = (t('ap_merge_estado') || {})[m.estado];
  if (aviso) h += `<div class="ap-flag">${esc(aviso)}</div>`;
  if (m.libera && m.libera.length) h += `<div class="ap-dep"><b>${esc(t('ap_libera'))}</b> ${esc(m.libera.join(' · '))}</div>`;
  if (S && !S.pode_merge) h += `<div class="ap-hint">${esc(t('ap_sem_gh'))}</div>`;
  h += `<div class="ap-actions"><span class="ap-sp"></span>${botoesMerge(m, 'ap-b')}</div>`;
  if (erros[m.chave]) h += `<div class="ap-err">${esc(erros[m.chave])}</div>`;
  return h + '</article>';
}

const erros = {};  // chave -> last error of a decision

function itensVisiveis() {
  const lista = (S && S.itens ? S.itens : []).map((i) => ({ ...i, erro: erros[i.chave] || '' }));
  for (const [chave, f] of feitos) if (f.item.tipo !== 'merge' && !lista.some((i) => i.chave === chave)) lista.push(f.item);  // decided: stays a moment
  return lista;
}
function mergesVisiveis() {
  const lista = [...(S && S.merges ? S.merges : [])];
  for (const [chave, f] of feitos) if (f.item.tipo === 'merge' && !lista.some((i) => i.chave === chave)) lista.push(f.item);
  return lista;
}
function contagem() {
  const a = S ? (S.n_aprovar ?? (S.itens || []).length) : 0;
  const m = S ? (S.n_merge ?? (S.merges || []).length) : 0;
  const c = certPendentes().length;
  return { a, m, c, n: a + m, total: a + m + c };  // n = the Arquiteto's queue; total = everything for Alex
}

// ---------------------------------------------------------------- certidões (the Financeiro's program)
let certOcupado = false;
let certMsg = '';             // what the last "Já baixei" found
let certCopiado = '';         // chave whose CNPJ was just copied
const CNPJ_BPG = '59.456.359/0001-10';
function certPendentes() { return (S && S.certidoes && S.certidoes.pendencias) || []; }
function dataBr(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }

function htmlCert(p) {
  const dis = certOcupado || !permitido ? ' disabled' : '';
  let h = `<article class="ap-card cert${p.urgente ? ' urgente' : ''}${certOcupado ? ' busy' : ''}" data-chave="${esc(p.chave)}">`;
  h += `<div class="ap-top"><span class="ap-tag o-cert">${esc(t('ap_cert_tag'))}</span>`
    + (p.verificacao ? `<span class="ap-when">${esc(tr(t('ap_cert_verif'), { v: p.verificacao }))}</span>` : '') + '</div>';
  h += `<h3 class="ap-title">${esc(p.nome)}</h3>`;
  h += `<div class="ap-from">${esc(p.motivo)}</div>`;
  h += `<div class="ap-actions"><span class="ap-cnpj">CNPJ ${esc(CNPJ_BPG)}</span>`
    + `<button class="ap-b" data-x="cert-cnpj">${esc(certCopiado === p.chave ? t('ap_cert_copiado') : t('ap_cert_copiar'))}</button>`
    + `<span class="ap-sp"></span>`
    + (p.link ? `<a class="ap-b" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(t('ap_cert_abrir'))}</a>` : '')
    + `<button class="ap-b primary" data-x="cert-baixei"${dis}>${certOcupado ? '<span class="spinner small"></span>' : ''}${esc(t('ap_cert_baixei'))}</button></div>`;
  return h + '</article>';
}

function htmlCertResumo() {
  const c = S && S.certidoes;
  if (!c || !c.lista || !c.lista.length) return '';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const itens = c.lista.map((x) => {
    let cls = 'sem', txt = t('ap_cert_sem');
    if (x.validade) {
      const dias = Math.round((new Date(x.validade + 'T00:00:00') - hoje) / 86400000);
      cls = dias < 0 ? 'venc' : dias <= 7 ? 'perto' : 'ok';
      txt = tr(t('ap_cert_ate'), { d: dataBr(x.validade) });
    }
    const pos = x.situacao === 'positiva' || x.situacao === 'irregular';
    return `<li class="${pos ? 'venc' : cls}"><b>${esc(x.nome)}</b> <span>${esc(txt)}</span>`
      + `${x.auto ? `<em>${esc(t('ap_cert_auto'))}</em>` : ''}</li>`;
  }).join('');
  return `<ul class="ap-cert-lista">${itens}</ul>` + (certMsg ? `<div class="ap-hint">${esc(certMsg)}</div>` : '');
}

async function buscarCertidoes(chave) {
  if (certOcupado) return;
  certOcupado = true; certMsg = ''; render();
  try {
    const r = await fetch('api/aprovacao', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, acao: 'c', motivo: '' }) });
    const j = await r.json();
    certMsg = j.ok ? (j.feito || '') : t('ap_erro') + (j.erro || r.status);
    if (j.ok) {  // the server re-read the state: get it now instead of waiting for the next poll
      try { const r2 = await fetch('api/aprovacao', { cache: 'no-store' }); const j2 = await r2.json(); S = { ...j2 }; } catch (_) { /* next poll */ }
    }
  } catch (e) {
    certMsg = t('ap_erro') + (e.message || e);
  }
  certOcupado = false;
  renderPill(); render(); avisar();
}

/** For the Financeiro's sign in the office: how many certidões wait for Alex. */
export function certResumo() { return certPendentes().length; }

function render() {
  if (!isAprovacaoOpen()) return;
  const { a, m, n } = contagem();
  const { c, total } = contagem();
  const det = [m ? tr(t('ap_n_det'), { a, m }) : '', c ? tr(t('ap_n_cert'), { c }) : ''].filter(Boolean).join(' · ');
  $('ap-count').textContent = S && S.disponivel ? (total ? tr(t('ap_n'), { n: total }) + (det ? ' · ' + det : '') : t('ap_n0')) : '';
  const trava = $('ap-trava');
  trava.className = 'ap-trava ' + (S && S.trava ? 'on' : 'off');
  trava.innerHTML = S && S.disponivel ? `<span class="pdot"></span>${esc(S.trava ? t('ap_trava_on') : t('ap_trava_off'))}` : '';
  trava.title = S && !S.trava ? t('ap_trava_off_dica') : '';
  const msg = $('ap-msg');
  let aviso = '';
  if (!S) aviso = t('ap_lendo');
  else if (!S.disponivel) aviso = tr(t('ap_indisponivel'), { p: S.programa || '' });
  else if (S.erro) aviso = tr(t('ap_erro_ler'), { e: S.erro });
  if (!permitido) aviso = (aviso ? aviso + ' · ' : '') + t('ap_remoto');
  msg.textContent = aviso;
  msg.classList.toggle('hidden', !aviso);
  const itens = S && S.disponivel ? itensVisiveis() : [];
  const merges = S && S.disponivel ? mergesVisiveis() : [];
  const certs = S && S.disponivel ? certPendentes() : [];
  $('ap-empty').classList.toggle('hidden', !(S && S.disponivel && !itens.length && !merges.length && !certs.length));
  const temCert = !!(S && S.disponivel && S.certidoes && (certs.length || (S.certidoes.lista || []).length));
  $('ap-sec-cert').classList.toggle('hidden', !temCert);
  $('ap-cert-sub').classList.toggle('hidden', !certs.length);
  renderLista($('ap-list-cert'), certs, htmlCert);
  const resumo = temCert ? htmlCertResumo() : '';
  if ($('ap-cert-resumo').__html !== resumo) { $('ap-cert-resumo').innerHTML = resumo; $('ap-cert-resumo').__html = resumo; }
  const entradas = itens.filter((i) => !ehPlano(i));
  const planos = itens.filter(ehPlano);
  $('ap-sec-itens').classList.toggle('hidden', !entradas.length);
  $('ap-sec-planos').classList.toggle('hidden', !planos.length);
  renderLista($('ap-list-itens'), entradas);
  renderLista($('ap-list-planos'), planos);
  $('ap-sec-merge').classList.toggle('hidden', !merges.length);
  renderLista($('ap-list-merge'), merges, htmlMerge);
}

function renderLista(lista, itens, montar = htmlCartao) {
  // keyed update: untouched cards keep their DOM (focus in the reason box and text selection survive the poll)
  const vistos = new Set();
  let antes = null;
  for (let k = itens.length - 1; k >= 0; k--) {
    const it = itens[k];
    vistos.add(it.chave);
    const html = montar(it);
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
  const n = ok ? contagem().total : 0;
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

function avisar() { for (const f of ouvintes) { try { f(); } catch (_) { /* a listener must not break the queue */ } } }

async function decidir(chave, acao, motivo = '') {
  if (enviando.has(chave)) return;
  const item = acao === 'm' ? (S && S.merges || []).find((i) => i.chave === chave) : (S && S.itens || []).find((i) => i.chave === chave);
  enviando.add(chave);
  delete erros[chave];
  pedindo = null;
  confirmaMerge = null;
  render();
  avisar();
  try {
    const r = await fetch('api/aprovacao', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, acao, motivo }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro || r.status);
    if (item) {
      feitos.set(chave, { item, acao, texto: j.feito || '' });
      setTimeout(() => { feitos.delete(chave); render(); }, 2600);
    }
    if (S) {
      S.itens = (S.itens || []).filter((i) => i.chave !== chave);
      S.merges = (S.merges || []).filter((i) => i.chave !== chave);
      S.n_aprovar = S.itens.length; S.n_merge = S.merges.length; S.n = S.n_aprovar + S.n_merge;
    }
    renderPill();
    if (aoDecidir) aoDecidir();
  } catch (e) {
    erros[chave] = t('ap_erro') + (e.message || e);
  }
  enviando.delete(chave);
  render();
  avisar();
}

/** For the Cadeia board: act on an item of this list (same rules, same feedback). */
export function acaoFila(chave, acao, motivo = '') { return decidir(chave, acao, motivo); }
export function itemFila(chave) { return (S && S.itens || []).find((i) => i.chave === chave) || null; }
export function mergeFila(chave) { return (S && S.merges || []).find((i) => i.chave === chave) || null; }
export function estadoAcao(chave) { return { ocupado: enviando.has(chave), erro: erros[chave] || '', feito: feitos.get(chave) || null }; }
export function podeDecidir() { return permitido; }
export function pedirMerge(chave) { confirmaMerge = chave; render(); avisar(); }
export function cancelarMerge() { confirmaMerge = null; render(); avisar(); }
export function aoMudar(fn) { ouvintes.push(fn); }

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
  return S && S.disponivel ? { agente: S.agente || 'arquiteto', n: contagem().n, trava: !!S.trava } : null;
}

export function updateAprovacao(state) {
  if (!state) return;
  repo = (state.cadeia && state.cadeia.github) || '';
  if (state.aprovacao) {
    S = state.aprovacao;
    const todos = [...(S.itens || []), ...(S.merges || [])];
    for (const k of Object.keys(erros)) if (!todos.some((i) => i.chave === k)) delete erros[k];
    for (const k of [...aberto]) if (!todos.some((i) => i.chave === k) && !feitos.has(k)) { aberto.delete(k); delete detalhes[k]; }
    if (pedindo && !todos.some((i) => i.chave === pedindo.chave)) pedindo = null;
    if (confirmaMerge && !todos.some((i) => i.chave === confirmaMerge)) confirmaMerge = null;
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
  $('ap-listas').addEventListener('input', (e) => { if (e.target.classList.contains('ap-motivo') && pedindo) pedindo.motivo = e.target.value; });
  $('ap-listas').addEventListener('click', (e) => {
    const card = e.target.closest('article[data-chave]');
    if (!card || card.classList.contains('done')) return;
    const chave = card.dataset.chave;
    if (e.target.closest('a')) return;
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.x === 'cert-baixei') { buscarCertidoes(chave); return; }
    if (b.dataset.x === 'cert-cnpj') {
      const feito = () => { certCopiado = chave; render(); setTimeout(() => { certCopiado = ''; render(); }, 1800); };
      try { navigator.clipboard.writeText(CNPJ_BPG.replace(/\D/g, '')).then(feito, () => {}); } catch (_) { /* no clipboard */ }
      return;
    }
    if (b.dataset.x === 'ver') {
      if (aberto.has(chave)) aberto.delete(chave);
      else { aberto.add(chave); if (!detalhes[chave]) carregarDetalhe(chave); }
      render();
      return;
    }
    if (b.dataset.x === 'cancelar') { pedindo = null; render(); return; }
    if (b.dataset.x === 'confirmar') { const inp = card.querySelector('.ap-motivo'); decidir(chave, pedindo ? pedindo.acao : 'r', inp ? inp.value : ''); return; }
    if (b.dataset.x === 'merge-nao') { confirmaMerge = null; render(); avisar(); return; }
    if (b.dataset.x === 'merge-sim') { decidir(chave, 'm'); return; }
    if (b.dataset.a === 'm') { confirmaMerge = chave; render(); avisar(); return; }
    if (b.dataset.a === 'a' || b.dataset.a === 'd') { decidir(chave, b.dataset.a); return; }
    if (b.dataset.a === 'r' || b.dataset.a === 'b') { pedindo = { chave, acao: b.dataset.a, motivo: '' }; render(); }
  });
}
