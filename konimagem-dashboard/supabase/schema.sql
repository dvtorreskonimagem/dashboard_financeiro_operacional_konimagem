-- ============================================================================
-- KONIMAGEM Dashboard — Esquema do banco (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- Rode este arquivo UMA VEZ no painel do Supabase:
--   Supabase > SQL Editor > New query > cole tudo > Run.
--
-- O que ele cria:
--   * profiles : papel (admin / gerencia / comercial) de cada usuário
--   * kv       : documentos de estado sincronizados (state/core, state/agfa,
--                state/equinix) — um por linha, no formato jsonb
--   * RLS      : todo usuário logado LÊ; só admin GRAVA
--   * trigger  : cria um profile automaticamente quando um usuário é criado
--   * realtime : publica a tabela kv para sincronização em tempo real
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) PERFIS DE USUÁRIO
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  role       text not null default 'comercial'
             check (role in ('admin','gerencia','comercial')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- cada usuário lê o próprio perfil (necessário para o app descobrir o papel)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- função auxiliar: o usuário logado é admin?
-- security definer + search_path fixo para rodar sem recursão de RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) DOCUMENTOS DE ESTADO (key-value jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.kv (
  path       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.kv enable row level security;

-- qualquer usuário autenticado LÊ todos os documentos
drop policy if exists "kv_select_auth" on public.kv;
create policy "kv_select_auth"
  on public.kv for select
  to authenticated
  using (true);

-- só admin INSERE
drop policy if exists "kv_insert_admin" on public.kv;
create policy "kv_insert_admin"
  on public.kv for insert
  to authenticated
  with check (public.is_admin());

-- só admin ATUALIZA
drop policy if exists "kv_update_admin" on public.kv;
create policy "kv_update_admin"
  on public.kv for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- (sem policy de DELETE: ninguém apaga documentos pela API)

-- ---------------------------------------------------------------------------
-- 3) CRIAÇÃO AUTOMÁTICA DE PERFIL
-- ---------------------------------------------------------------------------
-- Quando um usuário é criado (Authentication > Users > Add user), cria o
-- profile correspondente já com papel 'comercial' (o de menor acesso).
-- Depois você promove quem precisar para 'gerencia' ou 'admin' (passo 4).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'comercial')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4) REALTIME
-- ---------------------------------------------------------------------------
-- Publica a tabela kv para que mudanças cheguem em tempo real aos navegadores.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kv'
  ) then
    alter publication supabase_realtime add table public.kv;
  end if;
end $$;

-- ============================================================================
-- FIM. Próximos passos (ver README):
--   - criar os usuários em Authentication > Users
--   - promover o administrador:
--       update public.profiles set role = 'admin'    where email = 'ADMIN@EXEMPLO.COM';
--       update public.profiles set role = 'gerencia' where email = 'GERENTE@EXEMPLO.COM';
--     (quem não for promovido fica como 'comercial')
-- ============================================================================
