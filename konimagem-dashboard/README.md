# KONIMAGEM — Dashboard Financeiro e Operacional

Dashboard em arquivo único (`index.html`) com backend real em **Supabase** (login + sincronização em tempo real) e publicação na **Vercel**.

O frontend é o mesmo de antes. O que mudou: a sincronização que dependia do Claude.ai agora roda sobre o Supabase, e o login de navegação (senhas no código) virou autenticação de verdade.

---

## Como funciona (resumo técnico)

- A **base** (dados do Excel) continua embutida no `index.html`. Atualizar a base = gerar um arquivo novo e publicar, exatamente como hoje.
- Os **dados mutáveis** (lançamentos, rateios, despesas, AGFA, Equinix) são sincronizados no Supabase, na tabela `kv`, em 3 documentos: `state/core`, `state/agfa`, `state/equinix`.
- **Permissão** é decidida pelo banco (RLS): todo usuário logado **lê**; só o perfil **admin grava**. Gerência e Comercial entram em modo somente leitura automaticamente.
- Os perfis (quais abas cada um vê) seguem no frontend; a proteção dos dados é o RLS.

Arquivos adicionados ao projeto original:

| Arquivo | Para que serve |
|---|---|
| `config.js` | Onde você cola a URL e a chave do Supabase |
| `vendor/supabase.js` | Biblioteca do Supabase (embutida, sem CDN) |
| `koni-backend.js` | Adapter que liga o dashboard ao Supabase |
| `koni-auth.js` | Login real (Supabase Auth) e troca de senha |
| `supabase/schema.sql` | Script que cria as tabelas, RLS e realtime |
| `manifest.webmanifest`, `icon-*.png` | PWA (instalar na tela inicial) |
| `vercel.json` | Configuração da publicação |

> Se o `config.js` estiver com os valores de exemplo, o dashboard funciona só no navegador local (sem sincronizar). Útil para testar antes de ligar o backend.

---

## Passo a passo do deploy

### 1. Supabase (banco + login)

1. Crie a conta em supabase.com e um **novo projeto**.
   - Região: **South America (São Paulo)** (mais perto, mais rápido).
   - Guarde a senha do banco num lugar seguro.
2. Menu **SQL Editor** > **New query** > cole todo o conteúdo de `supabase/schema.sql` > **Run**.
   - Isso cria as tabelas `profiles` e `kv`, as regras de permissão (RLS), o gatilho de criação de perfil e liga o realtime.
3. Menu **Authentication** > **Users** > **Add user** para cada pessoa:
   - informe e-mail e senha;
   - marque **Auto Confirm User** (senão a pessoa não consegue entrar sem confirmar e-mail).
4. Defina quem é **admin** (quem pode editar). No **SQL Editor**, rode (trocando os e-mails):
   ```sql
   update public.profiles set role = 'admin'    where email = 'admin@konimagem.com';
   update public.profiles set role = 'gerencia' where email = 'gerente@konimagem.com';
   -- quem não for promovido fica como 'comercial' (somente leitura, menu reduzido)
   ```
5. Menu **Project Settings** > **API**. Copie:
   - **Project URL**
   - a chave **anon public** (NÃO a `service_role`)

### 2. config.js (ligar o frontend ao banco)

Abra `config.js` e substitua os dois valores pelos que você copiou:

```js
window.__KONI_CONFIG = {
  SUPABASE_URL:      "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci...sua-chave-anon..."
};
```

A chave `anon` pode ficar no código sem risco: ela é pública por design e quem protege os dados é o RLS. **Nunca** coloque a `service_role` aqui.

### 3. GitHub (guardar o código)

1. Crie um repositório novo (sugestão de nome: `konimagem-dashboard`). Pode ser **privado**.
2. Suba os arquivos. O jeito mais simples sem instalar nada: no repositório, **Add file** > **Upload files**, arraste **todos** os arquivos e pastas deste projeto (incluindo a pasta `vendor/`) e confirme (**Commit changes**).

### 4. Vercel (publicar)

1. Crie a conta em vercel.com e conecte sua conta do GitHub.
2. **Add New** > **Project** > importe o repositório `konimagem-dashboard`.
3. Em **Framework Preset** escolha **Other** (é um site estático, sem build).
   - Build Command: vazio. Output Directory: vazio (raiz).
4. **Deploy**. A Vercel gera um endereço `https://konimagem-dashboard-xxxx.vercel.app`.
5. (Opcional) **Settings** > **Domains** para usar um domínio próprio.

### 5. Primeira carga dos dados (migração)

Os lançamentos atuais estão no navegador de quem usa hoje. Para levá-los ao banco:

1. Na versão atual (a que está em uso hoje), aba **Dados** > **Backup (JSON)**. Guarde esse arquivo.
2. Abra o site novo da Vercel e **entre como admin**.
3. Clique em **Atualizar Dashboard** e selecione o backup JSON.
4. Como você é admin, o sistema envia tudo para o banco automaticamente. A partir daí, todos que entrarem veem os mesmos dados, em tempo real.

> Faça isso **uma vez**, com o backup mais recente. Depois, cada lançamento feito por um admin aparece para os outros sozinho.

---

## Testes rápidos depois de publicar

- Entrar como **admin**: deve conseguir lançar e editar; o selo de sincronização fica verde ("Conectado").
- Entrar como **gerência/comercial**: vê os dados, mas edições ficam bloqueadas (modo somente leitura).
- Abrir o site em **dois navegadores** (um admin, um leitor): um lançamento do admin aparece no outro em segundos.
- **Trocar senha**: botão "Trocar senha" ao lado do nome da sessão.

---

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Selo "Somente local" | `config.js` ainda com valores de exemplo | Preencher URL e chave anon |
| Login diz "inválido" para usuário certo | usuário não confirmado | Authentication > Users > marcar Auto Confirm |
| Admin não consegue gravar (vira só leitura) | perfil não está como `admin` | rodar o `update ... set role='admin'` |
| Lançamento não aparece no outro navegador | realtime não publicado | reexecutar o bloco 4 do `schema.sql` |
| Dados não carregam | chave anon errada ou projeto pausado | conferir em Project Settings > API |

---

## Segurança

- A proteção real dos dados é o **RLS** do Supabase. A tela de login controla a navegação; o banco controla quem lê e quem grava.
- A chave `anon` é pública e pode ser commitada. A `service_role` **nunca** vai para o frontend nem para o GitHub.
- As senhas antigas que ainda aparecem no objeto `ROLES` dentro do `index.html` (ex: `koni2026admin`) **não valem mais** para entrar: o login agora é 100% Supabase. Elas ficam apenas como rótulo de configuração de menu e podem ser ignoradas.
- Recomendado rodar o scan do Aikido no repositório, como nos outros projetos.
