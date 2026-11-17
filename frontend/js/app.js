/* =====================================================================
   Crust & Crumb — shared client core (Supabase client, API, UI helpers)
   Exposes a single global: CC
   ===================================================================== */
const CC = (() => {
  const state = { sb: null, config: null, profile: null };

  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>" +
        "<rect width='100%' height='100%' fill='#f2e6d0'/>" +
        "<circle cx='400' cy='300' r='90' fill='#d9a85c' opacity='.55'/>" +
        "<text x='400' y='450' font-family='Georgia' font-size='34' fill='#8b5a2b' text-anchor='middle'>Crust &amp; Crumb</text></svg>"
    );

  const STATUS_LABEL = {
    received: "Order received",
    baking: "Baking",
    ready_for_pickup: "Ready for pickup",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  // ---- tiny helpers --------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) =>
    "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString("en-CA");
  const shortId = (id) => String(id || "").slice(0, 8).toUpperCase();
  const fmtDate = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }) : "";
  const fmtTime = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    const hr = Number(h);
    return `${((hr + 11) % 12) + 1}:${m} ${hr >= 12 ? "PM" : "AM"}`;
  };
  const fmtDateTime = (iso) =>
    new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // ---- toasts ----------------------------------------------------------
  function toast(message, type = "info", ms = 4200) {
    let box = $("#toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts";
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---- cart (localStorage) -------------------------------------------
  const CART_KEY = "cc_cart_v1";
  function getCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* storage unavailable */
    }
    updateCartBadge();
    document.dispatchEvent(new CustomEvent("cart:changed"));
  }
  function updateCartBadge() {
    const n = getCart().reduce((sum, l) => sum + l.quantity, 0);
    $$("#cart-count").forEach((el) => (el.textContent = n));
  }

  // ---- modal ---------------------------------------------------------
  function openModal(html, { wide = false } = {}) {
    const modal = $("#modal");
    if (!modal) return;
    $("#modal-body").innerHTML = html;
    $(".modal-card", modal).classList.toggle("wide", wide);
    modal.classList.add("open");
  }
  function closeModal() {
    const modal = $("#modal");
    if (modal) modal.classList.remove("open");
  }

  // ---- API (Flask backend, authenticated with the Supabase JWT) -------
  async function api(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const { data } = await state.sb.auth.getSession();
    if (data.session) headers.Authorization = "Bearer " + data.session.access_token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const err = new Error((json && json.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // ---- session & role ------------------------------------------------
  const homeFor = (profile) => (profile && ["admin", "staff"].includes(profile.role) ? "admin.html" : "dashboard.html");

  async function getSession() {
    const { data } = await state.sb.auth.getSession();
    return data.session;
  }

  async function logout() {
    await state.sb.auth.signOut();
    state.profile = null;
    window.location.href = "index.html";
  }

  function renderNav() {
    const box = $("#nav-auth");
    if (!box) return;
    const p = state.profile;
    if (p) {
      const name = esc((p.full_name || p.email || "Account").split(" ")[0]);
      const isStaff = ["admin", "staff"].includes(p.role);
      box.innerHTML =
        `<a class="btn btn-ghost btn-small" href="${homeFor(p)}">${isStaff ? "Baker dashboard" : "Hi, " + name}</a>` +
        `<button class="btn btn-small btn-primary" id="logout-btn" type="button">Log out</button>`;
      $("#logout-btn").addEventListener("click", logout);
    } else {
      box.innerHTML =
        `<a class="btn btn-ghost btn-small" href="login.html">Log in</a>` +
        `<a class="btn btn-small btn-primary" href="register.html">Sign up</a>`;
    }
  }

  function bindChrome() {
    const header = $("#site-header");
    const onScroll = () => header && header.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const toggle = $("#nav-toggle");
    const nav = $("#main-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", () => nav.classList.toggle("open"));
      nav.addEventListener("click", (e) => {
        if (e.target.closest("a")) nav.classList.remove("open");
      });
    }

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]") || e.target.id === "modal") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // graceful fallback for any image that fails to load
    document.addEventListener(
      "error",
      (e) => {
        const t = e.target;
        if (t && t.tagName === "IMG" && !t.dataset.fallback) {
          t.dataset.fallback = "1";
          t.src = FALLBACK_IMG;
        }
      },
      true
    );
  }

  // ---- tabs ----------------------------------------------------------
  function initTabs(onChange) {
    const buttons = $$(".tab-btn");
    const show = (name) => {
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
      $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
      if (onChange) onChange(name);
    };
    buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
    return show;
  }

  // ---- init ----------------------------------------------------------
  async function init() {
    bindChrome();
    updateCartBadge();
    try {
      const res = await fetch("/api/config");
      state.config = await res.json();
      if (!res.ok) throw new Error(state.config.error || "Could not load configuration.");
      state.sb = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (err) {
      toast(err.message, "error", 8000);
      renderNav();
      throw err;
    }

    const session = await getSession();
    if (session) {
      try {
        state.profile = (await api("/api/auth/me")).profile;
      } catch (err) {
        if (err.status === 401) await state.sb.auth.signOut();
      }
    }
    renderNav();
    return state;
  }

  return {
    state,
    $, $$, esc, money, today, shortId, fmtDate, fmtTime, fmtDateTime,
    STATUS_LABEL, FALLBACK_IMG,
    toast, getCart, saveCart, updateCartBadge,
    openModal, closeModal, api, homeFor, getSession, logout,
    renderNav, initTabs, init,
    get sb() { return state.sb; },
    get profile() { return state.profile; },
    get config() { return state.config; },
  };
})();
