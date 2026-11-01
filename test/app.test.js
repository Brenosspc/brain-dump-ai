// Testes das rotas HTTP (lib/app.js), com a IA substituída por uma função falsa.
import { describe, it, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "../lib/app.js";
import { ErroAuthIndisponivel } from "../lib/auth.js";

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

// Login falso: cada token corresponde a um usuário; "token-fora-do-ar" simula o Supabase indisponível.
const USUARIO_ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USUARIO_BIA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIG_AUTH = { url: "https://exemplo.supabase.co", chavePublica: "chave-publica-de-teste" };

async function verificarUsuarioFalso(token) {
  if (token === "token-fora-do-ar") throw new ErroAuthIndisponivel("fora do ar");
  if (token === "token-ana") return { id: USUARIO_ANA, email: "ana@exemplo.com" };
  if (token === "token-bia") return { id: USUARIO_BIA, email: "bia@exemplo.com" };
  return null;
}

const comLogin = (token = "token-ana") => ({ Authorization: `Bearer ${token}` });

describe("histórico na nuvem (com login)", () => {
  const DISPOSITIVO = "11111111-1111-4111-8111-111111111111";
  const DESPEJO = "22222222-2222-4222-8222-222222222222";

  let servidor;
  let falharBanco = false;
  // Repositório falso em memória, que imita o filtro por usuário do banco real.
  const despejos = [];
  const repositorio = {
    async salvar({ usuarioId, dispositivoId, texto, resultado }) {
      if (falharBanco) throw Object.assign(new Error("conexão caiu"), { code: "ECONNRESET" });
      const despejo = { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" };
      despejos.unshift({ ...despejo, usuarioId, dispositivoId, texto, resultado });
      return despejo;
    },
    async listar(usuarioId, limite) {
      if (falharBanco) throw new Error("conexão caiu");
      return despejos
        .filter((d) => d.usuarioId === usuarioId)
        .slice(0, limite)
        .map(({ id, data, texto, resultado }) => ({ id, data, texto, resultado }));
    },
    async apagar(usuarioId, id) {
      const indice = despejos.findIndex((d) => d.id === id && d.usuarioId === usuarioId);
      if (indice < 0) return false;
      despejos.splice(indice, 1);
      return true;
    },
    async apagarTodos(usuarioId) {
      const antes = despejos.length;
      for (let i = despejos.length - 1; i >= 0; i--) if (despejos[i].usuarioId === usuarioId) despejos.splice(i, 1);
      return antes - despejos.length;
    },
  };

  function organizarLogado(texto, cabecalhos = comLogin()) {
    return fetch(`${servidor.base}/api/organizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dispositivo-Id": DISPOSITIVO, ...cabecalhos },
      body: JSON.stringify({ texto }),
    });
  }

  before(async () => {
    mock.method(console, "error", () => {});
    servidor = await subir({
      organizar: async () => RESPOSTA_IA,
      repositorio,
      verificarUsuario: verificarUsuarioFalso,
      configAuth: CONFIG_AUTH,
      limite: { maximo: 1_000, janelaMs: 60_000 },
    });
  });

  after(async () => {
    await servidor.fechar();
    mock.restoreAll();
  });

  it("/api/status informa a nuvem e os dados públicos do login", async () => {
    const dados = await (await fetch(`${servidor.base}/api/status`)).json();
    assert.equal(dados.nuvem, true);
    assert.equal(dados.dias_retencao, 30);
    assert.deepEqual(dados.auth, { url: CONFIG_AUTH.url, chave_publica: CONFIG_AUTH.chavePublica });
  });

  it("logado, organizar salva o despejo na conta e devolve id e data", async () => {
    const resposta = await organizarLogado("pagar luz");
    const dados = await resposta.json();
    assert.equal(resposta.status, 200);
    assert.deepEqual(dados.despejo, { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" });
    assert.deepEqual(dados.tarefas, ["Pagar luz"]);
    assert.equal(despejos[0].texto, "pagar luz");
    assert.equal(despejos[0].usuarioId, USUARIO_ANA);
    assert.equal(despejos[0].dispositivoId, DISPOSITIVO);
  });

  it("deslogado, organiza mas não salva nada no servidor", async () => {
    const total = despejos.length;
    const dados = await (await organizarLogado("oi", {})).json();
    assert.equal(dados.despejo, undefined);
    assert.equal(despejos.length, total);
  });

  it("com sessão expirada, organiza, não salva e avisa", async () => {
    const total = despejos.length;
    const resposta = await organizarLogado("oi", comLogin("token-vencido"));
    assert.equal(resposta.status, 200);
    const dados = await resposta.json();
    assert.equal(dados.despejo, null);
    assert.equal(dados.sessao_expirada, true);
    assert.equal(dados.sintese_acolhedora, "Respira fundo.");
    assert.equal(despejos.length, total);
  });

  it("com o login fora do ar, organiza mesmo assim (sem salvar)", async () => {
    const resposta = await organizarLogado("oi", comLogin("token-fora-do-ar"));
    assert.equal(resposta.status, 200);
    const dados = await resposta.json();
    assert.equal(dados.despejo, null);
    assert.equal(dados.sessao_expirada, undefined);
  });

  it("se o banco falhar ao salvar, o usuário ainda recebe o resultado", async () => {
    falharBanco = true;
    try {
      const resposta = await organizarLogado("oi");
      assert.equal(resposta.status, 200);
      const dados = await resposta.json();
      assert.equal(dados.despejo, null);
      assert.equal(dados.sintese_acolhedora, "Respira fundo.");
    } finally {
      falharBanco = false;
    }
  });

  it("lista só os despejos da própria conta", async () => {
    const meus = await (await fetch(`${servidor.base}/api/despejos`, { headers: comLogin() })).json();
    assert.equal(meus.despejos.length, 1);

    const deOutra = await (await fetch(`${servidor.base}/api/despejos`, { headers: comLogin("token-bia") })).json();
    assert.deepEqual(deOutra.despejos, []);
  });

  it("sem login ou com token inválido responde 401", async () => {
    for (const cabecalhos of [{}, comLogin("token-vencido"), { Authorization: "Basic abc" }]) {
      const resposta = await fetch(`${servidor.base}/api/despejos`, { headers: cabecalhos });
      assert.equal(resposta.status, 401);
      assert.match((await resposta.json()).erro, /Entre de novo/);
    }
  });

  it("o identificador do navegador sozinho não dá acesso ao histórico", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos`, { headers: { "X-Dispositivo-Id": DISPOSITIVO } });
    assert.equal(resposta.status, 401);
  });

  it("responde 503 se o login estiver fora do ar", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos`, { headers: comLogin("token-fora-do-ar") });
    assert.equal(resposta.status, 503);
    assert.match((await resposta.json()).erro, /confirmar seu login/);
  });

  it("responde 503 com mensagem amigável se o banco falhar ao listar", async () => {
    falharBanco = true;
    try {
      const resposta = await fetch(`${servidor.base}/api/despejos`, { headers: comLogin() });
      assert.equal(resposta.status, 503);
      assert.match((await resposta.json()).erro, /histórico na nuvem/);
    } finally {
      falharBanco = false;
    }
  });

  it("outra conta não consegue apagar o despejo", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos/${DESPEJO}`, {
      method: "DELETE",
      headers: comLogin("token-bia"),
    });
    assert.equal(resposta.status, 404);
    assert.equal(despejos.length, 1);
  });

  it("recusa id de despejo inválido", async () => {
    const resposta = await fetch(`${servidor.base}/api/despejos/abc`, { method: "DELETE", headers: comLogin() });
    assert.equal(resposta.status, 400);
  });

  it("apaga o próprio despejo (204) e depois responde 404", async () => {
    const url = `${servidor.base}/api/despejos/${DESPEJO}`;
    assert.equal((await fetch(url, { method: "DELETE", headers: comLogin() })).status, 204);
    assert.equal((await fetch(url, { method: "DELETE", headers: comLogin() })).status, 404);
  });

  it("apaga todo o histórico da conta, sem tocar no de outra", async () => {
    await repositorio.salvar({ usuarioId: USUARIO_ANA, dispositivoId: DISPOSITIVO, texto: "a", resultado: {} });
    await repositorio.salvar({ usuarioId: USUARIO_BIA, dispositivoId: DISPOSITIVO, texto: "b", resultado: {} });
    const resposta = await fetch(`${servidor.base}/api/despejos`, { method: "DELETE", headers: comLogin() });
    assert.equal(resposta.status, 204);
    assert.equal(despejos.filter((d) => d.usuarioId === USUARIO_ANA).length, 0);
    assert.equal(despejos.filter((d) => d.usuarioId === USUARIO_BIA).length, 1);
  });
});

describe("importar o histórico do navegador para a conta", () => {
  const DISPOSITIVO = "11111111-1111-4111-8111-111111111111";
  const ID_A = "55555555-5555-4555-8555-555555555555";
  const ID_B = "66666666-6666-4666-8666-666666666666";

  let servidor;
  let chamadas;
  let falharBanco = false;
  const repositorio = {
    async listar() {
      return [];
    },
    async vincularDispositivo(usuarioId, dispositivoId) {
      if (falharBanco) throw new Error("conexão caiu");
      chamadas.vincular.push({ usuarioId, dispositivoId });
      return 2;
    },
    async importar(usuarioId, dispositivoId, despejos) {
      chamadas.importar.push({ usuarioId, dispositivoId, despejos });
      return despejos.length;
    },
  };

  const despejoLocal = (id, extra = {}) => ({
    id,
    data: new Date(Date.now() - 60_000).toISOString(),
    texto: "  pagar luz  ",
    resultado: JSON.parse(RESPOSTA_IA),
    progresso: { concluidas: [0] },
    ...extra,
  });

  function importar(corpo, cabecalhos = { ...comLogin(), "X-Dispositivo-Id": DISPOSITIVO }) {
    return fetch(`${servidor.base}/api/despejos/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    });
  }

  before(async () => {
    mock.method(console, "error", () => {});
    servidor = await subir({
      organizar: async () => RESPOSTA_IA,
      repositorio,
      verificarUsuario: verificarUsuarioFalso,
      configAuth: CONFIG_AUTH,
      limite: { maximo: 1_000, janelaMs: 60_000 },
    });
  });

  beforeEach(() => {
    chamadas = { vincular: [], importar: [] };
  });

  after(async () => {
    await servidor.fechar();
    mock.restoreAll();
  });

  it("vincula os despejos anônimos do navegador e importa os locais, já limpos", async () => {
    const resposta = await importar({ despejos: [despejoLocal(ID_A), despejoLocal(ID_B.toUpperCase())] });
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { importados: 2, vinculados: 2, ignorados: 0 });

    assert.deepEqual(chamadas.vincular, [{ usuarioId: USUARIO_ANA, dispositivoId: DISPOSITIVO }]);
    const [{ usuarioId, dispositivoId, despejos }] = chamadas.importar;
    assert.equal(usuarioId, USUARIO_ANA);
    assert.equal(dispositivoId, DISPOSITIVO);
    assert.equal(despejos[0].texto, "pagar luz");
    assert.deepEqual(despejos[0].resultado.tarefas, ["Pagar luz"], "o resultado passa pela sanitização");
    assert.equal(despejos[0].resultado.extra, undefined);
    assert.equal(despejos[1].id, ID_B, "o id é guardado em minúsculas");
    assert.deepEqual(despejos[0].progresso.concluidas, [0]);
  });

  it("ignora despejos inválidos e corrige datas fora do prazo", async () => {
    const corpo = {
      despejos: [
        despejoLocal(ID_A, { data: "2001-01-01T00:00:00.000Z" }),
        despejoLocal("nao-e-uuid"),
        despejoLocal(ID_B, { texto: "   " }),
        despejoLocal(ID_B, { resultado: "texto" }),
        null,
      ],
    };
    const dados = await (await importar(corpo)).json();
    assert.deepEqual(dados, { importados: 1, vinculados: 2, ignorados: 4 });

    const [importado] = chamadas.importar[0].despejos;
    assert.ok(Date.now() - Date.parse(importado.data) < 60_000, "data antiga demais vira agora");
  });

  it("sem o identificador do navegador, só importa (não vincula)", async () => {
    const dados = await (await importar({ despejos: [despejoLocal(ID_A)] }, comLogin())).json();
    assert.deepEqual(dados, { importados: 1, vinculados: 0, ignorados: 0 });
    assert.equal(chamadas.vincular.length, 0);
  });

  it("exige login (401)", async () => {
    const resposta = await importar({ despejos: [] }, { "X-Dispositivo-Id": DISPOSITIVO });
    assert.equal(resposta.status, 401);
    assert.equal(chamadas.vincular.length + chamadas.importar.length, 0);
  });

  it("recusa formato inválido (400) e mais de 10 despejos (413)", async () => {
    assert.equal((await importar({ despejos: "tudo" })).status, 400);
    assert.equal((await importar({})).status, 400);
    const muitos = Array.from({ length: 11 }, () => despejoLocal(ID_A));
    assert.equal((await importar({ despejos: muitos })).status, 413);
  });

  it("aceita corpos maiores que 100 KB, mas não acima de 600 KB", async () => {
    const grande = despejoLocal(ID_A, { texto: "a".repeat(10_000) });
    grande.resultado.desabafos = Array.from({ length: 20 }, () => "b".repeat(1_000));
    const corpoMedio = { despejos: Array.from({ length: 10 }, () => grande) }; // ~300 KB
    assert.ok(JSON.stringify(corpoMedio).length > 100_000);
    assert.equal((await importar(corpoMedio)).status, 200);

    const corpoEnorme = JSON.stringify({ despejos: [{ texto: "x".repeat(700_000) }] });
    assert.equal((await importar(corpoEnorme)).status, 413);
  });

  it("responde 503 se o banco falhar", async () => {
    falharBanco = true;
    try {
      const resposta = await importar({ despejos: [despejoLocal(ID_A)] });
      assert.equal(resposta.status, 503);
    } finally {
      falharBanco = false;
    }
  });
});

describe("fase 3: apoio, micro-passos e progresso", () => {
  const DESPEJO = "22222222-2222-4222-8222-222222222222";

  let servidor;
  let respostaOrganizar = RESPOSTA_IA;
  let comportamentoPassos = async () => '{"passos":["Abrir o site","abrir o site","Fazer login"]}';
  const tarefasRecebidas = [];
  const progressosSalvos = new Map(); // `${usuario}:${id}` -> progresso

  const repositorio = {
    async salvar() {
      return { id: DESPEJO, data: "2026-11-01T12:00:00.000Z" };
    },
    async listar() {
      return [];
    },
    async atualizarProgresso(usuarioId, id, progresso) {
      if (usuarioId !== USUARIO_ANA || id !== DESPEJO) return false;
      progressosSalvos.set(`${usuarioId}:${id}`, progresso);
      return true;
    },
    async apagar() {
      return false;
    },
    async apagarTodos() {
      return 0;
    },
  };

  function patchProgresso(corpo, token = "token-ana", id = DESPEJO) {
    return fetch(`${servidor.base}/api/despejos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...comLogin(token) },
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
      verificarUsuario: verificarUsuarioFalso,
      configAuth: CONFIG_AUTH,
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
    assert.deepEqual(progressosSalvos.get(`${USUARIO_ANA}:${DESPEJO}`), esperado);
  });

  it("recusa progresso inválido (400)", async () => {
    assert.equal((await patchProgresso({ progresso: "tudo" })).status, 400);
    assert.equal((await patchProgresso({})).status, 400);
  });

  it("recusa id de despejo inválido (400)", async () => {
    assert.equal((await patchProgresso({ progresso: {} }, "token-ana", "abc")).status, 400);
  });

  it("outra conta não altera o progresso (404)", async () => {
    assert.equal((await patchProgresso({ progresso: { concluidas: [1] } }, "token-bia")).status, 404);
  });

  it("sem login válido não altera o progresso (401)", async () => {
    assert.equal((await patchProgresso({ progresso: { concluidas: [1] } }, "token-vencido")).status, 401);
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

  it("/api/status informa que a nuvem e o login estão desligados", async () => {
    const dados = await (await fetch(`${servidor.base}/api/status`)).json();
    assert.equal(dados.nuvem, false);
    assert.equal(dados.auth, null);
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

describe("banco sem login configurado", () => {
  let servidor;
  let salvou = false;

  before(async () => {
    servidor = await subir({
      organizar: async () => RESPOSTA_IA,
      repositorio: {
        async salvar() {
          salvou = true;
          return { id: "x", data: "y" };
        },
      },
    });
  });

  after(() => servidor.fechar());

  it("não ativa a nuvem nem salva nada (sem login, nada vai para o servidor)", async () => {
    const status = await (await fetch(`${servidor.base}/api/status`)).json();
    assert.equal(status.nuvem, false);
    assert.equal(status.auth, null);

    const resposta = await organizarPost(servidor.base, { texto: "oi" });
    assert.equal(resposta.status, 200);
    assert.equal(salvou, false);
    assert.equal((await fetch(`${servidor.base}/api/despejos`, { headers: comLogin() })).status, 503);
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
