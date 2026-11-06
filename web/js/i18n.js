// Tiny i18n: Portuguese (BR) and English.
const STR = {
  pt: {
    model: 'Modelo', runs_today: 'Execuções hoje', messages_today: 'Mensagens hoje', last_activity: 'Última atividade',
    schedules: 'Agendamentos', recent: 'Recentes', feed: 'Movimento do escritório', overview: 'Visão geral', follow: 'Seguir',
    hint: 'arraste para girar · roda para zoom · clique num agente', loading: 'Abrindo o escritório…',
    open: 'escritório aberto', closed: 'escritório fechado', connecting: 'conectando…', connected: 'ao vivo', disconnected: 'sem conexão com o servidor',
    status: { working: 'trabalhando', idle: 'livre', sleeping: 'dormindo', error: 'com problema', offline: 'desligado' },
    none: 'nenhum', never: 'nunca', next: 'próx.',
    talk: 'Falar com o agente', typing_label: 'respondendo…', as_demand: 'Registrar como demanda (plano → Dev → Reviewer)', send: 'Enviar',
    chat_ph: 'Escreva a ordem ou a pergunta… (Enter envia, Shift+Enter quebra linha)', chat_remote: 'conversa só pelo computador do escritório', sent_demand: 'registrado como demanda: ', chat_err: 'não enviado: ',
    leisure: {
      walk: ['Dando uma volta', 'Esticando as pernas', 'Passeando'],
      coffee: ['Tomando um café', 'Pausa para o café', 'Café fresquinho'],
      water: ['Bebendo água', 'Um copo d\u2019água'],
      table: ['Lanchinho na copa', 'Papo na copa', 'Pausa na copa'],
      sofa: ['Descansando no sofá', 'Relaxando um pouco', 'Olhando o celular'],
      board: ['Pensando no quadro', 'Rabiscando ideias'],
      chat: ['Batendo papo', 'Trocando ideias'],
      window: ['Olhando a janela'],
    },
    sleep: 'Zzz…', typing: '…', error: '!',
  },
  en: {
    model: 'Model', runs_today: 'Runs today', messages_today: 'Messages today', last_activity: 'Last activity',
    schedules: 'Schedules', recent: 'Recent', feed: 'Office activity', overview: 'Overview', follow: 'Follow',
    hint: 'drag to orbit · wheel to zoom · click an agent', loading: 'Opening the office…',
    open: 'office open', closed: 'office closed', connecting: 'connecting…', connected: 'live', disconnected: 'no connection to the server',
    status: { working: 'working', idle: 'free', sleeping: 'sleeping', error: 'in trouble', offline: 'offline' },
    none: 'none', never: 'never', next: 'next',
    talk: 'Talk to the agent', typing_label: 'answering…', as_demand: 'Register as a demand (plan → Dev → Reviewer)', send: 'Send',
    chat_ph: 'Write the order or the question… (Enter sends, Shift+Enter for a new line)', chat_remote: 'chat only from the office computer', sent_demand: 'registered as demand: ', chat_err: 'not sent: ',
    leisure: {
      walk: ['Taking a walk', 'Stretching the legs', 'Wandering'],
      coffee: ['Getting coffee', 'Coffee break', 'Fresh coffee'],
      water: ['Drinking water', 'A glass of water'],
      table: ['Snack in the kitchen', 'Kitchen chat', 'Kitchen break'],
      sofa: ['Resting on the sofa', 'Chilling a bit', 'Checking the phone'],
      board: ['Thinking at the board', 'Sketching ideas'],
      chat: ['Chatting', 'Trading ideas'],
      window: ['Looking outside'],
    },
    sleep: 'Zzz…', typing: '…', error: '!',
  },
};

export let lang = 'pt';

export function setLang(l) {
  lang = STR[l] ? l : 'pt';
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = STR[lang][el.dataset.i18n];
    if (v) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    const v = STR[lang][el.dataset.i18nPh];
    if (v) el.placeholder = v;
  }
  try { localStorage.setItem('my3dlobby.lang', lang); } catch (_) {}
}

export function t(key) {
  const v = STR[lang][key];
  return v === undefined ? key : v;
}

export function initialLang(serverPref) {
  let saved = null;
  try { saved = localStorage.getItem('my3dlobby.lang'); } catch (_) {}
  if (saved && STR[saved]) return saved;
  const q = new URLSearchParams(location.search).get('lang');
  if (q && STR[q]) return q;
  if (serverPref && STR[serverPref]) return serverPref;
  return (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}
