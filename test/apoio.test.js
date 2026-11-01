// Testes da rede de segurança do cartão de apoio (lib/apoio.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectarSinaisDeRisco } from "../lib/apoio.js";

describe("detectarSinaisDeRisco", () => {
  for (const texto of [
    "às vezes penso em me matar",
    "acho que vou me matar",
    "tenho pensado em suicídio",
    "NÃO QUERO MAIS VIVER",
    "nao aguento mais viver assim",
    "eu só queria morrer hoje",
    "queria estar morta",
    "dá vontade de me machucar",
    "queria sumir para sempre",
    "seria melhor sem mim aqui",
    "não vejo mais sentido na vida",
  ]) {
    it(`detecta: "${texto}"`, () => {
      assert.equal(detectarSinaisDeRisco(texto), true);
    });
  }

  for (const texto of [
    "preciso pagar a conta de luz",
    "tô morrendo de sono",
    "essa reunião vai me matar de tédio kkk",
    "minha mãe vai me matar se eu esquecer",
    "essa série vai me matar de rir",
    "tô cansado e ansioso com a prova",
    "quero sumir das redes sociais por um tempo",
    "",
  ]) {
    it(`não detecta em texto comum: "${texto}"`, () => {
      assert.equal(detectarSinaisDeRisco(texto), false);
    });
  }

  it("não quebra com entradas que não são texto", () => {
    assert.equal(detectarSinaisDeRisco(undefined), false);
    assert.equal(detectarSinaisDeRisco(null), false);
  });
});
