-- Schema do Brain Dump AI (Postgres / Supabase).
-- Aplicar com: npm run db:setup  (pode rodar mais de uma vez sem problema)

-- Despejos salvos (ambiente de teste)
create table if not exists public.despejos (
  id             uuid primary key default gen_random_uuid(),
  -- Identificador anônimo do navegador (gerado no frontend, sem login)
  dispositivo_id uuid not null,
  criado_em      timestamptz not null default now(),
  texto          text not null check (char_length(texto) between 1 and 10000),
  resultado      jsonb not null
);

-- Progresso do checklist: { "concluidas": [índices], "micro_passos": { "<índice>": [passos] } }
-- (adicionada depois da criação da tabela; "if not exists" mantém o script seguro para rodar de novo)
alter table public.despejos
  add column if not exists progresso jsonb not null default '{}'::jsonb;

-- Dono do despejo (login com Supabase Auth). Despejos sem dono são do período sem login e só
-- podem ser vinculados a uma conta pelo navegador que os criou. Ao apagar a conta, os despejos vão junto.
alter table public.despejos
  add column if not exists usuario_id uuid references auth.users (id) on delete cascade;

-- Acelera a listagem "despejos da minha conta, mais recentes primeiro"
create index if not exists despejos_usuario_criado_idx
  on public.despejos (usuario_id, criado_em desc);

-- Acelera a listagem "despejos deste navegador, mais recentes primeiro"
create index if not exists despejos_dispositivo_criado_idx
  on public.despejos (dispositivo_id, criado_em desc);

-- Acelera a limpeza dos despejos antigos
create index if not exists despejos_criado_idx
  on public.despejos (criado_em);

-- Segurança: o Supabase expõe as tabelas do schema "public" numa API pública (com a chave anon).
-- Ligar o RLS sem criar nenhuma política bloqueia todo acesso por essa API.
-- O servidor do app conecta com o usuário dono do banco, que não é afetado pelo RLS.
alter table public.despejos enable row level security;
