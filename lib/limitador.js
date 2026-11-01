// Limitador de requisições por IP, em memória (janela fixa).
// Protege a cota da GEMINI_API_KEY contra uso abusivo sem precisar de dependência externa.
// Observação: o contador vive na memória do processo, então zera quando o servidor reinicia
// e não é compartilhado entre várias instâncias. Para um app de portfólio, é suficiente.

/**
 * Cria um middleware Express que limita cada IP a `maximo` requisições por `janelaMs`.
 */
export function criarLimitador({ maximo = 10, janelaMs = 60_000, mensagem } = {}) {
  // ip -> { contagem, inicio }
  const registros = new Map();

  // Limpeza periódica de IPs com janela expirada, para o Map não crescer sem fim.
  const limpeza = setInterval(() => {
    const agora = Date.now();
    for (const [ip, registro] of registros) {
      if (agora - registro.inicio >= janelaMs) registros.delete(ip);
    }
  }, janelaMs);
  limpeza.unref(); // não impede o processo de encerrar

  return function limitador(req, res, next) {
    const ip = req.ip ?? "desconhecido";
    const agora = Date.now();
    let registro = registros.get(ip);

    // Primeira requisição do IP ou janela anterior já expirou: começa uma nova.
    if (!registro || agora - registro.inicio >= janelaMs) {
      registro = { contagem: 0, inicio: agora };
      registros.set(ip, registro);
    }

    registro.contagem += 1;

    const restantes = Math.max(0, maximo - registro.contagem);
    const segundosParaReset = Math.ceil((registro.inicio + janelaMs - agora) / 1000);
    res.set("RateLimit-Limit", String(maximo));
    res.set("RateLimit-Remaining", String(restantes));
    res.set("RateLimit-Reset", String(segundosParaReset));

    if (registro.contagem > maximo) {
      res.set("Retry-After", String(segundosParaReset));
      return res.status(429).json({
        erro:
          mensagem ??
          `Você enviou muitos textos seguidos. Respire um pouco e tente de novo em ${segundosParaReset}s.`,
      });
    }

    return next();
  };
}
