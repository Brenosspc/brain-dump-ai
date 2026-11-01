// Testes da integração com a IA (lib/ia.js), usando um cliente do Gemini falso.
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import {
  criarOrganizador,
  criarGeradorMicroPassos,
  ehCotaDiaria,
  traduzirErroGemini,
  RESPONSE_SCHEMA,
  SCHEMA_MICRO_PASSOS,
  PROMPT_MICRO_PASSOS,
} from "../lib/ia.js";

/** Erro no formato do SDK: `status` + mensagem com o JSON da API. */
function erroApi(status, corpoErro = {}) {
  const erro = new Error(JSON.stringify({ error: { code: status, ...corpoErro } }));
  erro.status = status;
  return erro;
}

function erroCota(quotaId) {
  return erroApi(429, {
    message: "You exceeded your current quota",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaMetric: "generate_content_free_tier_requests", quotaId }],
      },
    ],
  });
}

const COTA_DIARIA = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";
const COTA_MINUTO = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";

/**
 * Cliente falso: cada chamada consome a próxima "resposta" da fila
 * (um texto devolve sucesso; um Error é lançado). Guarda os parâmetros recebidos.
 */
function criarAiFalsa(respostas) {
  const chamadas = [];
  return {
    chamadas,
    models: {
      async generateContent(parametros) {
        chamadas.push(parametros);
        const proxima = respostas.shift();
        if (proxima instanceof Error) throw proxima;
        return { text: proxima };
      },
    },
  };
}

describe("criarOrganizador", () => {
  before(() => mock.method(console, "warn", () => {}));
  after(() => mock.restoreAll());

  it("usa o modelo principal com a configuração esperada", async () => {
    const ai = criarAiFalsa(['{"ok":true}']);
    const organizar = criarOrganizador({ ai, modelo: "principal", modeloReserva: "reserva" });

    assert.equal(await organizar("pagar luz"), '{"ok":true}');
    assert.equal(ai.chamadas.length, 1);

    const [{ model, contents, config }] = ai.chamadas;
    assert.equal(model, "principal");
    assert.equal(contents, "<brain_dump>\npagar luz\n</brain_dump>");
    assert.equal(config.responseMimeType, "application/json");
    assert.equal(config.thinkingConfig.thinkingLevel, "LOW");
    assert.equal(config.thinkingConfig.thinkingBudget, undefined);
    assert.deepEqual(config.httpOptions.retryOptions, { attempts: 1 }, "sem repetições automáticas do SDK");
    assert.equal(config.httpOptions.timeout, 18_000);
  });

  it("sem reserva, o principal pode usar o prazo inteiro", async () => {
    const ai = criarAiFalsa(["{}"]);
    const organizar = criarOrganizador({ ai, modelo: "principal", prazoTotalMs: 30_000 });
    await organizar("x");
    assert.equal(ai.chamadas[0].config.httpOptions.timeout, 30_000);
  });

  for (const [descricao, erro] of [
    ["cota diária esgotada", erroCota(COTA_DIARIA)],
    ["sobrecarga (503)", erroApi(503)],
    ["prazo estourado (504)", erroApi(504)],
    ["timeout local", Object.assign(new Error("timeout"), { name: "AbortError" })],
    ["modelo indisponível (404)", erroApi(404)],
  ]) {
    it(`tenta o modelo reserva quando o principal falha por ${descricao}`, async () => {
      const ai = criarAiFalsa([erro, '{"reserva":true}']);
      const organizar = criarOrganizador({ ai, modelo: "principal", modeloReserva: "reserva" });

      assert.equal(await organizar("x"), '{"reserva":true}');
      assert.deepEqual(
        ai.chamadas.map((c) => c.model),
        ["principal", "reserva"]
      );
    });
  }

  it("não tenta o reserva em erro de configuração (400)", async () => {
    const ai = criarAiFalsa([erroApi(400)]);
    const organizar = criarOrganizador({ ai, modelo: "principal", modeloReserva: "reserva" });
    await assert.rejects(organizar("x"), (erro) => erro.status === 400);
    assert.equal(ai.chamadas.length, 1);
  });

  it("propaga o erro quando não há reserva configurado", async () => {
    const ai = criarAiFalsa([erroApi(503)]);
    const organizar = criarOrganizador({ ai, modelo: "principal", modeloReserva: "" });
    await assert.rejects(organizar("x"), (erro) => erro.status === 503);
    assert.equal(ai.chamadas.length, 1);
  });

  it("o reserva recebe só o tempo que sobrou do prazo total", async () => {
    let relogio = 0;
    const ai = criarAiFalsa([erroApi(503), "{}"]);
    const original = ai.models.generateContent;
    // A primeira chamada "leva" 18 s.
    ai.models.generateContent = async (parametros) => {
      if (ai.chamadas.length === 0) relogio += 18_000;
      return original(parametros);
    };
    const organizar = criarOrganizador({
      ai,
      modelo: "principal",
      modeloReserva: "reserva",
      prazoTotalMs: 30_000,
      agora: () => relogio,
    });

    await organizar("x");
    assert.equal(ai.chamadas[1].config.httpOptions.timeout, 12_000);
  });

  it("não tenta o reserva se sobrar pouco tempo", async () => {
    let relogio = 0;
    const ai = criarAiFalsa([erroApi(503), "{}"]);
    const original = ai.models.generateContent;
    ai.models.generateContent = async (parametros) => {
      relogio += 28_000;
      return original(parametros);
    };
    const organizar = criarOrganizador({
      ai,
      modelo: "principal",
      modeloReserva: "reserva",
      prazoTotalMs: 30_000,
      agora: () => relogio,
    });

    await assert.rejects(organizar("x"), (erro) => erro.status === 503);
    assert.equal(ai.chamadas.length, 1);
  });
});

describe("schema da organização", () => {
  it("exige o campo sugerir_apoio como booleano", () => {
    assert.equal(RESPONSE_SCHEMA.properties.sugerir_apoio.type, "BOOLEAN");
    assert.ok(RESPONSE_SCHEMA.required.includes("sugerir_apoio"));
  });
});

describe("criarGeradorMicroPassos", () => {
  before(() => mock.method(console, "warn", () => {}));
  after(() => mock.restoreAll());

  it("envia a tarefa delimitada, com o prompt e o schema dos micro-passos", async () => {
    const ai = criarAiFalsa(['{"passos":["Abrir o site"]}']);
    const gerar = criarGeradorMicroPassos({ ai, modelo: "principal", modeloReserva: "reserva" });

    assert.equal(await gerar("Declarar o imposto"), '{"passos":["Abrir o site"]}');
    const [{ model, contents, config }] = ai.chamadas;
    assert.equal(model, "principal");
    assert.equal(contents, "<tarefa>\nDeclarar o imposto\n</tarefa>");
    assert.equal(config.systemInstruction, PROMPT_MICRO_PASSOS);
    assert.equal(config.responseSchema, SCHEMA_MICRO_PASSOS);
    assert.deepEqual(config.httpOptions.retryOptions, { attempts: 1 });
  });

  it("também usa o modelo reserva quando o principal falha", async () => {
    const ai = criarAiFalsa([erroApi(503), '{"passos":["x"]}']);
    const gerar = criarGeradorMicroPassos({ ai, modelo: "principal", modeloReserva: "reserva" });
    await gerar("tarefa");
    assert.deepEqual(
      ai.chamadas.map((c) => c.model),
      ["principal", "reserva"]
    );
  });
});

describe("ehCotaDiaria", () => {
  it("reconhece a cota diária pelo quotaId estruturado", () => {
    assert.equal(ehCotaDiaria(erroCota(COTA_DIARIA)), true);
  });

  it("não confunde com a cota por minuto", () => {
    assert.equal(ehCotaDiaria(erroCota(COTA_MINUTO)), false);
  });

  it("recorre ao texto quando não há detalhes estruturados", () => {
    const erro = Object.assign(new Error("Quota exceeded: requests per day"), { status: 429 });
    assert.equal(ehCotaDiaria(erro), true);
  });

  it("só vale para status 429", () => {
    assert.equal(ehCotaDiaria(Object.assign(erroCota(COTA_DIARIA), { status: 503 })), false);
  });
});

describe("traduzirErroGemini", () => {
  it("timeout vira 504 com mensagem amigável", () => {
    const { status, mensagem } = traduzirErroGemini(Object.assign(new Error(), { name: "TimeoutError" }));
    assert.equal(status, 504);
    assert.match(mensagem, /demorou demais/);
  });

  it("diferencia cota diária de excesso momentâneo", () => {
    assert.match(traduzirErroGemini(erroCota(COTA_DIARIA)).mensagem, /limite diário/);
    assert.match(traduzirErroGemini(erroCota(COTA_MINUTO)).mensagem, /pouco tempo/);
  });

  it("não expõe detalhes técnicos em erros de configuração", () => {
    const { status, mensagem } = traduzirErroGemini(erroApi(404));
    assert.equal(status, 500);
    assert.doesNotMatch(mensagem, /404|error/i);
  });

  it("erro desconhecido vira 500 genérico", () => {
    assert.equal(traduzirErroGemini(new Error("???")).status, 500);
  });
});
