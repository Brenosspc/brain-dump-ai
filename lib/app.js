// App Express do Brain Dump AI: rotas, limitadores e tratamento de erros.
// Recebe a IA (`organizar`, `gerarMicroPassos`), o banco (`repositorio`) e o login (`verificarUsuario`)
// por parâmetro, o que permite testar as rotas sem chamar o Gemini, o banco ou o Supabase de verdade.
import { randomUUID } from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { criarLimitador } from "./limitador.js";
import { sanitizarResposta, sanitizarPassos, sanitizarProgresso } from "./sanitizar.js";
import { traduzirErroGemini } from "./ia.js";
import { detectarSinaisDeRisco } from "./apoio.js";
import { DIAS_RETENCAO, LIMITE_LISTA_MAXIMO, LIMITE_LISTA_PADRAO, ehUuid } from "./db.js";
import { lerToken, ErroAuthIndisponivel } from "./auth.js";

export const LIMITE_CARACTERES = 10_000;
export const LIMITE_CARACTERES_TAREFA = 300;
/** Tamanho máximo do progresso (JSON) aceito por despejo. */
const LIMITE_BYTES_PROGRESSO = 20_000;
/** Quantos despejos do navegador podem ser importados de uma vez para a conta. */
export const MAX_IMPORTACAO = 10;
const ROTA_IMPORTAR = "/api/despejos/importar";

const PASTA_PUBLICA = fileURLToPath(new URL("../public", import.meta.url));
const ERRO_BANCO = "Não consegui acessar o histórico na nuvem agora. Tente de novo em instantes.";
const ERRO_AUTH_INDISPONIVEL = "Não consegui confirmar seu login agora. Tente de novo em instantes.";

/** Identificador anônimo do navegador, enviado pelo frontend no cabeçalho X-Dispositivo-Id. */
function lerDispositivo(req) {
  const id = req.get("X-Dispositivo-Id");
  return ehUuid(id) ? id.toLowerCase() : null;
}

/**
 * Valida um despejo vindo do navegador para importação. Devolve o despejo limpo ou null.
 * A data é mantida se for válida e estiver dentro do prazo de retenção; senão, vira "agora".
 */
function validarDespejoImportado(despejo) {
  if (!despejo || typeof despejo !== "object") return null;
  if (!ehUuid(despejo.id)) return null;

  const texto = typeof despejo.texto === "string" ? despejo.texto.trim() : "";
  if (!texto || texto.length > LIMITE_CARACTERES) return null;
  if (!despejo.resultado || typeof despejo.resultado !== "object") return null;

  const agora = Date.now();
  const limiteAntigo = agora - DIAS_RETENCAO * 24 * 60 * 60 * 1000;
  const quando = Date.parse(despejo.data);
  const data = Number.isFinite(quando) && quando <= agora && quando > limiteAntigo ? new Date(quando) : new Date(agora);

  return {
    id: despejo.id.toLowerCase(),
    data: data.toISOString(),
    texto,
    resultado: sanitizarResposta(despejo.resultado),
    progresso: sanitizarProgresso(despejo.progresso) ?? { concluidas: [], micro_passos: {} },
  };
}

/**
 * @param {object} opcoes
 * @param {(texto: string) => Promise<string>} opcoes.organizar devolve o JSON (texto) gerado pela IA
 * @param {(tarefa: string) => Promise<string>} [opcoes.gerarMicroPassos] devolve o JSON (texto) com { passos }
 * @param {object|null} [opcoes.repositorio] acesso ao banco (lib/db.js); null = sem histórico na nuvem
 * @param {((token: string) => Promise<{id: string, email: string}|null>)|null} [opcoes.verificarUsuario]
 *        verificação do login (lib/auth.js); null = sem login
 * @param {{ url: string, chavePublica: string }|null} [opcoes.configAuth] dados públicos do Supabase para o navegador
 * @param {string} [opcoes.trustProxy] valor de TRUST_PROXY (atrás de Render, Railway etc.)
 * @param {{ maximo: number, janelaMs: number }} [opcoes.limite] limite de organizações por IP
 * @param {{ maximo: number, janelaMs: number }} [opcoes.limiteHistorico] limite das rotas de histórico por IP
 */
export function criarApp({
  organizar,
  gerarMicroPassos = null,
  repositorio = null,
  verificarUsuario = null,
  configAuth = null,
  trustProxy,
  limite = { maximo: 10, janelaMs: 60_000 },
  limiteHistorico = { maximo: 60, janelaMs: 60_000 },
}) {
  const app = express();
  // Histórico na nuvem só existe com banco E login: sem login, nada é salvo no servidor.
  const nuvemAtiva = Boolean(repositorio && verificarUsuario && configAuth);

  // Atrás de um proxy, defina TRUST_PROXY=1 para que req.ip seja o IP real do usuário.
  // Localmente fica desligado, para que o cabeçalho X-Forwarded-For não possa ser forjado
  // para escapar do limitador.
  if (trustProxy) {
    app.set("trust proxy", Number(trustProxy) || trustProxy);
  }

  // Protege a cota da chave do Gemini (padrão: 10 organizações por minuto por IP).
  const limitarOrganizar = criarLimitador(limite);
  const limitarHistorico = criarLimitador({
    ...limiteHistorico,
    mensagem: "Muitas ações no histórico em pouco tempo. Tente de novo em instantes.",
  });

  // JSON de até 100 KB em todas as rotas, exceto a importação (até 10 despejos completos).
  const jsonPadrao = express.json({ limit: "100kb" });
  app.use((req, res, next) => (req.path === ROTA_IMPORTAR ? next() : jsonPadrao(req, res, next)));
  app.use(express.static(PASTA_PUBLICA));

  /** Identifica o usuário logado, se houver. Lança ErroAuthIndisponivel se o Supabase não responder. */
  async function identificarUsuario(req) {
    if (!verificarUsuario) return null;
    const token = lerToken(req);
    return token ? verificarUsuario(token) : null;
  }

  // Informa ao frontend se o histórico na nuvem (com login) está disponível.
  app.get("/api/status", (req, res) => {
    res.json({
      nuvem: nuvemAtiva,
      dias_retencao: DIAS_RETENCAO,
      // A URL e a chave anon/publishable do Supabase são públicas por natureza: o navegador precisa
      // delas para fazer login. O acesso à tabela continua bloqueado pelo RLS.
      auth: nuvemAtiva ? { url: configAuth.url, chave_publica: configAuth.chavePublica } : null,
    });
  });

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
    const resultado = sanitizarResposta(dados);
    // Rede de segurança: expressões explícitas de risco ativam o cartão de apoio mesmo se a IA não marcar.
    resultado.sugerir_apoio = resultado.sugerir_apoio || detectarSinaisDeRisco(texto);

    // 5) Salva na conta, se houver nuvem e a pessoa estiver logada.
    //    Uma falha aqui (login ou banco) não impede a pessoa de ver o resultado.
    if (!nuvemAtiva || !lerToken(req)) return res.json(resultado);

    let usuario;
    try {
      usuario = await identificarUsuario(req);
    } catch (erro) {
      console.error("[Auth] Falha ao verificar o login:", erro.message);
      return res.json({ ...resultado, despejo: null });
    }
    if (!usuario) return res.json({ ...resultado, despejo: null, sessao_expirada: true });

    try {
      const despejo = await repositorio.salvar({
        usuarioId: usuario.id,
        dispositivoId: lerDispositivo(req) ?? randomUUID(),
        texto,
        resultado,
      });
      return res.json({ ...resultado, despejo });
    } catch (erro) {
      console.error("[Banco] Falha ao salvar o despejo:", erro.code ?? "", erro.message);
      return res.json({ ...resultado, despejo: null });
    }
  });

  // ---------------------------------------------------------------------------
  // Micro-passos: divide uma tarefa em 3 a 5 passos pequenos
  // ---------------------------------------------------------------------------

  // Usa o mesmo limitador da organização, porque também gasta cota da IA.
  app.post("/api/micro-passos", limitarOrganizar, async (req, res) => {
    if (!gerarMicroPassos) {
      return res.status(503).json({ erro: "Os micro-passos não estão disponíveis neste servidor." });
    }

    const tarefa = typeof req.body?.tarefa === "string" ? req.body.tarefa.replace(/\s+/g, " ").trim() : "";
    if (!tarefa) {
      return res.status(400).json({ erro: "Informe a tarefa que você quer dividir em passos." });
    }
    if (tarefa.length > LIMITE_CARACTERES_TAREFA) {
      return res.status(413).json({ erro: "Essa tarefa é longa demais para dividir. Tente resumir em uma frase." });
    }

    let textoIa;
    try {
      textoIa = await gerarMicroPassos(tarefa);
    } catch (erro) {
      console.error("[Gemini] Falha ao gerar micro-passos:", erro);
      const { status, mensagem } = traduzirErroGemini(erro);
      return res.status(status).json({ erro: mensagem });
    }

    let passos = [];
    try {
      passos = sanitizarPassos(JSON.parse(textoIa));
    } catch (erro) {
      console.error("[Gemini] Micro-passos não vieram em JSON válido:", erro, "\nConteúdo:", textoIa);
    }
    if (passos.length === 0) {
      return res.status(502).json({ erro: "Não consegui dividir essa tarefa agora. Tente de novo em instantes." });
    }
    return res.json({ passos });
  });

  // ---------------------------------------------------------------------------
  // Histórico na nuvem (exige login)
  // ---------------------------------------------------------------------------

  /** Exige nuvem configurada e um login válido; guarda o usuário em res.locals.usuario. */
  async function exigirConta(req, res, next) {
    if (!nuvemAtiva) {
      return res.status(503).json({ erro: "O histórico na nuvem não está configurado neste servidor." });
    }
    let usuario;
    try {
      usuario = await identificarUsuario(req);
    } catch (erro) {
      console.error("[Auth] Falha ao verificar o login:", erro.message);
      return res.status(503).json({ erro: ERRO_AUTH_INDISPONIVEL });
    }
    if (!usuario) {
      return res.status(401).json({ erro: "Sua sessão expirou ou você não está logado. Entre de novo." });
    }
    res.locals.usuario = usuario;
    return next();
  }

  app.get("/api/despejos", limitarHistorico, exigirConta, async (req, res) => {
    const pedido = Number.parseInt(req.query.limite, 10);
    const limiteLista = Number.isFinite(pedido)
      ? Math.min(Math.max(pedido, 1), LIMITE_LISTA_MAXIMO)
      : LIMITE_LISTA_PADRAO;
    try {
      const despejos = await repositorio.listar(res.locals.usuario.id, limiteLista);
      return res.json({ despejos });
    } catch (erro) {
      console.error("[Banco] Falha ao listar despejos:", erro.code ?? "", erro.message);
      return res.status(503).json({ erro: ERRO_BANCO });
    }
  });

  // Leva para a conta os despejos que estavam só neste navegador (e os da nuvem sem dono criados
  // por ele antes do login). Chamado pelo frontend logo depois de entrar.
  app.post(
    ROTA_IMPORTAR,
    limitarHistorico,
    express.json({ limit: "600kb" }),
    exigirConta,
    async (req, res) => {
      const lista = req.body?.despejos;
      if (!Array.isArray(lista)) {
        return res.status(400).json({ erro: "Formato de importação inválido." });
      }
      if (lista.length > MAX_IMPORTACAO) {
        return res.status(413).json({ erro: `Dá para importar no máximo ${MAX_IMPORTACAO} despejos de uma vez.` });
      }

      const validos = lista.map(validarDespejoImportado).filter(Boolean);
      const dispositivoId = lerDispositivo(req);
      try {
        const vinculados = dispositivoId
          ? await repositorio.vincularDispositivo(res.locals.usuario.id, dispositivoId)
          : 0;
        const importados = await repositorio.importar(
          res.locals.usuario.id,
          dispositivoId ?? randomUUID(),
          validos
        );
        return res.json({ importados, vinculados, ignorados: lista.length - validos.length });
      } catch (erro) {
        console.error("[Banco] Falha ao importar despejos:", erro.code ?? "", erro.message);
        return res.status(503).json({ erro: ERRO_BANCO });
      }
    }
  );

  // Atualiza o progresso (tarefas concluídas e micro-passos) de um despejo.
  app.patch("/api/despejos/:id", limitarHistorico, exigirConta, async (req, res) => {
    if (!ehUuid(req.params.id)) {
      return res.status(400).json({ erro: "Despejo inválido." });
    }
    const progresso = sanitizarProgresso(req.body?.progresso);
    if (!progresso) {
      return res.status(400).json({ erro: "Progresso inválido." });
    }
    if (JSON.stringify(progresso).length > LIMITE_BYTES_PROGRESSO) {
      return res.status(413).json({ erro: "O progresso deste despejo ficou grande demais para salvar." });
    }
    try {
      const atualizou = await repositorio.atualizarProgresso(
        res.locals.usuario.id,
        req.params.id.toLowerCase(),
        progresso
      );
      if (!atualizou) return res.status(404).json({ erro: "Esse despejo não foi encontrado na nuvem." });
      return res.json({ progresso });
    } catch (erro) {
      console.error("[Banco] Falha ao salvar o progresso:", erro.code ?? "", erro.message);
      return res.status(503).json({ erro: ERRO_BANCO });
    }
  });

  app.delete("/api/despejos/:id", limitarHistorico, exigirConta, async (req, res) => {
    if (!ehUuid(req.params.id)) {
      return res.status(400).json({ erro: "Despejo inválido." });
    }
    try {
      const apagou = await repositorio.apagar(res.locals.usuario.id, req.params.id.toLowerCase());
      if (!apagou) return res.status(404).json({ erro: "Esse despejo não foi encontrado (talvez já tenha sido apagado)." });
      return res.status(204).end();
    } catch (erro) {
      console.error("[Banco] Falha ao apagar despejo:", erro.code ?? "", erro.message);
      return res.status(503).json({ erro: ERRO_BANCO });
    }
  });

  app.delete("/api/despejos", limitarHistorico, exigirConta, async (req, res) => {
    try {
      await repositorio.apagarTodos(res.locals.usuario.id);
      return res.status(204).end();
    } catch (erro) {
      console.error("[Banco] Falha ao apagar o histórico:", erro.code ?? "", erro.message);
      return res.status(503).json({ erro: ERRO_BANCO });
    }
  });

  // Middleware de erro: trata JSON malformado e corpo acima do limite do express.json.
  app.use((erro, req, res, next) => {
    if (erro?.type === "entity.too.large") {
      return res.status(413).json({ erro: "O texto enviado é grande demais. Tente dividir em partes menores." });
    }
    if (erro?.type === "entity.parse.failed") {
      return res.status(400).json({ erro: "Não consegui entender os dados enviados." });
    }
    if (erro instanceof ErroAuthIndisponivel) {
      return res.status(503).json({ erro: ERRO_AUTH_INDISPONIVEL });
    }
    console.error("[Servidor] Erro inesperado:", erro);
    return res.status(500).json({ erro: "Erro interno no servidor. Tente novamente." });
  });

  return app;
}
