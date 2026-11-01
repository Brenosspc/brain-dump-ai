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
  // Despejo na tela: { id, naNuvem } e o progresso do checklist
  despejoAtual: null,
  progresso: { concluidas: [], micro_passos: {} },
  timersProgresso: new Map(), // id do despejo -> timer do envio do progresso à nuvem
  // Histórico
  nuvem: false, // o servidor tem banco de dados configurado
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

  // Campo novo: despejos antigos do histórico não têm, e contam como false.
  resultado.sugerir_apoio = dados.sugerir_apoio === true;

  return resultado;
}

function progressoVazio() {
  return { concluidas: [], micro_passos: {} };
}

/**
 * Valida o progresso de um despejo (tarefas concluídas e micro-passos), no mesmo formato
 * aceito pelo servidor. Devolve sempre um objeto válido (vazio se a entrada for inválida).
 */
function validarProgresso(dados) {
  const progresso = progressoVazio();
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return progresso;

  if (Array.isArray(dados.concluidas)) {
    const indices = dados.concluidas.filter((n) => Number.isInteger(n) && n >= 0 && n < 100);
    progresso.concluidas = [...new Set(indices)].sort((a, b) => a - b);
  }

  const origem = dados.micro_passos;
  if (origem && typeof origem === "object" && !Array.isArray(origem)) {
    for (const [chave, passos] of Object.entries(origem)) {
      if (!/^\d{1,2}$/.test(chave) || !Array.isArray(passos)) continue;
      const limpos = passos
        .filter((passo) => typeof passo === "string" && passo.trim())
        .map((passo) => passo.trim().slice(0, 200))
        .slice(0, 6);
      if (limpos.length > 0) progresso.micro_passos[String(Number(chave))] = limpos;
    }
  }
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
      headers: { "Content-Type": "application/json", "X-Dispositivo-Id": estado.dispositivoId },
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

  return { resultado, despejo };
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
    const { resultado, despejo } = await chamarApi(texto);
    definirEnviando(false);
    // Usa o id da nuvem quando o servidor salvou; senão, um id local.
    const id = despejo?.id ?? gerarId();
    renderizarResultado(resultado, texto, { id, naNuvem: Boolean(despejo) });
    void salvarNoHistorico(texto, resultado, despejo, id); // atualiza o painel em segundo plano
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

/**
 * @param {object} resultado resultado validado
 * @param {string} texto texto original do despejo
 * @param {{ id?: string, naNuvem?: boolean, progresso?: object }} [contexto] identificação e progresso salvos
 */
function renderizarResultado(resultado, texto, { id = null, naNuvem = false, progresso = null } = {}) {
  estado.resultadoAtual = resultado;
  estado.despejoAtual = id ? { id, naNuvem } : null;
  estado.progresso = validarProgresso(progresso);

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

  el.metricaPercentual.textContent = `Sua mente está ${percentual}% mais leve`;
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
// Checklist de tarefas e micro-passos
// ---------------------------------------------------------------------------

function criarCartaoTarefas({ chave, emoji, titulo }, tarefas) {
  const secao = document.createElement("section");
  secao.className = "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:col-span-2";
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
  contagem.dataset.contagemTarefas = "";

  cabecalho.append(icone, nome, contagem);

  const lista = document.createElement("ul");
  lista.className = "mt-3 space-y-3";
  tarefas.forEach((tarefa, indice) => lista.append(criarItemTarefa(tarefa, indice)));

  const parabens = document.createElement("p");
  parabens.className = "mt-4 text-sm text-sky-300";
  parabens.dataset.tarefasConcluidas = "";
  parabens.hidden = true;
  parabens.textContent = "Tudo feito por aqui. 🌱 Bom trabalho, no seu ritmo.";

  secao.append(cabecalho, lista, parabens);
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
    const passos = await chamarMicroPassos(tarefa);
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
// Novo despejo
// ---------------------------------------------------------------------------

function novoDespejo() {
  pararGravacao();
  estado.resultadoAtual = null;
  estado.despejoAtual = null;
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

  const headers = { "X-Dispositivo-Id": estado.dispositivoId };
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
  el.avisoArmazenamento.textContent = estado.nuvem
    ? `Modo de teste: seus despejos ficam salvos num banco de dados na nuvem por até ${estado.diasRetencao} dias, ` +
      "ligados a este navegador (sem login). Não escreva informações reais ou sensíveis."
    : `Seus últimos ${MAX_HISTORICO} despejos ficam salvos apenas neste navegador. ` +
      "Se você limpar os dados do navegador ou trocar de aparelho, eles somem.";
}

/** Pergunta ao servidor se o histórico na nuvem está ativo. */
async function verificarNuvem() {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_HISTORICO_MS);
  try {
    const resposta = await fetch("/api/status", { signal: controle.signal });
    const dados = await resposta.json();
    estado.nuvem = dados?.nuvem === true;
    if (Number.isInteger(dados?.dias_retencao)) estado.diasRetencao = dados.dias_retencao;
  } catch {
    estado.nuvem = false;
  } finally {
    clearTimeout(timer);
  }
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

  info.append(quando, resumo);

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

  // Histórico: mostra logo a cópia local e, se o servidor tiver banco, troca pela da nuvem.
  estado.dispositivoId = obterDispositivoId();
  atualizarTextoArmazenamento();
  renderizarHistorico(lerHistorico());
  verificarNuvem().then(carregarHistorico);
}

iniciar();
