/* ============================================================================
   KONI BACKEND  -  Adapter Supabase + shim window.claude
   ----------------------------------------------------------------------------
   O dashboard foi escrito para sincronizar via capability "db" do Claude.ai
   (window.claude.use('db')), com uma interface estilo Firestore:
       DB.doc(path).set(obj)
       DB.doc(path).onSnapshot(cb)   ->   cb(snap);  snap.exists; snap.data()

   Fora do Claude.ai (ex: publicado na Vercel) essa capability não existe, e o
   app cairia em "somente localStorage". Este arquivo recria EXATAMENTE a mesma
   interface sobre o Supabase (Postgres + Realtime + Auth/RLS), sem precisar
   mexer na lógica de sincronização que já existe no index.html.

   Modelo de dados: uma tabela única "kv" (path PK, data jsonb). Cada documento
   sincronizado (state/core, state/agfa, state/equinix) vira uma linha.
   Permissão de escrita é decidida pelo RLS no banco (só admin grava); quando o
   banco recusa a escrita de um perfil leitor, devolvemos o mesmo código de erro
   ('invalid_argument') que o app já trata como "somente leitura".

   IMPORTANTE: este script roda ANTES do script principal do dashboard, para que
   window.claude.use('db') já exista quando o app chamar initSharedDb().
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.__KONI_CONFIG || {};
  var URL = cfg.SUPABASE_URL || "";
  var KEY = cfg.SUPABASE_ANON_KEY || "";
  var configured =
    URL && KEY &&
    URL.indexOf("SUA_URL") === -1 &&
    KEY.indexOf("SUA_CHAVE") === -1;

  // Se não estiver configurado, não define window.claude: o app segue em
  // localStorage-only, exatamente como antes (comportamento de fallback dele).
  if (!configured) {
    console.warn("[KONI] Supabase não configurado em config.js — rodando só local (sem sincronização).");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("[KONI] Biblioteca supabase-js não carregou (vendor/supabase.js). Rodando só local.");
    return;
  }

  // Cliente Supabase único da página. Sessão persiste no localStorage (gerida
  // pela própria supabase-js) — por isso o usuário continua logado ao voltar.
  var sb = window.supabase.createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.__sb = sb;

  // ---- Registro de documentos observados (path -> {cb, channel}) -----------
  var watchers = {};     // path -> { cb, channel }
  var hasSession = false;

  function isPermError(err) {
    if (!err) return false;
    var code = String(err.code || "");
    var msg = String(err.message || "").toLowerCase();
    return (
      code === "42501" ||                 // insufficient_privilege (RLS)
      code === "PGRST301" ||              // JWT / não autorizado
      msg.indexOf("row-level security") !== -1 ||
      msg.indexOf("row level security") !== -1 ||
      msg.indexOf("permission denied") !== -1 ||
      msg.indexOf("violates row-level") !== -1
    );
  }

  function snapOf(rowData, exists) {
    return {
      exists: !!exists,
      metadata: { fromCache: false },
      data: function () { return exists ? (rowData || {}) : undefined; }
    };
  }

  // Leitura inicial + assinatura em tempo real de um documento.
  async function connectPath(path) {
    var w = watchers[path];
    if (!w || !hasSession) return;

    // 1) leitura inicial
    try {
      var res = await sb.from("kv").select("data").eq("path", path).maybeSingle();
      if (res.error) {
        console.warn("[KONI] leitura inicial falhou (" + path + "):", res.error.message);
      } else {
        var row = res.data;
        w.cb(snapOf(row ? row.data : undefined, !!row));
      }
    } catch (e) {
      console.warn("[KONI] erro na leitura inicial (" + path + "):", e);
    }

    // 2) realtime — remove canal antigo antes de recriar (evita duplicar)
    try {
      if (w.channel) { sb.removeChannel(w.channel); w.channel = null; }
      w.channel = sb
        .channel("kv:" + path)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "kv", filter: "path=eq." + path },
          function (payload) {
            var nw = payload.new;
            if (nw) w.cb(snapOf(nw.data, true));
          }
        )
        .subscribe();
    } catch (e) {
      console.warn("[KONI] erro ao assinar realtime (" + path + "):", e);
    }
  }

  function connectAll() {
    Object.keys(watchers).forEach(function (p) { connectPath(p); });
  }
  function disconnectAll() {
    Object.keys(watchers).forEach(function (p) {
      var w = watchers[p];
      if (w && w.channel) { try { sb.removeChannel(w.channel); } catch (e) {} w.channel = null; }
    });
  }

  // Reage a login/logout: só começa a ler/sincronizar quando há sessão.
  sb.auth.onAuthStateChange(function (event, session) {
    var now = !!session;
    if (now && !hasSession) { hasSession = true; connectAll(); }
    else if (!now && hasSession) { hasSession = false; disconnectAll(); }
    else if (now) { hasSession = true; } // refresh de token
  });
  // Estado inicial (caso já exista sessão persistida ao abrir a página).
  sb.auth.getSession().then(function (r) {
    if (r && r.data && r.data.session) { hasSession = true; connectAll(); }
  }).catch(function () { /* sem rede / sem sessão: segue mostrando o login */ });

  // ---- Adapter estilo Firestore -------------------------------------------
  var DB = {
    doc: function (path) {
      return {
        // grava o documento inteiro (upsert por path). Só admin passa no RLS.
        set: async function (obj) {
          var uid = null;
          try {
            var s = await sb.auth.getSession();
            uid = s && s.data && s.data.session ? s.data.session.user.id : null;
          } catch (e) {}
          var payload = { path: path, data: obj, updated_at: new Date().toISOString() };
          if (uid) payload.updated_by = uid;
          var res = await sb.from("kv").upsert(payload, { onConflict: "path" });
          if (res.error) {
            if (isPermError(res.error)) {
              // perfil leitor: o app marca "somente leitura" e para de tentar.
              var e = new Error("sem permissão de escrita");
              e.code = "invalid_argument";
              throw e;
            }
            throw res.error; // erro transitório: o app mostra "erro" e tenta depois
          }
          return true;
        },
        // observa o documento: entrega snapshot inicial + mudanças em tempo real.
        onSnapshot: function (cb) {
          watchers[path] = { cb: cb, channel: null };
          if (hasSession) connectPath(path);
          return function unsubscribe() {
            var w = watchers[path];
            if (w && w.channel) { try { sb.removeChannel(w.channel); } catch (e) {} }
            delete watchers[path];
          };
        }
      };
    }
  };

  // ---- Shim window.claude: só define se não houver um runtime real ---------
  // (na Vercel não há; dentro do claude.ai o runtime real é mantido).
  if (!window.claude) {
    window.claude = {
      use: async function (cap) {
        if (cap === "db") return DB;
        // 'downloads' e outras capabilities: devolve null -> o app usa o
        // método clássico de download (funciona num site normal).
        return null;
      }
    };
  }

  // Exposto para o koni-auth.js (login/logout).
  window.__KONI_BACKEND = { sb: sb, ready: true };
})();
