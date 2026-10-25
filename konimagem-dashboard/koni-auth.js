/* ============================================================================
   KONI AUTH  -  Login real via Supabase Auth
   ----------------------------------------------------------------------------
   Substitui o login "de navegação" (objeto ROLES com senhas no código) por
   autenticação de verdade no Supabase. O papel (admin/gerencia/comercial) vem
   da tabela public.profiles, não de uma escolha na tela.

   Mantém TODA a lógica de perfil que já existe no dashboard: canEdit(),
   allowedPages(), aplicarSessao() seguem funcionando, só que agora SESSION.role
   é definido a partir do banco. A segurança real dos DADOS é o RLS no Supabase;
   esta tela controla a navegação (quais abas cada perfil vê).

   Roda DEPOIS do script principal (está injetado antes de </body>), então as
   funções e variáveis do app (SESSION, ROLES, aplicarSessao...) já existem.
   ========================================================================== */
(function () {
  "use strict";

  // true  = pede e-mail e senha toda vez que o site/app é aberto (a sessão só vale
  //         enquanto a aba/app continuar aberto; recarregar a página mantém).
  // false = comportamento anterior: lembra o login neste aparelho.
  var EXIGIR_LOGIN_A_CADA_ABERTURA = true;
  function marcarAberto(on) {
    try { if (on) sessionStorage.setItem("koni_mob_ok", "1"); else sessionStorage.removeItem("koni_mob_ok"); } catch (e) {}
  }
  function jaAbertoNestaAba() {
    try { return sessionStorage.getItem("koni_mob_ok") === "1"; } catch (e) { return false; }
  }

  var sb = window.__sb || null;

  // Sem Supabase configurado: não mexe em nada. O login original (offline)
  // continua valendo, útil para testar o frontend sem backend.
  if (!sb) {
    console.warn("[KONI] Auth Supabase inativo — usando login local do arquivo.");
    return;
  }

  function el(id) { return document.getElementById(id); }
  function setMsg(t, erro) {
    var m = el("loginMsg");
    if (m) { m.textContent = t || ""; m.style.color = erro ? "var(--neg)" : "var(--ink3)"; }
  }

  // Papel válido conforme o objeto ROLES do app (fallback seguro = comercial,
  // o perfil de menor acesso).
  function papelValido(role) {
    try { return (window.ROLES && window.ROLES[role]) ? role : (ROLES[role] ? role : "comercial"); }
    catch (e) { return (typeof ROLES !== "undefined" && ROLES[role]) ? role : "comercial"; }
  }

  async function carregarPapel(user) {
    // lê o papel do próprio usuário (RLS permite ler o próprio profile)
    try {
      var r = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (!r.error && r.data && r.data.role) return r.data.role;
    } catch (e) {}
    return "comercial";
  }

  async function aplicarSessaoSupabase(user) {
    var role = papelValido(await carregarPapel(user));
    // SESSION é o 'let' global do app; a atribuição abaixo alcança esse binding.
    SESSION = { role: role, email: user.email || "", ts: new Date().toISOString() };
    try { aplicarSessao(); } catch (e) { console.error("[KONI] aplicarSessao:", e); }
    injetarBotaoSenha();
  }

  // --------- override do login ---------------------------------------------
  window.doLogin = async function () {
    var email = ((el("loginUser") && el("loginUser").value) || "").trim();
    var pass = (el("loginPass") && el("loginPass").value) || "";
    if (!email || !pass) { setMsg("Informe e-mail e senha.", true); return; }
    setMsg("Entrando...", false);
    try {
      var res = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (res.error) {
        setMsg("E-mail ou senha inválidos.", true);
        if (el("loginPass")) el("loginPass").value = "";
        return;
      }
      setMsg("", false);
      marcarAberto(true);
      await aplicarSessaoSupabase(res.data.user);
    } catch (e) {
      console.error("[KONI] login:", e);
      setMsg("Falha ao conectar. Tente de novo.", true);
    }
  };

  // --------- override do logout --------------------------------------------
  window.doLogout = async function () {
    if (!confirm("Sair do dashboard?")) return;
    try { await sb.auth.signOut(); } catch (e) {}
    marcarAberto(false);
    SESSION = null;
    if (el("loginGate")) el("loginGate").classList.add("show");
    if (el("loginUser")) el("loginUser").value = "";
    if (el("loginPass")) el("loginPass").value = "";
    setMsg("", false);
  };

  // --------- troca de senha pelo próprio usuário ---------------------------
  window.koniTrocarSenha = async function () {
    var nova = prompt("Nova senha (mínimo 6 caracteres):");
    if (nova == null) return;
    nova = String(nova);
    if (nova.length < 6) { alert("A senha precisa ter pelo menos 6 caracteres."); return; }
    try {
      var r = await sb.auth.updateUser({ password: nova });
      if (r.error) { alert("Não consegui trocar a senha: " + r.error.message); return; }
      alert("Senha alterada com sucesso.");
    } catch (e) { alert("Falha ao trocar a senha."); }
  };

  // injeta um botão discreto "Trocar senha" ao lado da sessão (uma única vez)
  function injetarBotaoSenha() {
    try {
      if (el("koniBtnSenha")) return;
      var ref = el("sessaoInfo");
      if (!ref || !ref.parentNode) return;
      var b = document.createElement("button");
      b.id = "koniBtnSenha";
      b.textContent = "Trocar senha";
      b.className = "btn-icon labeled";
      b.title = "Alterar a sua própria senha de acesso";
      b.style.cssText = "margin-left:8px;font-size:11px;cursor:pointer";
      b.onclick = window.koniTrocarSenha;
      ref.parentNode.insertBefore(b, ref.nextSibling);
    } catch (e) {}
  }

  // --------- restauração de sessão ao abrir a página -----------------------
  // Se já existe sessão Supabase válida, entra direto (em qualquer dispositivo).
  (async function bootAuth() {
    try {
      var r = await sb.auth.getSession();
      var session = r && r.data ? r.data.session : null;
      if (session && session.user && (!EXIGIR_LOGIN_A_CADA_ABERTURA || jaAbertoNestaAba())) {
        await aplicarSessaoSupabase(session.user);
      } else {
        // Supabase é a única fonte de verdade: ignora qualquer sessão que o
        // loadSession() antigo possa ter restaurado de localStorage forjado.
        SESSION = null;
        if (el("loginGate")) el("loginGate").classList.add("show");
      }
    } catch (e) {
      SESSION = null;
      if (el("loginGate")) el("loginGate").classList.add("show");
    }
  })();
})();
