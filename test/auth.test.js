// Testes da verificação de login (lib/auth.js), com um fetch falso no lugar do Supabase.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { criarVerificadorAuth, lerToken, ErroAuthIndisponivel } from "../lib/auth.js";

const URL_SUPABASE = "https://exemplo.supabase.co/";
const CHAVE = "chave-publica-de-teste";
const USUARIO = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "ana@exemplo.com" };

/** fetch falso: responde com `status` e `corpo`, e guarda cada chamada. */
function criarFetchFalso(responder) {
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const { status = 200, corpo = {} } = await responder(chamadas.length);
    return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  };
  return { buscar, chamadas };
}

describe("lerToken", () => {
  const req = (valor) => ({ get: (nome) => (nome === "Authorization" ? valor : undefined) });

  it("lê o token do cabeçalho Bearer", () => {
    assert.equal(lerToken(req("Bearer abc.def.ghi")), "abc.def.ghi");
  });

  it("ignora cabeçalho ausente, de outro tipo ou grande demais", () => {
    for (const valor of [undefined, "", "Bearer", "Bearer ", "Basic abc", "bearer abc", `Bearer ${"a".repeat(5000)}`]) {
      assert.equal(lerToken(req(valor)), null, String(valor).slice(0, 20));
    }
  });
});

describe("criarVerificadorAuth", () => {
  it("pergunta ao Supabase de quem é o token e devolve { id, email }", async () => {
    const { buscar, chamadas } = criarFetchFalso(() => ({ corpo: { ...USUARIO, role: "authenticated" } }));
    const verificar = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar });

    assert.deepEqual(await verificar("token-1"), USUARIO);
    const [{ url, opcoes }] = chamadas;
    assert.equal(url, "https://exemplo.supabase.co/auth/v1/user", "sem barra dupla");
    assert.equal(opcoes.headers.apikey, CHAVE);
    assert.equal(opcoes.headers.Authorization, "Bearer token-1");
  });

  it("devolve null para token vazio, sem chamar o Supabase", async () => {
    const { buscar, chamadas } = criarFetchFalso(() => ({ corpo: USUARIO }));
    const verificar = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar });
    assert.equal(await verificar(""), null);
    assert.equal(chamadas.length, 0);
  });

  it("devolve null para token inválido ou expirado (401/403)", async () => {
    for (const status of [401, 403]) {
      const { buscar } = criarFetchFalso(() => ({ status, corpo: { msg: "invalid JWT" } }));
      const verificar = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar });
      assert.equal(await verificar("token-ruim"), null);
    }
  });

  it("devolve null se a resposta não tiver id", async () => {
    const { buscar } = criarFetchFalso(() => ({ corpo: { email: "x@y.com" } }));
    const verificar = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar });
    assert.equal(await verificar("token"), null);
  });

  it("lança ErroAuthIndisponivel se o Supabase falhar (5xx ou rede)", async () => {
    const { buscar: buscar500 } = criarFetchFalso(() => ({ status: 500 }));
    const verificar500 = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar500 });
    await assert.rejects(verificar500("token"), ErroAuthIndisponivel);

    const verificarRede = criarVerificadorAuth({
      url: URL_SUPABASE,
      chavePublica: CHAVE,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(verificarRede("token"), ErroAuthIndisponivel);
  });

  it("guarda o resultado por 60 s para não consultar o Supabase a cada clique", async () => {
    let instante = 1_000_000;
    const { buscar, chamadas } = criarFetchFalso(() => ({ corpo: USUARIO }));
    const verificar = criarVerificadorAuth({
      url: URL_SUPABASE,
      chavePublica: CHAVE,
      fetch: buscar,
      agora: () => instante,
    });

    await verificar("token-1");
    instante += 59_000;
    await verificar("token-1");
    assert.equal(chamadas.length, 1, "dentro do prazo usa o cache");

    instante += 2_000;
    await verificar("token-1");
    assert.equal(chamadas.length, 2, "depois do prazo consulta de novo");

    await verificar("token-2");
    assert.equal(chamadas.length, 3, "cada token tem sua própria entrada");
  });

  it("não guarda em cache tokens recusados", async () => {
    const { buscar, chamadas } = criarFetchFalso((n) => (n === 1 ? { status: 401 } : { corpo: USUARIO }));
    const verificar = criarVerificadorAuth({ url: URL_SUPABASE, chavePublica: CHAVE, fetch: buscar });
    assert.equal(await verificar("token"), null);
    assert.deepEqual(await verificar("token"), USUARIO);
    assert.equal(chamadas.length, 2);
  });
});
