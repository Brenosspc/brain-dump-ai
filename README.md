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
- **Checklist de tarefas:** marque o que já fez, com o progresso salvo no histórico.
- **Quebrar em passos menores:** a IA divide uma tarefa que parece grande demais em 3 a 5 passos pequenos, começando por um bem fácil.
- **Apoio quando precisa:** se o texto mostrar sinais de sofrimento intenso, aparece com delicadeza o contato do **CVV (188)**. Um rodapé discreto deixa esse contato sempre à mão.
- **Copiar apenas tarefas:** uma por linha, prontas para colar no seu app de lista.
- **Histórico:** os últimos 5 despejos ficam salvos e podem ser reabertos com o progresso.
- **Login sem senha (opcional):** entre com um link mágico enviado por e-mail para guardar o histórico na nuvem e acessá-lo de outros aparelhos. Sem login, tudo fica só no navegador. Ao entrar, o que já estava no navegador vai para a sua conta.
- **Pensado para foco:** dark mode suave, sem distrações, animações discretas que respeitam `prefers-reduced-motion`, navegação por teclado e suporte a leitores de tela.

## 🛠️ Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js 18+ (ESM), Express 5 |
| IA | Google Gemini (`gemini-3.8-flash`) via `@google/genai`, com respostas estruturadas por `responseSchema` |
| Frontend | HTML + JavaScript Vanilla (ES6) + Tailwind CSS via CDN, sem build step |
| Persistência | Postgres no Supabase (opcional, ambiente de teste) via `pg`, com LocalStorage como cópia e reserva |

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

### Banco de dados (opcional)

Sem banco, o histórico fica só no navegador. Para salvar na nuvem (Supabase, plano gratuito):

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No projeto, clique em **Connect → Direct** e copie a URI (a conexão direta ou o *Session pooler*). Coloque no `.env` como `DATABASE_URL=...`, trocando `[YOUR-PASSWORD]` pela senha do banco (sem os colchetes).
3. Em **Database → Settings → SSL Configuration**, baixe o certificado e salve como `certs/supabase-ca.crt`. A conexão usa TLS com verificação de certificado.
4. Crie a tabela:
   ```bash
   npm run db:setup
   ```

### Login (Supabase Auth)

O histórico na nuvem só é usado por quem entra com a conta. Para ativar:

1. No Supabase, abra **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** adicione `http://localhost:3000/**`
2. Em **Authentication → Sign In / Providers**, deixe o provedor **Email** ativado.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable** para o `.env`:
   ```
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_ANON_KEY=sua_chave_publica
   ```
4. Rode `npm run db:setup` de novo (adiciona a coluna `usuario_id`).

> O e-mail padrão do Supabase tem um limite baixo de envios por hora e serve só para testes. Para uso real, configure um SMTP próprio em **Authentication → Emails**.

> ⚠️ **Ambiente de teste:** os despejos são apagados depois de 30 dias. Não use textos reais ou sensíveis.

### Testes

```bash
npm test
```

Os testes usam o `node:test` (nativo do Node, sem dependências) e substituem o Gemini, o banco e o login por versões falsas, então **não gastam cota da API nem precisam de banco**.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `GEMINI_API_KEY` | Sim | Chave da API do Gemini. Fica só no servidor e nunca é enviada ao navegador. |
| `GEMINI_MODELO` | Não | Modelo principal (padrão: `gemini-3.8-flash`). |
| `GEMINI_MODELO_RESERVA` | Não | Modelo usado quando o principal está sem cota, sobrecarregado ou lento (padrão: `gemini-3.5-flash-lite`). Deixe vazio para desligar. |
| `DATABASE_URL` | Não | String de conexão do Postgres. Sem ela, o histórico fica só no navegador. |
| `DATABASE_CA_PATH` | Não | Caminho do certificado raiz do banco (padrão: `certs/supabase-ca.crt`). |
| `SUPABASE_URL` | Não | URL do projeto Supabase, para o login. Sem ela (ou sem a chave abaixo), o histórico fica só no navegador. |
| `SUPABASE_ANON_KEY` | Não | Chave anon/publishable do Supabase. É pública por natureza: o navegador a usa para fazer login. |
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
  "desabafos": ["Você está se sentindo cansado hoje, e isso é válido."],
  "sugerir_apoio": false
}
```

Com banco e login configurados e o cabeçalho `Authorization: Bearer <token>` da sessão, o despejo é salvo na conta e a resposta inclui `"despejo": { "id": "...", "data": "..." }`. Se o token tiver expirado, o resultado vem normalmente, sem salvar, com `"sessao_expirada": true`.

`sugerir_apoio` fica `true` quando há sinais de sofrimento intenso. Isso acontece de duas formas: a IA marca o campo, ou o servidor encontra no texto uma expressão explícita de risco, uma rede de segurança que funciona mesmo que a IA deixe passar.

### `POST /api/micro-passos`

Divide uma tarefa em 3 a 5 passos pequenos. Requisição `{ "tarefa": "Declarar o imposto de renda" }` (até 300 caracteres) e resposta `{ "passos": ["Abrir o site da Receita", "..."] }`. Usa o mesmo limite de requisições da organização.

### Histórico na nuvem

Exceto `/api/status`, todas exigem login (`Authorization: Bearer <token>`), e cada conta só acessa os próprios despejos. O servidor confirma o token com o próprio Supabase (`/auth/v1/user`).

| Rota | Descrição |
| --- | --- |
| `GET /api/status` | `{ "nuvem": true, "dias_retencao": 30, "auth": { "url": "...", "chave_publica": "..." } }`: informa se o histórico na nuvem e o login estão ativos |
| `POST /api/despejos/importar` | Leva para a conta até 10 despejos do navegador (`{ "despejos": [...] }`) e os que o navegador (`X-Dispositivo-Id`) salvou antes do login. Responde `{ "importados", "vinculados", "ignorados" }` |
| `GET /api/despejos?limite=5` | Lista os despejos mais recentes (`{ "despejos": [...] }`) |
| `PATCH /api/despejos/:id` | Salva o progresso: `{ "progresso": { "concluidas": [0, 2], "micro_passos": { "0": ["..."] } } }` |
| `DELETE /api/despejos/:id` | Apaga um despejo (204, ou 404 se não existir) |
| `DELETE /api/despejos` | Apaga todo o histórico da conta (204) |

**Erros:** sempre no formato `{ "erro": "mensagem amigável" }`.

| Status | Quando |
| --- | --- |
| 400 | Texto vazio ou JSON inválido |
| 401 | Rota de histórico sem login ou com a sessão expirada |
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
- **Sem banco**, o histórico fica só no LocalStorage do navegador e o servidor não armazena o texto.
- **Sem login**, nada é salvo no servidor: o histórico fica só no navegador.
- **Com login**, a conexão com o banco usa TLS com verificação de certificado, todas as consultas são parametrizadas, cada conta só lê, altera e apaga os próprios despejos, e eles são apagados automaticamente depois de 30 dias. O RLS do Supabase fica ligado para bloquear a API pública.
- O token de login é verificado no servidor a cada pedido (com cache de 60 s guardando só o hash do token). Ao sair da conta, a cópia do histórico guardada no navegador é apagada.

## 📁 Estrutura

```
brain-dump-ai/
├── server.js           # Ponto de entrada: configuração e inicialização
├── lib/
│   ├── app.js          # App Express: rotas e tratamento de erros
│   ├── db.js           # Acesso ao banco (Postgres): salvar, listar, apagar, importar, limpeza
│   ├── auth.js         # Verificação do login (token do Supabase Auth)
│   ├── apoio.js        # Rede de segurança do cartão de apoio (CVV)
│   ├── ia.js           # Integração com o Gemini (prompts, schemas, modelo reserva)
│   ├── limitador.js    # Limite de requisições por IP (em memória)
│   └── sanitizar.js    # Limpeza e validação da resposta da IA
├── public/
│   ├── index.html      # Interface
│   ├── style.css       # Estilos complementares ao Tailwind
│   └── app.js          # Lógica do frontend (voz, envio, histórico, login)
├── db/schema.sql       # Tabela despejos (aplicada com npm run db:setup)
├── scripts/            # Script de configuração do banco
├── certs/              # Certificado raiz do Supabase (público)
├── test/               # Testes automatizados (node:test)
├── .env.example        # Modelo das variáveis de ambiente
└── package.json
```

## ⚠️ Limitações conhecidas

- No **plano gratuito** do Gemini, a cota diária é pequena. Quando ela acaba, o app avisa e é preciso esperar a renovação ou ativar o faturamento no Google AI Studio.
- O **ditado por voz** depende do navegador: funciona no Chrome e no Edge, mas não no Firefox, no Opera e no Brave.
- O **e-mail do link mágico** usa o servidor padrão do Supabase, com poucos envios por hora. Para muitos usuários, é preciso um SMTP próprio.
- O limitador de requisições vive na memória do processo: zera ao reiniciar o servidor e não é compartilhado entre várias instâncias.

## 👤 Autor
