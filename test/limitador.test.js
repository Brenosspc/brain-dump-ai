// Testes do limitador de requisições por IP (lib/limitador.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as esperar } from "node:timers/promises";
import { criarLimitador } from "../lib/limitador.js";

/** Imita o objeto `res` do Express, guardando status, cabeçalhos e corpo. */
function criarRes() {
  return {
    statusCode: 200,
    cabecalhos: {},
    corpo: null,
    set(nome, valor) {
      this.cabecalhos[nome] = valor;
      return this;
    },
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(corpo) {
      this.corpo = corpo;
      return this;
    },
  };
}

/** Executa o middleware e informa se a requisição passou (next foi chamado). */
function requisitar(limitador, ip) {
  const res = criarRes();
  let passou = false;
  limitador({ ip }, res, () => {
    passou = true;
  });
  return { passou, res };
}

describe("criarLimitador", () => {
  it("deixa passar até o máximo e bloqueia com 429 depois", () => {
    const limitador = criarLimitador({ maximo: 2, janelaMs: 60_000 });
    assert.equal(requisitar(limitador, "1.1.1.1").passou, true);
    assert.equal(requisitar(limitador, "1.1.1.1").passou, true);

    const { passou, res } = requisitar(limitador, "1.1.1.1");
    assert.equal(passou, false);
    assert.equal(res.statusCode, 429);
    assert.match(res.corpo.erro, /tente de novo/i);
    assert.ok(Number(res.cabecalhos["Retry-After"]) > 0);
  });

  it("conta cada IP separadamente", () => {
    const limitador = criarLimitador({ maximo: 1, janelaMs: 60_000 });
    assert.equal(requisitar(limitador, "1.1.1.1").passou, true);
    assert.equal(requisitar(limitador, "2.2.2.2").passou, true);
    assert.equal(requisitar(limitador, "1.1.1.1").passou, false);
  });

  it("informa os cabeçalhos RateLimit", () => {
    const limitador = criarLimitador({ maximo: 3, janelaMs: 60_000 });
    const { res } = requisitar(limitador, "1.1.1.1");
    assert.equal(res.cabecalhos["RateLimit-Limit"], "3");
    assert.equal(res.cabecalhos["RateLimit-Remaining"], "2");
  });

  it("libera de novo quando a janela expira", async () => {
    const limitador = criarLimitador({ maximo: 1, janelaMs: 50 });
    assert.equal(requisitar(limitador, "1.1.1.1").passou, true);
    assert.equal(requisitar(limitador, "1.1.1.1").passou, false);
    await esperar(80);
    assert.equal(requisitar(limitador, "1.1.1.1").passou, true);
  });
});
