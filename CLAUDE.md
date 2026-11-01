# Brain Dump AI

App de brain dump para pessoas com TDAH/ansiedade: o usuário escreve pensamentos sem ordem e a IA (Gemini) os organiza em tarefas, ideias, dúvidas e desabafos. Projeto de portfólio.

## Stack
- Backend: Node 18+ (ESM), Express, @google/genai, dotenv. Modelo principal `gemini-3.8-flash` com reserva `gemini-3.5-flash-lite` (o 2.5 não está disponível para chaves novas; Gemini 3.5+ usa `thinkingLevel`, não `thinkingBudget`)
- Estrutura: `server.js` (configuração) → `lib/app.js` (rotas) + `lib/ia.js` (Gemini)
- Testes: `npm test` (`node:test`, Gemini simulado, sem gastar cota)
- Frontend: HTML + JS Vanilla ES6 + Tailwind via CDN, sem build step (`public/`)
- Persistência: Postgres no Supabase (opcional, teste) via `pg` em `lib/db.js`, ligado por `DATABASE_URL`; LocalStorage como cópia/reserva. Schema em `db/schema.sql` (`npm run db:setup`). TLS sempre verificado com `certs/supabase-ca.crt` (nunca `rejectUnauthorized: false`). Sem login: despejos separados por `X-Dispositivo-Id` (UUID anônimo do navegador), retenção de 30 dias

## Rodar
```
npm run dev
```
Abre em http://localhost:3000 (requer `.env` com `GEMINI_API_KEY`, ver `.env.example`).

## Regras
- UI e comentários em português do Brasil.
- `GEMINI_API_KEY` só no servidor; nunca expor no frontend.
- Respostas da IA sempre estruturadas via `responseSchema`.
- Não adicionar dependências sem avisar.
- UI em dark mode minimalista.
- Cartão de apoio (CVV 188): ativado por `sugerir_apoio` da IA OU pela lista de expressões em `lib/apoio.js`. Ao mexer nisso, manter as duas camadas, o tom calmo e evitar falsos positivos com expressões idiomáticas ("vai me matar de rir").
