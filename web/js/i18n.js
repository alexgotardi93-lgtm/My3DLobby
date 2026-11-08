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
    conversas: 'Conversas', cv_search: 'Pesquisar agente ou mensagem', cv_f_all: 'Todos', cv_f_working: 'Trabalhando', cv_f_unread: 'Não lidas',
    cv_pick: 'Escolha uma conversa', cv_pick_sub: 'Cada agente é um contato. Em cima de cada conversa fica fixo o que ele está fazendo agora; na Cadeia você acompanha cada plano do Arquiteto até o seu merge.',
    cv_agents: 'Agentes', cv_messages: 'Mensagens', cv_chain_hits: 'Na cadeia', cv_nothing: 'Nada encontrado para “{q}”',
    cv_you: 'Você', cv_typing: 'digitando…', cv_msg_ph: 'Mensagem — Enter envia, Shift+Enter quebra a linha', cv_send: 'Enviar',
    cv_show: 'Ver no escritório', cv_back: 'Voltar', cv_close: 'Fechar (Esc)', cv_open_chat: 'Abrir a conversa',
    cv_now: 'Agora', cv_steps: 'Últimos passos', cv_step_n: 'passo {n}', cv_step_lim: 'passo {n} de até {m}', cv_ago: 'há {t}',
    cv_free: 'Livre', cv_last_run: 'Última rodada terminou às {h} · {n} passos', cv_last_reply: 'Respondeu às {h} · {n} passos', cv_no_data: 'Ainda sem registro de atividade no Hermes',
    cv_stalled: 'Sem sinal há {t}: a rodada pode ter travado', cv_session: 'Rodada', cv_started: 'começou {h}', cv_model: 'modelo',
    cv_tasks: 'Lista do agente: {a} de {b} feitas', cv_task_now: 'agora: {x}', cv_said: 'Disse', cv_hermes: 'Hermes', cv_plan: 'Plano', cv_since: 'desde {h}',
    cv_chain: 'Cadeia', cv_chain_sub: 'Arquiteto → Dev → Reviewer → você', cv_chain_ro: 'Somente leitura. Para dar uma ordem, fale com o Arquiteto.', cv_open_arch: 'Abrir o Arquiteto',
    cv_board: 'Em andamento', cv_board_empty: 'Nada em andamento: a fila está vazia.', cv_board_off: 'Pasta da cadeia não encontrada ({p}).',
    cv_today: 'Hoje', cv_yesterday: 'Ontem', cv_more: 'ler mais', cv_less: 'mostrar menos', cv_seen: 'visto por último {h}',
    cv_chain_idle: 'Cadeia parada: nada na fila', cv_wait_you: '{n} esperando você', cv_in_queue: '{n} na fila do Dev', cv_pill_exec: 'Dev executando “{t}”',
    cv_local: 'local', cv_demand: 'Registrar como demanda (plano → Dev → Reviewer)', cv_empty_chat: 'Nenhuma mensagem ainda. Escreva abaixo para falar com {n}.',
    cv_no_agent_now: 'Sem rodada ativa agora', cv_working_on: 'Trabalhando', cv_chain_preview_none: 'nada em andamento',
    passo_estado: { ok: 'deu certo', erro: 'deu erro', rodando: 'em andamento', parou: 'interrompido' },
    estado: { executando: 'Executando', pensando: 'Pensando no próximo passo', lendo: 'Lendo a tarefa', respondeu: 'Respondeu', terminou: 'Terminou', parado: 'Sem sinal' },
    acoes: { terminal: 'Rodando', ler: 'Lendo', escrever: 'Escrevendo', editar: 'Editando', procurar: 'Procurando', skill: 'Lendo a skill', skills: 'Olhando as skills',
      tarefas: 'Atualizando a lista', processo: 'Acompanhando um processo', codigo: 'Rodando um script', memoria: 'Anotando na memória', conversas: 'Procurando em conversas antigas',
      web: 'Pesquisando na web', pagina: 'Lendo uma página', navegador: 'Usando o navegador', delegar: 'Delegando', mensagem: 'Enviando mensagem', perguntar: 'Perguntando',
      imagem: 'Olhando uma imagem', agenda: 'Mexendo em agendamento', outro: 'Usando' },
    cad: { novo: 'Demanda nova para o Arquiteto', 'em-avaliacao': 'Arquiteto avaliando', rascunho: 'Arquiteto escrevendo o plano', pronto: 'Na fila do Dev',
      bloqueado: 'Na fila, depois do plano anterior', 'em-execucao': 'Dev executando', devolvido: 'Devolvido ao Dev (ciclo {c})', 'em-revisao': 'PR {pr} aberto: CI, Tester e Reviewer',
      revisando: 'Reviewer revisando o PR {pr}', aprovado: 'Aprovado: falta o seu merge do PR {pr}', 'aguardando-alex': 'Esperando você', 'escalar-arquiteto': 'Voltou para o Arquiteto',
      concluido: 'Concluído', backlog: 'Backlog', descartado: 'Descartado', avaliado: 'Plano escrito' },
    ev: { inicio: 'Acompanhando a cadeia a partir de agora ({n} em andamento).', novo: 'Nova demanda para o Arquiteto: {t}', 'em-avaliacao': 'O Arquiteto está avaliando a demanda {t}',
      avaliado: 'O Arquiteto escreveu o plano da demanda {t}', rascunho: 'O Arquiteto começou o plano {t}', pronto: '{t} entrou na fila do Dev', 'em-execucao': 'O Dev começou {t}',
      'em-revisao': 'O Dev abriu o PR {pr} de {t}: agora CI, Tester e Reviewer', revisando: 'O Reviewer começou a revisar o PR {pr} ({t})', devolvido: 'O Reviewer devolveu {t} ao Dev (ciclo {c})',
      aprovado: 'O Reviewer aprovou {t}: falta o seu merge do PR {pr}', 'aguardando-alex': '{t} está esperando você', 'escalar-arquiteto': '{t} voltou para o Arquiteto',
      concluido: '{t} concluído', backlog: '{t} foi para o backlog', descartado: '{t} foi descartado', outro: '{t}: {de} → {para}' },
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
    conversas: 'Chats', cv_search: 'Search an agent or a message', cv_f_all: 'All', cv_f_working: 'Working', cv_f_unread: 'Unread',
    cv_pick: 'Pick a chat', cv_pick_sub: 'Every agent is a contact. What it is doing right now stays pinned on top of its chat; the Chain thread follows each plan from the Arquiteto to your merge.',
    cv_agents: 'Agents', cv_messages: 'Messages', cv_chain_hits: 'In the chain', cv_nothing: 'Nothing found for “{q}”',
    cv_you: 'You', cv_typing: 'typing…', cv_msg_ph: 'Message — Enter sends, Shift+Enter for a new line', cv_send: 'Send',
    cv_show: 'Show in the office', cv_back: 'Back', cv_close: 'Close (Esc)', cv_open_chat: 'Open the chat',
    cv_now: 'Now', cv_steps: 'Last steps', cv_step_n: 'step {n}', cv_step_lim: 'step {n} of up to {m}', cv_ago: '{t} ago',
    cv_free: 'Free', cv_last_run: 'Last run ended at {h} · {n} steps', cv_last_reply: 'Answered at {h} · {n} steps', cv_no_data: 'No Hermes activity recorded yet',
    cv_stalled: 'No sign of life for {t}: the run may be stuck', cv_session: 'Run', cv_started: 'started {h}', cv_model: 'model',
    cv_tasks: "Agent's list: {a} of {b} done", cv_task_now: 'now: {x}', cv_said: 'Said', cv_hermes: 'Hermes', cv_plan: 'Plan', cv_since: 'since {h}',
    cv_chain: 'Chain', cv_chain_sub: 'Arquiteto → Dev → Reviewer → you', cv_chain_ro: 'Read only. To give an order, talk to the Arquiteto.', cv_open_arch: 'Open the Arquiteto',
    cv_board: 'In progress', cv_board_empty: 'Nothing in progress: the queue is empty.', cv_board_off: 'Chain folder not found ({p}).',
    cv_today: 'Today', cv_yesterday: 'Yesterday', cv_more: 'read more', cv_less: 'show less', cv_seen: 'last seen {h}',
    cv_chain_idle: 'Chain idle: nothing queued', cv_wait_you: '{n} waiting for you', cv_in_queue: "{n} in the Dev's queue", cv_pill_exec: 'Dev working on “{t}”',
    cv_local: 'local', cv_demand: 'Register as a demand (plan → Dev → Reviewer)', cv_empty_chat: 'No messages yet. Write below to talk to {n}.',
    cv_no_agent_now: 'No active run now', cv_working_on: 'Working', cv_chain_preview_none: 'nothing in progress',
    passo_estado: { ok: 'worked', erro: 'failed', rodando: 'running', parou: 'interrupted' },
    estado: { executando: 'Running', pensando: 'Thinking about the next step', lendo: 'Reading the task', respondeu: 'Answered', terminou: 'Finished', parado: 'No sign of life' },
    acoes: { terminal: 'Running', ler: 'Reading', escrever: 'Writing', editar: 'Editing', procurar: 'Searching', skill: 'Reading the skill', skills: 'Looking at the skills',
      tarefas: 'Updating its list', processo: 'Watching a process', codigo: 'Running a script', memoria: 'Taking a note', conversas: 'Searching old chats',
      web: 'Searching the web', pagina: 'Reading a page', navegador: 'Using the browser', delegar: 'Delegating', mensagem: 'Sending a message', perguntar: 'Asking',
      imagem: 'Looking at an image', agenda: 'Editing a schedule', outro: 'Using' },
    cad: { novo: 'New demand for the Arquiteto', 'em-avaliacao': 'Arquiteto evaluating', rascunho: 'Arquiteto writing the plan', pronto: "In the Dev's queue",
      bloqueado: 'Queued, after the previous plan', 'em-execucao': 'Dev working', devolvido: 'Sent back to the Dev (cycle {c})', 'em-revisao': 'PR {pr} open: CI, Tester and Reviewer',
      revisando: 'Reviewer reviewing PR {pr}', aprovado: 'Approved: your merge of PR {pr} is missing', 'aguardando-alex': 'Waiting for you', 'escalar-arquiteto': 'Back with the Arquiteto',
      concluido: 'Done', backlog: 'Backlog', descartado: 'Discarded', avaliado: 'Plan written' },
    ev: { inicio: 'Following the chain from now on ({n} in progress).', novo: 'New demand for the Arquiteto: {t}', 'em-avaliacao': 'The Arquiteto is evaluating the demand {t}',
      avaliado: 'The Arquiteto wrote the plan for {t}', rascunho: 'The Arquiteto started the plan {t}', pronto: "{t} entered the Dev's queue", 'em-execucao': 'The Dev started {t}',
      'em-revisao': 'The Dev opened PR {pr} for {t}: now CI, Tester and Reviewer', revisando: 'The Reviewer started reviewing PR {pr} ({t})', devolvido: 'The Reviewer sent {t} back to the Dev (cycle {c})',
      aprovado: 'The Reviewer approved {t}: your merge of PR {pr} is missing', 'aguardando-alex': '{t} is waiting for you', 'escalar-arquiteto': '{t} went back to the Arquiteto',
      concluido: '{t} done', backlog: '{t} went to the backlog', descartado: '{t} was discarded', outro: '{t}: {de} → {para}' },
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
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const v = STR[lang][el.dataset.i18nTitle];
    if (v) el.title = v;
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
