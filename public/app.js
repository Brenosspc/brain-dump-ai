// Brain Dump AI — lógica do frontend (Vanilla ES6, sem dependências).
//
// Regra de segurança: todo texto vindo da IA ou do histórico é renderizado com
// textContent / createElement. NUNCA use innerHTML neste arquivo.

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const LIMITE_CARACTERES = 10_000; // mesmo limite do backend
// O servidor gasta no máximo 30 s com a IA (somando o modelo reserva); esperamos um pouco mais,
// para nunca desistir antes de a resposta chegar.
const TIMEOUT_REQUISICAO_MS = 35_000;
const TIMEOUT_HISTORICO_MS = 10_000;
const CHAVE_HISTORICO = "brainDumpAI.historico";
const CHAVE_DISPOSITIVO = "brainDumpAI.dispositivo";
const MAX_HISTORICO = 5;
const DURACAO_FEEDBACK_COPIA_MS = 2_000;
// Agrupa cliques rápidos no checklist num único envio à nuvem.
const ATRASO_SALVAR_PROGRESSO_MS = 700;
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Biblioteca oficial do Supabase (login), com versão fixa e carregada só quando o login existe.
const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// Cada categoria tem uma cor própria: borda de destaque, selo do ícone e marcador da lista.
const CATEGORIAS = [
  {
    chave: "tarefas",
    emoji: "📝",
    titulo: "Tarefas",
    borda: "border-l-sky-400/70",
    selo: "bg-sky-500/15",
    marcador: "marker:text-sky-400/70",
  },
  {
    chave: "ideias",
    emoji: "💡",
    titulo: "Ideias",
    borda: "border-l-amber-400/70",
    selo: "bg-amber-500/15",
    marcador: "marker:text-amber-400/70",
  },
  {
    chave: "duvidas",
    emoji: "❓",
    titulo: "Dúvidas",
    borda: "border-l-violet-400/70",
    selo: "bg-violet-500/15",
    marcador: "marker:text-violet-400/70",
  },
  {
    chave: "desabafos",
    emoji: "🧘",
    titulo: "Desabafos",
    borda: "border-l-teal-400/70",
    selo: "bg-teal-500/15",
    marcador: "marker:text-teal-400/70",
  },
];

// Exemplo pronto ("Ver um exemplo pronto"): mostra o app funcionando sem chamar a IA nem gastar cota.
const EXEMPLO = {
  texto:
    "amanhã tenho reunião às 9h e ainda não montei a apresentação. preciso renovar a CNH que vence esse mês. " +
    "a pia tá cheia de louça. será que eu peço mais prazo pro meu chefe? queria muito começar a correr de manhã. " +
    "me sinto atrasado em tudo e fico me comparando com os outros",
  resultado: {
    sintese_acolhedora:
      "Tem bastante coisa disputando a sua atenção agora, e é compreensível se sentir atrasado. Vamos separar tudo e começar pelo que está mais perto.",
    nivel_carga_cognitiva: "Alta",
    estado_mental: "Sobrecarga com autocobrança",
    tarefas: ["Montar a apresentação da reunião de amanhã", "Renovar a CNH antes do vencimento", "Lavar a louça da pia"],
    ideias: ["Começar a correr de manhã"],
    duvidas: ["Devo pedir mais prazo ao meu chefe?"],
    desabafos: ["Sensação de estar atrasado em tudo", "Comparação constante com outras pessoas"],
    sugerir_apoio: false,
  },
  // Micro-passos prontos, um por tarefa (mesma ordem de resultado.tarefas).
  passos: [
    ["Abrir um arquivo de slides em branco", "Escrever o título e 3 tópicos", "Colocar uma frase em cada tópico", "Ensaiar uma vez em voz alta"],
    ["Entrar no site do Detran do seu estado", "Ver a lista de documentos exigidos", "Agendar o exame médico", "Separar o comprovante de residência"],
    ["Colocar uma música animada", "Lavar só os copos primeiro", "Lavar pratos e talheres", "Deixar as panelas de molho"],
  ],
  // Ajuda pronta: primeiro passo de cada ideia e perguntas de cada dúvida (mesma ordem do resultado).
  primeiros_passos: ["Deixar o tênis e a roupa separados ao lado da cama hoje à noite"],
  perguntas: [
    [
      "O que acontece de concreto se a apresentação atrasar um ou dois dias?",
      "Com mais prazo, você conseguiria entregar algo de que se orgulha?",
      "Como seu chefe costuma reagir quando alguém avisa com antecedência?",
    ],
  ],
};

// Ajuda sob demanda nos cartões de ideias e dúvidas (desabafos nunca recebem sugestão).
const AJUDAS = {
  ideias: {
    tipo: "primeiro_passo",
    campo: "primeiros_passos",
    botao: "💡 Qual o primeiro passo?",
    esperando: "Pensando no primeiro passo…",
    erro: "Não consegui pensar num primeiro passo agora.",
  },
  duvidas: {
    tipo: "perguntas",
    campo: "perguntas",
    botao: "❓ Me ajude a pensar",
    esperando: "Pensando em perguntas…",
    erro: "Não consegui pensar em perguntas agora.",
  },
};

const CAMPOS_TEXTO = ["sintese_acolhedora", "nivel_carga_cognitiva", "estado_mental"];

// ---------------------------------------------------------------------------
// Referências do DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  form: $("form-despejo"),
  texto: $("texto"),
  botaoExemplo: $("botao-exemplo"),
  avisoExemplo: $("aviso-exemplo"),
  contador: $("contador"),
  botaoEnviar: $("botao-enviar"),
  rotuloEnviar: $("rotulo-enviar"),
  teclaMod: $("tecla-mod"),
  botaoMic: $("botao-microfone"),
  rotuloMic: $("rotulo-microfone"),
  avisoMic: $("aviso-microfone"),
  status: $("status"),
  erro: $("erro"),
  carregando: $("carregando"),
  resultado: $("resultado"),
  tituloResultado: $("titulo-resultado"),
  apoio: $("apoio"),
  sintese: $("sintese"),
  tagCarga: $("tag-carga"),
  tagEstado: $("tag-estado"),
  metricaPercentual: $("metrica-percentual"),
  metricaBarra: $("metrica-barra"),
  metricaDetalhe: $("metrica-detalhe"),
  cartoes: $("cartoes"),
  botaoCopiar: $("botao-copiar"),
  rotuloCopiar: $("rotulo-copiar"),
  botaoNovo: $("botao-novo"),
  painelHistorico: $("painel-historico"),
  historicoContagem: $("historico-contagem"),
  historicoVazio: $("historico-vazio"),
  avisoHistorico: $("aviso-historico"),
  avisoArmazenamento: $("aviso-armazenamento"),
  // Conta (login)
  conta: $("conta"),
  botaoEntrar: $("botao-entrar"),
  contaLogada: $("conta-logada"),
  contaEmail: $("conta-email"),
  botaoSair: $("botao-sair"),
  formLogin: $("form-login"),
  emailLogin: $("email-login"),
  botaoEnviarLink: $("botao-enviar-link"),
  statusLogin: $("status-login"),
  botaoFecharLogin: $("botao-fechar-login"),
  historicoLista: $("historico-lista"),
  botaoLimparHistorico: $("botao-limpar-historico"),
};

// ---------------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------------

const estado = {
  enviando: false,
  resultadoAtual: null,
  timerCopia: null,
  quadroContagem: 0, // requestAnimationFrame da contagem da métrica
  // Despejo na tela: { id, naNuvem } e o progresso do checklist
  despejoAtual: null,
  modoExemplo: false, // o resultado na tela é o exemplo pronto (nada é salvo nem enviado à IA)
  progresso: progressoVazio(),
  timersProgresso: new Map(), // id do despejo -> timer do envio do progresso à nuvem
  // Conta e histórico
  nuvemDisponivel: false, // o servidor oferece histórico na nuvem (banco + login)
  configAuth: null, // { url, chavePublica } do Supabase, vindos do servidor
  supabase: null, // cliente do Supabase (só existe quando o login está disponível)
  usuario: null, // { id, email } de quem está logado
  nuvem: false, // usar a nuvem agora: disponível E com alguém logado
  historicoDaNuvem: false, // a lista exibida veio da nuvem (e não da cópia local)
  historicoExibido: [], // entradas mostradas no painel, mantidas atualizadas com o progresso
  diasRetencao: 30,
  dispositivoId: "", // identificador anônimo deste navegador (UUID)
  // Voz
  gravando: false,
  querGravar: false, // o usuário pediu para gravar (usado para reiniciar se o navegador parar sozinho)
  textoBaseVoz: "", // texto que já estava na textarea quando a sessão de voz começou
  vozOffset: 0, // resultados da sessão já incorporados ao texto base (quando o usuário digita durante a gravação)
  vozTotal: 0, // quantidade de resultados vistos na sessão atual
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** Erro com mensagem já pronta para mostrar ao usuário. */
class ErroAmigavel extends Error {}

const formatarNumero = (n) => n.toLocaleString("pt-BR");

function contarPalavras(texto) {
  const limpo = texto.trim();
  return limpo ? limpo.split(/\s+/).length : 0;
}

function plural(n, singular, pluralTexto) {
  return n === 1 ? singular : pluralTexto;
}

function formatarData(iso) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function reduzMovimento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Gera um UUID v4 (o servidor exige esse formato para ids de despejo e de dispositivo). */
function gerarId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID só existe em contexto seguro (HTTPS/localhost); fora dele, monta o UUID à mão.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Junta dois trechos de texto com um espaço entre eles, se necessário. */
function juntarTexto(base, extra) {
  if (!extra) return base;
  if (!base) return extra;
  return /\s$/.test(base) ? base + extra : `${base} ${extra}`;
}

// ---------------------------------------------------------------------------
// Mensagens (status e erro)
// ---------------------------------------------------------------------------

function mostrarStatus(mensagem) {
  el.status.textContent = mensagem;
}

function mostrarErro(mensagem) {
  el.status.textContent = "";
  el.erro.textContent = mensagem;
}

function limparMensagens() {
  el.status.textContent = "";
  el.erro.textContent = "";
}

// ---------------------------------------------------------------------------
// Contador de caracteres / palavras
// ---------------------------------------------------------------------------

function excedeLimite() {
  return el.texto.value.trim().length > LIMITE_CARACTERES;
}

function atualizarContador() {
  const texto = el.texto.value;
  const caracteres = texto.length;
  const palavras = contarPalavras(texto);

  let mensagem =
    `${formatarNumero(caracteres)} / ${formatarNumero(LIMITE_CARACTERES)} caracteres · ` +
    `${formatarNumero(palavras)} ${plural(palavras, "palavra", "palavras")}`;

  let nivel = "normal";
  if (excedeLimite()) {
    nivel = "excedido";
    mensagem += " — passou do limite, tente dividir em partes";
  } else if (caracteres > LIMITE_CARACTERES * 0.9) {
    nivel = "alerta";
  }

  el.contador.textContent = mensagem;
  el.contador.dataset.nivel = nivel;
  ajustarAlturaTexto();
  atualizarBotaoEnviar();
}

/** Faz a caixa de texto crescer com o conteúdo (os limites ficam no CSS: min-height e max-height). */
function ajustarAlturaTexto() {
  el.texto.style.height = "auto";
  el.texto.style.height = `${el.texto.scrollHeight + 2}px`;
}

function atualizarBotaoEnviar() {
  el.botaoEnviar.disabled = estado.enviando || excedeLimite();
}

// ---------------------------------------------------------------------------
// Validação da resposta (API ou histórico)
// ---------------------------------------------------------------------------

/**
 * Confere o formato do resultado e devolve uma cópia normalizada, ou null se for inválido.
 * Usado tanto para a resposta da API quanto para entradas lidas do LocalStorage.
 */
function validarResultado(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;

  const resultado = {};
  for (const campo of CAMPOS_TEXTO) {
    if (typeof dados[campo] !== "string" || !dados[campo].trim()) return null;
    resultado[campo] = dados[campo].trim();
  }

  for (const { chave } of CATEGORIAS) {
    if (!Array.isArray(dados[chave])) return null;
    resultado[chave] = dados[chave]
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim());
  }

  // Campo novo: despejos antigos do histórico não têm, e contam como false.
  resultado.sugerir_apoio = dados.sugerir_apoio === true;

  return resultado;
}

function progressoVazio() {
  return { concluidas: [], micro_passos: {}, primeiros_passos: {}, perguntas: {} };
}

/** Lista de textos limpa: só strings não vazias, cortadas em 200 caracteres, no máximo `maximo`. */
function limparTextos(lista, maximo) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().slice(0, 200))
    .slice(0, maximo);
}

/** Copia um objeto { "<índice>": valor } mantendo só índices válidos com valor aproveitável. */
function copiarPorIndice(origem, limpar) {
  const resultado = {};
  if (!origem || typeof origem !== "object" || Array.isArray(origem)) return resultado;
  for (const [chave, valor] of Object.entries(origem)) {
    if (!/^\d{1,2}$/.test(chave)) continue;
    const limpo = limpar(valor);
    if (limpo.length > 0) resultado[String(Number(chave))] = limpo;
  }
  return resultado;
}

/**
 * Valida o progresso de um despejo (tarefas concluídas, micro-passos, primeiros passos e
 * perguntas), no mesmo formato aceito pelo servidor. Devolve sempre um objeto válido.
 */
function validarProgresso(dados) {
  const progresso = progressoVazio();
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return progresso;

  if (Array.isArray(dados.concluidas)) {
    const indices = dados.concluidas.filter((n) => Number.isInteger(n) && n >= 0 && n < 100);
    progresso.concluidas = [...new Set(indices)].sort((a, b) => a - b);
  }

  progresso.micro_passos = copiarPorIndice(dados.micro_passos, (passos) => limparTextos(passos, 6));
  progresso.primeiros_passos = copiarPorIndice(dados.primeiros_passos, (passo) =>
    typeof passo === "string" ? passo.trim().slice(0, 200) : ""
  );
  progresso.perguntas = copiarPorIndice(dados.perguntas, (perguntas) => limparTextos(perguntas, 3));
  return progresso;
}

// ---------------------------------------------------------------------------
// Chamada à API
// ---------------------------------------------------------------------------

async function chamarApi(texto) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_REQUISICAO_MS);

  let resposta;
  try {
    resposta = await fetch("/api/organizar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dispositivo-Id": estado.dispositivoId,
        ...(await cabecalhoLogin()),
      },
      body: JSON.stringify({ texto }),
      signal: controle.signal,
    });
  } catch (erro) {
    if (erro?.name === "AbortError") {
      throw new ErroAmigavel("O servidor demorou demais para responder. Seu texto continua aqui; tente novamente.");
    }
    throw new ErroAmigavel("Não consegui falar com o servidor. Verifique sua conexão e tente novamente.");
  } finally {
    clearTimeout(timer);
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // Corpo vazio ou não-JSON: tratado abaixo.
  }

  if (!resposta.ok) {
    const mensagem =
      typeof dados?.erro === "string" && dados.erro.trim()
        ? dados.erro.trim()
        : `Algo deu errado ao organizar (código ${resposta.status}). Tente novamente.`;
    throw new ErroAmigavel(mensagem);
  }

  const resultado = validarResultado(dados);
  if (!resultado) {
    throw new ErroAmigavel("A resposta veio num formato inesperado. Tente organizar de novo.");
  }

  // Quando o servidor salva na nuvem, devolve { id, data } do despejo.
  const salvo = dados.despejo;
  const despejo =
    salvo && PADRAO_UUID.test(salvo.id ?? "") && typeof salvo.data === "string" && !Number.isNaN(Date.parse(salvo.data))
      ? { id: salvo.id, data: salvo.data }
      : null;

  return { resultado, despejo, sessaoExpirada: dados.sessao_expirada === true };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

function definirEnviando(sim) {
  estado.enviando = sim;
  el.botaoEnviar.setAttribute("aria-busy", String(sim));
  el.rotuloEnviar.textContent = sim ? "Organizando…" : "Organizar";
  el.carregando.hidden = !sim;
  if (vozDisponivel()) el.botaoMic.disabled = sim;
  if (sim) {
    el.resultado.hidden = true;
    mostrarStatus("Organizando seus pensamentos… isso leva alguns segundos.");
  }
  atualizarBotaoEnviar();
}

async function enviar() {
  if (estado.enviando) return; // evita envio duplo

  const texto = el.texto.value.trim();
  limparMensagens();

  if (!texto) {
    mostrarErro("Escreva alguma coisa antes de organizar. Pode ser bem bagunçado mesmo!");
    el.texto.focus();
    return;
  }
  if (texto.length > LIMITE_CARACTERES) {
    mostrarErro(
      `Seu texto passou de ${formatarNumero(LIMITE_CARACTERES)} caracteres. Tente dividir em partes menores.`
    );
    el.texto.focus();
    return;
  }

  pararGravacao();
  definirEnviando(true);

  try {
    const { resultado, despejo, sessaoExpirada } = await chamarApi(texto);
    definirEnviando(false);
    // Usa o id da nuvem quando o servidor salvou; senão, um id local.
    const id = despejo?.id ?? gerarId();
    renderizarResultado(resultado, texto, { id, naNuvem: Boolean(despejo) });
    void salvarNoHistorico(texto, resultado, despejo, id); // atualiza o painel em segundo plano
    mostrarStatus(
      sessaoExpirada
        ? "Pronto! Seus pensamentos foram organizados, mas sua sessão expirou: este despejo ficou salvo só neste navegador. Entre de novo para salvar na nuvem."
        : "Pronto! Seus pensamentos foram organizados."
    );
    focarResultado();
  } catch (erro) {
    definirEnviando(false);
    // Devolve à tela o resultado anterior, que foi escondido durante o carregamento.
    if (estado.resultadoAtual) el.resultado.hidden = false;
    if (!(erro instanceof ErroAmigavel)) console.error("[Brain Dump] Erro inesperado:", erro);
    // O texto digitado continua na textarea.
    mostrarErro(erro instanceof ErroAmigavel ? erro.message : "Algo inesperado aconteceu. Tente novamente.");
  }
}

// ---------------------------------------------------------------------------
// Renderização do resultado
// ---------------------------------------------------------------------------

/**
 * Fórmula motivacional (determinística, não clínica):
 * X = min(90, 10 + 5 × itens organizados + piso(palavras / 25))
 */
function calcularLeveza(palavras, itens) {
  return Math.min(90, 10 + 5 * itens + Math.floor(palavras / 25));
}

/** Moldura comum dos cartões: borda colorida da categoria e título com o ícone num selo. */
function criarMolduraCartao({ chave, emoji, titulo, borda, selo }, extraClasse = "") {
  const secao = document.createElement("section");
  secao.className = `cartao rounded-2xl border border-l-4 border-slate-800 ${borda} bg-slate-900/60 p-5 ${extraClasse}`;
  secao.setAttribute("aria-labelledby", `cartao-${chave}`);

  const cabecalho = document.createElement("h3");
  cabecalho.id = `cartao-${chave}`;
  cabecalho.className = "flex items-center gap-2.5 text-base font-semibold text-slate-100";

  const icone = document.createElement("span");
  icone.setAttribute("aria-hidden", "true");
  icone.className = `flex h-8 w-8 items-center justify-center rounded-lg text-base ${selo}`;
  icone.textContent = emoji;

  const nome = document.createElement("span");
  nome.textContent = titulo;

  const contagem = document.createElement("span");
  contagem.className = "ml-auto text-xs font-normal text-slate-500";

  cabecalho.append(icone, nome, contagem);
  secao.append(cabecalho);
  return { secao, contagem };
}

function criarCartao(categoria, itens) {
  const { secao, contagem } = criarMolduraCartao(categoria);
  contagem.textContent = `${itens.length} ${plural(itens.length, "item", "itens")}`;

  const ajuda = AJUDAS[categoria.chave];
  const lista = document.createElement("ul");
  lista.className = `mt-3 list-disc space-y-2 pl-5 leading-relaxed text-slate-300 ${categoria.marcador}`;
  itens.forEach((item, indice) => {
    const li = document.createElement("li");
    const texto = document.createElement("span");
    texto.textContent = item;
    li.append(texto);
    if (ajuda) {
      const area = document.createElement("div");
      renderizarAreaAjuda(area, ajuda, item, indice);
      li.append(area);
    }
    lista.append(li);
  });

  secao.append(lista);
  if (categoria.chave === "duvidas") {
    const aviso = document.createElement("p");
    aviso.className = "mt-4 text-xs leading-relaxed text-slate-500";
    aviso.textContent = "Perguntas para te ajudar a pensar, não são orientação profissional.";
    secao.append(aviso);
  }
  return secao;
}

// ---------------------------------------------------------------------------
// Ajuda sob demanda: "primeiro passo" (ideias) e "me ajude a pensar" (dúvidas)
// ---------------------------------------------------------------------------

/** Mostra a ajuda já salva para o item ou, se ainda não existir, o botão para pedi-la. */
function renderizarAreaAjuda(area, ajuda, item, indice) {
  const salvo = estado.progresso[ajuda.campo][String(indice)];

  if (ajuda.tipo === "primeiro_passo" && salvo) {
    const passo = document.createElement("p");
    passo.className = "mt-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-100/90";
    const rotulo = document.createElement("span");
    rotulo.className = "font-semibold text-amber-200";
    rotulo.textContent = "Primeiro passo: ";
    passo.append(rotulo, document.createTextNode(salvo));
    area.replaceChildren(passo);
    return;
  }

  if (ajuda.tipo === "perguntas" && salvo?.length) {
    const lista = document.createElement("ul");
    lista.className = "mt-1.5 space-y-1 rounded-lg bg-violet-500/10 px-3 py-2 text-sm leading-relaxed text-violet-100/90";
    lista.setAttribute("aria-label", `Perguntas para pensar sobre: ${item}`);
    for (const pergunta of salvo) {
      const li = document.createElement("li");
      li.className = "list-none";
      li.textContent = `🤔 ${pergunta}`;
      lista.append(li);
    }
    area.replaceChildren(lista);
    return;
  }

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className =
    "mt-1 rounded px-0.5 text-xs text-sky-300/80 underline-offset-4 hover:text-sky-200 hover:underline disabled:cursor-wait disabled:opacity-60";
  botao.textContent = ajuda.botao;
  botao.setAttribute("aria-label", `${ajuda.botao.replace(/^\S+\s/, "")} ${item}`);
  botao.addEventListener("click", () => pedirAjuda(ajuda, item, indice, area, botao));
  area.replaceChildren(botao);
}

/** Mensagem fixa (tema sensível): aparece só na tela, não é salva no progresso. */
function mostrarEncaminhamento(area, mensagem) {
  const aviso = document.createElement("p");
  aviso.className = "mt-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm leading-relaxed text-slate-300";
  aviso.textContent = `🩺 ${mensagem}`;
  area.replaceChildren(aviso);
}

async function chamarAjuda(tipo, texto) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_REQUISICAO_MS);

  let resposta;
  try {
    resposta = await fetch("/api/ajuda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, texto }),
      signal: controle.signal,
    });
  } catch (erro) {
    if (erro?.name === "AbortError") throw new ErroAmigavel("A IA demorou demais para responder. Tente de novo.");
    throw new ErroAmigavel("Não consegui falar com o servidor. Verifique sua conexão e tente novamente.");
  } finally {
    clearTimeout(timer);
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // Corpo vazio ou não-JSON: tratado abaixo.
  }

  if (!resposta.ok) {
    throw new ErroAmigavel(
      typeof dados?.erro === "string" && dados.erro.trim() ? dados.erro.trim() : "Não consegui ajudar agora. Tente de novo."
    );
  }
  if (!dados || typeof dados !== "object") {
    throw new ErroAmigavel("A resposta veio num formato inesperado. Tente de novo.");
  }
  return dados;
}

/** No exemplo pronto, a ajuda já vem pronta (uma pausa curta imita o tempo da IA). */
async function ajudaDoExemplo(ajuda, indice) {
  await new Promise((resolver) => setTimeout(resolver, reduzMovimento() ? 0 : 900));
  const pronta = EXEMPLO[ajuda.campo]?.[indice];
  if (!pronta) throw new ErroAmigavel("Não há uma sugestão pronta para esse item no exemplo.");
  return ajuda.tipo === "primeiro_passo" ? { primeiro_passo: pronta } : { perguntas: pronta };
}

async function pedirAjuda(ajuda, item, indice, area, botao) {
  if (botao.disabled) return;
  botao.disabled = true;
  botao.setAttribute("aria-busy", "true");
  botao.textContent = ajuda.esperando;
  limparMensagens();

  const despejoAlvo = estado.despejoAtual?.id;
  try {
    const dados = estado.modoExemplo ? await ajudaDoExemplo(ajuda, indice) : await chamarAjuda(ajuda.tipo, item);
    // A pessoa pode ter aberto outro despejo enquanto esperava.
    if (estado.despejoAtual?.id !== despejoAlvo || !area.isConnected) return;

    if (dados.sugerir_apoio === true) {
      // Sinal de sofrimento: em vez de sugestão, o cartão de apoio (CVV).
      renderizarAreaAjuda(area, ajuda, item, indice);
      el.apoio.hidden = false;
      el.apoio.scrollIntoView({ behavior: reduzMovimento() ? "auto" : "smooth", block: "center" });
      mostrarStatus("Em vez de uma sugestão, deixei um contato de apoio no topo do resultado.");
      return;
    }
    if (typeof dados.encaminhar === "string" && dados.encaminhar.trim()) {
      mostrarEncaminhamento(area, dados.encaminhar.trim());
      mostrarStatus("Esse assunto merece a conversa com um profissional.");
      return;
    }

    if (ajuda.tipo === "primeiro_passo") {
      const passo = typeof dados.primeiro_passo === "string" ? dados.primeiro_passo.trim().slice(0, 200) : "";
      if (!passo) throw new ErroAmigavel("A resposta veio num formato inesperado. Tente de novo.");
      estado.progresso.primeiros_passos[String(indice)] = passo;
      mostrarStatus(`Primeiro passo: ${passo}`);
    } else {
      const perguntas = limparTextos(dados.perguntas, 3);
      if (perguntas.length === 0) throw new ErroAmigavel("A resposta veio num formato inesperado. Tente de novo.");
      estado.progresso.perguntas[String(indice)] = perguntas;
      mostrarStatus(`Pronto: ${perguntas.length} perguntas para te ajudar a pensar.`);
    }
    renderizarAreaAjuda(area, ajuda, item, indice);
    salvarProgresso();
  } catch (erro) {
    if (!area.isConnected) return;
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
    botao.textContent = ajuda.botao;
    if (!(erro instanceof ErroAmigavel)) console.error("[Ajuda] Erro inesperado:", erro);
    mostrarErro(erro instanceof ErroAmigavel ? erro.message : ajuda.erro);
  }
}

/**
 * @param {object} resultado resultado validado
 * @param {string} texto texto original do despejo
 * @param {{ id?: string, naNuvem?: boolean, progresso?: object }} [contexto] identificação e progresso salvos
 */
function renderizarResultado(resultado, texto, { id = null, naNuvem = false, progresso = null, exemplo = false } = {}) {
  estado.resultadoAtual = resultado;
  estado.despejoAtual = id ? { id, naNuvem } : null;
  estado.modoExemplo = exemplo;
  estado.progresso = validarProgresso(progresso);
  el.avisoExemplo.hidden = !exemplo;

  // Cartão de apoio (CVV) só quando há sinais de sofrimento intenso.
  el.apoio.hidden = !resultado.sugerir_apoio;

  el.sintese.textContent = resultado.sintese_acolhedora;
  el.tagCarga.textContent = `Carga cognitiva: ${resultado.nivel_carga_cognitiva}`;
  el.tagEstado.textContent = `Estado: ${resultado.estado_mental}`;

  // Métrica de peso cognitivo
  const palavras = contarPalavras(texto);
  const caracteres = texto.length;
  const itens = CATEGORIAS.reduce((soma, { chave }) => soma + resultado[chave].length, 0);
  const percentual = calcularLeveza(palavras, itens);

  el.metricaPercentual.textContent = `${percentual}%`;
  el.metricaDetalhe.textContent =
    `Processamos ${formatarNumero(palavras)} ${plural(palavras, "palavra", "palavras")} ` +
    `(${formatarNumero(caracteres)} caracteres) e organizamos em ${itens} ${plural(itens, "item", "itens")}.`;

  // Cartões: só os que têm itens (o de tarefas vira um checklist)
  const cartoes = CATEGORIAS.filter(({ chave }) => resultado[chave].length > 0).map((categoria) =>
    categoria.chave === "tarefas"
      ? criarCartaoTarefas(categoria, resultado.tarefas)
      : criarCartao(categoria, resultado[categoria.chave])
  );
  if (cartoes.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "text-sm text-slate-400 sm:col-span-2";
    vazio.textContent = "Não encontrei itens para separar desta vez. Tudo bem: escrever já ajuda.";
    cartoes.push(vazio);
  }
  el.cartoes.replaceChildren(...cartoes);
  atualizarResumoTarefas({ anunciar: false });

  // Botão de copiar só aparece se houver tarefas
  el.botaoCopiar.hidden = resultado.tarefas.length === 0;
  clearTimeout(estado.timerCopia);
  el.rotuloCopiar.textContent = "Copiar apenas tarefas";

  // Mostra o resultado e anima a barra (e o número) a partir do zero
  el.metricaBarra.style.width = "0%";
  el.resultado.hidden = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.metricaBarra.style.width = `${percentual}%`;
    })
  );
  animarContagem(el.metricaPercentual, percentual);
}

/** Conta de 0 até o valor final em ~0,8 s (sem animação para quem prefere menos movimento). */
function animarContagem(elemento, final) {
  cancelAnimationFrame(estado.quadroContagem);
  if (reduzMovimento()) {
    elemento.textContent = `${final}%`;
    return;
  }
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / 800);
    const suave = 1 - (1 - t) ** 3;
    elemento.textContent = `${Math.round(final * suave)}%`;
    if (t < 1) estado.quadroContagem = requestAnimationFrame(passo);
  };
  estado.quadroContagem = requestAnimationFrame(passo);
}

function focarResultado() {
  el.tituloResultado.focus({ preventScroll: true });
  el.resultado.scrollIntoView({ behavior: reduzMovimento() ? "auto" : "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Checklist de tarefas e micro-passos
// ---------------------------------------------------------------------------

function criarCartaoTarefas(categoria, tarefas) {
  const { secao, contagem } = criarMolduraCartao(categoria, "sm:col-span-2");
  contagem.dataset.contagemTarefas = "";

  // Barra de progresso das tarefas (enche conforme você marca)
  const trilho = document.createElement("div");
  trilho.className = "mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800";
  trilho.setAttribute("aria-hidden", "true");
  const barra = document.createElement("div");
  barra.className = "barra h-full rounded-full bg-gradient-to-r from-sky-400 to-teal-300";
  barra.style.width = "0%";
  barra.dataset.barraTarefas = "";
  trilho.append(barra);

  const lista = document.createElement("ul");
  lista.className = "mt-3 space-y-3";
  tarefas.forEach((tarefa, indice) => lista.append(criarItemTarefa(tarefa, indice)));

  const parabens = document.createElement("p");
  parabens.className = "parabens mt-4 text-sm text-teal-300";
  parabens.dataset.tarefasConcluidas = "";
  parabens.hidden = true;
  parabens.textContent = "Tudo feito por aqui. 🌱 Bom trabalho, no seu ritmo.";

  secao.append(trilho, lista, parabens);
  return secao;
}

function criarItemTarefa(tarefa, indice) {
  const li = document.createElement("li");
  li.className = "tarefa";

  const linha = document.createElement("div");
  linha.className = "flex items-start gap-3";

  const caixa = document.createElement("input");
  caixa.type = "checkbox";
  caixa.id = `tarefa-${indice}`;
  caixa.className = "mt-1 h-4 w-4 shrink-0 cursor-pointer accent-sky-400";
  caixa.checked = estado.progresso.concluidas.includes(indice);

  const rotulo = document.createElement("label");
  rotulo.htmlFor = caixa.id;
  rotulo.className = "texto-tarefa flex-1 cursor-pointer leading-relaxed text-slate-300";
  rotulo.textContent = tarefa;

  caixa.addEventListener("change", () => alternarTarefa(indice, caixa.checked, li));
  li.classList.toggle("concluida", caixa.checked);
  linha.append(caixa, rotulo);

  const areaPassos = document.createElement("div");
  areaPassos.className = "pl-7";
  renderizarAreaPassos(areaPassos, tarefa, indice);

  li.append(linha, areaPassos);
  return li;
}

/** Mostra os micro-passos da tarefa ou, se ainda não existirem, o botão para pedi-los. */
function renderizarAreaPassos(area, tarefa, indice) {
  const passos = estado.progresso.micro_passos[String(indice)];

  if (passos?.length) {
    const lista = document.createElement("ol");
    lista.className = "mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-400 marker:text-slate-600";
    lista.setAttribute("aria-label", `Passos menores para: ${tarefa}`);
    for (const passo of passos) {
      const item = document.createElement("li");
      item.textContent = passo;
      lista.append(item);
    }
    area.replaceChildren(lista);
    return;
  }

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className =
    "mt-1 rounded px-0.5 text-xs text-sky-300/80 underline-offset-4 hover:text-sky-200 hover:underline disabled:cursor-wait disabled:opacity-60";
  botao.textContent = "Quebrar em passos menores";
  botao.setAttribute("aria-label", `Quebrar em passos menores: ${tarefa}`);
  botao.addEventListener("click", () => pedirMicroPassos(tarefa, indice, area, botao));
  area.replaceChildren(botao);
}

function alternarTarefa(indice, marcada, li) {
  const conjunto = new Set(estado.progresso.concluidas);
  if (marcada) conjunto.add(indice);
  else conjunto.delete(indice);
  estado.progresso.concluidas = [...conjunto].sort((a, b) => a - b);

  li.classList.toggle("concluida", marcada);
  if (marcada) {
    li.classList.remove("comemorar");
    void li.offsetWidth; // reinicia a animação se a pessoa marcar de novo
    li.classList.add("comemorar");
  }
  atualizarResumoTarefas({ anunciar: true });
  salvarProgresso();
}

/** Atualiza "X de N feitas" e a mensagem de tudo concluído. */
function atualizarResumoTarefas({ anunciar }) {
  const contagem = el.cartoes.querySelector("[data-contagem-tarefas]");
  const parabens = el.cartoes.querySelector("[data-tarefas-concluidas]");
  if (!contagem || !parabens) return;

  const total = estado.resultadoAtual?.tarefas.length ?? 0;
  const feitas = estado.progresso.concluidas.filter((indice) => indice < total).length;
  contagem.textContent = `${feitas} de ${total} ${plural(total, "feita", "feitas")}`;
  const barra = el.cartoes.querySelector("[data-barra-tarefas]");
  if (barra) barra.style.width = `${total ? Math.round((feitas / total) * 100) : 0}%`;

  const tudoFeito = total > 0 && feitas === total;
  const jaMostrava = !parabens.hidden;
  parabens.hidden = !tudoFeito;
  if (anunciar && tudoFeito && !jaMostrava) {
    mostrarStatus("Todas as tarefas concluídas. Bom trabalho!");
  }
}

async function chamarMicroPassos(tarefa) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_REQUISICAO_MS);

  let resposta;
  try {
    resposta = await fetch("/api/micro-passos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tarefa }),
      signal: controle.signal,
    });
  } catch (erro) {
    if (erro?.name === "AbortError") throw new ErroAmigavel("A IA demorou demais para responder. Tente de novo.");
    throw new ErroAmigavel("Não consegui falar com o servidor. Verifique sua conexão e tente novamente.");
  } finally {
    clearTimeout(timer);
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // Corpo vazio ou não-JSON: tratado abaixo.
  }

  if (!resposta.ok) {
    throw new ErroAmigavel(
      typeof dados?.erro === "string" && dados.erro.trim()
        ? dados.erro.trim()
        : "Não consegui dividir essa tarefa agora. Tente de novo."
    );
  }

  const passos = Array.isArray(dados?.passos)
    ? dados.passos.filter((passo) => typeof passo === "string" && passo.trim()).map((passo) => passo.trim())
    : [];
  if (passos.length === 0) throw new ErroAmigavel("A resposta veio num formato inesperado. Tente de novo.");
  return passos.slice(0, 6);
}

async function pedirMicroPassos(tarefa, indice, area, botao) {
  if (botao.disabled) return;
  botao.disabled = true;
  botao.setAttribute("aria-busy", "true");
  botao.textContent = "Pensando nos passos…";
  limparMensagens();

  const despejoAlvo = estado.despejoAtual?.id;
  try {
    const passos = estado.modoExemplo ? await passosDoExemplo(indice) : await chamarMicroPassos(tarefa);
    // A pessoa pode ter aberto outro despejo enquanto esperava.
    if (estado.despejoAtual?.id !== despejoAlvo || !area.isConnected) return;

    estado.progresso.micro_passos[String(indice)] = passos;
    renderizarAreaPassos(area, tarefa, indice);
    mostrarStatus(`Pronto: a tarefa foi dividida em ${passos.length} passos menores.`);
    salvarProgresso();
  } catch (erro) {
    if (!area.isConnected) return;
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
    botao.textContent = "Quebrar em passos menores";
    if (!(erro instanceof ErroAmigavel)) console.error("[Micro-passos] Erro inesperado:", erro);
    mostrarErro(erro instanceof ErroAmigavel ? erro.message : "Não consegui dividir essa tarefa agora.");
  }
}

/** No exemplo pronto, os passos já vêm prontos (uma pausa curta imita o tempo da IA). */
async function passosDoExemplo(indice) {
  await new Promise((resolver) => setTimeout(resolver, reduzMovimento() ? 0 : 900));
  const passos = EXEMPLO.passos[indice];
  if (!passos) throw new ErroAmigavel("Não há passos prontos para essa tarefa no exemplo.");
  return passos;
}

/**
 * Salva o progresso do despejo na tela: na cópia local na hora e na nuvem
 * logo depois (agrupando cliques rápidos).
 */
function salvarProgresso() {
  const alvo = estado.despejoAtual;
  if (!alvo) return;
  const progresso = {
    concluidas: [...estado.progresso.concluidas],
    micro_passos: { ...estado.progresso.micro_passos },
    primeiros_passos: { ...estado.progresso.primeiros_passos },
    perguntas: { ...estado.progresso.perguntas },
  };

  // Mantém o painel de histórico em dia (para "Reabrir" mostrar o progresso atual).
  const exibido = estado.historicoExibido.find((entrada) => entrada.id === alvo.id);
  if (exibido) exibido.progresso = progresso;

  // Cópia local
  const lista = lerHistorico();
  const local = lista.find((entrada) => entrada.id === alvo.id);
  if (local) {
    local.progresso = progresso;
    gravarHistorico(lista);
  }

  // Nuvem
  if (!estado.nuvem || !alvo.naNuvem) return;
  clearTimeout(estado.timersProgresso.get(alvo.id));
  estado.timersProgresso.set(
    alvo.id,
    setTimeout(() => {
      estado.timersProgresso.delete(alvo.id);
      enviarProgressoNuvem(alvo.id, progresso);
    }, ATRASO_SALVAR_PROGRESSO_MS)
  );
}

async function enviarProgressoNuvem(id, progresso) {
  try {
    await chamarHistorico("PATCH", `/api/despejos/${encodeURIComponent(id)}`, { progresso });
  } catch (erro) {
    console.warn("[Progresso] Não foi possível salvar na nuvem:", erro);
    mostrarAvisoHistorico("Não consegui salvar o progresso na nuvem; ele ficou salvo neste navegador.");
  }
}

// ---------------------------------------------------------------------------
// Copiar tarefas
// ---------------------------------------------------------------------------

function copiarComFallback(texto) {
  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();

  let copiou = false;
  try {
    copiou = document.execCommand("copy");
  } catch {
    copiou = false;
  }
  area.remove();
  el.botaoCopiar.focus();
  return copiou;
}

async function copiarTarefas() {
  const tarefas = estado.resultadoAtual?.tarefas ?? [];
  if (tarefas.length === 0) return;

  const texto = tarefas.join("\n");
  let copiou = false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      copiou = true;
    } catch {
      // Sem permissão ou contexto inseguro: tenta o método antigo.
    }
  }
  if (!copiou) copiou = copiarComFallback(texto);

  if (copiou) {
    el.rotuloCopiar.textContent = "Copiado!";
    mostrarStatus(`${tarefas.length} ${plural(tarefas.length, "tarefa copiada", "tarefas copiadas")}.`);
    clearTimeout(estado.timerCopia);
    estado.timerCopia = setTimeout(() => {
      el.rotuloCopiar.textContent = "Copiar apenas tarefas";
    }, DURACAO_FEEDBACK_COPIA_MS);
  } else {
    mostrarErro("Não consegui copiar automaticamente. Selecione as tarefas no cartão e copie manualmente.");
  }
}

// ---------------------------------------------------------------------------
// Exemplo pronto
// ---------------------------------------------------------------------------

/** Mostra um despejo de exemplo já organizado, sem chamar a IA e sem salvar no histórico. */
function mostrarExemplo() {
  if (estado.enviando) return;
  pararGravacao();
  limparMensagens();
  el.texto.value = EXEMPLO.texto;
  atualizarContador();
  const resultado = validarResultado(EXEMPLO.resultado);
  renderizarResultado(resultado, EXEMPLO.texto, { exemplo: true });
  mostrarStatus("Exemplo pronto carregado. Marque uma tarefa ou quebre outra em passos menores para ver como funciona.");
  focarResultado();
}

// ---------------------------------------------------------------------------
// Novo despejo
// ---------------------------------------------------------------------------

function novoDespejo() {
  pararGravacao();
  estado.resultadoAtual = null;
  estado.despejoAtual = null;
  estado.modoExemplo = false;
  el.avisoExemplo.hidden = true;
  estado.progresso = progressoVazio();
  el.resultado.hidden = true;
  el.cartoes.replaceChildren();
  el.texto.value = "";
  atualizarContador();
  limparMensagens();
  el.texto.focus();
}

// ---------------------------------------------------------------------------
// Voz (Web Speech API)
// ---------------------------------------------------------------------------

const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconhecimento = null;

function vozDisponivel() {
  return reconhecimento !== null;
}

function atualizarUiGravacao(gravando) {
  const estavaGravando = estado.gravando;
  estado.gravando = gravando;
  el.botaoMic.classList.toggle("gravando", gravando);
  el.botaoMic.setAttribute("aria-pressed", String(gravando));
  el.rotuloMic.textContent = gravando ? "Parar gravação" : "Falar em vez de digitar";
  if (gravando && !estavaGravando) {
    mostrarStatus("Gravando… fale à vontade. Clique de novo para parar.");
  } else if (!gravando && estavaGravando && !estado.enviando && !el.erro.textContent) {
    mostrarStatus("Gravação encerrada.");
  }
}

function iniciarSessaoVoz() {
  estado.textoBaseVoz = el.texto.value;
  estado.vozOffset = 0;
  estado.vozTotal = 0;
  reconhecimento.start();
}

function iniciarGravacao() {
  if (!vozDisponivel() || estado.enviando) return;
  limparMensagens();
  estado.querGravar = true;
  try {
    iniciarSessaoVoz();
  } catch (erro) {
    // start() lança se já estiver ativo; nesse caso não há o que fazer.
    console.warn("[Voz] Não foi possível iniciar:", erro);
  }
}

function pararGravacao() {
  estado.querGravar = false;
  // stop() também cobre o intervalo entre start() e onstart; é inofensivo se nada estiver gravando.
  if (reconhecimento) reconhecimento.stop();
}

function mensagemErroVoz(codigo) {
  switch (codigo) {
    case "not-allowed":
    case "service-not-allowed":
      return "Não tenho permissão para usar o microfone. Libere o acesso no ícone ao lado do endereço do site e tente de novo.";
    case "audio-capture":
      return "Não encontrei um microfone funcionando. Verifique se ele está conectado.";
    case "network":
      // Também é o erro que navegadores sem o serviço de voz do Google costumam devolver.
      return "Não consegui acessar o serviço de ditado. Verifique a internet ou use o Chrome ou o Edge.";
    case "language-not-supported":
      return "Seu navegador não oferece ditado em português. Você pode digitar normalmente.";
    default:
      return "O ditado por voz parou por um problema. Tente de novo.";
  }
}

/**
 * Opera e Brave expõem webkitSpeechRecognition, mas o reconhecimento não funciona neles
 * (não têm acesso ao serviço de voz do Google). Devolve o nome do navegador nesses casos.
 */
function navegadorSemDitado() {
  const marcas = navigator.userAgentData?.brands?.map((m) => m.brand) ?? [];
  if (/\bOPR\/|\bOPX\//.test(navigator.userAgent) || marcas.some((m) => /opera/i.test(m))) return "Opera";
  if (navigator.brave || marcas.some((m) => /brave/i.test(m))) return "Brave";
  return null;
}

function desabilitarVoz(mensagem) {
  el.botaoMic.disabled = true;
  el.avisoMic.textContent = mensagem;
  el.avisoMic.hidden = false;
}

function configurarVoz() {
  if (!Reconhecimento) {
    desabilitarVoz("Seu navegador não suporta ditado por voz. Tente o Chrome ou o Edge, ou digite normalmente.");
    return;
  }

  const semDitado = navegadorSemDitado();
  if (semDitado) {
    desabilitarVoz(
      `O ditado por voz não funciona no ${semDitado}. Para falar em vez de digitar, abra o app no Chrome ou no Edge.`
    );
    return;
  }

  reconhecimento = new Reconhecimento();
  reconhecimento.lang = "pt-BR";
  reconhecimento.continuous = true;
  reconhecimento.interimResults = true;

  reconhecimento.onstart = () => atualizarUiGravacao(true);

  reconhecimento.onresult = (evento) => {
    const partes = [];
    for (let i = estado.vozOffset; i < evento.results.length; i++) {
      const trecho = evento.results[i][0]?.transcript.trim();
      if (trecho) partes.push(trecho);
    }
    estado.vozTotal = evento.results.length;
    // Trechos finais e provisórios aparecem juntos; os provisórios são substituídos no próximo evento.
    el.texto.value = juntarTexto(estado.textoBaseVoz, partes.join(" "));
    atualizarContador();
  };

  reconhecimento.onerror = (evento) => {
    if (evento.error === "aborted") return;
    if (evento.error === "no-speech") {
      mostrarStatus("Não ouvi nada ainda. Pode falar quando quiser.");
      return; // o onend reinicia a sessão se o usuário ainda quiser gravar
    }
    estado.querGravar = false;
    mostrarErro(mensagemErroVoz(evento.error));
  };

  reconhecimento.onend = () => {
    // O Chrome encerra sozinho após silêncio; se o usuário não pediu para parar, reinicia.
    if (estado.querGravar) {
      try {
        iniciarSessaoVoz();
        return;
      } catch (erro) {
        console.warn("[Voz] Falha ao reiniciar:", erro);
        estado.querGravar = false;
      }
    }
    atualizarUiGravacao(false);
  };

  el.botaoMic.addEventListener("click", () => {
    if (estado.querGravar || estado.gravando) pararGravacao();
    else iniciarGravacao();
  });
}

// ---------------------------------------------------------------------------
// Histórico: na nuvem quando o servidor tem banco, sempre com uma cópia no LocalStorage
// ---------------------------------------------------------------------------

function validarEntradaHistorico(entrada) {
  if (!entrada || typeof entrada !== "object") return null;
  if (typeof entrada.id !== "string" || !entrada.id) return null;
  if (typeof entrada.texto !== "string" || !entrada.texto.trim()) return null;
  if (typeof entrada.data !== "string" || Number.isNaN(Date.parse(entrada.data))) return null;
  const resultado = validarResultado(entrada.resultado);
  if (!resultado) return null;
  return {
    id: entrada.id,
    data: entrada.data,
    texto: entrada.texto.slice(0, LIMITE_CARACTERES),
    resultado,
    progresso: validarProgresso(entrada.progresso),
  };
}

function gravarHistorico(lista) {
  try {
    localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(lista));
    return true;
  } catch (erro) {
    console.warn("[Histórico] Não foi possível salvar:", erro);
    return false;
  }
}

/** Lê o histórico local, descartando entradas corrompidas (e regravando a versão limpa). */
function lerHistorico() {
  let bruto;
  try {
    bruto = localStorage.getItem(CHAVE_HISTORICO);
  } catch (erro) {
    console.warn("[Histórico] LocalStorage indisponível:", erro);
    return [];
  }
  if (!bruto) return [];

  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch {
    console.warn("[Histórico] JSON corrompido; histórico descartado.");
    gravarHistorico([]);
    return [];
  }

  if (!Array.isArray(dados)) {
    gravarHistorico([]);
    return [];
  }

  const validas = dados.map(validarEntradaHistorico).filter(Boolean).slice(0, MAX_HISTORICO);
  if (validas.length !== dados.length) gravarHistorico(validas);
  return validas;
}

/** Identificador anônimo deste navegador, usado pelo servidor para separar os despejos na nuvem. */
function obterDispositivoId() {
  try {
    const salvo = localStorage.getItem(CHAVE_DISPOSITIVO);
    if (salvo && PADRAO_UUID.test(salvo)) return salvo;
  } catch {
    // LocalStorage indisponível: segue com um identificador só desta aba.
  }
  const novo = gerarId();
  try {
    localStorage.setItem(CHAVE_DISPOSITIVO, novo);
  } catch {
    console.warn("[Histórico] Sem LocalStorage: o histórico na nuvem vale só enquanto esta aba estiver aberta.");
  }
  return novo;
}

/** Chama as rotas de histórico com timeout; em erro, lança ErroAmigavel (com o status HTTP). */
async function chamarHistorico(metodo, caminho, corpo) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_HISTORICO_MS);

  const headers = { "X-Dispositivo-Id": estado.dispositivoId, ...(await cabecalhoLogin()) };
  if (corpo !== undefined) headers["Content-Type"] = "application/json";

  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controle.signal,
    });
  } catch {
    throw new ErroAmigavel("Não consegui falar com o servidor para acessar o histórico.");
  } finally {
    clearTimeout(timer);
  }

  if (resposta.status === 204) return null;

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    // Corpo vazio ou não-JSON: tratado abaixo.
  }

  if (!resposta.ok) {
    const mensagem =
      typeof dados?.erro === "string" && dados.erro.trim()
        ? dados.erro.trim()
        : "Não consegui acessar o histórico na nuvem agora.";
    const erro = new ErroAmigavel(mensagem);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

function mostrarAvisoHistorico(mensagem) {
  el.avisoHistorico.textContent = mensagem;
  el.avisoHistorico.hidden = !mensagem;
}

function atualizarTextoArmazenamento() {
  let texto;
  if (estado.nuvem) {
    texto =
      `Seus despejos ficam salvos na sua conta, na nuvem (ambiente de teste), por até ${estado.diasRetencao} dias. ` +
      "Ao sair da conta, a cópia guardada neste navegador é apagada.";
  } else if (estado.nuvemDisponivel) {
    texto =
      `Seus últimos ${MAX_HISTORICO} despejos ficam salvos só neste navegador. ` +
      "Entre com seu e-mail para guardá-los na nuvem e acessar de outros aparelhos.";
  } else {
    texto =
      `Seus últimos ${MAX_HISTORICO} despejos ficam salvos apenas neste navegador. ` +
      "Se você limpar os dados do navegador ou trocar de aparelho, eles somem.";
  }
  el.avisoArmazenamento.textContent = texto;
}

/** Pergunta ao servidor se o histórico na nuvem (com login) está disponível. */
async function verificarNuvem() {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_HISTORICO_MS);
  try {
    const resposta = await fetch("/api/status", { signal: controle.signal });
    const dados = await resposta.json();
    const auth = dados?.auth;
    const authValida =
      auth && typeof auth.url === "string" && /^https:\/\//.test(auth.url) && typeof auth.chave_publica === "string";
    estado.nuvemDisponivel = dados?.nuvem === true && Boolean(authValida);
    estado.configAuth = estado.nuvemDisponivel ? { url: auth.url, chavePublica: auth.chave_publica } : null;
    if (Number.isInteger(dados?.dias_retencao)) estado.diasRetencao = dados.dias_retencao;
  } catch {
    estado.nuvemDisponivel = false;
    estado.configAuth = null;
  } finally {
    clearTimeout(timer);
  }
  estado.nuvem = false; // só vira true quando houver alguém logado
  atualizarTextoArmazenamento();
}

/** Mostra o histórico: da nuvem quando disponível; senão (ou se a nuvem falhar), o do navegador. */
async function carregarHistorico() {
  mostrarAvisoHistorico("");
  estado.historicoDaNuvem = false;
  if (!estado.nuvem) {
    renderizarHistorico(lerHistorico());
    return;
  }
  try {
    const dados = await chamarHistorico("GET", `/api/despejos?limite=${MAX_HISTORICO}`);
    const lista = Array.isArray(dados?.despejos) ? dados.despejos.map(validarEntradaHistorico).filter(Boolean) : [];
    estado.historicoDaNuvem = true;
    renderizarHistorico(lista);
  } catch (erro) {
    const motivo = erro instanceof ErroAmigavel ? erro.message : "Não consegui carregar o histórico da nuvem.";
    mostrarAvisoHistorico(`${motivo} Mostrando o que está salvo neste navegador.`);
    renderizarHistorico(lerHistorico());
  }
}

/**
 * Registra um despejo recém-organizado. O servidor já salvou na nuvem (quando `despejo` vem
 * preenchido); aqui guardamos a cópia local, com o mesmo id, e atualizamos o painel.
 */
async function salvarNoHistorico(texto, resultado, despejo, id) {
  const entrada = {
    id,
    data: despejo?.data ?? new Date().toISOString(),
    texto,
    resultado,
    progresso: progressoVazio(),
  };
  const salvouLocal = gravarHistorico(
    [entrada, ...lerHistorico().filter((item) => item.id !== entrada.id)].slice(0, MAX_HISTORICO)
  );

  await carregarHistorico();

  if (estado.nuvem && !despejo) {
    mostrarAvisoHistorico("Não consegui salvar este despejo na nuvem; ele ficou salvo só neste navegador.");
  } else if (!estado.nuvem && !salvouLocal) {
    mostrarAvisoHistorico("Não consegui salvar este despejo no histórico do navegador. O resultado continua aqui na tela.");
  }
}

function criarItemHistorico(entrada) {
  const dataFormatada = formatarData(entrada.data);

  const li = document.createElement("li");
  li.className = "flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3";

  const info = document.createElement("div");
  info.className = "min-w-0 flex-1";

  const quando = document.createElement("time");
  quando.dateTime = entrada.data;
  quando.className = "block text-xs text-slate-500";
  quando.textContent = dataFormatada;

  const resumo = document.createElement("p");
  resumo.className = "mt-1 truncate text-sm text-slate-300";
  resumo.textContent = entrada.texto.replace(/\s+/g, " ").trim().slice(0, 120);

  info.append(quando, resumo, criarPreviaHistorico(entrada));

  const acoes = document.createElement("div");
  acoes.className = "flex shrink-0 items-center gap-1";

  const botaoReabrir = document.createElement("button");
  botaoReabrir.type = "button";
  botaoReabrir.className =
    "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 hover:bg-slate-800";
  botaoReabrir.textContent = "Reabrir";
  botaoReabrir.setAttribute("aria-label", `Reabrir despejo de ${dataFormatada}`);
  // Busca a entrada na hora do clique, para pegar o progresso mais recente.
  botaoReabrir.addEventListener("click", () =>
    reabrirDespejo(estado.historicoExibido.find((item) => item.id === entrada.id) ?? entrada)
  );

  const botaoApagar = document.createElement("button");
  botaoApagar.type = "button";
  botaoApagar.className = "rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-rose-200";
  botaoApagar.textContent = "Apagar";
  botaoApagar.setAttribute("aria-label", `Apagar despejo de ${dataFormatada}`);
  botaoApagar.addEventListener("click", () => apagarDespejo(entrada));

  acoes.append(botaoReabrir, botaoApagar);
  li.append(info, acoes);
  return li;
}

/** Selos com o resumo do despejo: quantos itens de cada categoria e tarefas feitas. */
function criarPreviaHistorico(entrada) {
  const previa = document.createElement("ul");
  previa.className = "mt-2 flex flex-wrap gap-1.5";
  previa.setAttribute("aria-label", "Resumo do despejo");

  const selo = (texto, classe) => {
    const item = document.createElement("li");
    item.className = `rounded-full px-2 py-0.5 text-[11px] ${classe}`;
    item.textContent = texto;
    previa.append(item);
  };

  const nomes = {
    tarefas: ["tarefa", "tarefas"],
    ideias: ["ideia", "ideias"],
    duvidas: ["dúvida", "dúvidas"],
    desabafos: ["desabafo", "desabafos"],
  };
  for (const { chave, selo: cor } of CATEGORIAS) {
    const n = entrada.resultado?.[chave]?.length ?? 0;
    if (n > 0) selo(`${n} ${plural(n, ...nomes[chave])}`, `${cor} text-slate-300`);
  }

  const total = entrada.resultado?.tarefas?.length ?? 0;
  const feitas = (entrada.progresso?.concluidas ?? []).filter((i) => i < total).length;
  if (total > 0 && feitas > 0) selo(`✓ ${feitas}/${total} feitas`, "bg-slate-800 text-teal-300");
  return previa;
}

function renderizarHistorico(lista) {
  estado.historicoExibido = lista;
  el.historicoContagem.textContent = `(${lista.length})`;
  el.historicoVazio.hidden = lista.length > 0;
  el.botaoLimparHistorico.hidden = lista.length === 0;
  el.historicoLista.replaceChildren(...lista.map(criarItemHistorico));
}

function reabrirDespejo(entrada) {
  if (estado.enviando) return;
  pararGravacao();
  el.texto.value = entrada.texto;
  atualizarContador();
  limparMensagens();
  renderizarResultado(entrada.resultado, entrada.texto, {
    id: entrada.id,
    naNuvem: estado.historicoDaNuvem,
    progresso: entrada.progresso,
  });
  mostrarStatus(`Despejo de ${formatarData(entrada.data)} reaberto.`);
  focarResultado();
}

async function apagarDespejo(entrada) {
  const dataFormatada = formatarData(entrada.data);
  if (!window.confirm(`Apagar o despejo de ${dataFormatada}? Isso não pode ser desfeito.`)) return;

  limparMensagens();
  if (estado.nuvem) {
    try {
      await chamarHistorico("DELETE", `/api/despejos/${encodeURIComponent(entrada.id)}`);
    } catch (erro) {
      // 404: já não existe na nuvem; segue apagando a cópia local.
      if (erro.status !== 404) {
        mostrarErro(erro instanceof ErroAmigavel ? erro.message : "Não consegui apagar agora. Tente de novo.");
        return;
      }
    }
  }

  gravarHistorico(lerHistorico().filter((item) => item.id !== entrada.id));
  await carregarHistorico();
  mostrarStatus(`Despejo de ${dataFormatada} apagado.`);
  el.painelHistorico.querySelector("summary").focus();
}

async function limparHistorico() {
  const pergunta = estado.nuvem
    ? "Apagar todo o histórico deste navegador, inclusive o que está salvo na nuvem? Isso não pode ser desfeito."
    : "Apagar todo o histórico deste navegador? Isso não pode ser desfeito.";
  if (!window.confirm(pergunta)) return;

  limparMensagens();
  if (estado.nuvem) {
    try {
      await chamarHistorico("DELETE", "/api/despejos");
    } catch (erro) {
      mostrarErro(erro instanceof ErroAmigavel ? erro.message : "Não consegui apagar o histórico agora. Tente de novo.");
      return;
    }
  }

  try {
    localStorage.removeItem(CHAVE_HISTORICO);
  } catch (erro) {
    console.warn("[Histórico] Não foi possível apagar:", erro);
  }
  await carregarHistorico();
  mostrarStatus("Histórico apagado.");
  el.painelHistorico.querySelector("summary").focus();
}

// ---------------------------------------------------------------------------
// Conta (login com link mágico do Supabase)
// ---------------------------------------------------------------------------

/** Cabeçalho Authorization com o token da sessão, quando há alguém logado. */
async function cabecalhoLogin() {
  if (!estado.supabase || !estado.usuario) return {};
  try {
    // getSession() devolve a sessão atual e renova o token se ele estiver para vencer.
    const { data } = await estado.supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function atualizarUiConta() {
  el.conta.hidden = !estado.nuvemDisponivel;
  const logado = Boolean(estado.usuario);
  el.botaoEntrar.hidden = logado;
  el.contaLogada.hidden = !logado;
  el.contaEmail.textContent = estado.usuario?.email ?? "";
  el.contaEmail.title = estado.usuario?.email ?? "";
  if (logado) fecharFormLogin({ devolverFoco: false });
}

function abrirFormLogin() {
  el.formLogin.hidden = false;
  el.botaoEntrar.setAttribute("aria-expanded", "true");
  el.statusLogin.textContent = "";
  el.emailLogin.focus();
}

function fecharFormLogin({ devolverFoco = true } = {}) {
  if (el.formLogin.hidden) return;
  el.formLogin.hidden = true;
  el.botaoEntrar.setAttribute("aria-expanded", "false");
  if (devolverFoco && !el.botaoEntrar.hidden) el.botaoEntrar.focus();
}

async function enviarLinkLogin() {
  if (!estado.supabase || el.botaoEnviarLink.disabled) return;

  const email = el.emailLogin.value.trim();
  if (!PADRAO_EMAIL.test(email)) {
    el.statusLogin.textContent = "Confira o e-mail: parece que falta alguma coisa.";
    el.emailLogin.focus();
    return;
  }

  el.botaoEnviarLink.disabled = true;
  el.botaoEnviarLink.textContent = "Enviando…";
  el.statusLogin.textContent = "";
  try {
    const { error } = await estado.supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    if (error) throw error;
    el.statusLogin.textContent =
      `Pronto! Enviamos um link de acesso para ${email}. Abra seu e-mail e clique nele (confira também o spam).`;
  } catch (erro) {
    console.warn("[Login] Falha ao enviar o link:", erro);
    el.statusLogin.textContent =
      erro?.status === 429
        ? "Muitos pedidos de link em pouco tempo. Espere alguns minutos e tente de novo."
        : "Não consegui enviar o link agora. Confira o e-mail e tente de novo em instantes.";
  } finally {
    el.botaoEnviarLink.disabled = false;
    el.botaoEnviarLink.textContent = "Enviar link";
  }
}

async function sair() {
  if (!estado.supabase) return;
  el.botaoSair.disabled = true;
  try {
    // "local": sai só deste navegador, sem derrubar a sessão em outros aparelhos.
    const { error } = await estado.supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  } catch (erro) {
    console.warn("[Login] Falha ao sair:", erro);
    mostrarErro("Não consegui sair da conta agora. Tente de novo.");
  } finally {
    el.botaoSair.disabled = false;
  }
}

function apagarCopiaLocal() {
  try {
    localStorage.removeItem(CHAVE_HISTORICO);
  } catch (erro) {
    console.warn("[Histórico] Não foi possível apagar a cópia local:", erro);
  }
}

/**
 * Leva para a conta os despejos guardados só neste navegador (e os que ele salvou na nuvem antes
 * do login). Pode ser chamada mais de uma vez: o servidor ignora o que já foi importado.
 * Devolve quantos despejos foram levados, ou null se falhar.
 */
async function importarParaConta() {
  try {
    const dados = await chamarHistorico("POST", "/api/despejos/importar", { despejos: lerHistorico() });
    return (dados?.importados ?? 0) + (dados?.vinculados ?? 0);
  } catch (erro) {
    console.warn("[Login] Falha ao importar o histórico deste navegador:", erro);
    return null;
  }
}

/** Reage a entradas e saídas da conta (chamada em fila, uma de cada vez). */
async function tratarMudancaDeSessao(evento, sessao, { veioDoLink }) {
  const anterior = estado.usuario;
  const usuario = sessao?.user ? { id: sessao.user.id, email: sessao.user.email ?? "" } : null;

  estado.usuario = usuario;
  estado.nuvem = estado.nuvemDisponivel && Boolean(usuario);
  atualizarUiConta();
  atualizarTextoArmazenamento();

  // Entrou (ou abriu a página já logado): leva o histórico local para a conta e carrega o da nuvem.
  if (usuario && anterior?.id !== usuario.id) {
    const levados = await importarParaConta();
    await carregarHistorico();

    const partes = [];
    if (veioDoLink || evento === "SIGNED_IN") partes.push(`Você entrou como ${usuario.email}.`);
    if (levados > 0) {
      partes.push(
        `${levados} ${plural(levados, "despejo deste navegador foi salvo", "despejos deste navegador foram salvos")} na sua conta.`
      );
    }
    if (partes.length) mostrarStatus(partes.join(" "));
    if (levados === null) {
      mostrarAvisoHistorico("Não consegui levar o histórico deste navegador para a sua conta agora. Ele continua salvo aqui.");
    }
    return;
  }

  // Saiu: apaga a cópia local (protege quem usa um computador compartilhado) e limpa a tela.
  if (!usuario && anterior) {
    apagarCopiaLocal();
    novoDespejo();
    await carregarHistorico();
    mostrarStatus("Você saiu da conta. A cópia do histórico guardada neste navegador foi apagada.");
    return;
  }

  // Abriu a página sem estar logado.
  if (evento === "INITIAL_SESSION") await carregarHistorico();
}

/** Mensagem de erro que o Supabase coloca no endereço quando o link de acesso não vale mais. */
function lerErroDoLink() {
  const parametros = new URLSearchParams(window.location.hash.slice(1));
  const codigo = parametros.get("error_code") || parametros.get("error");
  if (!codigo) return null;
  return codigo === "otp_expired"
    ? "Esse link de acesso expirou ou já foi usado. Peça um novo em “Entrar”."
    : "Não consegui concluir o login com esse link. Peça um novo em “Entrar”.";
}

/** Carrega a biblioteca do Supabase e passa a acompanhar a sessão. */
async function iniciarLogin() {
  const veioDoLink = /access_token=/.test(window.location.hash);
  const erroDoLink = lerErroDoLink();

  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_JS_URL));
  } catch (erro) {
    console.warn("[Login] Não consegui carregar a biblioteca de login:", erro);
    estado.nuvemDisponivel = false;
    atualizarUiConta();
    atualizarTextoArmazenamento();
    await carregarHistorico();
    mostrarAvisoHistorico("Não consegui carregar o login agora. O histórico fica salvo só neste navegador.");
    return;
  }

  estado.supabase = createClient(estado.configAuth.url, estado.configAuth.chavePublica, {
    auth: {
      // "implicit": o link funciona mesmo se o e-mail abrir em outro navegador (comum no celular).
      flowType: "implicit",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "brainDumpAI.sessao",
    },
  });

  let fila = Promise.resolve();
  estado.supabase.auth.onAuthStateChange((evento, sessao) => {
    // A biblioteca recomenda não chamar o Supabase dentro deste callback: agendamos o tratamento,
    // em fila, para os eventos serem processados um de cada vez.
    setTimeout(() => {
      fila = fila
        .then(() => tratarMudancaDeSessao(evento, sessao, { veioDoLink }))
        .catch((erro) => console.error("[Login] Erro ao tratar a sessão:", erro));
    }, 0);
  });

  // Tira tokens ou erros do endereço (não ficam no histórico do navegador).
  if (window.location.hash) {
    setTimeout(() => history.replaceState(null, "", window.location.pathname + window.location.search), 0);
  }
  if (erroDoLink) {
    abrirFormLogin();
    el.statusLogin.textContent = erroDoLink;
  }
  atualizarUiConta();
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

function iniciar() {
  // Dica do atalho conforme o sistema
  const plataforma = navigator.userAgentData?.platform || navigator.platform || "";
  if (/mac|iphone|ipad/i.test(plataforma)) {
    el.teclaMod.textContent = "⌘";
    el.teclaMod.title = "Command";
  }

  el.form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    enviar();
  });

  el.texto.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      enviar();
    }
  });

  el.texto.addEventListener("input", () => {
    // Se o usuário digitar durante a gravação, o que está na tela vira a nova base do ditado.
    if (estado.gravando) {
      estado.textoBaseVoz = el.texto.value;
      estado.vozOffset = estado.vozTotal;
    }
    atualizarContador();
  });

  el.botaoExemplo.addEventListener("click", mostrarExemplo);
  // A largura muda (girar o celular, redimensionar a janela): recalcula a altura da caixa de texto.
  window.addEventListener("resize", ajustarAlturaTexto, { passive: true });
  el.botaoCopiar.addEventListener("click", copiarTarefas);
  el.botaoNovo.addEventListener("click", novoDespejo);
  el.botaoLimparHistorico.addEventListener("click", limparHistorico);

  configurarVoz();
  atualizarContador();

  // Conta
  el.botaoEntrar.addEventListener("click", () => (el.formLogin.hidden ? abrirFormLogin() : fecharFormLogin()));
  el.botaoFecharLogin.addEventListener("click", () => fecharFormLogin());
  el.botaoSair.addEventListener("click", sair);
  el.formLogin.addEventListener("submit", (evento) => {
    evento.preventDefault();
    enviarLinkLogin();
  });
  el.formLogin.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") fecharFormLogin();
  });

  // Histórico: mostra logo a cópia local; se o servidor tiver nuvem com login, inicia o login
  // (que carrega o histórico da conta quando houver alguém logado).
  estado.dispositivoId = obterDispositivoId();
  atualizarTextoArmazenamento();
  renderizarHistorico(lerHistorico());
  verificarNuvem().then(() => (estado.nuvemDisponivel ? iniciarLogin() : carregarHistorico()));
}

iniciar();
