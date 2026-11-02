// Testes da lista de temas sensíveis (lib/temas-sensiveis.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectarTemaSensivel, MENSAGEM_PROFISSIONAL } from "../lib/temas-sensiveis.js";

describe("detectarTemaSensivel", () => {
  for (const texto of [
    "Devo parar de tomar o remédio?",
    "aumentar a dose da Ritalina",
    "Será que preciso de um PSIQUIATRA?",
    "tomo 10 mg de sertralina",
    "começar terapia ou não",
    "mudar o tratamento",
    "medicação nova",
  ]) {
    it(`detecta: "${texto}"`, () => assert.equal(detectarTemaSensivel(texto), true));
  }

  for (const texto of [
    "Devo pedir mais prazo ao meu chefe?",
    "app para organizar receitas",
    "começar a correr de manhã",
    "remediar a situação com a Ana", // "remediar" não é "remédio"
    "",
  ]) {
    it(`ignora: "${texto}"`, () => assert.equal(detectarTemaSensivel(texto), false));
  }

  it("a mensagem fixa sugere um profissional", () => {
    assert.match(MENSAGEM_PROFISSIONAL, /profissional/);
  });
});
