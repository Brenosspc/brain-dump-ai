// Testes da limpeza da resposta da IA (lib/sanitizar.js).
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import {
  limparLista,
  sanitizarResposta,
  sanitizarPassos,
  sanitizarProgresso,
  sanitizarPrimeiroPasso,
  sanitizarPerguntas,
  CATEGORIAS,
  MAX_PERGUNTAS,
  MAX_PASSOS,
} from "../lib/sanitizar.js";

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
      sugerir_apoio: false,
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

describe("sugerir_apoio", () => {
  before(() => mock.method(console, "warn", () => {}));
  after(() => mock.restoreAll());

  it("só é true com um true explícito", () => {
    assert.equal(sanitizarResposta({ sugerir_apoio: true }).sugerir_apoio, true);
    for (const valor of [false, "true", 1, null, undefined]) {
      assert.equal(sanitizarResposta({ sugerir_apoio: valor }).sugerir_apoio, false, String(valor));
    }
  });
});

describe("sanitizarPassos", () => {
  it("limpa, remove duplicatas e limita a quantidade", () => {
    const passos = sanitizarPassos({
      passos: ["  Abrir o site ", "", "abrir o site", 42, "Fazer login", "a", "b", "c", "d", "e"],
    });
    assert.equal(passos[0], "Abrir o site");
    assert.equal(passos[1], "Fazer login");
    assert.ok(passos.length <= MAX_PASSOS);
  });

  it("corta passos enormes", () => {
    const [passo] = sanitizarPassos({ passos: ["x".repeat(1_000)] });
    assert.equal(passo.length, 200);
  });

  it("devolve lista vazia para formatos inválidos", () => {
    assert.deepEqual(sanitizarPassos(null), []);
    assert.deepEqual(sanitizarPassos({ passos: "texto" }), []);
  });
});

describe("sanitizarProgresso", () => {
  it("mantém só índices válidos, sem repetição e em ordem", () => {
    const { concluidas } = sanitizarProgresso({ concluidas: [3, 1, 1, -1, 2.5, "2", 100, 0] });
    assert.deepEqual(concluidas, [0, 1, 3]);
  });

  it("aceita micro-passos só com chaves numéricas e passos válidos", () => {
    const { micro_passos } = sanitizarProgresso({
      micro_passos: { 0: ["Abrir o app"], "01": ["Separar documentos"], abc: ["x"], 2: [], 3: "texto" },
    });
    assert.deepEqual(micro_passos, { 0: ["Abrir o app"], 1: ["Separar documentos"] });
  });

  it("ignora campos extras e devolve null se não for objeto", () => {
    assert.deepEqual(sanitizarProgresso({ extra: "x" }), {
      concluidas: [],
      micro_passos: {},
      primeiros_passos: {},
      perguntas: {},
    });
    assert.equal(sanitizarProgresso(null), null);
    assert.equal(sanitizarProgresso([1, 2]), null);
    assert.equal(sanitizarProgresso("texto"), null);
  });
});

describe("ajuda sob demanda", () => {
  it("sanitizarPrimeiroPasso limpa espaços e devolve \"\" se não houver passo", () => {
    assert.equal(sanitizarPrimeiroPasso({ passo: "  Separar   o tênis  " }), "Separar o tênis");
    assert.equal(sanitizarPrimeiroPasso({ passo: 42 }), "");
    assert.equal(sanitizarPrimeiroPasso(null), "");
    assert.equal(sanitizarPrimeiroPasso({ passo: "x".repeat(500) }).length, 200);
  });

  it("sanitizarPerguntas mantém no máximo 3, sem vazias nem repetidas", () => {
    const perguntas = sanitizarPerguntas({ perguntas: ["O que pesa mais?", "o que pesa mais", "", "A?", "B?", "C?"] });
    assert.deepEqual(perguntas, ["O que pesa mais?", "A?", "B?"]);
    assert.equal(MAX_PERGUNTAS, 3);
    assert.deepEqual(sanitizarPerguntas({}), []);
  });

  it("sanitizarProgresso guarda primeiros passos e perguntas por índice", () => {
    const progresso = sanitizarProgresso({
      primeiros_passos: { 0: " Abrir o caderno ", 1: "", x: "?", 2: 5 },
      perguntas: { "01": ["A?", "a?"], 3: "não é lista", 4: [] },
    });
    assert.deepEqual(progresso.primeiros_passos, { 0: "Abrir o caderno" });
    assert.deepEqual(progresso.perguntas, { 1: ["A?"] });
  });
});
