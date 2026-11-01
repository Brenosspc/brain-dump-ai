# Brain Dump AI

App de brain dump para pessoas com TDAH/ansiedade: o usuário escreve pensamentos sem ordem e a IA (Gemini) os organiza em tarefas, ideias, dúvidas e desabafos. Projeto de portfólio.

## Stack
- Backend: Node 18+ (ESM), Express, @google/genai (`gemini-3.8-flash`; o 2.5 não está disponível para chaves novas), dotenv
- Frontend: HTML + JS Vanilla ES6 + Tailwind via CDN, sem build step (`public/`)
- Persistência: LocalStorage (sem banco)

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
