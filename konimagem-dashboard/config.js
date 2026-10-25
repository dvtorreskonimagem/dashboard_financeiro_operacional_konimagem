/* ============================================================================
   CONFIGURAÇÃO DO BACKEND (Supabase)
   ----------------------------------------------------------------------------
   Preencha os dois valores abaixo com os dados do SEU projeto Supabase.
   Onde encontrar: painel do Supabase > Project Settings > Data API (ou API).
     - Project URL     ->  SUPABASE_URL
     - anon / public   ->  SUPABASE_ANON_KEY   (a chave "anon public", NÃO a service_role)

   A chave "anon" pode ficar exposta no navegador sem problema: quem protege os
   dados é o RLS (Row Level Security) configurado no banco, não o segredo da chave.
   NUNCA coloque aqui a chave "service_role".

   Enquanto estiver com os valores de exemplo (SUA_URL...), o dashboard funciona
   normalmente só no navegador local (localStorage), sem sincronizar.
   ========================================================================== */
window.__KONI_CONFIG = {
  SUPABASE_URL:https://whmoyxwlipqnyvutwpne.supabase.co,
  SUPABASE_ANON_KEY:sb_publishable_BHzj5zG9mDa8R1Mp3DxYpg_wRwDo1bL
};
