// Cabeçalhos de segurança HTTP (sem dependências: o mesmo que o helmet faria, só o que usamos).
// A Content-Security-Policy libera apenas o que o site carrega de fato; se adicionar um recurso
// externo novo (fonte, script, API), ele precisa entrar aqui, senão o navegador bloqueia.

// Biblioteca de login (Supabase), versão fixa. A mesma URL e o hash ficam em public/app.js (SRI).
export const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js";

/** Origem (https://host) de uma URL, ou null se ela for inválida ou não for https/http. */
function origemDe(url) {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Monta a Content-Security-Policy.
 * @param {{ supabaseUrl?: string|null }} [opcoes] URL do projeto Supabase (para o login conversar com ele)
 */
export function montarCsp({ supabaseUrl = null } = {}) {
  const supabase = supabaseUrl ? origemDe(supabaseUrl) : null;
  const diretivas = {
    "default-src": ["'self'"],
    "script-src": ["'self'", SUPABASE_JS_URL],
    "style-src": ["'self'", "https://fonts.googleapis.com"],
    "font-src": ["https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(supabase ? [supabase] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(diretivas)
    .map(([nome, valores]) => `${nome} ${valores.join(" ")}`)
    .join("; ");
}

/** Middleware do Express que aplica os cabeçalhos de segurança em todas as respostas. */
export function cabecalhosSeguranca(opcoes = {}) {
  const cabecalhos = {
    "Content-Security-Policy": montarCsp(opcoes),
    // Impede o navegador de "adivinhar" o tipo de um arquivo (ex.: tratar texto como script).
    "X-Content-Type-Options": "nosniff",
    // Ninguém pode embutir o site num iframe (clickjacking). Reforça o frame-ancestors da CSP.
    "X-Frame-Options": "DENY",
    // Outros sites só recebem a origem, nunca o caminho completo.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Depois da primeira visita por HTTPS, o navegador nunca mais usa HTTP (ignorado em http://localhost).
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    // Isola a janela de popups de outros sites.
    "Cross-Origin-Opener-Policy": "same-origin",
    // Só o microfone (ditado por voz) e só neste site; o resto fica desligado.
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
  };
  return (req, res, next) => {
    res.set(cabecalhos);
    next();
  };
}
