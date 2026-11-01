// Verificação do login (Supabase Auth) no servidor.
// O navegador envia o token de acesso no cabeçalho Authorization: Bearer <token>; aqui perguntamos
// ao próprio Supabase de quem é o token (GET /auth/v1/user). Assim não precisamos de nenhuma
// biblioteca de JWT, e um token revogado (logout) deixa de valer.
import { createHash } from "node:crypto";

const TEMPO_CACHE_MS = 60_000; // evita consultar o Supabase a cada clique
const MAX_CACHE = 500;
const TIMEOUT_MS = 8_000;

/** Erro de infraestrutura (Supabase fora do ar, rede): diferente de "token inválido". */
export class ErroAuthIndisponivel extends Error {}

/** Lê o token do cabeçalho Authorization ("Bearer <token>"). */
export function lerToken(req) {
  const cabecalho = req.get("Authorization") ?? "";
  const [tipo, token] = cabecalho.split(" ");
  return tipo === "Bearer" && token && token.length < 4096 ? token : null;
}

/**
 * @param {object} opcoes
 * @param {string} opcoes.url URL do projeto Supabase (ex.: https://xxxx.supabase.co)
 * @param {string} opcoes.chavePublica chave anon/publishable do projeto (pública por natureza)
 * @param {typeof fetch} [opcoes.fetch] permite injetar um fetch falso nos testes
 */
export function criarVerificadorAuth({ url, chavePublica, fetch: buscar = globalThis.fetch, agora = Date.now }) {
  const base = url.replace(/\/+$/, "");
  // Guardamos só o hash do token na memória, nunca o token em si.
  const cache = new Map(); // hash -> { usuario, expira }

  /** Devolve { id, email } do dono do token, ou null se o token for inválido/expirado. */
  return async function verificar(token) {
    if (!token) return null;

    const chave = createHash("sha256").update(token).digest("hex");
    const emCache = cache.get(chave);
    if (emCache && emCache.expira > agora()) return emCache.usuario;
    cache.delete(chave);

    let resposta;
    try {
      resposta = await buscar(`${base}/auth/v1/user`, {
        headers: { apikey: chavePublica, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (erro) {
      throw new ErroAuthIndisponivel(`Supabase Auth indisponível: ${erro.name}`);
    }

    if (resposta.status === 401 || resposta.status === 403) return null;
    if (!resposta.ok) throw new ErroAuthIndisponivel(`Supabase Auth respondeu ${resposta.status}`);

    const dados = await resposta.json().catch(() => null);
    if (typeof dados?.id !== "string" || !dados.id) return null;

    const usuario = { id: dados.id, email: typeof dados.email === "string" ? dados.email : "" };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value); // descarta o mais antigo
    cache.set(chave, { usuario, expira: agora() + TEMPO_CACHE_MS });
    return usuario;
  };
}
