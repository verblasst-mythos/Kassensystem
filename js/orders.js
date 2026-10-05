/* ==========================================================================
   Bestellungen: Übersicht, Umsätze je Mitarbeiter, Storno, Bon-Nachdruck
   ========================================================================== */
"use strict";

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

const Orders = {
  range: "today",
  staffFilter: "", // '' = alle Mitarbeiter
  rows: [],
  loading: false,

  rangeFilter() {
    if (this.range === "today") return { from: startOfDay(0).toISOString() };
    if (this.range === "week") return { from: startOfDay(-6).toISOString() };
    return {};
  },

  rangeLabel() {
    if (this.range === "today") return "Heute";
    if (this.range === "week") return "Letzte 7 Tage";
    return "Gesamter Zeitraum";
  },

  async load() {
    this.loading = true;
    this.paint();
    try {
      this.rows = await DB.listOrders(this.rangeFilter());
    } catch (err) {
      fail(err);
      this.rows = [];
    }
    this.loading = false;
    this.paint();
  },

  payFilter: "",
  statusFilter: "",
  search: "",

  /** Bestellungen nach Mitarbeiter, Zahlart, Status und Suchtext gefiltert. */
  filtered() {
    const q = this.search.trim().toLowerCase().replace(/^#/, "");

    return this.rows.filter((o) => {
      if (
        this.staffFilter &&
        o.staff_id !== this.staffFilter &&
        o.staff_name !== this.staffFilter
      )
        return false;

      if (this.payFilter && o.payment_method !== this.payFilter) return false;

      if (this.statusFilter === "storniert" && o.status !== "storniert")
        return false;
      if (this.statusFilter === "ok" && o.status === "storniert") return false;

      if (q) {
        const hay = [
          String(o.order_no),
          o.staff_name,
          o.note,
          o.discount_name,
          ...(o.items || []).map((i) => i.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  },

  /** Gefilterte Bestellungen als CSV (Excel-tauglich, Semikolon). */
  exportCsv() {
    const rows = this.filtered();
    if (!rows.length) {
      toast("Keine Bestellungen zum Exportieren", "error");
      return;
    }

    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const dec = (n) => String(num(n)).replace(".", ",");

    const header = [
      "Bon",
      "Datum",
      "Uhrzeit",
      "Mitarbeiter",
      "Zahlart",
      "Status",
      "Zwischensumme",
      "Rabatt",
      "Rabatt-Name",
      "Summe",
      "Notiz",
      "Artikel",
    ];

    const lines = rows.map((o) => {
      const d = new Date(o.created_at);
      return [
        o.order_no,
        d.toLocaleDateString("de-DE"),
        d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        o.staff_name || "",
        o.payment_method === "bar" ? "Bar" : "Karte",
        o.status === "storniert" ? "Storniert" : "OK",
        dec(o.subtotal),
        dec(o.discount_amount || 0),
        o.discount_name || "",
        dec(o.total),
        o.note || "",
        (o.items || []).map((i) => `${i.qty}x ${i.name}`).join(", "),
      ]
        .map(cell)
        .join(";");
    });

    const csv = "\ufeff" + [header.map(cell).join(";"), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bestellungen-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${rows.length} Bestellungen exportiert`, "success");
  },

  stats(rows) {
    const valid = rows.filter((o) => o.status !== "storniert");
    const sum = (arr) => num(arr.reduce((s, o) => s + Number(o.total), 0));
    const cash = valid.filter((o) => o.payment_method === "bar");
    const card = valid.filter((o) => o.payment_method === "karte");
    return {
      count: valid.length,
      revenue: sum(valid),
      avg: valid.length ? num(sum(valid) / valid.length) : 0,
      cash: sum(cash),
      card: sum(card),
      cancelled: rows.length - valid.length,
    };
  },

  /** Umsatz gruppiert je Mitarbeiter, absteigend sortiert. */
  perStaff() {
    const map = new Map();
    this.rows
      .filter((o) => o.status !== "storniert")
      .forEach((o) => {
        const key = o.staff_id || o.staff_name || "unbekannt";
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: o.staff_name || "Ohne Zuordnung",
            revenue: 0,
            count: 0,
            cash: 0,
            card: 0,
          });
        }
        const e = map.get(key);
        e.count += 1;
        e.revenue = num(e.revenue + Number(o.total));
        if (o.payment_method === "bar") e.cash = num(e.cash + Number(o.total));
        else e.card = num(e.card + Number(o.total));
      });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  },

  paintStaffSelect() {
    const sel = $("#o-staff");
    if (!sel) return;
    // Auswahl aus dem Personalstamm plus Namen, die nur in Bestellungen vorkommen.
    const names = new Map();
    (State.staff || []).forEach((s) => names.set(s.id, s.name));
    this.rows.forEach((o) => {
      if (o.staff_id && !names.has(o.staff_id))
        names.set(o.staff_id, o.staff_name || "Unbekannt");
      else if (!o.staff_id && o.staff_name && !names.has(o.staff_name))
        names.set(o.staff_name, o.staff_name);
    });
    const current = this.staffFilter;
    sel.innerHTML =
      `<option value="">Alle Mitarbeiter</option>` +
      [...names.entries()]
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "de"))
        .map(
          ([id, name]) =>
            `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(name)}</option>`,
        )
        .join("");
  },

  paint() {
    const rows = this.filtered();
    const s = this.stats(rows);
    $("#o-revenue").textContent = money(s.revenue);
    $("#o-count").textContent = s.count;
    $("#o-avg").textContent = money(s.avg);
    $("#o-cash").textContent = money(s.cash);
    $("#o-card").textContent = money(s.card);

    const who = this.staffFilter
      ? $("#o-staff")?.selectedOptions?.[0]?.textContent || "Auswahl"
      : "Alle Mitarbeiter";
    $("#o-scope").textContent = `${this.rangeLabel()} · ${who}`;

    $$("#o-range button").forEach((b) =>
      b.setAttribute("aria-current", String(b.dataset.range === this.range)),
    );

    this.paintStaffSelect();
    this.paintPerStaff();

    const body = $("#o-tbody");
    if (this.loading) {
      body.innerHTML = `<tr><td colspan="7" class="muted" style="padding:var(--space-8);text-align:center">
        Lade Bestellungen …</td></tr>`;
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="muted" style="padding:var(--space-8);text-align:center">
        Für diese Auswahl gibt es keine Bestellungen.</td></tr>`;
      return;
    }

    body.innerHTML = rows
      .map((o) => {
        const pos = (o.items || []).reduce((n, i) => n + Number(i.qty), 0);
        const cancelled = o.status === "storniert";
        const coop = o.discount_source === "kooperation";
        return `<tr class="${cancelled ? "is-cancelled" : ""}">
          <td class="strong">#${o.order_no}</td>
          <td class="muted">${fmtDateTime(o.created_at)}</td>
          <td>${pos} Artikel${o.staff_name ? ` · <span class="muted">${esc(o.staff_name)}</span>` : ""}${
            coop
              ? ` · <span class="tag ok">${esc(o.discount_name || "Kooperation")}</span>`
              : ""
          }${o.note ? `<div class="muted small">${esc(o.note)}</div>` : ""}</td>
          <td><span class="tag">${o.payment_method === "bar" ? "Bar" : "Karte"}</span></td>
          <td class="num">${money(o.total)}</td>
          <td><span class="tag ${cancelled ? "bad" : "ok"}">${cancelled ? "Storniert" : "OK"}</span></td>
          <td>
            <div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
              <button class="btn btn-sm" data-bon="${o.id}">Bon</button>
              ${
                cancelled || State.user?.role !== "admin"
                  ? ""
                  : `<button class="btn btn-sm btn-danger" data-storno="${o.id}">Storno</button>`
              }
            </div>
          </td>
        </tr>`;
      })
      .join("");
  },

  /** Tabelle „Umsatz je Mitarbeiter" — nur für den Chef sichtbar. */
  paintPerStaff() {
    const card = $("#o-perstaff");
    if (!card) return;
    const isAdmin = State.user?.role === "admin";
    card.classList.toggle("hidden", !isAdmin);
    if (!isAdmin) return;

    const list = this.perStaff();
    const gesamt = num(list.reduce((s, e) => s + e.revenue, 0));
    $("#o-perstaff-body").innerHTML = list.length
      ? list
          .map((e) => {
            const anteil =
              gesamt > 0 ? Math.round((e.revenue / gesamt) * 100) : 0;
            const active = this.staffFilter === e.key;
            return `<tr class="${active ? "is-active" : ""}">
              <td class="strong">${esc(e.name)}</td>
              <td class="num">${e.count}</td>
              <td class="num">${money(e.cash)}</td>
              <td class="num">${money(e.card)}</td>
              <td class="num strong">${money(e.revenue)}</td>
              <td>
                <div class="bar-track" title="${anteil} % vom Gesamtumsatz">
                  <div class="bar-fill" style="width:${anteil}%"></div>
                </div>
              </td>
              <td><button class="btn btn-sm" data-pick-staff="${esc(e.key)}">${
                active ? "Filter aus" : "Nur diesen"
              }</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="muted" style="padding:var(--space-8);text-align:center">
           In diesem Zeitraum wurde noch nichts verkauft.</td></tr>`;
  },

  bind() {
    $("#o-range").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-range]");
      if (!b) return;
      this.range = b.dataset.range;
      this.load();
    });

    $("#o-staff").addEventListener("change", (e) => {
      this.staffFilter = e.target.value;
      this.paint();
    });

    $("#o-reload").addEventListener("click", () => this.load());
    $("#o-export").addEventListener("click", () => this.exportCsv());

    $("#o-pay").addEventListener("change", (e) => {
      this.payFilter = e.target.value;
      this.paint();
    });

    $("#o-status").addEventListener("change", (e) => {
      this.statusFilter = e.target.value;
      this.paint();
    });

    let searchTimer = null;
    $("#o-search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.search = e.target.value;
        this.paint();
      }, 150);
    });

    $("#o-perstaff-body").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-pick-staff]");
      if (!b) return;
      const key = b.dataset.pickStaff;
      this.staffFilter = this.staffFilter === key ? "" : key;
      this.paint();
    });

    $("#o-tbody").addEventListener("click", async (e) => {
      const bon = e.target.closest("button[data-bon]");
      const storno = e.target.closest("button[data-storno]");
      if (bon) {
        const o = this.rows.find((x) => x.id === bon.dataset.bon);
        if (o) Receipt.show(o);
        return;
      }
      if (storno) {
        const o = this.rows.find((x) => x.id === storno.dataset.storno);
        if (!o) return;
        if (State.user?.role !== "admin") {
          toast("Stornieren ist nur für Admins möglich", "error");
          return;
        }
        const ok = await confirmDialog(
          `Bestellung #${o.order_no} stornieren?`,
          `Der Betrag von ${money(o.total)} wird nicht mehr im Umsatz gezählt und die Artikel gehen zurück ins Lager. Der Bon bleibt zur Nachvollziehbarkeit gespeichert.`,
          "Stornieren",
        );
        if (!ok) return;
        try {
          await DB.cancelOrder(o.id, State.user?.name || null);
          toast(`Bestellung #${o.order_no} storniert — Lager zurückgebucht`);
          this.load();
          Kasse.reloadStock();
        } catch (err) {
          fail(err);
        }
      }
    });
  },
};

window.Orders = Orders;
