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
const CHAVE_HISTORICO = "brainDumpAI.historico";
const MAX_HISTORICO = 5;
const DURACAO_FEEDBACK_COPIA_MS = 2_000;

const CATEGORIAS = [
  { chave: "tarefas", emoji: "🔴", titulo: "Tarefas" },
  { chave: "ideias", emoji: "💡", titulo: "Ideias" },
  { chave: "duvidas", emoji: "❓", titulo: "Dúvidas" },
  { chave: "desabafos", emoji: "🧘", titulo: "Desabafos" },
];

const CAMPOS_TEXTO = ["sintese_acolhedora", "nivel_carga_cognitiva", "estado_mental"];

// ---------------------------------------------------------------------------
// Referências do DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  form: $("form-despejo"),
  texto: $("texto"),
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

function gerarId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  atualizarBotaoEnviar();
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

  return resultado;
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
      headers: { "Content-Type": "application/json" },
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
  return resultado;
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
    const resultado = await chamarApi(texto);
    definirEnviando(false);
    renderizarResultado(resultado, texto);
    salvarNoHistorico(texto, resultado);
    mostrarStatus("Pronto! Seus pensamentos foram organizados.");
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

function criarCartao({ chave, emoji, titulo }, itens) {
  const secao = document.createElement("section");
  secao.className = "rounded-2xl border border-slate-800 bg-slate-900/60 p-5";
  secao.setAttribute("aria-labelledby", `cartao-${chave}`);

  const cabecalho = document.createElement("h3");
  cabecalho.id = `cartao-${chave}`;
  cabecalho.className = "flex items-center gap-2 text-base font-semibold text-slate-100";

  const icone = document.createElement("span");
  icone.setAttribute("aria-hidden", "true");
  icone.textContent = emoji;

  const nome = document.createElement("span");
  nome.textContent = titulo;

  const contagem = document.createElement("span");
  contagem.className = "ml-auto text-xs font-normal text-slate-500";
  contagem.textContent = `${itens.length} ${plural(itens.length, "item", "itens")}`;

  cabecalho.append(icone, nome, contagem);

  const lista = document.createElement("ul");
  lista.className = "mt-3 list-disc space-y-2 pl-5 leading-relaxed text-slate-300 marker:text-slate-600";
  for (const item of itens) {
    const li = document.createElement("li");
    li.textContent = item;
    lista.append(li);
  }

  secao.append(cabecalho, lista);
  return secao;
}

function renderizarResultado(resultado, texto) {
  estado.resultadoAtual = resultado;

  el.sintese.textContent = resultado.sintese_acolhedora;
  el.tagCarga.textContent = `Carga cognitiva: ${resultado.nivel_carga_cognitiva}`;
  el.tagEstado.textContent = `Estado: ${resultado.estado_mental}`;

  // Métrica de peso cognitivo
  const palavras = contarPalavras(texto);
  const caracteres = texto.length;
  const itens = CATEGORIAS.reduce((soma, { chave }) => soma + resultado[chave].length, 0);
  const percentual = calcularLeveza(palavras, itens);

  el.metricaPercentual.textContent = `Sua mente está ${percentual}% mais leve`;
  el.metricaDetalhe.textContent =
    `Processamos ${formatarNumero(palavras)} ${plural(palavras, "palavra", "palavras")} ` +
    `(${formatarNumero(caracteres)} caracteres) e organizamos em ${itens} ${plural(itens, "item", "itens")}.`;

  // Cartões: só os que têm itens
  const cartoes = CATEGORIAS.filter(({ chave }) => resultado[chave].length > 0).map((categoria) =>
    criarCartao(categoria, resultado[categoria.chave])
  );
  if (cartoes.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "text-sm text-slate-400 sm:col-span-2";
    vazio.textContent = "Não encontrei itens para separar desta vez. Tudo bem: escrever já ajuda.";
    cartoes.push(vazio);
  }
  el.cartoes.replaceChildren(...cartoes);

  // Botão de copiar só aparece se houver tarefas
  el.botaoCopiar.hidden = resultado.tarefas.length === 0;
  clearTimeout(estado.timerCopia);
  el.rotuloCopiar.textContent = "Copiar apenas tarefas";

  // Mostra o resultado e anima a barra a partir do zero
  el.metricaBarra.style.width = "0%";
  el.resultado.hidden = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.metricaBarra.style.width = `${percentual}%`;
    })
  );
}

function focarResultado() {
  el.tituloResultado.focus({ preventScroll: true });
  el.resultado.scrollIntoView({ behavior: reduzMovimento() ? "auto" : "smooth", block: "start" });
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
// Novo despejo
// ---------------------------------------------------------------------------

function novoDespejo() {
  pararGravacao();
  estado.resultadoAtual = null;
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
// Histórico (LocalStorage)
// ---------------------------------------------------------------------------

function validarEntradaHistorico(entrada) {
  if (!entrada || typeof entrada !== "object") return null;
  if (typeof entrada.id !== "string" || !entrada.id) return null;
  if (typeof entrada.texto !== "string" || !entrada.texto.trim()) return null;
  if (typeof entrada.data !== "string" || Number.isNaN(Date.parse(entrada.data))) return null;
  const resultado = validarResultado(entrada.resultado);
  if (!resultado) return null;
  return { id: entrada.id, data: entrada.data, texto: entrada.texto.slice(0, LIMITE_CARACTERES), resultado };
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

/** Lê o histórico, descartando entradas corrompidas (e regravando a versão limpa). */
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

function salvarNoHistorico(texto, resultado) {
  const entrada = { id: gerarId(), data: new Date().toISOString(), texto, resultado };
  const lista = [entrada, ...lerHistorico()].slice(0, MAX_HISTORICO);

  if (gravarHistorico(lista)) {
    el.avisoHistorico.hidden = true;
  } else {
    el.avisoHistorico.textContent =
      "Não consegui salvar este despejo no histórico do navegador. O resultado continua aqui na tela.";
    el.avisoHistorico.hidden = false;
  }
  renderizarHistorico(lerHistorico());
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

  info.append(quando, resumo);

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className =
    "shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 hover:bg-slate-800";
  botao.textContent = "Reabrir";
  botao.setAttribute("aria-label", `Reabrir despejo de ${dataFormatada}`);
  botao.addEventListener("click", () => reabrirDespejo(entrada));

  li.append(info, botao);
  return li;
}

function renderizarHistorico(lista) {
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
  renderizarResultado(entrada.resultado, entrada.texto);
  mostrarStatus(`Despejo de ${formatarData(entrada.data)} reaberto.`);
  focarResultado();
}

function limparHistorico() {
  const confirmou = window.confirm("Apagar todo o histórico deste navegador? Isso não pode ser desfeito.");
  if (!confirmou) return;

  try {
    localStorage.removeItem(CHAVE_HISTORICO);
  } catch (erro) {
    console.warn("[Histórico] Não foi possível apagar:", erro);
  }
  el.avisoHistorico.hidden = true;
  renderizarHistorico(lerHistorico());
  mostrarStatus("Histórico apagado.");
  el.painelHistorico.querySelector("summary").focus();
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

  el.botaoCopiar.addEventListener("click", copiarTarefas);
  el.botaoNovo.addEventListener("click", novoDespejo);
  el.botaoLimparHistorico.addEventListener("click", limparHistorico);

  configurarVoz();
  atualizarContador();
  renderizarHistorico(lerHistorico());
}

iniciar();
