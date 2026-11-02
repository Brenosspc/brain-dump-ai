// Temas em que a IA NÃO dá sugestão ("primeiro passo" ou "perguntas para pensar"):
// saúde (principalmente remédios e tratamento), finanças e questões jurídicas.
// Duas camadas, como no cartão de apoio: a IA marca `tema_sensivel` e esta lista simples
// cobre os casos mais perigosos (remédios e tratamento) mesmo que o modelo deixe passar.
// Um falso positivo só mostra a sugestão de conversar com um profissional.
import { normalizar } from "./apoio.js";

export const MENSAGEM_PROFISSIONAL =
  "Esse assunto merece a conversa com um profissional (médico, psicólogo, contador ou advogado, conforme o caso). Aqui eu não dou sugestões sobre ele.";

const EXPRESSOES_SENSIVEIS = [
  /\b(remedio|remedios|medicamento|medicamentos|medicacao|medicacoes)\b/,
  /\b(dose|dosagem|miligrama|mg)\b/,
  /\b(tarja preta|antidepressivo|ansiolitico|calmante|estimulante)s?\b/,
  /\b(ritalina|venvanse|concerta|rivotril|clonazepam|sertralina|fluoxetina|escitalopram)\b/,
  /\bparar de tomar\b/,
  /\b(psiquiatra|diagnostico|tratamento|terapia)\b/,
];

/** true se o texto falar de remédios, tratamento ou diagnóstico. */
export function detectarTemaSensivel(texto) {
  const normalizado = normalizar(texto);
  return EXPRESSOES_SENSIVEIS.some((expressao) => expressao.test(normalizado));
}
