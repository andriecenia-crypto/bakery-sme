/* =====================================================================
   Crust & Crumb — baker / admin dashboard
   ===================================================================== */
(async function () {
  const { $, $$, esc, money } = CC;

  try {
    await CC.init();
  } catch {
    return;
  }

  // ---- guard: staff & admins only ----------------------------------------
  if (!CC.profile) {
    window.location.replace("login.html");
    return;
  }
  if (!["admin", "staff"].includes(CC.profile.role)) {
    window.location.replace("dashboard.html");
    return;
  }
  const isAdmin = CC.profile.role === "admin";
  $("#staff-name").textContent = (CC.profile.full_name || CC.profile.email).split(" ")[0];
  $("#role-label").textContent = isAdmin ? "Admin" : "Baker";
  if (!isAdmin) $$("[data-admin-only]").forEach((el) => el.remove());

  const S = { products: [], categories: [] };

  const fail = (err) => CC.toast(err.message || "Something went wrong.", "error");
  const options = (list, selected) =>
    list.map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${esc(l)}</option>`).join("");

  const ORDER_STATUS_OPTS = Object.entries(CC.STATUS_LABEL);
  const BATCH_STATUS_OPTS = [
    ["scheduled", "Scheduled"],
    ["baking", "Baking"],
    ["completed", "Completed"],
  ];

  // =====================================================================
  // OVERVIEW
  // =====================================================================
  async function loadOverview() {
    try {
      const s = await CC.api("/api/admin/stats");
      $("#stat-grid").innerHTML = `
        <div class="stat"><span>Pickups today</span><strong>${s.orders_today}</strong></div>
        <div class="stat"><span>Open orders</span><strong>${s.open_orders}</strong></div>
        <div class="stat"><span>Ready for pickup</span><strong>${s.ready_for_pickup}</strong></div>
        <div class="stat"><span>Paid today</span><strong>${money(s.revenue_today)}</strong></div>
        <div class="stat"><span>Unpaid today</span><strong>${money(s.unpaid_today)}</strong></div>
        <div class="stat"><span>Batches today</span><strong>${s.batches_today}</strong></div>
        <div class="stat"><span>Products</span><strong>${s.products}</strong></div>`;
      const { orders } = await CC.api("/api/admin/orders?status=open");
      $("#overview-orders").innerHTML = ordersTable(orders.slice(0, 8));
      bindOrderEvents($("#overview-orders"));
    } catch (err) {
      fail(err);
    }
  }

  // =====================================================================
  // ORDERS
  // =====================================================================
  function ordersTable(orders) {
    if (!orders.length) return `<p class="empty">No orders to show.</p>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
      <tbody>${orders
        .map(
          (o) => `<tr>
        <td><strong>#${CC.shortId(o.id)}</strong></td>
        <td>${esc((o.users && o.users.full_name) || "—")}<br/><small class="muted">${esc(
            (o.users && (o.users.phone || o.users.email)) || ""
          )}</small></td>
        <td>${CC.fmtDate(o.pickup_date)}<br/><small class="muted">${CC.fmtTime(o.pickup_time)}</small></td>
        <td>${(o.order_items || [])
          .map(
            (it) =>
              `${it.quantity} × ${esc(it.products ? it.products.name : "Item")}${
                it.customization_notes ? `<div class="note">“${esc(it.customization_notes)}”</div>` : ""
              }`
          )
          .join("<br/>")}</td>
        <td>${money(o.total_amount)}</td>
        <td><select data-order="${o.id}" data-field="payment_status">${options(
          [
            ["unpaid", "Unpaid"],
            ["paid", "Paid"],
          ],
          o.payment_status
        )}</select></td>
        <td><select data-order="${o.id}" data-field="fulfillment_status">${options(
          ORDER_STATUS_OPTS,
          o.fulfillment_status
        )}</select></td>
      </tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function bindOrderEvents(root) {
    $$("select[data-order]", root).forEach((sel) =>
      sel.addEventListener("change", async () => {
        try {
          await CC.api(`/api/admin/orders/${sel.dataset.order}`, {
            method: "PATCH",
            body: { [sel.dataset.field]: sel.value },
          });
          CC.toast("Order updated — customer notified.", "success", 2200);
          if (sel.dataset.field === "fulfillment_status") {
            loadOverview();
            loadOrders();
          }
        } catch (err) {
          fail(err);
          loadOrders();
        }
      })
    );
  }

  async function loadOrders() {
    const status = $("#order-status-filter").value;
    const date = $("#order-date-filter").value;
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (date) qs.set("date", date);
    try {
      const { orders } = await CC.api("/api/admin/orders?" + qs);
      const box = $("#orders-table");
      box.innerHTML = ordersTable(orders);
      bindOrderEvents(box);
    } catch (err) {
      fail(err);
    }
  }

  // =====================================================================
  // PRODUCTS
  // =====================================================================
  async function loadProducts() {
    try {
      const [prods, cats] = await Promise.all([CC.api("/api/products"), CC.api("/api/products/categories")]);
      S.products = prods.products;
      S.categories = cats.categories;
    } catch (err) {
      return fail(err);
    }
    const box = $("#products-table");
    if (!S.products.length) {
      box.innerHTML = `<p class="empty">No products yet. Add your first bake!</p>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Prep</th><th>Featured</th><th></th></tr></thead>
      <tbody>${S.products
        .map(
          (p) => `<tr>
        <td><img class="thumb" src="${esc(p.image_url || CC.FALLBACK_IMG)}" alt="" /></td>
        <td><strong>${esc(p.name)}</strong><br/><small class="muted">${esc((p.description || "").slice(0, 70))}</small></td>
        <td>${esc((p.categories && p.categories.name) || "—")}</td>
        <td>${money(p.price)}</td>
        <td>${p.prep_time_hours ? p.prep_time_hours + "h" : "Same day"}</td>
        <td>${p.is_featured ? "★" : ""}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-small" data-edit-product="${p.id}">Edit</button>
          <button class="btn btn-danger btn-small" data-del-product="${p.id}">Delete</button>
        </td></tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function productForm(p) {
    const cats = [["", "— No category —"], ...S.categories.map((c) => [c.id, c.name])];
    CC.openModal(
      `
      <h2>${p ? "Edit product" : "Add product"}</h2>
      <div id="pf-error" class="form-error hidden"></div>
      <form id="product-form">
        <div class="field"><label for="pf-name">Name</label><input id="pf-name" required maxlength="120" value="${esc(p?.name)}" /></div>
        <div class="field"><label for="pf-desc">Description</label><textarea id="pf-desc" maxlength="600">${esc(p?.description)}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="pf-price">Price (₱)</label><input id="pf-price" type="number" step="0.01" min="0" required value="${p ? p.price : ""}" /></div>
          <div class="field"><label for="pf-prep">Prep time (hours)</label><input id="pf-prep" type="number" min="0" max="720" value="${p ? p.prep_time_hours : 0}" /></div>
        </div>
        <div class="field"><label for="pf-cat">Category</label><select id="pf-cat">${options(cats, p?.category_id || "")}</select></div>
        <div class="field"><label for="pf-img">Image URL</label><input id="pf-img" type="url" placeholder="https://images.unsplash.com/…" value="${esc(p?.image_url)}" /></div>
        <div class="field checkbox"><input id="pf-feat" type="checkbox" ${p?.is_featured ? "checked" : ""} /><label for="pf-feat" style="margin:0">Feature on the home page</label></div>
        <button class="btn btn-primary btn-block" type="submit">${p ? "Save changes" : "Create product"}</button>
      </form>`
    );
    $("#product-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        name: $("#pf-name").value,
        description: $("#pf-desc").value,
        price: $("#pf-price").value,
        prep_time_hours: $("#pf-prep").value,
        category_id: $("#pf-cat").value || null,
        image_url: $("#pf-img").value,
        is_featured: $("#pf-feat").checked,
      };
      try {
        await CC.api(p ? `/api/products/${p.id}` : "/api/products", { method: p ? "PUT" : "POST", body });
        CC.closeModal();
        CC.toast(p ? "Product updated." : "Product created.", "success");
        loadProducts();
      } catch (err) {
        const box = $("#pf-error");
        box.textContent = err.message;
        box.classList.remove("hidden");
      }
    });
  }

  // =====================================================================
  // BAKING SCHEDULE
  // =====================================================================
  async function loadBatches() {
    const day = $("#batch-date").value;
    try {
      const { batches } = await CC.api("/api/admin/batches?date=" + day);
      const box = $("#batches-table");
      if (!batches.length) {
        box.innerHTML = `<p class="empty">No batches scheduled for this day.</p>`;
        return;
      }
      box.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Target</th><th>Actual baked</th><th>Status</th><th></th></tr></thead>
        <tbody>${batches
          .map(
            (b) => `<tr>
          <td><strong>${esc(b.products ? b.products.name : "—")}</strong></td>
          <td><input type="number" min="1" data-batch="${b.id}" data-field="target_quantity" value="${b.target_quantity}" /></td>
          <td><input type="number" min="0" data-batch="${b.id}" data-field="actual_baked" value="${b.actual_baked}" /></td>
          <td><select data-batch="${b.id}" data-field="status">${options(BATCH_STATUS_OPTS, b.status)}</select></td>
          <td><button class="btn btn-danger btn-small" data-del-batch="${b.id}">Delete</button></td>
        </tr>`
          )
          .join("")}</tbody></table></div>`;
      $$("[data-batch]", box).forEach((el) =>
        el.addEventListener("change", async () => {
          try {
            await CC.api(`/api/admin/batches/${el.dataset.batch}`, {
              method: "PUT",
              body: { [el.dataset.field]: el.value },
            });
            CC.toast("Batch updated.", "success", 1800);
          } catch (err) {
            fail(err);
            loadBatches();
          }
        })
      );
    } catch (err) {
      fail(err);
    }
  }

  function batchForm() {
    CC.openModal(`
      <h2>Schedule a batch</h2>
      <div id="bf-error" class="form-error hidden"></div>
      <form id="batch-form">
        <div class="field"><label for="bf-product">Product</label>
          <select id="bf-product" required>${options(S.products.map((p) => [p.id, p.name]), "")}</select></div>
        <div class="field-row">
          <div class="field"><label for="bf-date">Batch date</label><input id="bf-date" type="date" required value="${$("#batch-date").value}" /></div>
          <div class="field"><label for="bf-qty">Target quantity</label><input id="bf-qty" type="number" min="1" required value="12" /></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Add batch</button>
      </form>`);
    $("#batch-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await CC.api("/api/admin/batches", {
          method: "POST",
          body: {
            product_id: $("#bf-product").value,
            batch_date: $("#bf-date").value,
            target_quantity: $("#bf-qty").value,
          },
        });
        CC.closeModal();
        $("#batch-date").value = $("#bf-date").value;
        CC.toast("Batch scheduled.", "success");
        loadBatches();
      } catch (err) {
        const box = $("#bf-error");
        box.textContent = err.message;
        box.classList.remove("hidden");
      }
    });
  }

  // =====================================================================
  // FORECAST
  // =====================================================================
  async function loadForecast() {
    const day = $("#forecast-date").value;
    try {
      const f = await CC.api("/api/admin/forecast?date=" + day);
      $("#forecast-hint").textContent =
        `Suggested = the higher of confirmed pre-orders or the ${f.lookback_days}-day average demand + ${Math.round(
          (f.buffer - 1) * 100
        )}% buffer. Made-to-order items follow pre-orders only.`;
      $("#forecast-table").innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Pre-ordered</th><th>Avg / day</th><th>Scheduled</th><th>Suggested bake</th><th>Gap</th></tr></thead>
        <tbody>${f.forecast
          .map((r) => {
            const gapCls = r.gap > 0 ? "gap-pos" : r.gap < 0 ? "gap-neg" : "";
            const gapTxt = r.gap > 0 ? `+${r.gap} short` : r.gap < 0 ? `${-r.gap} spare` : "on target";
            return `<tr>
              <td><strong>${esc(r.name)}</strong><br/><small class="muted">${esc(r.category || "")}${
                r.made_to_order ? " · made to order" : ""
              }</small></td>
              <td>${r.ordered}</td><td>${r.avg_daily}</td><td>${r.scheduled}</td>
              <td><strong>${r.suggested}</strong></td><td class="${gapCls}">${gapTxt}</td></tr>`;
          })
          .join("")}</tbody></table></div>`;
    } catch (err) {
      fail(err);
    }
  }

  async function generateBatches() {
    const day = $("#forecast-date").value;
    try {
      const r = await CC.api("/api/admin/batches/generate", { method: "POST", body: { date: day } });
      CC.toast(r.created ? `${r.created} batch(es) created for ${day}.` : "Nothing to generate — all set!", "success");
      loadForecast();
    } catch (err) {
      fail(err);
    }
  }

  // =====================================================================
  // TEAM (admin only)
  // =====================================================================
  async function loadTeam() {
    if (!isAdmin) return;
    try {
      const { users } = await CC.api("/api/admin/users");
      $("#team-table").innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Role</th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
          <td>${esc(u.full_name || "—")}</td><td>${esc(u.email)}</td><td>${esc(u.phone || "—")}</td>
          <td>${CC.fmtDateTime(u.created_at)}</td>
          <td><select data-user="${u.id}">${options(
              [
                ["customer", "Customer"],
                ["staff", "Staff (baker)"],
                ["admin", "Admin"],
              ],
              u.role
            )}</select></td></tr>`
          )
          .join("")}</tbody></table></div>`;
      $$("select[data-user]").forEach((sel) =>
        sel.addEventListener("change", async () => {
          try {
            await CC.api(`/api/admin/users/${sel.dataset.user}/role`, { method: "PATCH", body: { role: sel.value } });
            CC.toast("Role updated.", "success", 2000);
          } catch (err) {
            fail(err);
            loadTeam();
          }
        })
      );
    } catch (err) {
      fail(err);
    }
  }

  // =====================================================================
  // EVENTS & TABS
  // =====================================================================
  document.addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit-product]");
    if (edit) return productForm(S.products.find((p) => p.id === edit.dataset.editProduct));
    const delP = e.target.closest("[data-del-product]");
    if (delP) {
      const p = S.products.find((x) => x.id === delP.dataset.delProduct);
      if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
      try {
        await CC.api(`/api/products/${p.id}`, { method: "DELETE" });
        CC.toast("Product deleted.", "success");
        loadProducts();
      } catch (err) {
        fail(err);
      }
      return;
    }
    const delB = e.target.closest("[data-del-batch]");
    if (delB) {
      if (!confirm("Delete this batch?")) return;
      try {
        await CC.api(`/api/admin/batches/${delB.dataset.delBatch}`, { method: "DELETE" });
        loadBatches();
      } catch (err) {
        fail(err);
      }
    }
  });

  $("#add-product-btn").addEventListener("click", async () => {
    if (!S.categories.length) await loadProducts();
    productForm(null);
  });
  $("#add-batch-btn").addEventListener("click", async () => {
    if (!S.products.length) await loadProducts();
    batchForm();
  });
  $("#generate-btn").addEventListener("click", generateBatches);
  $("#order-status-filter").addEventListener("change", loadOrders);
  $("#order-date-filter").addEventListener("change", loadOrders);
  $("#batch-date").addEventListener("change", loadBatches);
  $("#forecast-date").addEventListener("change", loadForecast);

  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA");
  $("#batch-date").value = CC.today();
  $("#forecast-date").value = tomorrow;

  const loaders = {
    overview: loadOverview,
    orders: loadOrders,
    products: loadProducts,
    schedule: async () => {
      if (!S.products.length) await loadProducts();
      loadBatches();
    },
    forecast: loadForecast,
    team: loadTeam,
  };
  CC.initTabs((name) => loaders[name] && loaders[name]());

  // live refresh when new orders arrive
  CC.sb
    .channel("staff-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
      const active = $(".tab-btn.active");
      if (active && ["overview", "orders"].includes(active.dataset.tab)) loaders[active.dataset.tab]();
    })
    .subscribe();

  await loadProducts();
  loadOverview();
})();
