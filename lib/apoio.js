// Rede de segurança para o cartão de apoio (CVV).
// A IA já marca `sugerir_apoio` quando percebe sofrimento intenso; esta verificação simples
// garante o cartão mesmo que o modelo deixe passar uma expressão explícita de risco.
// Um falso positivo só mostra uma mensagem gentil com o contato do CVV, então
// preferimos errar para o lado de mostrar.

const EXPRESSOES_DE_RISCO = [
  // "vou me matar" conta; expressões como "isso vai me matar de tédio" ou "minha mãe vai me matar" não.
  /(?<!\b(vai|vao|ia|iam) )\bme matar\b(?! de (rir|tedio|vergonha|raiva|cansaco|fome|saudade|trabalhar|trabalho))/,
  /\bsuicid/,
  /\btirar (a )?minha (propria )?vida\b/,
  /\bacabar com (a )?minha (propria )?vida\b/,
  /\bnao (quero|aguento) mais viver\b/,
  /\bquero morrer\b/,
  /\bqueria (estar )?morrer\b/,
  /\bqueria (estar )?mort[oa]\b/,
  /\bme machucar\b/,
  /\bme cortar\b/,
  /\bautomutila/,
  /\bsumir para sempre\b/,
  /\bseria melhor sem mim\b/,
  /\bmelhor (se eu|eu) nao existisse\b/,
  /\bnao vejo (mais )?sentido (em|na) (viver|vida)\b/,
];

/** Normaliza para comparação: minúsculas, sem acentos e com espaços simples. */
export function normalizar(texto) {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** true se o texto contiver alguma expressão explícita de risco. */
export function detectarSinaisDeRisco(texto) {
  const normalizado = normalizar(texto);
  return EXPRESSOES_DE_RISCO.some((expressao) => expressao.test(normalizado));
}
