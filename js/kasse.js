/* ==========================================================================
   Kasse: Produktauswahl, Warenkorb, Parken, Zahlung, Bon
   ========================================================================== */
"use strict";

const ALL_CATEGORIES = "__all";
const DEFAULT_VAT = 0.19;

/**
 * Enthaltene MwSt. je Steuersatz.
 * Ein Rabatt wird anteilig auf alle Positionen verteilt.
 * Positionen ohne eigenen Satz (ältere Bons) rechnen mit dem Standardsatz.
 */
function vatBreakdown(items, subtotal, total, fallbackRate = DEFAULT_VAT) {
  const factor = Number(subtotal) > 0 ? Number(total) / Number(subtotal) : 1;
  const groups = new Map();

  (items || []).forEach((item) => {
    const rate =
      item.vat_rate !== undefined && item.vat_rate !== null
        ? Number(item.vat_rate)
        : fallbackRate;
    const gross =
      Number(item.line_total ?? Number(item.unit_price) * Number(item.qty)) *
      factor;
    groups.set(rate, (groups.get(rate) || 0) + gross);
  });

  return [...groups.entries()]
    .map(([rate, gross]) => ({
      rate,
      gross: num(gross),
      vat: num(gross - gross / (1 + rate)),
    }))
    .sort((a, b) => b.rate - a.rate);
}

const sameId = (a, b) => String(a) === String(b);

const Kasse = {
  query: "",
  favOnly: false,
  lastAdded: null,
  lastStockSync: 0,
  paying: false,
  removed: null,

  /* ---------- Favoriten & Geparkte Bons (pro Gerät gespeichert) ---------- */

  favs() {
    return new Set((Store.get("favs", []) || []).map(String));
  },

  toggleFav(productId) {
    const favs = this.favs();
    const id = String(productId);
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    Store.set("favs", [...favs]);
    this.renderProducts();
  },

  parked() {
    return Store.get("parked", []) || [];
  },

  saveParked(list) {
    Store.set("parked", list);
    this.paintParked();
  },

  paintParked() {
    const n = this.parked().length;
    const badge = $("#parked-badge");
    badge.textContent = n;
    badge.classList.toggle("hidden", n === 0);
    this.paintParkButton();
  },

  paintParkButton() {
    const btn = $("#park-btn");
    if (!btn) return;
    const n = this.parked().length;
    if (State.cart.length) {
      btn.textContent = "Parken";
      btn.title = "Bon parken (F6)";
    } else {
      btn.textContent = n ? `Geparkt (${n})` : "Parken";
      btn.title = n ? "Geparkte Bons ansehen (F6)" : "Nichts zu parken";
    }
    btn.disabled = !State.cart.length && n === 0;
  },

  /** Aktuellen Bon beiseitelegen. */
  parkCurrent({ silent = false } = {}) {
    if (!State.cart.length) return false;

    const list = this.parked();
    list.push({
      id: Date.now().toString(36),
      at: new Date().toISOString(),
      staff: State.user?.name || "",
      cart: State.cart,
      discountId: State.discountId,
      coop: State.coop
        ? {
            id: State.coop.id,
            name: State.coop.name,
            kind: State.coop.kind,
            value: State.coop.value,
          }
        : null,
      note: State.note,
      orderType: State.orderType,
    });
    this.saveParked(list);

    State.cart = [];
    State.discountId = "";
    State.coop = null;
    State.note = "";
    this.renderCart();

    if (!silent) toast("Bon geparkt", "success");
    return true;
  },

  resumeParked(id) {
    const list = this.parked();
    const entry = list.find((p) => p.id === id);
    if (!entry) return;

    if (State.cart.length) this.parkCurrent({ silent: true });

    this.saveParked(this.parked().filter((p) => p.id !== id));

    // Bestände können sich seit dem Parken geändert haben.
    const dropped = [];
    State.cart = [];
    (entry.cart || []).forEach((line) => {
      const p = State.products.find((x) => sameId(x.id, line.product_id));
      if (!p) {
        dropped.push(line.name);
        return;
      }
      let qty = line.qty;
      if (this.tracksStock(p)) qty = Math.min(qty, Math.max(0, Number(p.stock)));
      if (qty <= 0) {
        dropped.push(line.name);
        return;
      }
      if (qty < line.qty) dropped.push(`${line.name} (nur ${qty})`);
      State.cart.push({ ...line, qty });
    });

    State.discountId = entry.discountId || "";
    State.coop = entry.coop || null;
    State.note = entry.note || "";
    State.orderType = entry.orderType || "Hier essen";

    this.renderAll();
    closeModal();

    if (dropped.length) {
      toast(`Nicht mehr komplett verfügbar: ${dropped.join(", ")}`, "error");
    } else {
      toast("Bon wieder geöffnet");
    }
  },

  showParked() {
    const list = this.parked();

    if (!list.length) {
      toast("Keine geparkten Bons");
      return;
    }

    const rows = list
      .map((p) => {
        const count = p.cart.reduce((s, l) => s + l.qty, 0);
        const sum = p.cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
        const names = p.cart
          .slice(0, 3)
          .map((l) => `${l.qty}× ${l.name}`)
          .join(", ");
        return `
          <div class="parked-item">
            <div class="info">
              <strong>${count} Artikel · ${money(sum)}</strong>
              <span>${fmtTime(p.at)}${p.staff ? " · " + esc(p.staff) : ""} · ${esc(names)}${p.cart.length > 3 ? " …" : ""}</span>
            </div>
            <button class="btn btn-sm btn-primary" data-resume="${esc(p.id)}" type="button">Öffnen</button>
            <button class="icon-btn" data-drop="${esc(p.id)}" type="button" aria-label="Verwerfen">×</button>
          </div>`;
      })
      .join("");

    openModal({
      title: `Geparkte Bons (${list.length})`,
      bodyHTML: rows,
      footHTML: `<button class="btn" data-close type="button">Schließen</button>`,
      onMount: (root) => {
        root.addEventListener("click", async (e) => {
          const resume = e.target.closest("[data-resume]");
          const drop = e.target.closest("[data-drop]");
          if (resume) {
            this.resumeParked(resume.dataset.resume);
          } else if (drop) {
            const ok = await confirmDialog(
              "Geparkten Bon verwerfen?",
              "Der Bon wird endgültig gelöscht.",
              "Verwerfen",
              { danger: true },
            );
            if (!ok) return;
            this.saveParked(
              this.parked().filter((p) => p.id !== drop.dataset.drop),
            );
            if (this.parked().length) this.showParked();
            else closeModal();
          }
        });
      },
    });
  },

  /** Angefangenen Bon nach einem Neuladen der Seite wiederherstellen. */
  restoreForUser() {
    this.paintParked();
    const draft = Store.get("draft", null);
    if (
      draft &&
      State.user &&
      draft.userId === State.user.id &&
      Array.isArray(draft.cart) &&
      draft.cart.length &&
      !State.cart.length
    ) {
      State.cart = draft.cart.filter((l) =>
        State.products.some((p) => sameId(p.id, l.product_id)),
      );
      State.discountId = draft.discountId || "";
      State.note = draft.note || "";
      State.orderType = draft.orderType || "Hier essen";
      if (State.cart.length) toast("Angefangener Bon wiederhergestellt");
    }
  },

  saveDraft() {
    if (!State.user) return;
    if (!State.cart.length) {
      Store.set("draft", null);
      return;
    }
    Store.set("draft", {
      userId: State.user.id,
      cart: State.cart,
      discountId: State.discountId,
      note: State.note,
      orderType: State.orderType,
    });
  },

  /* ---------- Rendern ---------- */

  render() {
    this.renderAll();
  },

  renderAll() {
    this.renderCategories();
    this.renderProducts();
    this.renderCart();
    this.applyPreferences();
  },

  categories() {
    const seen = [];
    State.products.forEach((p) => {
      const c = p.category || "Sonstiges";
      if (!seen.includes(c)) seen.push(c);
    });
    return seen;
  },

  renderCategories() {
    const cats = this.categories();

    if (
      State.category !== ALL_CATEGORIES &&
      (!State.category || !cats.includes(State.category))
    ) {
      State.category = cats[0] || ALL_CATEGORIES;
    }

    const count = (c) =>
      State.products.filter((p) => (p.category || "Sonstiges") === c).length;

    const chip = (value, label, n) =>
      `<button class="chip" role="tab" data-cat="${esc(value)}"
         aria-pressed="${value === State.category && !this.query}">${esc(label)}<span class="count">${n}</span></button>`;

    $("#cat-bar").innerHTML =
      chip(ALL_CATEGORIES, "Alle", State.products.length) +
      cats.map((c) => chip(c, c, count(c))).join("");
  },

  /**
   * Wird das Lager für dieses Produkt geführt?
   * Fehlen die Lagerspalten noch in der Datenbank, läuft die Kasse
   * ohne Lagerverwaltung weiter statt alles als ausverkauft anzuzeigen.
   */
  tracksStock(p) {
    return (
      !!p &&
      p.track_stock !== false &&
      p.stock !== undefined &&
      p.stock !== null
    );
  },

  /** Wie viele Stück lassen sich vom Produkt noch in den Warenkorb legen? */
  stockLeft(p) {
    if (!this.tracksStock(p)) return Infinity;
    const line = State.cart.find((l) => sameId(l.product_id, p.id));
    return Number(p.stock) - (line ? line.qty : 0);
  },

  visibleProducts() {
    const q = this.query.trim().toLowerCase();
    const favs = this.favs();
    let list = State.products;

    if (this.favOnly) list = list.filter((p) => favs.has(String(p.id)));

    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          String(p.category || "").toLowerCase().includes(q),
      );
    } else if (State.category !== ALL_CATEGORIES) {
      list = list.filter(
        (p) => (p.category || "Sonstiges") === State.category,
      );
    }

    return list;
  },

  renderProducts() {
    const grid = $("#product-grid");
    const list = this.visibleProducts();
    const favs = this.favs();

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <p>${
            this.query
              ? `Kein Artikel zu „${esc(this.query)}“ gefunden.`
              : this.favOnly
                ? "Noch keine Favoriten. Tippe auf den Stern an einem Artikel."
                : "Keine Produkte in dieser Kategorie. Lege welche in der Verwaltung an."
          }</p>
        </div>`;
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const tracked = this.tracksStock(p);
        const left = this.stockLeft(p);
        const out = tracked && left <= 0;
        const low = tracked && !out && left <= Number(p.min_stock ?? 0);
        const line = State.cart.find((l) => sameId(l.product_id, p.id));
        const isFav = favs.has(String(p.id));

        let badge = "";
        if (out) badge = `<span class="stock-badge out">Ausverkauft</span>`;
        else if (low) badge = `<span class="stock-badge low">nur noch ${left}</span>`;
        else if (tracked) badge = `<span class="stock-badge">${left} da</span>`;

        const pulse = sameId(this.lastAdded, p.id) ? " pulse" : "";

        return `
          <div class="product${out ? " is-out" : ""}${pulse}" role="button"
               tabindex="${out ? -1 : 0}" data-add="${esc(p.id)}"
               aria-disabled="${out}"
               aria-label="${esc(p.name)}, ${money(p.price)}${out ? ", ausverkauft" : ""}">
            ${line ? `<span class="in-cart">${line.qty}</span>` : ""}
            <button type="button" class="fav${isFav ? " on" : ""}" data-fav="${esc(p.id)}"
                    aria-pressed="${isFav}" aria-label="Favorit: ${esc(p.name)}">${isFav ? "★" : "☆"}</button>
            <span class="product-name">${esc(p.name)}</span>
            <span class="product-meta">
              <span class="product-price">${money(p.price)}</span>
              ${badge}
            </span>
          </div>`;
      })
      .join("");

    this.lastAdded = null;
  },

  /* ---------- Warenkorb ---------- */

  add(productId, qty = 1) {
    const p = State.products.find((x) => sameId(x.id, productId));
    if (!p) return;

    if (this.stockLeft(p) < qty) {
      toast(`${p.name} ist ausverkauft`, "error");
      Sound.beep(220, 120);
      return;
    }

    const line = State.cart.find((l) => sameId(l.product_id, p.id));

    if (line) {
      line.qty += qty;
    } else {
      State.cart.push({
        product_id: p.id,
        name: p.name,
        unit_price: Number(p.price),
        vat_rate:
          p.vat_rate !== undefined && p.vat_rate !== null
            ? Number(p.vat_rate)
            : DEFAULT_VAT,
        qty,
      });
    }

    this.lastAdded = p.id;
    Sound.beep(740, 40);
    this.renderCart();
    this.scrollCartToEnd();
  },

  scrollCartToEnd() {
    const box = $("#cart-items");
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
  },

  changeQty(productId, delta) {
    const line = State.cart.find((l) => sameId(l.product_id, productId));
    if (!line) return;

    if (delta > 0) {
      const p = State.products.find((x) => sameId(x.id, productId));
      if (this.stockLeft(p) <= 0) {
        toast(`Mehr als ${line.qty} × ${line.name} sind nicht auf Lager`, "error");
        return;
      }
    }

    if (line.qty + delta <= 0) {
      this.removeLine(productId);
      return;
    }

    line.qty += delta;
    this.renderCart();
  },

  async editQty(productId) {
    const line = State.cart.find((l) => sameId(l.product_id, productId));
    if (!line) return;

    const input = await promptDialog({
      title: line.name,
      label: "Menge",
      value: String(line.qty),
      type: "number",
    });
    if (input === null) return;

    const qty = Math.floor(Number(input));
    if (!Number.isFinite(qty) || qty < 0 || qty > 999) {
      toast("Bitte eine Menge zwischen 0 und 999 eingeben", "error");
      return;
    }
    if (qty === 0) {
      this.removeLine(productId);
      return;
    }

    const p = State.products.find((x) => sameId(x.id, productId));
    if (this.tracksStock(p) && qty > Number(p.stock)) {
      toast(`Nur ${p.stock} × ${line.name} auf Lager`, "error");
      line.qty = Math.max(1, Number(p.stock));
    } else {
      line.qty = qty;
    }
    this.renderCart();
  },

  removeLine(productId) {
    const index = State.cart.findIndex((l) => sameId(l.product_id, productId));
    if (index < 0) return;

    const [line] = State.cart.splice(index, 1);
    this.renderCart();

    toast(`${line.name} entfernt`, "", {
      action: {
        label: "Rückgängig",
        onClick: () => {
          const p = State.products.find((x) => sameId(x.id, line.product_id));
          if (p && this.stockLeft(p) < line.qty) {
            toast("Nicht mehr genug auf Lager", "error");
            return;
          }
          State.cart.splice(Math.min(index, State.cart.length), 0, line);
          this.renderCart();
        },
      },
    });
  },

  /** Warenkorb komplett zurücksetzen (ohne Rückfrage). */
  clear() {
    State.cart = [];
    State.discountId = "";
    State.coop = null;
    State.note = "";
    this.renderCart();
  },

  async clearWithConfirm() {
    if (!State.cart.length) return;

    if (State.settings?.confirm_cart_clear !== false) {
      const ok = await confirmDialog(
        "Warenkorb leeren?",
        "Alle Positionen werden verworfen.",
        "Leeren",
        { danger: true },
      );
      if (!ok) return;
    }

    const backup = {
      cart: State.cart,
      discountId: State.discountId,
      coop: State.coop,
      note: State.note,
    };
    this.clear();

    toast("Bon geleert", "", {
      action: {
        label: "Rückgängig",
        onClick: () => {
          if (State.cart.length) return;
          State.cart = backup.cart;
          State.discountId = backup.discountId;
          State.coop = backup.coop;
          State.note = backup.note;
          this.renderCart();
        },
      },
    });
  },

  totals() {
    const subtotal = num(
      State.cart.reduce((sum, line) => sum + line.unit_price * line.qty, 0),
    );

    const coop = State.coop;
    const discount = State.discounts.find((x) => sameId(x.id, State.discountId));

    let discountAmount = 0;
    let discountName = null;
    let discountSource = "rabatt";

    // Kooperation hat Vorrang vor einem normalen Rabatt.
    if (coop) {
      discountAmount =
        coop.kind === "percent"
          ? num((subtotal * Number(coop.value)) / 100)
          : num(coop.value);
      discountName = coop.name;
      discountSource = "kooperation";
    } else if (discount) {
      discountAmount =
        discount.kind === "percent"
          ? num((subtotal * Number(discount.value)) / 100)
          : num(discount.value);
      discountName = discount.name;
    }

    discountAmount = Math.min(discountAmount, subtotal);

    const total = num(subtotal - discountAmount);

    const groups = vatBreakdown(
      State.cart.map((l) => ({
        vat_rate: l.vat_rate,
        line_total: l.unit_price * l.qty,
      })),
      subtotal,
      total,
    );
    const vat = num(groups.reduce((s, g) => s + g.vat, 0));

    return {
      subtotal,
      discount: discountAmount,
      total,
      discountName,
      discountSource,
      vat,
      vatGroups: groups,
    };
  },

  /* ---------- Kooperation per Codewort freischalten ---------- */

  renderCoop() {
    const box = $("#coop-box");
    if (!box) return;

    const coop = State.coop;

    if (coop) {
      const value =
        coop.kind === "percent" ? `${Number(coop.value)} %` : money(coop.value);

      box.innerHTML = `
        <div class="coop-active">
          <span class="tag ok">Kooperation</span>
          <span class="coop-name">${esc(coop.name)} · ${value}</span>
          <button class="btn btn-sm btn-ghost" id="coop-clear" type="button">Entfernen</button>
        </div>`;

      $("#coop-clear").addEventListener("click", () => {
        State.coop = null;
        toast("Kooperation entfernt");
        this.renderCart();
      });
      return;
    }

    // Eingabefeld nicht neu aufbauen, solange jemand darin tippt.
    if ($("#coop-code") && document.activeElement === $("#coop-code")) return;

    box.innerHTML = `
      <div class="coop-form">
        <input class="input" id="coop-code" placeholder="Kooperations-Codewort"
               autocomplete="off" aria-label="Codewort für Kooperation">
        <button class="btn btn-sm" id="coop-apply" type="button">Prüfen</button>
      </div>`;

    const input = $("#coop-code");
    const apply = () => this.applyCoop(input.value);

    $("#coop-apply").addEventListener("click", apply);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") apply();
    });
  },

  async applyCoop(code) {
    const clean = String(code || "").trim();

    if (!clean) {
      toast("Bitte ein Codewort eingeben", "error");
      return;
    }

    const btn = $("#coop-apply");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Prüfe …";
    }

    try {
      const coop = await DB.findCoopByCode(clean);

      if (!coop) {
        toast("Codewort nicht erkannt", "error");
        Sound.beep(220, 140);
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Prüfen";
        }
        return;
      }

      State.coop = coop;
      State.discountId = "";

      const value =
        coop.kind === "percent" ? `${Number(coop.value)} %` : money(coop.value);

      toast(`${coop.name} freigeschaltet — ${value}`, "success");
      this.renderCart();
    } catch (err) {
      fail(err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Prüfen";
      }
    }
  },

  renderCart() {
    const items = $("#cart-items");
    const count = State.cart.reduce((sum, line) => sum + line.qty, 0);

    $("#cart-count").textContent = count;

    if (!State.cart.length) {
      items.innerHTML = `
        <div class="empty" style="border:0;min-height:140px;align-content:center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18l-1.6 11.2A2 2 0 0 1 17.4 19H6.6a2 2 0 0 1-2-1.8L3 6z"/>
            <path d="M8 6V4.5A3.5 3.5 0 0 1 15 4.5V6"/>
          </svg>
          <p>Noch nichts gewählt. Tippe links auf einen Artikel.</p>
        </div>`;
    } else {
      items.innerHTML = State.cart
        .map(
          (line) => `
          <div class="cart-row">
            <div>
              <div class="cart-row-name">${esc(line.name)}</div>
              <div class="cart-row-unit">${money(line.unit_price)} / Stück</div>
            </div>
            <div class="cart-row-total">${money(line.unit_price * line.qty)}</div>
            <div class="qty">
              <button data-minus="${esc(line.product_id)}" type="button"
                      aria-label="Weniger ${esc(line.name)}">&minus;</button>
              <button class="qty-value" data-qty="${esc(line.product_id)}" type="button"
                      aria-label="Menge ändern: ${esc(line.name)}">${line.qty}</button>
              <button data-plus="${esc(line.product_id)}" type="button"
                      aria-label="Mehr ${esc(line.name)}">+</button>
              <span class="spacer"></span>
              <button data-remove="${esc(line.product_id)}" type="button"
                      aria-label="${esc(line.name)} entfernen">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
              </button>
            </div>
          </div>`,
        )
        .join("");
    }

    // Rabatt-Auswahl
    const select = $("#discount-select");
    select.innerHTML =
      `<option value="">Kein Rabatt</option>` +
      State.discounts
        .map((d) => {
          const label = d.kind === "percent" ? `${Number(d.value)} %` : money(d.value);
          return `<option value="${esc(d.id)}" ${
            sameId(d.id, State.discountId) ? "selected" : ""
          }>${esc(d.name)} (−${label})</option>`;
        })
        .join("");
    select.disabled = !!State.coop;

    this.renderCoop();
    this.renderProducts();

    // Notiz & Bestellart
    const preview = $("#note-preview");
    preview.textContent = State.note ? `Notiz: ${State.note}` : "";
    preview.classList.toggle("hidden", !State.note);
    $("#note-btn").textContent = State.note ? "Notiz ✎" : "Notiz";

    $$("#order-type button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.type === State.orderType)),
    );

    // Summen
    const t = this.totals();

    $("#sum-subtotal").textContent = money(t.subtotal);
    $("#row-discount").classList.toggle("hidden", t.discount <= 0);
    $("#label-discount").textContent =
      t.discountSource === "kooperation"
        ? `Kooperation (${t.discountName})`
        : `Rabatt${t.discountName ? " (" + t.discountName + ")" : ""}`;
    $("#sum-discount").textContent = "− " + money(t.discount);
    $("#sum-total").textContent = money(t.total);

    const vatText = t.vatGroups.length
      ? t.vatGroups
          .map((g) => `${money(g.vat)} (${Math.round(g.rate * 100)} %)`)
          .join(" · ")
      : money(0);
    $("#sum-vat").textContent = vatText;
    $("#row-vat").classList.toggle("hidden", State.settings?.show_vat === false);

    const empty = State.cart.length === 0;
    $("#pay-cash").disabled = empty;
    $("#pay-card").disabled = empty;
    $("#cart-clear").disabled = empty;
    this.paintParkButton();
    this.saveDraft();

    // Bon-Leiste für schmale Bildschirme
    const fab = $("#cart-fab");
    fab.classList.toggle("hidden", empty || State.view !== "kasse");
    $("#fab-count").textContent = count;
    $("#fab-total").textContent = money(t.total);
  },

  /** Einstellungen, die die Kasse betreffen (z. B. bevorzugte Zahlart). */
  applyPreferences() {
    const pref = State.settings?.default_payment === "card" ? "card" : "cash";
    $("#pay-cash")?.classList.toggle("preferred", pref === "cash");
    $("#pay-card")?.classList.toggle("preferred", pref === "card");
    if ($("#row-vat")) {
      $("#row-vat").classList.toggle("hidden", State.settings?.show_vat === false);
    }
  },

  /* ---------- Zahlung ---------- */

  /** Sinnvolle Schnellwahl-Beträge oberhalb der Summe (Scheingrößen). */
  cashSuggestions(total) {
    const set = new Set();
    [5, 10, 20, 50, 100, 200].forEach((b) => {
      const v = Math.ceil(total / b) * b;
      if (v > total + 0.0001) set.add(v);
    });
    return [...set].sort((a, b) => a - b).slice(0, 4);
  },

  openPayment(method) {
    if (!State.cart.length || this.paying) return;

    if (!navigator.onLine) {
      toast("Keine Internetverbindung — Zahlung nicht möglich", "error");
      return;
    }

    // Ohne Dienst wird nicht kassiert.
    if (!Duty.requireDuty()) return;

    // Bestände vor dem Kassieren noch einmal prüfen.
    const problem = State.cart.find((l) => {
      const p = State.products.find((x) => sameId(x.id, l.product_id));
      return !p || (this.tracksStock(p) && l.qty > Number(p.stock));
    });
    if (problem) {
      toast(`${problem.name}: Menge nicht mehr verfügbar`, "error");
      return;
    }

    const t = this.totals();
    const isCash = method === "bar";

    const cashBody = `
      <div class="cash-display">
        <span>Gegeben</span>
        <strong id="cash-shown">${money(t.total)}</strong>
      </div>

      <div class="quick-cash" id="quick-cash">
        <button class="btn btn-sm" data-cash="exact" type="button">Passend</button>
        ${this.cashSuggestions(t.total)
          .map(
            (v) =>
              `<button class="btn btn-sm" data-cash="${v}" type="button">${v} €</button>`,
          )
          .join("")}
      </div>

      <div class="numpad" id="numpad">
        ${["7", "8", "9", "4", "5", "6", "1", "2", "3", ",", "0", "del"]
          .map(
            (k) =>
              `<button type="button" data-num="${k}" class="${
                k === "," || k === "del" ? "soft" : ""
              }">${k === "del" ? "⌫" : k}</button>`,
          )
          .join("")}
      </div>

      <div class="change-box" id="change-box">
        <span class="change-label">Rückgeld</span>
        <span class="change-value" id="change-value">${money(0)}</span>
      </div>`;

    const cardBody = `
      <p class="muted" style="font-size:var(--text-sm);margin:0">
        Betrag am Kartenterminal eingeben und die Zahlung dort abschließen.
        Erst danach hier auf „Kassieren“ tippen.
      </p>`;

    const overlay = openModal({
      title: isCash ? "Barzahlung" : "Kartenzahlung",
      bodyHTML: `
        <div class="pay-total">
          <div class="pay-total-label">Zu zahlen</div>
          <div class="pay-total-value">${money(t.total)}</div>
        </div>
        ${isCash ? cashBody : cardBody}`,
      footHTML: `
        <button class="btn" data-close type="button">Abbrechen</button>
        <button class="btn btn-primary" id="confirm-pay" type="button">Kassieren</button>`,
      onMount: (root) => {
        const confirmBtn = $("#confirm-pay", root);

        if (!isCash) {
          confirmBtn.addEventListener("click", () =>
            this.finish(method, null, t),
          );
          return;
        }

        let buf = ""; // leer = passend
        let given = t.total;

        const shown = $("#cash-shown", root);
        const box = $("#change-box", root);
        const out = $("#change-value", root);

        const update = () => {
          const change = num(given - t.total);
          const short = !Number.isFinite(given) || change < -0.0001;

          shown.textContent = buf === "" ? money(t.total) : `${buf} €`;
          box.classList.toggle("negative", short);
          $(".change-label", box).textContent = short ? "Es fehlt" : "Rückgeld";
          out.textContent = money(short ? Math.abs(change) : change);
          confirmBtn.disabled = short;
        };

        const press = (key) => {
          if (key === "del") {
            buf = buf.slice(0, -1);
          } else if (key === ",") {
            if (!buf.includes(",")) buf = (buf || "0") + ",";
          } else if (/^[0-9]$/.test(key)) {
            if (buf.includes(",") && buf.split(",")[1].length >= 2) return;
            if (buf.replace(",", "").length >= 7) return;
            buf = (buf === "0" ? "" : buf) + key;
          }
          given = buf === "" ? t.total : parseFloat(buf.replace(",", ".")) || 0;
          update();
        };

        $("#numpad", root).addEventListener("click", (e) => {
          const b = e.target.closest("button[data-num]");
          if (b) press(b.dataset.num);
        });

        $("#quick-cash", root).addEventListener("click", (e) => {
          const b = e.target.closest("button[data-cash]");
          if (!b) return;
          if (b.dataset.cash === "exact") {
            buf = "";
            given = t.total;
          } else {
            given = Number(b.dataset.cash);
            buf = String(given).replace(".", ",");
          }
          update();
        });

        // Auch über die Tastatur bedienbar.
        const onKey = (e) => {
          if (/^[0-9]$/.test(e.key)) press(e.key);
          else if (e.key === "," || e.key === ".") press(",");
          else if (e.key === "Backspace") press("del");
        };
        document.addEventListener("keydown", onKey);
        root.addEventListener("modal-closed", () =>
          document.removeEventListener("keydown", onKey),
        );

        confirmBtn.addEventListener("click", () =>
          this.finish(method, given, t),
        );

        update();
      },
    });

    return overlay;
  },

  /*
    Zahlung abschließen:

    1. Bestellung in der Datenbank speichern (inklusive Lagerabzug).
    2. Kasse zurücksetzen und den Bon anzeigen.
    3. Quittung im Hintergrund an Discord senden. Fällt der Versand aus,
       bleibt die Bestellung trotzdem gespeichert.
  */
  async finish(method, cashGiven, t) {
    if (this.paying) return;
    this.paying = true;

    const btn = $("#confirm-pay");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Speichern …";
    }

    // Die Positionen merken, bevor der Warenkorb geleert wird.
    const cartSnapshot = State.cart.map((line) => ({ ...line }));
    const note =
      [State.orderType, State.note.trim()].filter(Boolean).join(" · ") || null;

    try {
      const order = await DB.placeOrder({
        items: cartSnapshot.map((line) => ({
          product_id: line.product_id,
          name: line.name,
          unit_price: line.unit_price,
          vat_rate: line.vat_rate,
          qty: line.qty,
          line_total: num(line.unit_price * line.qty),
        })),

        subtotal: t.subtotal,
        discount_name: t.discountName,
        discount_amount: t.discount,
        discount_source: t.discountSource,
        total: t.total,

        payment_method: method,
        cash_given: method === "bar" ? num(cashGiven) : null,
        change_due: method === "bar" ? num(cashGiven - t.total) : null,

        staff_id: State.user?.id || null,
        staff_name: State.user?.name || null,
        shift_id: State.shift?.id || null,
        note,
      });

      closeModal();
      this.clear();
      Sound.ok();
      toast(
        `Bestellung #${order.order_no} gespeichert — ${money(order.total)}`,
        "success",
      );

      Receipt.show(order);
      if (State.settings?.auto_print_receipt) {
        setTimeout(() => window.print(), 350);
      }

      this.reloadStock();
      this.sendDiscord(order, cartSnapshot);
    } catch (err) {
      fail(err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Kassieren";
      }
    } finally {
      this.paying = false;
    }
  },

  /** Quittung an Discord – blockiert die Kasse nicht. */
  async sendDiscord(order, cartSnapshot) {
    try {
      await window.sendReceiptToDiscord({
        ...order,
        orderId: order.order_no || order.id || "Unbekannt",
        customerName: "Gast",
        total: order.total,
        currency: "EUR",
        staffName: State.user?.name || order.staff_name || "Unbekannt",
        items: cartSnapshot.map((line) => ({
          name: line.name,
          quantity: line.qty,
          price: line.unit_price,
        })),
      });
    } catch (err) {
      console.error("Discord-Quittung konnte nicht gesendet werden:", err);
      toast(
        "Bestellung gespeichert, aber die Discord-Quittung ging nicht raus.",
        "error",
      );
    }
  },

  /** Lädt Produkte neu, damit die Bestandszahlen aktuell bleiben. */
  async reloadStock() {
    try {
      State.products = await DB.listProducts(true);
      this.lastStockSync = Date.now();
      this.renderCategories();
      this.renderProducts();
    } catch (err) {
      console.error(err);
    }
  },

  /** Höchstens alle 20 Sekunden still nachladen (Bestände anderer Geräte). */
  async refreshStockQuiet() {
    if (!State.user || Date.now() - this.lastStockSync < 20000) return;
    await this.reloadStock();
  },

  /* ---------- Events ---------- */

  bind() {
    const search = $("#product-search");

    $("#cat-bar").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-cat]");
      if (!button) return;

      State.category = button.dataset.cat;
      this.query = "";
      search.value = "";
      this.renderCategories();
      this.renderProducts();
    });

    $("#fav-filter").addEventListener("click", (e) => {
      this.favOnly = !this.favOnly;
      e.currentTarget.setAttribute("aria-pressed", String(this.favOnly));
      this.renderProducts();
    });

    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderCategories();
      this.renderProducts();
    });

    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        this.query = "";
        search.blur();
        this.renderCategories();
        this.renderProducts();
      } else if (e.key === "Enter") {
        // Erstes Suchergebnis direkt in den Bon legen.
        const first = this.visibleProducts().find(
          (p) => this.stockLeft(p) > 0,
        );
        if (first) {
          this.add(first.id);
          search.select();
        }
      }
    });

    const grid = $("#product-grid");

    grid.addEventListener("click", (event) => {
      const fav = event.target.closest("button[data-fav]");
      if (fav) {
        this.toggleFav(fav.dataset.fav);
        return;
      }
      const tile = event.target.closest("[data-add]");
      if (tile) this.add(tile.dataset.add);
    });

    grid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const tile = event.target.closest("[data-add]");
      if (tile && event.target === tile) {
        event.preventDefault();
        this.add(tile.dataset.add);
      }
    });

    $("#cart-items").addEventListener("click", (event) => {
      const plus = event.target.closest("button[data-plus]");
      const minus = event.target.closest("button[data-minus]");
      const remove = event.target.closest("button[data-remove]");
      const qty = event.target.closest("button[data-qty]");

      if (plus) this.changeQty(plus.dataset.plus, 1);
      else if (minus) this.changeQty(minus.dataset.minus, -1);
      else if (remove) this.removeLine(remove.dataset.remove);
      else if (qty) this.editQty(qty.dataset.qty);
    });

    $("#discount-select").addEventListener("change", (event) => {
      State.discountId = event.target.value;
      this.renderCart();
    });

    $("#order-type").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-type]");
      if (!b) return;
      State.orderType = b.dataset.type;
      this.renderCart();
    });

    $("#note-btn").addEventListener("click", async () => {
      const text = await promptDialog({
        title: "Notiz zum Bon",
        label: "Wird auf dem Bon und in der Bestellung gespeichert",
        value: State.note,
        placeholder: "z. B. ohne Zwiebeln, scharf",
        multiline: true,
        confirmLabel: "Speichern",
      });
      if (text === null) return;
      State.note = text.trim().slice(0, 200);
      this.renderCart();
    });

    $("#cart-clear").addEventListener("click", () => this.clearWithConfirm());

    $("#cart-fab").addEventListener("click", () =>
      $(".cart-panel").scrollIntoView({ behavior: "smooth", block: "start" }),
    );

    $("#park-btn").addEventListener("click", () => {
      if (State.cart.length) this.parkCurrent();
      else this.showParked();
    });

    $("#parked-badge").addEventListener("click", (e) => {
      e.stopPropagation();
      this.showParked();
    });

    $("#pay-cash").addEventListener("click", () => this.openPayment("bar"));
    $("#pay-card").addEventListener("click", () => this.openPayment("karte"));

    // Tastenkürzel
    document.addEventListener("keydown", (e) => {
      if (!State.user || State.view !== "kasse" || isModalOpen()) return;

      if (e.key === "F2") {
        e.preventDefault();
        search.focus();
        search.select();
      } else if (e.key === "F4") {
        e.preventDefault();
        if (!$("#pay-cash").disabled) this.openPayment("bar");
      } else if (e.key === "F8") {
        e.preventDefault();
        if (!$("#pay-card").disabled) this.openPayment("karte");
      } else if (e.key === "F6") {
        e.preventDefault();
        $("#park-btn").click();
      }
    });

    // Bestände regelmäßig aktualisieren, solange die Kasse offen ist.
    setInterval(() => {
      if (State.user && State.view === "kasse" && !isModalOpen()) {
        this.refreshStockQuiet();
      }
    }, 60000);
  },
};

/* ==========================================================================
   Bon / Kassenzettel
   ========================================================================== */

const Receipt = {
  build(order) {
    const s = State.settings || {};
    const W = 40;

    const line = (leftText, rightText) => {
      const left = String(leftText);
      const right = String(rightText);
      const gap = Math.max(1, W - left.length - right.length);
      return left + " ".repeat(gap) + right;
    };

    const rule = (character = "-") => character.repeat(W);

    const center = (text) => {
      const value = String(text);
      const padding = Math.max(0, Math.floor((W - value.length) / 2));
      return " ".repeat(padding) + value;
    };

    const wrap = (text, indent = "") => {
      const words = String(text).split(/\s+/);
      const rows = [];
      let current = indent;
      words.forEach((w) => {
        if ((current + w).length > W) {
          rows.push(current.trimEnd());
          current = indent + w + " ";
        } else {
          current += w + " ";
        }
      });
      rows.push(current.trimEnd());
      return rows;
    };

    const out = [];

    out.push(center((s.business_name || s.shop_name || "Masora Döner").toUpperCase()));
    if (s.address) out.push(center(s.address));
    if (s.phone) out.push(center("Tel. " + s.phone));
    if (s.tax_id) out.push(center("St.-Nr. " + s.tax_id));
    out.push("");

    out.push(line("Bon #" + order.order_no, fmtDateTime(order.created_at)));
    if (order.staff_name) out.push("Bedienung: " + order.staff_name);
    if (order.note) wrap(order.note).forEach((r) => out.push(r));

    if (order.status === "storniert") {
      out.push("");
      out.push(center("*** STORNIERT ***"));
    }

    out.push(rule("="));

    (order.items || []).forEach((item) => {
      out.push(line(`${item.qty}x ${item.name}`, money(item.line_total)));
      if (item.qty > 1) out.push("    " + money(item.unit_price) + " / Stück");
    });

    out.push(rule("-"));
    out.push(line("Zwischensumme", money(order.subtotal)));

    if (Number(order.discount_amount) > 0) {
      const type =
        order.discount_source === "kooperation" ? "Kooperation" : "Rabatt";
      out.push(
        line(
          type + (order.discount_name ? " (" + order.discount_name + ")" : ""),
          "-" + money(order.discount_amount),
        ),
      );
    }

    out.push(rule("="));
    out.push(line("SUMME", money(order.total)));

    const groups = vatBreakdown(order.items, order.subtotal, order.total);
    groups.forEach((g) =>
      out.push(
        line(`enthaltene MwSt. ${Math.round(g.rate * 100)}%`, money(g.vat)),
      ),
    );

    out.push("");
    out.push(line("Zahlung", order.payment_method === "bar" ? "Bar" : "Karte"));

    if (order.payment_method === "bar" && order.cash_given != null) {
      out.push(line("Gegeben", money(order.cash_given)));
      out.push(line("Rückgeld", money(order.change_due)));
    }

    out.push("");
    out.push(center(s.receipt_footer || "Danke für Ihren Besuch!"));

    return out.join("\n");
  },

  show(order) {
    const text = this.build(order);

    openModal({
      title: "Bon #" + order.order_no,
      bodyHTML: `<div class="receipt" id="receipt-text">${esc(text)}</div>`,
      footHTML: `
        <button class="btn" data-close type="button">Schließen</button>
        <button class="btn" id="copy-receipt" type="button">Kopieren</button>
        <button class="btn btn-primary" id="print-receipt" type="button">Drucken</button>`,
      onMount(root) {
        $("#print-receipt", root).addEventListener("click", () => window.print());
        $("#copy-receipt", root).addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast("Bon kopiert", "success");
          } catch {
            toast("Kopieren nicht möglich", "error");
          }
        });
      },
    });
  },
};

window.Kasse = Kasse;
window.Receipt = Receipt;
window.vatBreakdown = vatBreakdown;
