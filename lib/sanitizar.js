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

  return resposta;
}
