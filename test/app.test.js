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

describe("histórico na nuvem", () => {
  const DISPOSITIVO = "11111111-1111-4111-8111-111111111111";
  const OUTRO_DISPOSITIVO = "33333333-3333-4333-8333-333333333333";
  const DESPEJO = "22222222-2222-4222-8222-222222222222";

  let servidor;
  let falharBanco = false;
  // Repositório falso em memória, que imita o filtro por dispositivo do banco real.
  const despejos = [];
  const repositorio = {
    async salvar({ dispositivoId, texto, resultado }) {
      if (falharBanco) throw Object.assign(new Error("conexão caiu"), { code: "ECONNRESET" });
      const despejo = { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" };
      despejos.unshift({ ...despejo, dispositivoId, texto, resultado });
      return despejo;
    },
    async listar(dispositivoId, limite) {
      if (falharBanco) throw new Error("conexão caiu");
      return despejos
        .filter((d) => d.dispositivoId === dispositivoId)
        .slice(0, limite)
        .map(({ id, data, texto, resultado }) => ({ id, data, texto, resultado }));
    },
    async apagar(dispositivoId, id) {
      const indice = despejos.findIndex((d) => d.id === id && d.dispositivoId === dispositivoId);
      if (indice < 0) return false;
      despejos.splice(indice, 1);
      return true;
    },
    async apagarTodos(dispositivoId) {
      const antes = despejos.length;
      for (let i = despejos.length - 1; i >= 0; i--) if (despejos[i].dispositivoId === dispositivoId) despejos.splice(i, 1);
      return antes - despejos.length;
    },
  };

  const comDispositivo = (id = DISPOSITIVO) => ({ "X-Dispositivo-Id": id });

  before(async () => {
    mock.method(console, "error", () => {});
    servidor = await subir({ organizar: async () => RESPOSTA_IA, repositorio, limite: { maximo: 1_000, janelaMs: 60_000 } });
  });

  after(async () => {
    await servidor.fechar();
    mock.restoreAll();
  });

  it("/api/status informa que a nuvem está ativa", async () => {
    const dados = await (await fetch(`${servidor.base}/api/status`)).json();
    assert.equal(dados.nuvem, true);
    assert.equal(dados.dias_retencao, 30);
  });

  it("organizar salva o despejo e devolve id e data", async () => {
    const resposta = await fetch(`${servidor.base}/api/organizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...comDispositivo() },
      body: JSON.stringify({ texto: "pagar luz" }),
    });
    const dados = await resposta.json();
    assert.equal(resposta.status, 200);
    assert.deepEqual(dados.despejo, { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" });
    assert.deepEqual(dados.tarefas, ["Pagar luz"]);
    assert.equal(despejos[0].texto, "pagar luz");
  });

  it("sem identificação do navegador, organiza mas não salva", async () => {
    const total = despejos.length;
    const dados = await (await organizarPost(servidor.base, { texto: "oi" })).json();
    assert.equal(dados.despejo, undefined);
    assert.equal(despejos.length, total);
  });

  it("se o banco falhar ao salvar, o usuário ainda recebe o resultado", async () => {
    falharBanco = true;
    try {
      const resposta = await fetch(`${servidor.base}/api/organizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...comDispositivo() },
        body: JSON.stringify({ texto: "oi" }),
      });
      assert.equal(resposta.status, 200);
      const dados = await resposta.json();
      assert.equal(dados.despejo, null);
      assert.equal(dados.sintese_acolhedora, "Respira fundo.");
    } finally {
      falharBanco = false;
    }
  });

  it("lista só os despejos do próprio navegador", async () => {
    const meus = await (await fetch(`${servidor.base}/api/despejos`, { headers: comDispositivo() })).json();
    assert.equal(meus.despejos.length, 1);

    const deOutro = await (await fetch(`${servidor.base}/api/despejos`, { headers: comDispositivo(OUTRO_DISPOSITIVO) })).json();
    assert.deepEqual(deOutro.despejos, []);
  });

  it("recusa identificação ausente ou inválida", async () => {
    assert.equal((await fetch(`${servidor.base}/api/despejos`)).status, 400);
    assert.equal((await fetch(`${servidor.base}/api/despejos`, { headers: comDispositivo("nao-e-uuid") })).status, 400);
  });

  it("responde 503 com mensagem amigável se o banco falhar ao listar", async () => {
    falharBanco = true;
    try {
      const resposta = await fetch(`${servidor.base}/api/despejos`, { headers: comDispositivo() });
      assert.equal(resposta.status, 503);
      assert.match((await resposta.json()).erro, /histórico na nuvem/);
    } finally {
      falharBanco = false;
    }
  });

  it("outro navegador não consegue apagar o despejo", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos/${DESPEJO}`, {
      method: "DELETE",
      headers: comDispositivo(OUTRO_DISPOSITIVO),
    });
    assert.equal(resposta.status, 404);
    assert.equal(despejos.length, 1);
  });

  it("recusa id de despejo inválido", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos/abc`, { method: "DELETE", headers: comDispositivo() });
    assert.equal(resposta.status, 400);
  });

  it("apaga o próprio despejo (204) e depois responde 404", async () => {
    const url = `${servidor.base}/api/despejos/${DESPEJO}`;
    assert.equal((await fetch(url, { method: "DELETE", headers: comDispositivo() })).status, 204);
    assert.equal((await fetch(url, { method: "DELETE", headers: comDispositivo() })).status, 404);
  });

  it("apaga todo o histórico do navegador", async () => {
    await repositorio.salvar({ dispositivoId: DISPOSITIVO, texto: "a", resultado: {} });
    const resposta = await fetch(`${servidor.base}/api/despejos`, { method: "DELETE", headers: comDispositivo() });
    assert.equal(resposta.status, 204);
    assert.equal(despejos.filter((d) => d.dispositivoId === DISPOSITIVO).length, 0);
  });
});

describe("fase 3: apoio, micro-passos e progresso", () => {
  const DISPOSITIVO = "11111111-1111-4111-8111-111111111111";
  const OUTRO_DISPOSITIVO = "33333333-3333-4333-8333-333333333333";
  const DESPEJO = "22222222-2222-4222-8222-222222222222";

  let servidor;
  let respostaOrganizar = RESPOSTA_IA;
  let comportamentoPassos = async () => '{"passos":["Abrir o site","abrir o site","Fazer login"]}';
  const tarefasRecebidas = [];
  const progressosSalvos = new Map(); // `${dispositivo}:${id}` -> progresso

  const repositorio = {
    async salvar() {
      return { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" };
    },
    async listar() {
      return [];
    },
    async atualizarProgresso(dispositivoId, id, progresso) {
      if (dispositivoId !== DISPOSITIVO || id !== DESPEJO) return false;
      progressosSalvos.set(`${dispositivoId}:${id}`, progresso);
      return true;
    },
    async apagar() {
      return false;
    },
    async apagarTodos() {
      return 0;
    },
  };

  function patchProgresso(corpo, dispositivo = DISPOSITIVO, id = DESPEJO) {
    return fetch(`${servidor.base}/api/despejos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Dispositivo-Id": dispositivo },
      body: JSON.stringify(corpo),
    });
  }

  function pedirPassos(corpo) {
    return fetch(`${servidor.base}/api/micro-passos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  }

  before(async () => {
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
    servidor = await subir({
      organizar: async () => respostaOrganizar,
      gerarMicroPassos: async (tarefa) => {
        tarefasRecebidas.push(tarefa);
        return comportamentoPassos();
      },
      repositorio,
      limite: { maximo: 1_000, janelaMs: 60_000 },
    });
  });

  after(async () => {
    await servidor.fechar();
    mock.restoreAll();
  });

  it("organizar ativa o apoio quando a IA marca sugerir_apoio", async () => {
    respostaOrganizar = JSON.stringify({ ...JSON.parse(RESPOSTA_IA), sugerir_apoio: true });
    const dados = await (await organizarPost(servidor.base, { texto: "dia difícil" })).json();
    assert.equal(dados.sugerir_apoio, true);
  });

  it("organizar ativa o apoio por expressão de risco, mesmo se a IA não marcar", async () => {
    respostaOrganizar = JSON.stringify({ ...JSON.parse(RESPOSTA_IA), sugerir_apoio: false });
    const dados = await (await organizarPost(servidor.base, { texto: "às vezes penso em me matar" })).json();
    assert.equal(dados.sugerir_apoio, true);
  });

  it("organizar não ativa o apoio em textos comuns", async () => {
    respostaOrganizar = RESPOSTA_IA;
    const dados = await (await organizarPost(servidor.base, { texto: "pagar a luz, tô cansado" })).json();
    assert.equal(dados.sugerir_apoio, false);
  });

  it("micro-passos devolve a lista limpa", async () => {
    const resposta = await pedirPassos({ tarefa: "  Declarar   o imposto " });
    assert.equal(resposta.status, 200);
    assert.deepEqual((await resposta.json()).passos, ["Abrir o site", "Fazer login"]);
    assert.equal(tarefasRecebidas.at(-1), "Declarar o imposto");
  });

  it("micro-passos recusa tarefa vazia (400) ou longa demais (413)", async () => {
    assert.equal((await pedirPassos({ tarefa: "   " })).status, 400);
    assert.equal((await pedirPassos({})).status, 400);
    assert.equal((await pedirPassos({ tarefa: "x".repeat(301) })).status, 413);
  });

  it("micro-passos responde 502 quando a IA não devolve passos", async () => {
    comportamentoPassos = async () => '{"passos":[]}';
    assert.equal((await pedirPassos({ tarefa: "x" })).status, 502);
    comportamentoPassos = async () => "não é json";
    assert.equal((await pedirPassos({ tarefa: "x" })).status, 502);
  });

  it("micro-passos traduz erros da IA", async () => {
    comportamentoPassos = async () => {
      throw Object.assign(new Error("timeout"), { name: "AbortError" });
    };
    const resposta = await pedirPassos({ tarefa: "x" });
    assert.equal(resposta.status, 504);
    assert.match((await resposta.json()).erro, /demorou demais/);
  });

  it("salva o progresso sanitizado", async () => {
    const resposta = await patchProgresso({
      progresso: { concluidas: [2, 0, 0, -1], micro_passos: { 0: ["Abrir o app"], x: ["?"] }, extra: true },
    });
    assert.equal(resposta.status, 200);
    const esperado = { concluidas: [0, 2], micro_passos: { 0: ["Abrir o app"] } };
    assert.deepEqual((await resposta.json()).progresso, esperado);
    assert.deepEqual(progressosSalvos.get(`${DISPOSITIVO}:${DESPEJO}`), esperado);
  });

  it("recusa progresso inválido (400)", async () => {
    assert.equal((await patchProgresso({ progresso: "tudo" })).status, 400);
    assert.equal((await patchProgresso({})).status, 400);
  });

  it("recusa id de despejo inválido (400)", async () => {
    assert.equal((await patchProgresso({ progresso: {} }, DISPOSITIVO, "abc")).status, 400);
  });

  it("outro navegador não altera o progresso (404)", async () => {
    assert.equal((await patchProgresso({ progresso: { concluidas: [1] } }, OUTRO_DISPOSITIVO)).status, 404);
  });

  it("recusa progresso grande demais (413)", async () => {
    const micro_passos = {};
    for (let i = 0; i < 99; i++) micro_passos[i] = Array.from({ length: 6 }, (_, j) => `${j}`.padEnd(200, "x"));
    assert.equal((await patchProgresso({ progresso: { micro_passos } })).status, 413);
  });
});

describe("sem banco configurado", () => {
  let servidor;

  before(async () => {
    servidor = await subir({ organizar: async () => RESPOSTA_IA });
  });

  after(() => servidor.fechar());

  it("/api/status informa que a nuvem está desligada", async () => {
    assert.equal((await (await fetch(`${servidor.base}/api/status`)).json()).nuvem, false);
  });

  it("as rotas de histórico respondem 503", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos`, {
      headers: { "X-Dispositivo-Id": "11111111-1111-4111-8111-111111111111" },
    });
    assert.equal(resposta.status, 503);
  });

  it("organizar continua funcionando sem salvar", async () => {
    const resposta = await fetch(`${servidor.base}/api/organizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dispositivo-Id": "11111111-1111-4111-8111-111111111111" },
      body: JSON.stringify({ texto: "oi" }),
    });
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).despejo, undefined);
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
