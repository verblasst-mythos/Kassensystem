/* ==========================================================================
   App-Kern: State, Hilfsfunktionen, Login, Navigation
   ========================================================================== */
"use strict";

const State = {
  user: null,
  products: [],
  discounts: [],
  staff: [],
  settings: null,
  cart: [],
  discountId: "",
  coop: null, // aktivierte Kooperation (Rabatt mit Codewort)
  shift: null, // laufende Schicht, wenn eingestempelt
  category: null,
  view: "kasse",
};

/** Nach dieser Zeit wird die Kasse automatisch abgemeldet. */
const SESSION_MINUTES = 60;

/* ---------- Hilfsfunktionen ---------- */

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const money = (n) => euro.format(Number(n) || 0);
const num = (n) => Math.round((Number(n) || 0) * 100) / 100;

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
/** Sekunden als "1 Std 05 Min" bzw. "12 Min". */
function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} Std ${String(m).padStart(2, "0")} Min`;
  return `${m} Min`;
}

/** Sekunden als "59:12" für den Countdown. */
function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function $(sel, root = document) {
  return root.querySelector(sel);
}
function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function toast(message, kind = "") {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fail(err) {
  console.error(err);
  toast(
    err && err.message ? err.message : "Ein Fehler ist aufgetreten",
    "error",
  );
}

/* ---------- Modal ---------- */

let modalKeyHandler = null;

function openModal({
  title,
  bodyHTML,
  footHTML = "",
  onMount = null,
  wide = false,
}) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.id = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"
         ${wide ? 'style="max-width:720px"' : ""}>
      <div class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Schließen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ""}
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-close]")) closeModal();
  });
  modalKeyHandler = (e) => {
    if (e.key === "Escape") closeModal();
  };
  document.addEventListener("keydown", modalKeyHandler);

  if (onMount) onMount(overlay);
  return overlay;
}

function closeModal() {
  const el = $("#modal-overlay");
  if (el) el.remove();
  if (modalKeyHandler) {
    document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = null;
  }
}

/* ---------- Bestätigung ---------- */

function confirmDialog(title, text, confirmLabel = "Bestätigen") {
  return new Promise((resolve) => {
    openModal({
      title,
      bodyHTML: `<p style="font-size:var(--text-sm)">${esc(text)}</p>`,
      footHTML: `
        <button class="btn" data-close>Abbrechen</button>
        <button class="btn btn-primary" data-yes>${esc(confirmLabel)}</button>`,
      onMount(root) {
        $("[data-yes]", root).addEventListener("click", () => {
          closeModal();
          resolve(true);
        });
        root.addEventListener("click", (e) => {
          if (e.target === root || e.target.closest("[data-close]"))
            resolve(false);
        });
      },
    });
  });
}

/* ==========================================================================
   Login (PIN)
   ========================================================================== */

const Login = {
  pin: "",

  show() {
    $("#login").classList.remove("hidden");
    $("#app").classList.add("hidden");
    this.pin = "";
    this.paint();
  },

  hide() {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
  },

  paint() {
    $$("#pin-display .pin-dot").forEach((d, i) => {
      d.classList.toggle("filled", i < this.pin.length);
    });
  },

  press(key) {
    const errEl = $("#login-error");
    errEl.textContent = "";
    if (key === "del") {
      this.pin = this.pin.slice(0, -1);
    } else if (key === "clear") {
      this.pin = "";
    } else if (this.pin.length < 4) {
      this.pin += key;
    }
    this.paint();
    if (this.pin.length === 4) setTimeout(() => this.submit(), 120);
  },

  async submit() {
    const errEl = $("#login-error");
    const match = State.staff.find((s) => s.pin === this.pin && s.is_active);
    if (!match) {
      errEl.textContent = "PIN nicht erkannt";
      this.pin = "";
      this.paint();
      return;
    }
    State.user = match;
    this.hide();
    await App.afterLogin();
  },

  bind() {
    $("#pin-pad").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (b) this.press(b.dataset.key);
    });
    document.addEventListener("keydown", (e) => {
      if ($("#login").classList.contains("hidden")) return;
      if (/^[0-9]$/.test(e.key)) this.press(e.key);
      else if (e.key === "Backspace") this.press("del");
    });
  },
};

/* ==========================================================================
   Dienst: Ein- und Ausstempeln, Sitzungsdauer, Auto-Abmeldung
   ========================================================================== */

const Duty = {
  deadline: 0,
  ticker: null,
  warned: false,

  /** Ist der angemeldete Mitarbeiter gerade im Dienst? */
  isOn() {
    return !!(State.shift && !State.shift.ended_at);
  },

  /** Lädt eine eventuell noch offene Schicht nach dem Anmelden. */
  async load() {
    State.shift = null;
    if (!State.user) return;
    try {
      State.shift = await DB.openShift(State.user.id);
      // Wurde die Kasse vor kurzem automatisch abgemeldet?
      // Dann die Schicht fortsetzen statt sie zu zerstückeln.
      if (!State.shift) {
        const resumed = await DB.resumeShift(State.user.id);
        if (resumed) {
          State.shift = resumed;
          toast("Schicht fortgesetzt — du bist wieder im Dienst");
        }
      }
    } catch (err) {
      console.error(err);
    }
    this.paint();
  },

  async clockIn() {
    if (!State.user) return;
    if (this.isOn()) return;
    try {
      State.shift = await DB.clockIn(State.user.id, State.user.name);
      this.paint();
      toast(`Eingestempelt um ${fmtTime(State.shift.started_at)}`);
    } catch (err) {
      fail(err);
    }
  },

  async clockOut(auto = false) {
    if (!this.isOn()) return null;
    const shiftId = State.shift.id;
    const startedAt = State.shift.started_at;
    try {
      await DB.clockOut(shiftId, auto);
    } catch (err) {
      console.error(err);
      if (!auto) {
        fail(err);
        return null;
      }
    }
    State.shift = null;
    this.paint();
    const worked = fmtDuration(
      (Date.now() - new Date(startedAt).getTime()) / 1000,
    );
    if (!auto) toast(`Ausgestempelt — Dienstzeit ${worked}`);
    return worked;
  },

  /* ---------- Anzeige ---------- */

  paint() {
    const chip = $("#duty-chip");
    const btn = $("#duty-toggle");
    if (!chip || !btn) return;

    const on = this.isOn();
    chip.classList.toggle("on", on);
    chip.classList.toggle("off", !on);
    $("#duty-banner")?.classList.toggle("hidden", on);

    if (on) {
      const secs =
        (Date.now() - new Date(State.shift.started_at).getTime()) / 1000;
      $("#duty-state").textContent = "Im Dienst";
      $("#duty-since").textContent =
        `seit ${fmtTime(State.shift.started_at)} · ${fmtDuration(secs)}`;
      btn.textContent = "Ausstempeln";
      btn.classList.remove("btn-primary");
    } else {
      $("#duty-state").textContent = "Nicht im Dienst";
      $("#duty-since").textContent = "Zum Kassieren bitte einstempeln";
      btn.textContent = "Einstempeln";
      btn.classList.add("btn-primary");
    }
  },

  /* ---------- Sitzung / Auto-Abmeldung ---------- */

  startSession() {
    this.stopSession();
    this.warned = false;
    this.deadline = Date.now() + SESSION_MINUTES * 60 * 1000;
    this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
  },

  stopSession() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  },

  tick() {
    const left = Math.max(0, (this.deadline - Date.now()) / 1000);
    const el = $("#session-left");
    if (el) {
      el.textContent = fmtClock(left);
      el.classList.toggle("warn", left <= 300);
    }
    if (this.isOn()) this.paint();

    if (left <= 300 && !this.warned) {
      this.warned = true;
      toast("Die Kasse meldet sich in 5 Minuten automatisch ab", "error");
    }
    if (left <= 0) {
      this.stopSession();
      this.autoLogout();
    }
  },

  async autoLogout() {
    const name = State.user?.name || "";
    const worked = await this.clockOut(true);
    await App.logout({ auto: true });
    $("#login-error").textContent = worked
      ? `${name} nach ${SESSION_MINUTES} Minuten automatisch abgemeldet · Dienstzeit ${worked}`
      : `Nach ${SESSION_MINUTES} Minuten automatisch abgemeldet`;
  },

  /**
   * Prüft vor dem Kassieren, ob der Mitarbeiter im Dienst ist.
   * Ist er es nicht, kommt ein Hinweis mit direkter Einstempel-Taste.
   */
  requireDuty() {
    if (this.isOn()) return true;
    openModal({
      title: "Du bist nicht im Dienst",
      bodyHTML: `
        <p style="font-size:var(--text-sm)">
          Bevor du eine Bestellung kassieren kannst, musst du dich einstempeln.
          So wird der Umsatz dir zugeordnet und deine Dienstzeit erfasst.
        </p>
        <p class="muted" style="font-size:var(--text-sm);margin-top:var(--space-3)">
          Der Warenkorb bleibt erhalten.
        </p>`,
      footHTML: `
        <button class="btn" data-close>Abbrechen</button>
        <button class="btn btn-primary" id="duty-now">Jetzt einstempeln</button>`,
      onMount: (root) => {
        $("#duty-now", root).addEventListener("click", async () => {
          closeModal();
          await this.clockIn();
        });
      },
    });
    return false;
  },

  bind() {
    $("#duty-toggle").addEventListener("click", async () => {
      if (this.isOn()) {
        const ok = await confirmDialog(
          "Dienst beenden?",
          "Du wirst ausgestempelt. Zum Kassieren musst du dich danach wieder einstempeln.",
          "Ausstempeln",
        );
        if (ok) await this.clockOut(false);
      } else {
        await this.clockIn();
      }
    });
  },
};

/* ==========================================================================
   App
   ========================================================================== */

const App = {
  async boot() {
    this.bindTheme();
    Login.bind();
    this.bindNav();
    Duty.bind();

    try {
      const [staff, settings] = await Promise.all([
        DB.listStaff(true),
        DB.getSettings(),
      ]);
      State.staff = staff;
      State.settings = settings;
      this.paintBrand();
      Login.show();
      const hint = $("#login-hint");
      if (!staff.length) {
        hint.textContent =
          "Kein Personal angelegt. Bitte in der Datenbank einen PIN hinterlegen.";
      }
    } catch (err) {
      fail(err);
      $("#login-error").textContent = "Keine Verbindung zur Datenbank";
    }
  },

  paintBrand() {
    const name = State.settings?.shop_name || "Masora Döner";
    $$(".brand-name").forEach((el) => (el.textContent = name));
    document.title = name + " — Kasse";
  },

  async afterLogin() {
    $("#user-name").textContent = State.user.name;
    
    // Rollen-Anzeige
    const roleNames = {
      admin: "Admin",
      service: "Serviceleitung",
      lager: "Lager",
      kasse: "Kasse",
    };
    $("#user-role").textContent = roleNames[State.user.role] || "Kasse";
    
    // Rolle merken
    const role = State.user.role;
    
    // Navigation basierend auf Rolle anzeigen/ausblenden
    // Admin-Button: nur für admin
    const navAdmin = $("#nav-admin");
    if (navAdmin) {
      navAdmin.classList.toggle("hidden", role !== "admin");
    }
    
    // Lager-Button: nur für admin, lager
    const navLager = $("#nav-lager");
    if (navLager) {
      navLager.classList.toggle("hidden", !["admin", "lager"].includes(role));
    }
    
    // Dienstzeiten-Button: nur für admin, service
    const navDienst = $("#nav-dienst");
    if (navDienst) {
      navDienst.classList.toggle("hidden", !["admin", "service"].includes(role));
    }
    
    // Produkte-Button: nur für admin, service, lager
    const navProdukte = $("#nav-produkte");
    if (navProdukte) {
      navProdukte.classList.toggle("hidden", !["admin", "service", "lager"].includes(role));
    }
    
    try {
      const [products, discounts] = await Promise.all([
        DB.listProducts(true),
        DB.listDiscounts(true),
      ]);
      State.products = products;
      State.discounts = discounts;
      await Duty.load();
      Duty.startSession();
      Kasse.render();
      this.go("kasse");
    } catch (err) {
      fail(err);
    }
  },

  async logout({ auto = false } = {}) {
    // Beim manuellen Abmelden fragen, ob die Schicht beendet werden soll.
    if (!auto && Duty.isOn()) {
      const ok = await confirmDialog(
        "Abmelden und ausstempeln?",
        `Du bist noch im Dienst. Beim Abmelden wirst du ausgestempelt.`,
        "Abmelden",
      );
      if (!ok) return;
      await Duty.clockOut(false);
    }
    Duty.stopSession();
    State.user = null;
    State.shift = null;
    State.cart = [];
    State.discountId = "";
    State.coop = null;
    closeModal();
    Login.show();
  },

  bindNav() {
    $("#nav").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-view]");
      if (b) this.go(b.dataset.view);
    });
    $("#logout").addEventListener("click", () => this.logout());
    $("#duty-banner-btn").addEventListener("click", () => Duty.clockIn());
  },

  go(view) {
    State.view = view;
    $$("#nav button[data-view]").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.view === view));
    });
    $$(".view").forEach((v) =>
      v.classList.toggle("hidden", v.dataset.viewPanel !== view),
    );
    if (view === "bestellungen") Orders.load();
    if (view === "verwaltung") Admin.open();
  },

  bindTheme() {
    const root = document.documentElement;
    let mode = matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
    const paint = () => {
      root.setAttribute("data-theme", mode);
      $$("[data-theme-toggle]").forEach((t) => {
        t.setAttribute(
          "aria-label",
          mode === "dark"
            ? "Zu hellem Design wechseln"
            : "Zu dunklem Design wechseln",
        );
        t.innerHTML =
          mode === "dark"
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
      });
    };
    paint();
    $$("[data-theme-toggle]").forEach((t) =>
      t.addEventListener("click", () => {
        mode = mode === "dark" ? "light" : "dark";
        paint();
      }),
    );
  },
};

/* ==========================================================================
   Discord-Quittung über Cloudflare Worker
   ========================================================================== */

const DISCORD_WORKER_URL =
  "https://masora-doener-kasse-worker.finnwoschech.workers.dev/receipt";

async function sendReceiptToDiscord(order) {
  if (!order) {
    throw new Error("Keine Bestellung zum Senden vorhanden.");
  }

  const items = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.products)
      ? order.products
      : State.cart;

  const response = await fetch(DISCORD_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId: order.id || order.order_id || order.number || "Unbekannt",

      customerName:
        order.customerName ||
        order.customer_name ||
        order.customer ||
        "Gast",

      total:
        order.total ||
        order.total_amount ||
        order.amount ||
        order.grand_total ||
        0,

      currency: order.currency || "EUR",

      staffName: State.user?.name || "Unbekannt",

      items: items,
    }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.error ||
        `Discord-Quittung konnte nicht gesendet werden (${response.status}).`,
    );
  }

  return result;
}

window.sendReceiptToDiscord = sendReceiptToDiscord;

window.App = App;
window.State = State;
window.Duty = Duty;
