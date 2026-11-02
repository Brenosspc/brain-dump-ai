// Testes dos cabeçalhos de segurança (lib/seguranca.js) e do SRI da biblioteca de login.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { montarCsp, SUPABASE_JS_URL } from "../lib/seguranca.js";
import { criarApp } from "../lib/app.js";

/** Lê a CSP como { diretiva: [valores] }. */
function lerCsp(csp) {
  return Object.fromEntries(
    csp.split(";").map((parte) => {
      const [nome, ...valores] = parte.trim().split(/\s+/);
      return [nome, valores];
    })
  );
}

describe("montarCsp", () => {
  it("só libera o próprio site, as fontes do Google e o script fixo do Supabase", () => {
    const csp = lerCsp(montarCsp());
    assert.deepEqual(csp["default-src"], ["'self'"]);
    assert.deepEqual(csp["script-src"], ["'self'", SUPABASE_JS_URL]);
    assert.deepEqual(csp["connect-src"], ["'self'"]);
    assert.deepEqual(csp["object-src"], ["'none'"]);
    assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
    assert.deepEqual(csp["base-uri"], ["'none'"]);
  });

  it("nunca libera scripts inline nem eval", () => {
    const csp = montarCsp({ supabaseUrl: "https://abc.supabase.co" });
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  });

  it("libera a conexão só com a origem do Supabase configurado", () => {
    const csp = lerCsp(montarCsp({ supabaseUrl: "https://abc.supabase.co/caminho?x=1" }));
    assert.deepEqual(csp["connect-src"], ["'self'", "https://abc.supabase.co"]);
  });

  it("ignora uma URL do Supabase inválida ou perigosa", () => {
    for (const supabaseUrl of ["não é url", "javascript:alert(1)", "https://x.co; script-src *"]) {
      const csp = lerCsp(montarCsp({ supabaseUrl }));
      assert.ok(!csp["connect-src"].some((v) => v.includes("javascript") || v === "*"), supabaseUrl);
      assert.deepEqual(csp["script-src"], ["'self'", SUPABASE_JS_URL]);
    }
  });
});

describe("cabeçalhos nas respostas", () => {
  let servidor;
  let base;

  before(async () => {
    servidor = criarApp({
      organizar: async () => "{}",
      configAuth: { url: "https://abc.supabase.co", chavePublica: "chave" },
    }).listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(() => new Promise((resolve) => servidor.close(resolve)));

  for (const caminho of ["/", "/app.js", "/api/status", "/nao-existe"]) {
    it(`aplica os cabeçalhos em ${caminho}`, async () => {
      const resposta = await fetch(base + caminho);
      const h = resposta.headers;
      // No 404 o próprio Express manda uma CSP ainda mais restrita: default-src 'none'.
      const esperada = caminho === "/nao-existe" ? /default-src 'none'/ : /connect-src 'self' https:\/\/abc\.supabase\.co/;
      assert.match(h.get("content-security-policy"), esperada);
      assert.equal(h.get("x-content-type-options"), "nosniff");
      assert.equal(h.get("x-frame-options"), "DENY");
      assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.match(h.get("strict-transport-security"), /max-age=31536000/);
      assert.match(h.get("permissions-policy"), /microphone=\(self\)/);
      assert.equal(h.get("x-powered-by"), null);
    });
  }
});

describe("frontend compatível com a CSP", () => {
  it("public/app.js usa a mesma URL do Supabase liberada na CSP, com hash SRI", async () => {
    const codigo = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
    assert.ok(codigo.includes(`"${SUPABASE_JS_URL}"`));
    assert.match(codigo, /SUPABASE_JS_SRI = "sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(codigo, /script\.integrity = SUPABASE_JS_SRI/);
  });

  it("index.html não tem scripts inline, estilos inline nem eventos inline (bloqueados pela CSP)", async () => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    assert.doesNotMatch(html, /\sstyle="/);
    assert.doesNotMatch(html, /\son[a-z]+="/);
    for (const [, atributos] of html.matchAll(/<script([^>]*)>/g)) {
      assert.match(atributos, /\ssrc="/, "todo <script> precisa ser um arquivo (src)");
    }
    assert.doesNotMatch(html, /<style[\s>]/);
  });
});

describe("IP real atrás de proxies (TRUST_PROXY)", () => {
  // Simula a cadeia do Render: usuário -> Cloudflare -> balanceador -> app.
  // O X-Forwarded-For chega como "<forjado?>, <usuário>, <cloudflare>".
  async function restantes(trustProxy, xff) {
    const servidor = criarApp({ organizar: async () => "{}", trustProxy, limite: { maximo: 5, janelaMs: 60_000 } }).listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const valores = [];
    for (const cabecalho of xff) {
      const resposta = await fetch(`${base}/api/ajuda`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": cabecalho },
        body: "{}",
      });
      valores.push(resposta.headers.get("ratelimit-remaining"));
    }
    await new Promise((resolve) => servidor.close(resolve));
    return valores;
  }

  it("com 2 proxies, conta pelo IP do usuário mesmo com o Cloudflare variando", async () => {
    const valores = await restantes("2", ["200.1.1.1, 104.0.0.1", "200.1.1.1, 104.0.0.2", "200.1.1.1, 172.64.0.9"]);
    assert.deepEqual(valores, ["4", "3", "2"]);
  });

  it("com 2 proxies, forjar o X-Forwarded-For não zera o limite", async () => {
    const valores = await restantes("2", [
      "200.1.1.1, 104.0.0.1",
      "9.9.9.9, 200.1.1.1, 104.0.0.2",
      "8.8.8.8, 7.7.7.7, 200.1.1.1, 104.0.0.3",
    ]);
    assert.deepEqual(valores, ["4", "3", "2"]);
  });

  it("com 1 proxy só no Render, cada IP do Cloudflare vira um contador novo (o bug corrigido)", async () => {
    const valores = await restantes("1", ["200.1.1.1, 104.0.0.1", "200.1.1.1, 104.0.0.2"]);
    assert.deepEqual(valores, ["4", "4"]);
  });
});
