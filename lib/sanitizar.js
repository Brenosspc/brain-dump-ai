// Limpeza da resposta da IA. O responseSchema garante o formato, mas não a qualidade:
// aqui removemos itens vazios, espaços sobrando e duplicatas, e garantimos valores válidos.

export const NIVEIS_CARGA = ["Baixa", "Moderada", "Alta", "Muito Alta"];
export const CATEGORIAS = ["tarefas", "ideias", "duvidas", "desabafos"];

const SINTESE_PADRAO = "Obrigado por colocar tudo para fora. Vamos olhar para isso com calma, um passo de cada vez.";
const ESTADO_PADRAO = "Pensamentos Variados";

// Normaliza espaços: tira das pontas e colapsa espaços/quebras repetidos no meio.
function limparTexto(valor) {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
}

// Chave de comparação para detectar duplicatas: ignora maiúsculas, acentos e pontuação final.
function chaveComparacao(texto) {
  return texto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.!?;:,\s]+$/, "");
}

/**
 * Limpa uma lista de itens: só strings, sem vazios e sem duplicatas (mantém a primeira ocorrência).
 */
export function limparLista(lista) {
  if (!Array.isArray(lista)) return [];

  const vistos = new Set();
  const resultado = [];
  for (const item of lista) {
    const texto = limparTexto(item);
    if (!texto) continue;
    const chave = chaveComparacao(texto);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(texto);
  }
  return resultado;
}

/**
 * Devolve uma cópia limpa da resposta da IA, contendo apenas os campos do schema.
 * Campos inválidos recebem um valor padrão seguro (e geram aviso no console).
 */
export function sanitizarResposta(dados) {
  const entrada = dados && typeof dados === "object" ? dados : {};

  let nivel = limparTexto(entrada.nivel_carga_cognitiva);
  if (!NIVEIS_CARGA.includes(nivel)) {
    console.warn("[Sanitização] nivel_carga_cognitiva fora do enum:", entrada.nivel_carga_cognitiva);
    nivel = "Moderada";
  }

  const resposta = {
    sintese_acolhedora: limparTexto(entrada.sintese_acolhedora) || SINTESE_PADRAO,
    nivel_carga_cognitiva: nivel,
    estado_mental: limparTexto(entrada.estado_mental) || ESTADO_PADRAO,
  };

  for (const categoria of CATEGORIAS) {
    resposta[categoria] = limparLista(entrada[categoria]);
  }

  // Só um true explícito ativa o cartão de apoio (qualquer outro valor vira false).
  resposta.sugerir_apoio = entrada.sugerir_apoio === true;

  return resposta;
}

// ---------------------------------------------------------------------------
// Micro-passos e progresso do checklist
// ---------------------------------------------------------------------------

export const MAX_PASSOS = 6;
const MAX_CARACTERES_PASSO = 200;
const MAX_TAREFAS = 100;

/** Limpa os micro-passos devolvidos pela IA: no máximo 6, sem vazios ou duplicados, sem textos enormes. */
export function sanitizarPassos(dados) {
  return limparLista(dados?.passos)
    .map((passo) => passo.slice(0, MAX_CARACTERES_PASSO))
    .slice(0, MAX_PASSOS);
}

export const MAX_PERGUNTAS = 3;

/** Primeiro passo de uma ideia: um texto curto, ou "" se não vier nada útil. */
export function sanitizarPrimeiroPasso(dados) {
  return limparTexto(dados?.passo).slice(0, MAX_CARACTERES_PASSO);
}

/** Perguntas para pensar sobre uma dúvida: até 3, sem vazias nem repetidas. */
export function sanitizarPerguntas(dados) {
  return limparLista(dados?.perguntas)
    .map((pergunta) => pergunta.slice(0, MAX_CARACTERES_PASSO))
    .slice(0, MAX_PERGUNTAS);
}

/** Percorre um objeto { "<índice>": valor } e mantém só índices válidos com valor aproveitável. */
function porIndice(origem, limpar) {
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
 * Valida o progresso de um despejo enviado pelo navegador:
 *   { concluidas: number[], micro_passos: { "<índice da tarefa>": string[] },
 *     primeiros_passos: { "<índice da ideia>": string }, perguntas: { "<índice da dúvida>": string[] } }
 * Descarta tudo o que estiver fora do formato. Devolve null se não for um objeto.
 */
export function sanitizarProgresso(progresso) {
  if (!progresso || typeof progresso !== "object" || Array.isArray(progresso)) return null;

  const indiceValido = (n) => Number.isInteger(n) && n >= 0 && n < MAX_TAREFAS;

  const concluidas = Array.isArray(progresso.concluidas)
    ? [...new Set(progresso.concluidas.filter(indiceValido))].sort((a, b) => a - b)
    : [];

  return {
    concluidas,
    micro_passos: porIndice(progresso.micro_passos, (passos) => sanitizarPassos({ passos })),
    primeiros_passos: porIndice(progresso.primeiros_passos, (passo) => sanitizarPrimeiroPasso({ passo })),
    perguntas: porIndice(progresso.perguntas, (perguntas) => sanitizarPerguntas({ perguntas })),
  };
}
