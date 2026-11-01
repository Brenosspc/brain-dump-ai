// Testes das rotas HTTP (lib/app.js), com a IA substituída por uma função falsa.
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "../lib/app.js";

/** Sobe o app numa porta livre e devolve a URL base e uma função para encerrar. */
async function subir(opcoes) {
  const servidor = criarApp(opcoes).listen(0);
  await new Promise((resolve) => servidor.once("listening", resolve));
  const { port } = servidor.address();
  return {
    base: `http://127.0.0.1:${port}`,
    fechar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

function organizarPost(base, corpo) {
  return fetch(`${base}/api/organizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

const RESPOSTA_IA = JSON.stringify({
  sintese_acolhedora: "Respira fundo.",
  nivel_carga_cognitiva: "Moderada",
  estado_mental: "Foco Disperso",
  tarefas: ["Pagar luz", "pagar luz"],
  ideias: [],
  duvidas: [],
  desabafos: ["Cansaço"],
  extra: "removido",
});

describe("rotas", () => {
  let servidor;
  let comportamentoIa;
  const textosRecebidos = [];

  before(async () => {
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
    servidor = await subir({
      organizar: async (texto) => {
        textosRecebidos.push(texto);
        return comportamentoIa();
      },
      limite: { maximo: 1_000, janelaMs: 60_000 },
    });
  });

  after(async () => {
    await servidor.fechar();
    mock.restoreAll();
  });

  it("serve a página inicial", async () => {
    const resposta = await fetch(`${servidor.base}/`);
    assert.equal(resposta.status, 200);
    assert.match(await resposta.text(), /<title>Brain Dump AI<\/title>/);
  });

  it("organiza o texto e devolve a resposta sanitizada", async () => {
    comportamentoIa = async () => RESPOSTA_IA;
    const resposta = await organizarPost(servidor.base, { texto: "  pagar luz, cansado  " });
    assert.equal(resposta.status, 200);

    const dados = await resposta.json();
    assert.deepEqual(dados.tarefas, ["Pagar luz"]);
    assert.equal(dados.extra, undefined);
    assert.equal(textosRecebidos.at(-1), "pagar luz, cansado", "o texto chega à IA sem espaços nas pontas");
  });

  it("recusa texto vazio com 400", async () => {
    const resposta = await organizarPost(servidor.base, { texto: "   " });
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).erro, /Escreva alguma coisa/);
  });

  it("recusa texto acima de 10.000 caracteres com 413", async () => {
    const resposta = await organizarPost(servidor.base, { texto: "a".repeat(10_001) });
    assert.equal(resposta.status, 413);
  });

  it("aceita exatamente 10.000 caracteres", async () => {
    comportamentoIa = async () => RESPOSTA_IA;
    const resposta = await organizarPost(servidor.base, { texto: "a".repeat(10_000) });
    assert.equal(resposta.status, 200);
  });

  it("responde 400 para JSON malformado", async () => {
    const resposta = await organizarPost(servidor.base, "{texto");
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).erro, /Não consegui entender/);
  });

  it("traduz erros da IA em mensagens amigáveis", async () => {
    comportamentoIa = async () => {
      throw Object.assign(new Error("timeout"), { name: "AbortError" });
    };
    const resposta = await organizarPost(servidor.base, { texto: "oi" });
    assert.equal(resposta.status, 504);
    assert.match((await resposta.json()).erro, /demorou demais/);
  });

  it("responde 502 quando a IA devolve algo que não é JSON", async () => {
    comportamentoIa = async () => "isto não é json";
    const resposta = await organizarPost(servidor.base, { texto: "oi" });
    assert.equal(resposta.status, 502);
  });
});

describe("limite de requisições", () => {
  let servidor;

  before(async () => {
    servidor = await subir({
      organizar: async () => RESPOSTA_IA,
      limite: { maximo: 2, janelaMs: 60_000 },
    });
  });

  after(() => servidor.fechar());

  it("bloqueia com 429 depois do limite", async () => {
    assert.equal((await organizarPost(servidor.base, { texto: "a" })).status, 200);
    assert.equal((await organizarPost(servidor.base, { texto: "b" })).status, 200);

    const bloqueada = await organizarPost(servidor.base, { texto: "c" });
    assert.equal(bloqueada.status, 429);
    assert.ok(bloqueada.headers.get("retry-after"));
  });
});
