// App Express do Brain Dump AI: rotas, limitador e tratamento de erros.
// Recebe a função `organizar` por parâmetro, o que permite testar as rotas sem chamar o Gemini.
import express from "express";
import { fileURLToPath } from "node:url";
import { criarLimitador } from "./limitador.js";
import { sanitizarResposta } from "./sanitizar.js";
import { traduzirErroGemini } from "./ia.js";

export const LIMITE_CARACTERES = 10_000;

const PASTA_PUBLICA = fileURLToPath(new URL("../public", import.meta.url));

/**
 * @param {object} opcoes
 * @param {(texto: string) => Promise<string>} opcoes.organizar devolve o JSON (texto) gerado pela IA
 * @param {string} [opcoes.trustProxy] valor de TRUST_PROXY (atrás de Render, Railway etc.)
 * @param {{ maximo: number, janelaMs: number }} [opcoes.limite] limite de requisições por IP
 */
export function criarApp({ organizar, trustProxy, limite = { maximo: 10, janelaMs: 60_000 } }) {
  const app = express();

  // Atrás de um proxy, defina TRUST_PROXY=1 para que req.ip seja o IP real do usuário.
  // Localmente fica desligado, para que o cabeçalho X-Forwarded-For não possa ser forjado
  // para escapar do limitador.
  if (trustProxy) {
    app.set("trust proxy", Number(trustProxy) || trustProxy);
  }

  // Protege a cota da chave do Gemini (padrão: 10 organizações por minuto por IP).
  const limitarOrganizar = criarLimitador(limite);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(PASTA_PUBLICA));

  app.post("/api/organizar", limitarOrganizar, async (req, res) => {
    // 1) Validação da entrada
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";

    if (!texto) {
      return res
        .status(400)
        .json({ erro: "Escreva alguma coisa antes de organizar. Pode ser bem bagunçado mesmo!" });
    }

    if (texto.length > LIMITE_CARACTERES) {
      return res.status(413).json({
        erro: `Seu texto passou de ${LIMITE_CARACTERES.toLocaleString("pt-BR")} caracteres. Tente dividir em partes menores.`,
      });
    }

    // 2) Chamada à IA
    let textoIa;
    try {
      textoIa = await organizar(texto);
    } catch (erro) {
      console.error("[Gemini] Falha na chamada:", erro);
      const { status, mensagem } = traduzirErroGemini(erro);
      return res.status(status).json({ erro: mensagem });
    }

    // 3) Interpretação do JSON devolvido pela IA
    let dados;
    try {
      dados = JSON.parse(textoIa);
    } catch (erro) {
      console.error("[Gemini] Resposta não é um JSON válido:", erro, "\nConteúdo:", textoIa);
      return res.status(502).json({
        erro: "A IA respondeu de um jeito inesperado. Tente organizar de novo em instantes.",
      });
    }

    // 4) Limpeza: só campos do schema, sem itens vazios ou duplicados.
    return res.json(sanitizarResposta(dados));
  });

  // Middleware de erro: trata JSON malformado e corpo acima do limite do express.json.
  app.use((erro, req, res, next) => {
    if (erro?.type === "entity.too.large") {
      return res.status(413).json({ erro: "O texto enviado é grande demais. Tente dividir em partes menores." });
    }
    if (erro?.type === "entity.parse.failed") {
      return res.status(400).json({ erro: "Não consegui entender os dados enviados." });
    }
    console.error("[Servidor] Erro inesperado:", erro);
    return res.status(500).json({ erro: "Erro interno no servidor. Tente novamente." });
  });

  return app;
}
