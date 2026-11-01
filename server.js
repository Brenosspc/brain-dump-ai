// Brain Dump AI — ponto de entrada: lê a configuração, cria o cliente do Gemini e sobe o servidor.
// As rotas ficam em lib/app.js e a integração com a IA em lib/ia.js.
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { criarApp } from "./lib/app.js";
import { criarOrganizador } from "./lib/ia.js";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = Number(process.env.PORT) || 3000;

// gemini-2.5-flash não está mais disponível para chaves novas (a API devolve 404).
const MODELO = process.env.GEMINI_MODELO || "gemini-3.8-flash";
// Modelo reserva, com cota e fila próprias: usado quando o principal está sem cota, sobrecarregado
// ou lento demais. Para desligar, defina GEMINI_MODELO_RESERVA= (vazio) no .env.
const MODELO_RESERVA = process.env.GEMINI_MODELO_RESERVA ?? "gemini-3.5-flash-lite";

// Tempo total gasto com a IA, somando principal e reserva. O frontend espera um pouco mais (35 s),
// para nunca desistir antes de o servidor responder.
const PRAZO_TOTAL_IA_MS = 30_000;
// Tempo máximo do modelo principal; o restante do prazo fica para o reserva.
const TIMEOUT_PRINCIPAL_MS = 18_000;

// Sem chave não há como falar com a IA: aborta logo na inicialização.
if (!GEMINI_API_KEY) {
  console.error(
    "\n[ERRO] GEMINI_API_KEY não encontrada.\n" +
      "Crie um arquivo .env na raiz do projeto (use o .env.example como modelo)\n" +
      "e defina GEMINI_API_KEY=sua_chave.\n"
  );
  process.exit(1);
}

// O cliente do Gemini vive apenas no servidor; a chave nunca vai para o frontend.
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const organizar = criarOrganizador({
  ai,
  modelo: MODELO,
  modeloReserva: MODELO_RESERVA,
  prazoTotalMs: PRAZO_TOTAL_IA_MS,
  timeoutPrincipalMs: TIMEOUT_PRINCIPAL_MS,
});

const app = criarApp({ organizar, trustProxy: process.env.TRUST_PROXY });

// No Express 5, falhas ao abrir a porta (ex.: EADDRINUSE) chegam como argumento do callback.
app.listen(PORT, (erro) => {
  if (erro) {
    if (erro.code === "EADDRINUSE") {
      console.error(
        `\n[ERRO] A porta ${PORT} já está em uso. Feche o outro servidor ou defina outra PORT no .env.\n`
      );
    } else {
      console.error("[ERRO] Não foi possível iniciar o servidor:", erro);
    }
    process.exit(1);
  }
  const reserva = MODELO_RESERVA && MODELO_RESERVA !== MODELO ? ` (reserva: ${MODELO_RESERVA})` : "";
  console.log(`Brain Dump AI rodando em http://localhost:${PORT} — modelo ${MODELO}${reserva}`);
});
