// Testes da limpeza da resposta da IA (lib/sanitizar.js).
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { limparLista, sanitizarResposta, CATEGORIAS } from "../lib/sanitizar.js";

describe("limparLista", () => {
  it("remove itens vazios, não-strings e espaços sobrando", () => {
    assert.deepEqual(limparLista(["  Pagar   luz  ", "", "   ", null, 42, {}, "Ligar\npara a Ana"]), [
      "Pagar luz",
      "Ligar para a Ana",
    ]);
  });

  it("remove duplicatas ignorando maiúsculas, acentos e pontuação final", () => {
    assert.deepEqual(limparLista(["Será que aceito?", "sera que aceito", "SERÁ QUE ACEITO!!", "Outra coisa"]), [
      "Será que aceito?",
      "Outra coisa",
    ]);
  });

  it("devolve lista vazia quando a entrada não é um array", () => {
    assert.deepEqual(limparLista("texto"), []);
    assert.deepEqual(limparLista(undefined), []);
  });
});

describe("sanitizarResposta", () => {
  before(() => mock.method(console, "warn", () => {}));
  after(() => mock.restoreAll());

  it("mantém só os campos do schema e limpa as listas", () => {
    const resposta = sanitizarResposta({
      sintese_acolhedora: "  Respira fundo.  ",
      nivel_carga_cognitiva: "Alta",
      estado_mental: "Foco Disperso",
      tarefas: ["Pagar luz", "pagar luz."],
      ideias: [],
      duvidas: ["Aceito o freela?"],
      desabafos: ["Cansaço"],
      campo_extra: "não deveria aparecer",
    });
    assert.deepEqual(resposta, {
      sintese_acolhedora: "Respira fundo.",
      nivel_carga_cognitiva: "Alta",
      estado_mental: "Foco Disperso",
      tarefas: ["Pagar luz"],
      ideias: [],
      duvidas: ["Aceito o freela?"],
      desabafos: ["Cansaço"],
    });
  });

  it("usa valores padrão seguros para campos inválidos", () => {
    const resposta = sanitizarResposta({ nivel_carga_cognitiva: "Extrema", sintese_acolhedora: "   " });
    assert.equal(resposta.nivel_carga_cognitiva, "Moderada");
    assert.ok(resposta.sintese_acolhedora.length > 0);
    assert.ok(resposta.estado_mental.length > 0);
    for (const categoria of CATEGORIAS) assert.deepEqual(resposta[categoria], []);
  });

  it("não quebra com entradas que não são objetos", () => {
    for (const entrada of [null, undefined, "texto", 42]) {
      const resposta = sanitizarResposta(entrada);
      assert.equal(resposta.nivel_carga_cognitiva, "Moderada");
      assert.deepEqual(resposta.tarefas, []);
    }
  });
});
