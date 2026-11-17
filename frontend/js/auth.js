/* =====================================================================
   Crust & Crumb — login & registration (Supabase Auth)
   ===================================================================== */
(async function () {
  const { $ } = CC;

  try {
    await CC.init();
  } catch {
    return;
  }

  // Only allow redirects to local pages (prevents open-redirect abuse).
  function safeNext(profile) {
    const next = new URLSearchParams(window.location.search).get("next") || "";
    if (/^(dashboard)\.html(#[a-z]+)?$/.test(next) && !["admin", "staff"].includes(profile.role)) return next;
    return CC.homeFor(profile);
  }

  function showMessage(id, text, ok = false) {
    const box = $("#" + id);
    if (!box) return;
    box.textContent = text;
    box.className = ok ? "form-ok" : "form-error";
    box.classList.toggle("hidden", !text);
  }

  // Already signed in → send to the right place.
  if (CC.profile) {
    window.location.replace(safeNext(CC.profile));
    return;
  }

  // ---------------- LOGIN ----------------
  const loginForm = $("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", loginForm);
      showMessage("form-message", "");
      btn.disabled = true;
      btn.textContent = "Signing in…";
      const { error } = await CC.sb.auth.signInWithPassword({
        email: $("#email").value.trim(),
        password: $("#password").value,
      });
      if (error) {
        showMessage("form-message", error.message);
        btn.disabled = false;
        btn.textContent = "Log in";
        return;
      }
      try {
        const profile = (await CC.api("/api/auth/me")).profile;
        window.location.href = safeNext(profile);
      } catch (err) {
        showMessage("form-message", err.message);
        btn.disabled = false;
        btn.textContent = "Log in";
      }
    });
  }

  // ---------------- REGISTER ----------------
  const registerForm = $("#register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", registerForm);
      showMessage("form-message", "");

      const password = $("#password").value;
      if (password.length < 8) {
        showMessage("form-message", "Password must be at least 8 characters.");
        return;
      }
      if (password !== $("#confirm").value) {
        showMessage("form-message", "Passwords do not match.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Creating account…";
      const { data, error } = await CC.sb.auth.signUp({
        email: $("#email").value.trim(),
        password,
        options: {
          data: { full_name: $("#full_name").value.trim(), phone: $("#phone").value.trim() },
          emailRedirectTo: window.location.origin + "/login.html",
        },
      });

      if (error) {
        showMessage("form-message", error.message);
        btn.disabled = false;
        btn.textContent = "Create account";
        return;
      }

      if (data.session) {
        // Email confirmation disabled → signed in immediately.
        window.location.href = "dashboard.html";
      } else {
        registerForm.reset();
        showMessage(
          "form-message",
          "Almost there! Check your email to confirm your account, then log in.",
          true
        );
        btn.disabled = false;
        btn.textContent = "Create account";
      }
    });
  }
})();
