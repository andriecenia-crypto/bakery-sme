/* =====================================================================
   Crust & Crumb — catalog, basket, checkout, order tracking
   Used by index.html (data-page="home") and dashboard.html (data-page="dashboard")
   ===================================================================== */
(async function () {
  const { $, $$, esc, money } = CC;
  const page = document.body.dataset.page;

  try {
    await CC.init();
  } catch {
    return;
  }

  const S = { products: [], categories: [], avail: {}, filter: "all", orders: [] };

  // ---- dashboard guard: customers only ----------------------------------
  if (page === "dashboard") {
    if (!CC.profile) {
      window.location.replace("login.html?next=dashboard.html");
      return;
    }
    if (["admin", "staff"].includes(CC.profile.role)) {
      window.location.replace("admin.html");
      return;
    }
    const name = $("#welcome-name");
    if (name) name.textContent = (CC.profile.full_name || "friend").split(" ")[0];
  }

  // =====================================================================
  // CATALOG
  // =====================================================================
  async function loadCatalog() {
    const grid = $("#product-grid");
    if (grid) grid.innerHTML = `<p class="empty">Warming up the ovens…</p>`;
    try {
      const [cats, prods, avail] = await Promise.all([
        CC.sb.from("categories").select("*").order("name"),
        CC.sb.from("products").select("*").order("name"),
        fetch("/api/products/availability?date=" + CC.today()).then((r) => r.json()),
      ]);
      if (cats.error) throw cats.error;
      if (prods.error) throw prods.error;
      S.categories = cats.data || [];
      S.products = prods.data || [];
      S.avail = (avail && avail.availability) || {};
    } catch (err) {
      if (grid) grid.innerHTML = `<p class="empty">We couldn't load the menu right now. Please refresh.</p>`;
      CC.toast(err.message || "Could not load the menu.", "error");
      return;
    }
    renderTabs();
    renderFeatured();
    renderGrid();
  }

  function renderTabs() {
    const box = $("#category-tabs");
    if (!box) return;
    box.innerHTML =
      `<button class="tab-chip ${S.filter === "all" ? "active" : ""}" data-cat="all">All treats</button>` +
      S.categories
        .map(
          (c) =>
            `<button class="tab-chip ${S.filter === c.id ? "active" : ""}" data-cat="${c.id}">${esc(c.name)}</button>`
        )
        .join("");
  }

  function availabilityBadge(p) {
    const a = S.avail[p.id];
    if (a) {
      if (a.remaining === 0) return `<span class="badge out">Sold out today</span>`;
      if (a.remaining <= 5) return `<span class="badge low">Only ${a.remaining} left today</span>`;
      return `<span class="badge ok">${a.remaining} fresh today</span>`;
    }
    if (p.prep_time_hours >= 24) {
      const days = Math.round(p.prep_time_hours / 24);
      return `<span class="badge">Made to order · ${days} day${days > 1 ? "s" : ""} notice</span>`;
    }
    if (p.prep_time_hours > 0) return `<span class="badge">Made to order · ${p.prep_time_hours}h notice</span>`;
    return `<span class="badge">Baked fresh daily</span>`;
  }

  function productCard(p) {
    return `
      <article class="card product-card">
        <div class="card-img" data-open="${p.id}">
          <img loading="lazy" src="${esc(p.image_url || CC.FALLBACK_IMG)}" alt="${esc(p.name)}" />
          ${availabilityBadge(p)}
          ${p.is_featured ? `<span class="badge star">★ Favourite</span>` : ""}
        </div>
        <div class="card-body">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description || "")}</p>
          <div class="card-foot">
            <span class="price">${money(p.price)}</span>
            <button class="btn btn-small btn-primary" data-open="${p.id}">Add to basket</button>
          </div>
        </div>
      </article>`;
  }

  function renderFeatured() {
    const box = $("#featured-grid");
    if (!box) return;
    const items = S.products.filter((p) => p.is_featured).slice(0, 4);
    box.innerHTML = items.length ? items.map(productCard).join("") : `<p class="empty">Check back soon.</p>`;
  }

  function renderGrid() {
    const box = $("#product-grid");
    if (!box) return;
    const list = S.filter === "all" ? S.products : S.products.filter((p) => p.category_id === S.filter);
    if (!list.length) {
      box.innerHTML = `<p class="empty">Nothing in this category yet.</p>`;
      return;
    }
    if (S.filter !== "all") {
      box.innerHTML = list.map(productCard).join("");
      return;
    }
    // grouped by category when showing everything
    box.innerHTML = S.categories
      .map((c) => {
        const items = list.filter((p) => p.category_id === c.id);
        if (!items.length) return "";
        return `
          <div style="grid-column:1/-1;margin-top:1rem">
            <h3 style="margin:0">${esc(c.name)}</h3>
            <p class="muted" style="margin:0">${esc(c.description || "")}</p>
          </div>${items.map(productCard).join("")}`;
      })
      .join("");
  }

  // =====================================================================
  // PRODUCT MODAL (customization)
  // =====================================================================
  function openProduct(id) {
    const p = S.products.find((x) => x.id === id);
    if (!p) return;
    const isCake = p.prep_time_hours >= 24;
    CC.openModal(`
      <img class="modal-img" src="${esc(p.image_url || CC.FALLBACK_IMG)}" alt="${esc(p.name)}" />
      <h2>${esc(p.name)}</h2>
      <p class="muted">${esc(p.description || "")}</p>
      <p><span class="price">${money(p.price)}</span>
        ${p.prep_time_hours ? `<span class="muted"> · needs ${p.prep_time_hours}h notice</span>` : ""}</p>
      <form id="add-form">
        <div class="field">
          <label for="add-qty">Quantity</label>
          <input id="add-qty" type="number" min="1" max="50" value="1" required />
        </div>
        <div class="field">
          <label for="add-notes">${isCake ? "Cake message & customization" : "Special requests (optional)"}</label>
          <textarea id="add-notes" maxlength="300" placeholder="${
            isCake ? "e.g. “Happy Birthday Maria!” in gold, no nuts" : "e.g. sliced, extra crusty"
          }"></textarea>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Add to basket</button>
      </form>`);
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const qty = Math.max(1, Math.min(50, parseInt($("#add-qty").value, 10) || 1));
      const notes = $("#add-notes").value.trim();
      const cart = CC.getCart();
      const existing = cart.find((l) => l.product_id === p.id && (l.notes || "") === notes);
      if (existing) existing.quantity = Math.min(50, existing.quantity + qty);
      else
        cart.push({
          product_id: p.id,
          name: p.name,
          price: Number(p.price),
          image_url: p.image_url,
          prep: p.prep_time_hours,
          quantity: qty,
          notes,
        });
      CC.saveCart(cart);
      CC.closeModal();
      CC.toast(`${p.name} added to your basket`, "success", 2200);
    });
  }

  // =====================================================================
  // BASKET DRAWER
  // =====================================================================
  function toggleDrawer(open) {
    $("#cart-drawer").classList.toggle("open", open);
    $("#drawer-backdrop").classList.toggle("open", open);
  }

  function renderCart() {
    const box = $("#cart-items");
    if (!box) return;
    const cart = CC.getCart();
    if (!cart.length) {
      box.innerHTML = `<p class="empty">Your basket is empty.<br/>Add something delicious!</p>`;
    } else {
      box.innerHTML = cart
        .map(
          (l, i) => `
        <div class="cart-line">
          <img src="${esc(l.image_url || CC.FALLBACK_IMG)}" alt="" />
          <div>
            <h4>${esc(l.name)}</h4>
            ${l.notes ? `<small>“${esc(l.notes)}”</small>` : ""}
            <div class="qty">
              <button data-dec="${i}" aria-label="Decrease">−</button>
              <span>${l.quantity}</span>
              <button data-inc="${i}" aria-label="Increase">+</button>
              <button data-rm="${i}" class="btn-small" style="width:auto;border-radius:8px;padding:0 .5rem;font-size:.75rem">Remove</button>
            </div>
          </div>
          <strong>${money(l.price * l.quantity)}</strong>
        </div>`
        )
        .join("");
    }
    $("#cart-total").textContent = money(cart.reduce((s, l) => s + l.price * l.quantity, 0));
    $("#checkout-btn").disabled = !cart.length;
  }

  function handleCartClick(e) {
    const t = e.target.closest("[data-inc],[data-dec],[data-rm]");
    if (!t) return;
    const cart = CC.getCart();
    const idx = Number(t.dataset.inc ?? t.dataset.dec ?? t.dataset.rm);
    if (!cart[idx]) return;
    if (t.dataset.inc !== undefined) cart[idx].quantity = Math.min(50, cart[idx].quantity + 1);
    else if (t.dataset.dec !== undefined) cart[idx].quantity -= 1;
    else cart[idx].quantity = 0;
    CC.saveCart(cart.filter((l) => l.quantity > 0));
  }

  // =====================================================================
  // CHECKOUT
  // =====================================================================
  function startCheckout() {
    const cart = CC.getCart();
    if (!cart.length) return;
    if (!CC.profile) {
      window.location.href = "login.html?next=dashboard.html";
      return;
    }
    if (page !== "dashboard") {
      window.location.href = "dashboard.html#checkout";
      return;
    }
    openCheckout();
  }

  function openCheckout() {
    const cart = CC.getCart();
    if (!cart.length) {
      CC.toast("Your basket is empty.", "error");
      return;
    }
    const maxPrep = Math.max(...cart.map((l) => l.prep || 0));
    const earliest = new Date(Date.now() + maxPrep * 3600 * 1000);
    const minDate = earliest.toLocaleDateString("en-CA");
    const open = CC.config.openHour;
    const close = CC.config.closeHour;
    const slots = [];
    for (let h = open; h < close; h++) {
      for (const m of ["00", "30"]) {
        const v = `${String(h).padStart(2, "0")}:${m}`;
        slots.push(`<option value="${v}" ${v === "09:00" ? "selected" : ""}>${CC.fmtTime(v)}</option>`);
      }
    }
    const total = cart.reduce((s, l) => s + l.price * l.quantity, 0);

    CC.openModal(`
      <h2>Checkout</h2>
      <ul class="order-lines">
        ${cart
          .map(
            (l) => `<li><span>${l.quantity} × ${esc(l.name)}${
              l.notes ? `<div class="note">“${esc(l.notes)}”</div>` : ""
            }</span><strong>${money(l.price * l.quantity)}</strong></li>`
          )
          .join("")}
      </ul>
      <div class="row" style="margin-bottom:1rem"><span>Total (pay at pickup)</span><strong class="price">${money(total)}</strong></div>
      <div id="checkout-error" class="form-error hidden"></div>
      <form id="checkout-form">
        <div class="field-row">
          <div class="field">
            <label for="pickup-date">Pickup date</label>
            <input id="pickup-date" type="date" min="${minDate}" value="${minDate}" required />
          </div>
          <div class="field">
            <label for="pickup-time">Pickup time</label>
            <select id="pickup-time">${slots.join("")}</select>
          </div>
        </div>
        ${maxPrep ? `<p class="muted" style="font-size:.85rem">Items in your basket need ${maxPrep}h of preparation.</p>` : ""}
        <div class="field">
          <label for="checkout-phone">Phone (so we can confirm cake details)</label>
          <input id="checkout-phone" type="tel" value="${esc(CC.profile.phone || "")}" maxlength="30" />
        </div>
        <button class="btn btn-primary btn-block" type="submit">Place pre-order</button>
      </form>`);

    $("#checkout-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", e.target);
      const errBox = $("#checkout-error");
      errBox.classList.add("hidden");
      btn.disabled = true;
      btn.textContent = "Placing order…";
      try {
        await CC.api("/api/orders", {
          method: "POST",
          body: {
            pickup_date: $("#pickup-date").value,
            pickup_time: $("#pickup-time").value,
            phone: $("#checkout-phone").value,
            items: CC.getCart().map((l) => ({
              product_id: l.product_id,
              quantity: l.quantity,
              customization_notes: l.notes || "",
            })),
          },
        });
        CC.saveCart([]);
        CC.closeModal();
        toggleDrawer(false);
        CC.toast("Order placed! We'll keep you posted here.", "success");
        showTab("orders");
        await Promise.all([loadOrders(), loadNotifications(), refreshAvailability()]);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Place pre-order";
      }
    });
  }

  async function refreshAvailability() {
    try {
      const r = await fetch("/api/products/availability?date=" + CC.today()).then((x) => x.json());
      S.avail = r.availability || {};
      renderFeatured();
      renderGrid();
    } catch {
      /* non-critical */
    }
  }

  // =====================================================================
  // MY ORDERS (live tracking)
  // =====================================================================
  const STEPS = [
    ["received", "Received"],
    ["baking", "Baking"],
    ["ready_for_pickup", "Ready"],
    ["completed", "Picked up"],
  ];

  function orderCard(o) {
    const idx = STEPS.findIndex(([k]) => k === o.fulfillment_status);
    const tracker =
      o.fulfillment_status === "cancelled"
        ? ""
        : `<div class="tracker">${STEPS.map(
            ([, label], i) => `<div class="step ${i <= idx ? "done" : ""}">${label}</div>`
          ).join("")}</div>`;
    return `
      <article class="order-card">
        <div class="order-head">
          <div>
            <h3>Order #${CC.shortId(o.id)}</h3>
            <span class="muted">Pickup ${CC.fmtDate(o.pickup_date)} · ${CC.fmtTime(o.pickup_time)}</span>
          </div>
          <div>
            <span class="pill ${o.fulfillment_status}">${CC.STATUS_LABEL[o.fulfillment_status]}</span>
            <span class="pill ${o.payment_status}">${o.payment_status === "paid" ? "Paid" : "Pay at pickup"}</span>
          </div>
        </div>
        ${tracker}
        <ul class="order-lines">
          ${(o.order_items || [])
            .map(
              (it) => `<li><span>${it.quantity} × ${esc(it.products ? it.products.name : "Item")}${
                it.customization_notes ? `<div class="note">“${esc(it.customization_notes)}”</div>` : ""
              }</span><span>${money(it.unit_price * it.quantity)}</span></li>`
            )
            .join("")}
        </ul>
        <div class="row">
          <strong>Total ${money(o.total_amount)}</strong>
          ${
            o.fulfillment_status === "received"
              ? `<button class="btn btn-danger btn-small" data-cancel="${o.id}">Cancel order</button>`
              : ""
          }
        </div>
      </article>`;
  }

  async function loadOrders() {
    const box = $("#orders-list");
    if (!box) return;
    try {
      S.orders = (await CC.api("/api/orders/mine")).orders;
    } catch (err) {
      box.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
    box.innerHTML = S.orders.length
      ? S.orders.map(orderCard).join("")
      : `<p class="empty">No orders yet — your first pre-order is waiting in the menu.</p>`;
  }

  async function cancelOrder(id) {
    if (!confirm("Cancel this order?")) return;
    try {
      await CC.api(`/api/orders/${id}/cancel`, { method: "POST" });
      CC.toast("Order cancelled.", "success");
      await Promise.all([loadOrders(), loadNotifications(), refreshAvailability()]);
    } catch (err) {
      CC.toast(err.message, "error");
    }
  }

  // =====================================================================
  // NOTIFICATIONS
  // =====================================================================
  async function loadNotifications() {
    const box = $("#notif-list");
    if (!box) return;
    try {
      const { notifications, unread } = await CC.api("/api/auth/notifications");
      const badge = $("#notif-badge");
      if (badge) {
        badge.textContent = unread;
        badge.classList.toggle("hidden", !unread);
      }
      box.innerHTML = notifications.length
        ? notifications
            .map(
              (n) => `<div class="notif ${n.is_read ? "" : "unread"}"><div>${esc(n.message)}<time>${CC.fmtDateTime(
                n.created_at
              )}</time></div></div>`
            )
            .join("")
        : `<p class="empty">No updates yet.</p>`;
    } catch (err) {
      box.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  // =====================================================================
  // REALTIME (Supabase) + polling fallback
  // =====================================================================
  function subscribeRealtime() {
    const uid = CC.profile.id;
    CC.sb
      .channel("customer-" + uid)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `customer_id=eq.${uid}` },
        () => loadOrders()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bakery_notifications", filter: `user_id=eq.${uid}` },
        (payload) => {
          CC.toast(payload.new.message);
          loadNotifications();
        }
      )
      .subscribe();
    setInterval(() => {
      loadOrders();
      loadNotifications();
    }, 45000);
  }

  // =====================================================================
  // DASHBOARD TABS
  // =====================================================================
  let showTab = () => {};
  if (page === "dashboard") {
    showTab = CC.initTabs((name) => {
      if (name === "notifications") {
        CC.api("/api/auth/notifications/read", { method: "POST" })
          .then(() => {
            const badge = $("#notif-badge");
            if (badge) badge.classList.add("hidden");
            $$(".notif.unread").forEach((el) => el.classList.remove("unread"));
          })
          .catch(() => {});
      }
    });
  }

  // =====================================================================
  // EVENTS
  // =====================================================================
  document.addEventListener("click", (e) => {
    const cat = e.target.closest("[data-cat]");
    if (cat) {
      S.filter = cat.dataset.cat;
      renderTabs();
      renderGrid();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) return openProduct(open.dataset.open);
    const cancel = e.target.closest("[data-cancel]");
    if (cancel) return cancelOrder(cancel.dataset.cancel);
    if (e.target.closest("#cart-btn")) return toggleDrawer(true);
    if (e.target.closest("#cart-close") || e.target.id === "drawer-backdrop") return toggleDrawer(false);
    if (e.target.closest("#checkout-btn")) return startCheckout();
  });
  $("#cart-items")?.addEventListener("click", handleCartClick);
  document.addEventListener("cart:changed", renderCart);

  // =====================================================================
  // BOOT
  // =====================================================================
  renderCart();
  await loadCatalog();

  if (page === "dashboard") {
    await Promise.all([loadOrders(), loadNotifications()]);
    subscribeRealtime();
    if (window.location.hash === "#checkout") {
      history.replaceState(null, "", "dashboard.html");
      if (CC.getCart().length) openCheckout();
    }
  }
})();
