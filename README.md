# 🧠 Brain Dump AI (em andamento)

Despeje tudo o que está na sua cabeça, sem ordem, e deixe a IA organizar.

O **Brain Dump AI** foi pensado para pessoas com **TDAH e ansiedade**: você escreve (ou fala) os pensamentos do jeito que vierem, e a IA (Google Gemini) os separa em **tarefas**, **ideias**, **dúvidas** e **desabafos**, com uma síntese acolhedora do seu momento.

> Projeto de portfólio. Não é uma ferramenta clínica e não substitui acompanhamento profissional.

---

## ✨ Funcionalidades

- **Escreva sem filtro:** caixa de texto ampla, contador de caracteres/palavras e atalho **Ctrl + Enter** (ou **⌘ + Enter**) para organizar.
- **Fale em vez de digitar:** ditado por voz em português (Web Speech API), anexado ao texto. Funciona no Chrome e no Edge.
- **Organização com IA:**
  - 🔴 **Tarefas:** ações concretas, começando com verbo
  - 💡 **Ideias:** projetos e possibilidades
  - ❓ **Dúvidas:** decisões a tomar
  - 🧘 **Desabafos:** sentimentos reescritos com gentileza
- **Leitura do momento:** síntese acolhedora, nível de carga cognitiva e estado mental.
- **"Sua mente está X% mais leve":** métrica motivacional (não clínica) baseada no que foi organizado.
- **Copiar apenas tarefas:** uma por linha, prontas para colar no seu app de lista.
- **Histórico local:** os últimos 5 despejos ficam salvos **só no seu navegador**, e você pode reabri-los.
- **Pensado para foco:** dark mode suave, sem distrações, animações discretas que respeitam `prefers-reduced-motion`, navegação por teclado e suporte a leitores de tela.

## 🛠️ Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js 18+ (ESM), Express 5 |
| IA | Google Gemini (`gemini-3.8-flash`) via `@google/genai`, com respostas estruturadas por `responseSchema` |
| Frontend | HTML + JavaScript Vanilla (ES6) + Tailwind CSS via CDN, sem build step |
| Persistência | LocalStorage (sem banco de dados) |

## 🚀 Como rodar

**Pré-requisitos:** [Node.js 18+](https://nodejs.org/) e uma chave da API do Gemini, gerada gratuitamente no [Google AI Studio](https://aistudio.google.com/apikey).

```bash
# 1. Clone o repositório
git clone https://github.com/Brenosspc/brain-dump-ai.git
cd brain-dump-ai

# 2. Instale as dependências
npm install

# 3. Crie o arquivo .env a partir do modelo e coloque sua chave
cp .env.example .env
# edite o .env: GEMINI_API_KEY=sua_chave_aqui

# 4. Inicie o servidor
npm run dev
```

Abra **http://localhost:3000** no navegador.

### Testes

```bash
npm test
```

Os testes usam o `node:test` (nativo do Node, sem dependências) e substituem o Gemini por um cliente falso, então **não gastam cota da API**.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `GEMINI_API_KEY` | Sim | Chave da API do Gemini. Fica só no servidor e nunca é enviada ao navegador. |
| `GEMINI_MODELO` | Não | Modelo principal (padrão: `gemini-3.8-flash`). |
| `GEMINI_MODELO_RESERVA` | Não | Modelo usado quando o principal está sem cota, sobrecarregado ou lento (padrão: `gemini-3.5-flash-lite`). Deixe vazio para desligar. |
| `PORT` | Não | Porta do servidor (padrão: `3000`). |
| `TRUST_PROXY` | Não | Use `1` ao hospedar atrás de um proxy (Render, Railway etc.) para o limitador identificar o IP real. |

## 🔌 API

### `POST /api/organizar`

**Requisição**
```json
{ "texto": "preciso pagar a conta de luz... será que aceito o freela? tô cansado hoje" }
```

**Resposta (200)**
```json
{
  "sintese_acolhedora": "Você está lidando com muita coisa ao mesmo tempo, e tudo bem se sentir cansado.",
  "nivel_carga_cognitiva": "Moderada",
  "estado_mental": "Sobrecarga Leve",
  "tarefas": ["Pagar a conta de luz"],
  "ideias": [],
  "duvidas": ["Devo aceitar o freela?"],
  "desabafos": ["Você está se sentindo cansado hoje, e isso é válido."]
}
```

**Erros:** sempre no formato `{ "erro": "mensagem amigável" }`.

| Status | Quando |
| --- | --- |
| 400 | Texto vazio ou JSON inválido |
| 413 | Texto acima de 10.000 caracteres |
| 429 | Muitas requisições (limite de 10 por minuto por IP) |
| 502 / 503 / 504 | A IA respondeu de forma inesperada |
| 500 | Erro interno ou de configuração |

## 🔒 Segurança e privacidade

- A chave do Gemini existe **apenas no servidor**.
- **Limite de requisições por IP** protege a cota da API.
- O texto do usuário é delimitado no prompt e a IA é instruída a **ignorar comandos embutidos** (proteção contra *prompt injection*).
- A resposta da IA é **validada e sanitizada** no servidor e no navegador.
- Todo conteúdo da IA é renderizado com `textContent`, **nunca `innerHTML`** (proteção contra XSS).
- O histórico fica **só no LocalStorage do seu navegador**. O texto é enviado ao servidor e ao Gemini apenas para ser organizado, e o servidor não o armazena.

## 📁 Estrutura

```
brain-dump-ai/
├── server.js           # Ponto de entrada: configuração e inicialização
├── lib/
│   ├── app.js          # App Express: rotas e tratamento de erros
│   ├── ia.js           # Integração com o Gemini (prompt, schema, modelo reserva)
│   ├── limitador.js    # Limite de requisições por IP (em memória)
│   └── sanitizar.js    # Limpeza e validação da resposta da IA
├── public/
│   ├── index.html      # Interface
│   ├── style.css       # Estilos complementares ao Tailwind
│   └── app.js          # Lógica do frontend (voz, envio, histórico)
├── test/               # Testes automatizados (node:test)
├── .env.example        # Modelo das variáveis de ambiente
└── package.json
```

## ⚠️ Limitações conhecidas

- No **plano gratuito** do Gemini, a cota diária é pequena. Quando ela acaba, o app avisa e é preciso esperar a renovação ou ativar o faturamento no Google AI Studio.
- O **ditado por voz** depende do navegador: funciona no Chrome e no Edge, mas não no Firefox, no Opera e no Brave.
- O limitador de requisições vive na memória do processo: zera ao reiniciar o servidor e não é compartilhado entre várias instâncias.

## 👤 Autor
