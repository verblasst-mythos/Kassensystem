/* ==========================================================================
   App-Kern: State, Hilfsfunktionen, Dialoge, Anmeldung, Dienst, Navigation
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
  orderType: "Hier essen",
  note: "",
  view: "kasse",
};

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

/** Sicherer Zugriff auf localStorage (kann in privaten Fenstern fehlen). */
const Store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("masora." + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("masora." + key, JSON.stringify(value));
    } catch {
      /* ignorieren */
    }
  },
};

/**
 * Hinweis einblenden.
 * toast("Text", "error"|"success", { action: { label, onClick }, duration })
 */
function toast(message, kind = "", options = {}) {
  const wrap = $("#toasts");
  if (!wrap) return;

  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.setAttribute("role", kind === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  if (options.action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = options.action.label;
    btn.addEventListener("click", () => {
      el.remove();
      options.action.onClick();
    });
    el.appendChild(btn);
  }

  wrap.appendChild(el);

  // Maximal vier Hinweise gleichzeitig.
  while (wrap.children.length > 4) wrap.firstChild.remove();

  setTimeout(
    () => el.remove(),
    options.duration || (options.action ? 6000 : kind === "error" ? 5000 : 3000),
  );
}

function fail(err) {
  console.error(err);
  toast(
    err && err.message ? err.message : "Ein Fehler ist aufgetreten",
    "error",
  );
}

/** Kurzer Tastenklick-Ton über WebAudio (keine Datei nötig). */
const Sound = {
  ctx: null,
  beep(freq = 880, ms = 70, volume = 0.04) {
    if (Store.get("mute", false)) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + ms / 1000);
    } catch {
      /* Ton ist optional */
    }
  },
  ok() {
    this.beep(660, 60);
    setTimeout(() => this.beep(990, 90), 70);
  },
};

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
         ${wide ? 'style="width:min(100%,720px)"' : ""}>
      <div class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Schließen" type="button">
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
    if (e.key === "Escape") {
      closeModal();
    } else if (
      e.key === "Enter" &&
      !e.target.closest("textarea, button, select")
    ) {
      // Enter bestätigt die Hauptaktion des Dialogs.
      const primary = $(".modal-foot .btn-primary:not(:disabled)", overlay);
      if (primary) {
        e.preventDefault();
        primary.click();
      }
    }
  };
  document.addEventListener("keydown", modalKeyHandler);

  if (onMount) onMount(overlay);

  // Fokus ins erste Eingabefeld, sonst auf die Hauptaktion.
  const first = $("input:not([type=hidden]), select, textarea", overlay);
  if (first && !first.closest(".numpad")) setTimeout(() => first.focus(), 30);

  return overlay;
}

function closeModal() {
  const el = $("#modal-overlay");
  if (el) {
    el.remove();
    el.dispatchEvent(new Event("modal-closed"));
  }
  if (modalKeyHandler) {
    document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = null;
  }
}

function isModalOpen() {
  return !!$("#modal-overlay");
}

/* ---------- Bestätigung / Eingabe ---------- */

function confirmDialog(
  title,
  text,
  confirmLabel = "Bestätigen",
  { danger = false } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const overlay = openModal({
      title,
      bodyHTML: `<p style="font-size:var(--text-sm);margin:0">${esc(text)}</p>`,
      footHTML: `
        <button class="btn" data-close type="button">Abbrechen</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes type="button">${esc(confirmLabel)}</button>`,
      onMount(root) {
        $("[data-yes]", root).addEventListener("click", () => {
          done(true);
          closeModal();
        });
      },
    });

    overlay.addEventListener("modal-closed", () => done(false));
  });
}

/** Einzeiliges oder mehrzeiliges Eingabefeld. Liefert Text oder null. */
function promptDialog({
  title,
  label,
  value = "",
  placeholder = "",
  multiline = false,
  type = "text",
  confirmLabel = "Übernehmen",
}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const field = multiline
      ? `<textarea class="input" id="prompt-input" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" id="prompt-input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${type === "number" ? "numeric" : "text"}">`;

    const overlay = openModal({
      title,
      bodyHTML: `<div class="field" style="margin:0"><label for="prompt-input">${esc(label)}</label>${field}</div>`,
      footHTML: `
        <button class="btn" data-close type="button">Abbrechen</button>
        <button class="btn btn-primary" data-yes type="button">${esc(confirmLabel)}</button>`,
      onMount(root) {
        const input = $("#prompt-input", root);
        setTimeout(() => input.select(), 40);
        $("[data-yes]", root).addEventListener("click", () => {
          done(input.value);
          closeModal();
        });
      },
    });

    overlay.addEventListener("modal-closed", () => done(null));
  });
}

/* ==========================================================================
   Anmeldung (PIN)
   ========================================================================== */

const Login = {
  pin: "",
  busy: false,

  async show() {
    $("#login").classList.remove("hidden");
    $("#app").classList.add("hidden");
    this.pin = "";
    this.paint();

    // Personal neu laden, damit frisch angelegte PINs sofort gelten.
    try {
      State.staff = await DB.listStaff(true);
    } catch (err) {
      console.error(err);
    }
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
    if (this.busy) return;
    $("#login-error").textContent = "";

    if (key === "del") {
      this.pin = this.pin.slice(0, -1);
    } else if (key === "clear") {
      this.pin = "";
    } else if (this.pin.length < 4) {
      this.pin += key;
    }

    this.paint();

    if (this.pin.length === 4) {
      this.busy = true;
      setTimeout(() => this.submit(), 120);
    }
  },

  async submit() {
    const errEl = $("#login-error");
    const match = State.staff.find(
      (s) => String(s.pin) === this.pin && s.is_active,
    );

    if (!match) {
      errEl.textContent = "PIN nicht erkannt";
      const display = $("#pin-display");
      display.classList.remove("shake");
      void display.offsetWidth;
      display.classList.add("shake");
      Sound.beep(220, 160);
      this.pin = "";
      this.busy = false;
      this.paint();
      return;
    }

    State.user = match;
    this.pin = "";
    this.busy = false;
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
      else if (e.key === "Escape") this.press("clear");
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

  /** Sitzungsdauer in Minuten (Einstellung, sonst 60). */
  sessionMinutes() {
    return Number(State.settings?.session_timeout_minutes) || 60;
  },

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
    if (!State.user || this.isOn()) return;

    try {
      State.shift = await DB.clockIn(State.user.id, State.user.name);
      this.paint();
      Sound.ok();
      toast(`Eingestempelt um ${fmtTime(State.shift.started_at)}`, "success");
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
    $("#duty-banner")?.classList.toggle(
      "hidden",
      on || !State.user || State.view !== "kasse",
    );

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
    this.deadline = Date.now() + this.sessionMinutes() * 60 * 1000;
    this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
  },

  /** Sitzung um die volle Dauer verlängern. */
  extend() {
    if (!State.user) return;
    this.warned = false;
    this.deadline = Date.now() + this.sessionMinutes() * 60 * 1000;
    this.tick();
    toast(`Sitzung verlängert — ${this.sessionMinutes()} Minuten`, "success");
  },

  stopSession() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    const el = $("#session-left");
    if (el) el.textContent = "--:--";
  },

  tick() {
    const left = Math.max(0, (this.deadline - Date.now()) / 1000);
    const el = $("#session-left");

    if (el) {
      el.textContent = fmtClock(left);
      el.classList.toggle("warn", left <= 300);
    }

    if (this.isOn()) this.paint();

    if (left <= 300 && left > 0 && !this.warned) {
      this.warned = true;
      toast("Die Kasse meldet sich in 5 Minuten automatisch ab", "error", {
        action: { label: "Verlängern", onClick: () => this.extend() },
        duration: 15000,
      });
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
      ? `${name} nach ${this.sessionMinutes()} Minuten automatisch abgemeldet · Dienstzeit ${worked}`
      : `Nach ${this.sessionMinutes()} Minuten automatisch abgemeldet`;
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
        <p style="font-size:var(--text-sm);margin:0">
          Bevor du eine Bestellung kassieren kannst, musst du dich einstempeln.
          So wird der Umsatz dir zugeordnet und deine Dienstzeit erfasst.
        </p>
        <p class="muted" style="font-size:var(--text-sm);margin:var(--space-3) 0 0">
          Der Warenkorb bleibt erhalten.
        </p>`,
      footHTML: `
        <button class="btn" data-close type="button">Abbrechen</button>
        <button class="btn btn-primary" id="duty-now" type="button">Jetzt einstempeln</button>`,
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

    $("#session-extend").addEventListener("click", () => this.extend());
  },
};

/* ==========================================================================
   App
   ========================================================================== */

/** Farbvorgaben, auf die sich die Einstellungen beziehen. */
const ACCENT_PRESETS = {
  paprika: { primary: "#e25a24", accent: "#e8845a" },
  red: { primary: "#d94c58", accent: "#e57b84" },
  gold: { primary: "#d89b28", accent: "#e6b95a" },
  green: { primary: "#55a86a", accent: "#7fc093" },
  blue: { primary: "#4e8edc", accent: "#7eaee8" },
  purple: { primary: "#8a6bd1", accent: "#a98ee0" },
};

/** Schwarz oder Weiß – je nachdem, was auf der Farbe lesbar ist. */
function readableOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * lin((n >> 16) & 255) +
    0.7152 * lin((n >> 8) & 255) +
    0.0722 * lin(n & 255);
  return L > 0.42 ? "#1a1204" : "#ffffff";
}

const App = {
  themeOverride: null,

  async boot() {
    this.themeOverride = Store.get("theme", null);
    this.bindTheme();
    this.bindClock();
    this.bindConnection();
    Login.bind();
    this.bindNav();
    Duty.bind();
    Kasse.bind();
    Orders.bind();
    Admin.bind();

    try {
      State.staff = await DB.listStaff(true);
    } catch (err) {
      fail(err);
      $("#login").classList.remove("hidden");
      $("#login-error").textContent = "Keine Verbindung zur Datenbank";
      return;
    }

    try {
      State.settings = await DB.getSettings();
    } catch (err) {
      console.error(err);
      State.settings = { ...DEFAULT_SETTINGS };
      toast("Einstellungen konnten nicht geladen werden — Standard aktiv", "error");
    }

    this.applySettings();
    await Login.show();

    if (!State.staff.length) {
      $("#login-hint").textContent =
        "Kein Personal angelegt. Bitte in der Datenbank einen PIN hinterlegen.";
    }
  },

  /* ---------- Einstellungen anwenden ---------- */

  applySettings() {
    this.paintBrand();
    this.paintTheme();
    this.paintLogo();
    Kasse.applyPreferences?.();
  },

  paintBrand() {
    const s = State.settings || DEFAULT_SETTINGS;
    const name = s.business_name || "Masora Döner";
    const sub = s.business_subtitle || "Kassensystem";

    $$(".brand-name").forEach((el) => (el.textContent = name));
    $$(".brand-sub").forEach((el) => (el.textContent = sub));
    $$(".brand-logo:not(.has-logo)").forEach(
      (el) => (el.textContent = name.trim().charAt(0).toUpperCase() || "M"),
    );
    document.title = `${name} — Kasse`;
  },

  paintLogo() {
    const url = String(State.settings?.logo_url || "").trim();
    const valid = /^https?:\/\//i.test(url);

    $$(".brand-logo").forEach((el) => {
      if (valid) {
        el.classList.add("has-logo");
        el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
        el.textContent = "";
      } else {
        el.classList.remove("has-logo");
        el.style.backgroundImage = "";
        el.textContent =
          (State.settings?.business_name || "M").trim().charAt(0).toUpperCase() || "M";
      }
    });
  },

  /** Effektives Theme: eigene Wahl am Gerät > Einstellung > System. */
  effectiveTheme() {
    const mode = this.themeOverride || State.settings?.theme_mode || "dark";
    if (mode === "system") {
      return matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    return mode === "light" ? "light" : "dark";
  },

  paintTheme() {
    const s = State.settings || DEFAULT_SETTINGS;
    const root = document.documentElement;
    const theme = this.effectiveTheme();

    root.setAttribute("data-theme", theme);

    const primary = /^#[0-9a-f]{6}$/i.test(s.primary_color || "")
      ? s.primary_color
      : ACCENT_PRESETS.paprika.primary;
    const accent = /^#[0-9a-f]{6}$/i.test(s.accent_color || "")
      ? s.accent_color
      : ACCENT_PRESETS.paprika.accent;

    root.style.setProperty("--primary", primary);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--on-primary", readableOn(primary));
    document.body.classList.toggle("compact", !!s.compact_mode);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0a0e15" : "#111827";

    this.paintThemeToggle(theme);
  },

  paintThemeToggle(theme) {
    $$("[data-theme-toggle]").forEach((t) => {
      t.setAttribute(
        "aria-label",
        theme === "dark" ? "Zu hellem Design wechseln" : "Zu dunklem Design wechseln",
      );
      t.innerHTML =
        theme === "dark"
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
    });
  },

  bindTheme() {
    $$("[data-theme-toggle]").forEach((t) =>
      t.addEventListener("click", () => {
        this.themeOverride = this.effectiveTheme() === "dark" ? "light" : "dark";
        Store.set("theme", this.themeOverride);
        this.paintTheme();
      }),
    );
    this.paintTheme();

    matchMedia("(prefers-color-scheme: light)").addEventListener?.(
      "change",
      () => this.paintTheme(),
    );
  },

  bindClock() {
    const paint = () => {
      const now = new Date();
      $("#current-time").textContent = now.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      $("#current-date").textContent = now.toLocaleDateString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      });
    };
    paint();
    setInterval(paint, 15000);

    $("#fullscreen-button").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
  },

  bindConnection() {
    window.addEventListener("offline", () =>
      toast("Keine Internetverbindung — Zahlungen sind gesperrt", "error", {
        duration: 8000,
      }),
    );
    window.addEventListener("online", () =>
      toast("Wieder online", "success"),
    );
  },

  /* ---------- Anmeldung / Abmeldung ---------- */

  async afterLogin() {
    const user = State.user;
    const roleNames = {
      admin: "Admin",
      service: "Serviceleitung",
      lager: "Lager",
      kasse: "Kasse",
    };

    $("#user-name").textContent = user.name;
    $("#user-avatar").textContent = user.name.trim().charAt(0) || "?";
    $("#user-role").textContent = roleNames[user.role] || "Kasse";

    // Verwaltung: Admin sieht alles, Service und Lager nur ihre Reiter.
    const canAdmin = ["admin", "service", "lager"].includes(user.role);
    $("#nav-admin").classList.toggle("hidden", !canAdmin);
    $("#tab-admin").classList.toggle("hidden", !canAdmin);

    try {
      const [products, discounts] = await Promise.all([
        DB.listProducts(true),
        DB.listDiscounts(true),
      ]);
      State.products = products;
      State.discounts = discounts;

      await Duty.load();
      Duty.startSession();
      Kasse.restoreForUser();
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
        "Du bist noch im Dienst. Beim Abmelden wirst du ausgestempelt.",
        "Abmelden",
      );
      if (!ok) return;
      await Duty.clockOut(false);
    }

    // Ein angefangener Bon geht nicht verloren, sondern wird geparkt.
    if (State.cart.length) {
      Kasse.parkCurrent({ silent: true });
      toast("Offener Bon wurde automatisch geparkt");
    }

    Duty.stopSession();
    State.user = null;
    State.shift = null;
    State.cart = [];
    State.discountId = "";
    State.coop = null;
    State.note = "";
    closeModal();
    await Login.show();
  },

  bindNav() {
    const onClick = (e) => {
      const b = e.target.closest("button[data-view]");
      if (b) this.go(b.dataset.view);
    };
    $("#nav").addEventListener("click", onClick);
    $("#tabbar").addEventListener("click", onClick);
    $("#logout").addEventListener("click", () => this.logout());
    $("#duty-banner-btn").addEventListener("click", () => Duty.clockIn());
  },

  go(view) {
    const titles = {
      kasse: ["Schnellverkauf", "Kasse"],
      bestellungen: ["Übersicht", "Bestellungen"],
      verwaltung: ["Verwaltung", "Verwaltung"],
    };

    if (view === "verwaltung" && $("#nav-admin").classList.contains("hidden")) {
      toast("Dafür fehlt die Berechtigung", "error");
      return;
    }

    State.view = view;

    $$("#nav button[data-view], #tabbar button[data-view]").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.view === view));
    });
    $$(".view").forEach((v) =>
      v.classList.toggle("hidden", v.dataset.viewPanel !== view),
    );

    $("#page-eyebrow").textContent = titles[view][0];
    $("#page-title").textContent = titles[view][1];
    Duty.paint();
    $("#cart-fab").classList.toggle("hidden", view !== "kasse" || !State.cart.length);

    if (view === "kasse") setTimeout(() => Kasse.refreshStockQuiet(), 0);
    if (view === "bestellungen") Orders.load();
    if (view === "verwaltung") Admin.open();
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
      : [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(DISCORD_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        // Die Bon-Nummer hat Vorrang vor der internen ID.
        orderId:
          order.orderId ||
          order.order_no ||
          order.id ||
          order.order_id ||
          order.number ||
          "Unbekannt",

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
        staffName: order.staffName || State.user?.name || "Unbekannt",
        items,
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
  } finally {
    clearTimeout(timer);
  }
}

window.sendReceiptToDiscord = sendReceiptToDiscord;
window.ACCENT_PRESETS = ACCENT_PRESETS;
window.App = App;
window.State = State;
window.Duty = Duty;
window.Store = Store;
