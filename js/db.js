/* ==========================================================================
   Supabase-Anbindung + Datenzugriff
   ========================================================================== */
"use strict";

const SUPABASE_URL = "https://ldeuoyzuhgpvhznnfxyo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_yTChUB8i4akcasmwhq4D6w_iBNzibQ8";

if (typeof window.supabase === "undefined") {
  throw new Error("Supabase-Bibliothek wurde nicht geladen.");
}

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false },
  },
);

function unwrap({ data, error }) {
  if (error) {
    throw new Error(error.message || "Datenbankfehler");
  }

  return data;
}

const SETTINGS_COLUMNS = `
  id,
  business_name,
  business_subtitle,
  logo_url,
  primary_color,
  accent_color,
  theme_mode,
  accent_preset,
  compact_mode,
  default_payment,
  show_vat,
  auto_print_receipt,
  confirm_cart_clear,
  session_timeout_minutes,
  updated_at
`;

const DEFAULT_SETTINGS = {
  id: 1,
  business_name: "Masora Döner",
  business_subtitle: "Kassensystem",
  logo_url: null,

  primary_color: "#e95420",
  accent_color: "#e35d6a",

  theme_mode: "dark",
  accent_preset: "paprika",
  compact_mode: false,

  default_payment: "cash",
  show_vat: true,
  auto_print_receipt: false,
  confirm_cart_clear: true,
  session_timeout_minutes: 30,
};

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim());
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf(value, validValues, fallback) {
  return validValues.includes(value) ? value : fallback;
}

function numberOneOf(value, validValues, fallback) {
  const number = Number(value);
  return validValues.includes(number) ? number : fallback;
}

function sanitizeSettings(patch = {}) {
  return {
    id: 1,

    business_name:
      String(
        patch.business_name ?? DEFAULT_SETTINGS.business_name,
      ).trim() || DEFAULT_SETTINGS.business_name,

    business_subtitle:
      String(
        patch.business_subtitle ?? DEFAULT_SETTINGS.business_subtitle,
      ).trim() || DEFAULT_SETTINGS.business_subtitle,

    logo_url: String(patch.logo_url ?? "").trim() || null,

    primary_color: isHexColor(patch.primary_color)
      ? String(patch.primary_color).trim()
      : DEFAULT_SETTINGS.primary_color,

    accent_color: isHexColor(patch.accent_color)
      ? String(patch.accent_color).trim()
      : DEFAULT_SETTINGS.accent_color,

    theme_mode: oneOf(
      patch.theme_mode,
      ["dark", "light", "system"],
      DEFAULT_SETTINGS.theme_mode,
    ),

    accent_preset: oneOf(
      patch.accent_preset,
      ["paprika", "red", "gold", "green", "blue", "purple"],
      DEFAULT_SETTINGS.accent_preset,
    ),

    compact_mode: booleanValue(
      patch.compact_mode,
      DEFAULT_SETTINGS.compact_mode,
    ),

    default_payment: oneOf(
      patch.default_payment,
      ["cash", "card"],
      DEFAULT_SETTINGS.default_payment,
    ),

    show_vat: booleanValue(
      patch.show_vat,
      DEFAULT_SETTINGS.show_vat,
    ),

    auto_print_receipt: booleanValue(
      patch.auto_print_receipt,
      DEFAULT_SETTINGS.auto_print_receipt,
    ),

    confirm_cart_clear: booleanValue(
      patch.confirm_cart_clear,
      DEFAULT_SETTINGS.confirm_cart_clear,
    ),

    session_timeout_minutes: numberOneOf(
      patch.session_timeout_minutes,
      [15, 30, 60, 120],
      DEFAULT_SETTINGS.session_timeout_minutes,
    ),
  };
}

const DB = {
  /* ---------- Produkte ---------- */

  async listProducts(onlyActive = false) {
    let query = sb
      .from("products")
      .select("*")
      .order("category_order")
      .order("category")
      .order("sort_order")
      .order("name");

    if (onlyActive) {
      query = query.eq("is_active", true);
    }

    return unwrap(await query);
  },

  async createProduct(product) {
    return unwrap(
      await sb.from("products").insert(product).select().single(),
    );
  },

  async updateProduct(id, patch) {
    return unwrap(
      await sb
        .from("products")
        .update(patch)
        .eq("id", id)
        .select()
        .single(),
    );
  },

  async deleteProduct(id) {
    return unwrap(await sb.from("products").delete().eq("id", id));
  },

  /* ---------- Rabatte ---------- */

  async listDiscounts(onlyActive = false) {
    let query = sb.from("discounts").select("*").order("name");

    if (onlyActive) {
      query = query.eq("is_active", true);
    }

    return unwrap(await query);
  },

  async createDiscount(discount) {
    return unwrap(
      await sb.from("discounts").insert(discount).select().single(),
    );
  },

  async updateDiscount(id, patch) {
    return unwrap(
      await sb
        .from("discounts")
        .update(patch)
        .eq("id", id)
        .select()
        .single(),
    );
  },

  async deleteDiscount(id) {
    return unwrap(await sb.from("discounts").delete().eq("id", id));
  },

  /* ---------- Personal ---------- */

  async listStaff(onlyActive = false) {
    let query = sb.from("staff").select("*").order("name");

    if (onlyActive) {
      query = query.eq("is_active", true);
    }

    return unwrap(await query);
  },

  async createStaff(staff) {
    return unwrap(
      await sb.from("staff").insert(staff).select().single(),
    );
  },

  async updateStaff(id, patch) {
    return unwrap(
      await sb
        .from("staff")
        .update(patch)
        .eq("id", id)
        .select()
        .single(),
    );
  },

  async deleteStaff(id) {
    return unwrap(await sb.from("staff").delete().eq("id", id));
  },

  /* ---------- Kooperationen ---------- */

  async listCoops(onlyActive = false) {
    let query = sb.from("cooperations").select("*").order("name");

    if (onlyActive) {
      query = query.eq("is_active", true);
    }

    return unwrap(await query);
  },

  async createCoop(cooperation) {
    return unwrap(
      await sb.from("cooperations").insert(cooperation).select().single(),
    );
  },

  async updateCoop(id, patch) {
    return unwrap(
      await sb
        .from("cooperations")
        .update(patch)
        .eq("id", id)
        .select()
        .single(),
    );
  },

  async deleteCoop(id) {
    return unwrap(
      await sb.from("cooperations").delete().eq("id", id),
    );
  },

  async findCoopByCode(code) {
    const cleanCode = String(code || "").trim();

    if (!cleanCode) {
      return null;
    }

    const rows = unwrap(
      await sb
        .from("cooperations")
        .select("*")
        .eq("is_active", true)
        .ilike("code", cleanCode),
    );

    return rows?.[0] || null;
  },

  /* ---------- Bestellungen ---------- */

  isMissingFunction(error) {
    const message = String(error?.message || error || "");

    return (
      error?.code === "PGRST202" ||
      message.includes("does not exist") ||
      message.includes("Could not find the function")
    );
  },

  async placeOrder(order) {
    const response = await sb.rpc("place_order", {
      p_items: order.items,
      p_subtotal: order.subtotal,
      p_discount_name: order.discount_name,
      p_discount_amount: order.discount_amount,
      p_discount_source: order.discount_source || "rabatt",
      p_total: order.total,
      p_payment_method: order.payment_method,
      p_cash_given: order.cash_given,
      p_change_due: order.change_due,
      p_staff_id: order.staff_id,
      p_staff_name: order.staff_name,
      p_shift_id: order.shift_id,
      p_note: order.note || null,
    });

    if (response.error && this.isMissingFunction(response.error)) {
      console.warn(
        "Die Funktion place_order fehlt. Bestellung wird ohne Lagerabzug gespeichert.",
      );

      return unwrap(
        await sb
          .from("orders")
          .insert({
            items: order.items,
            subtotal: order.subtotal,
            discount_name: order.discount_name,
            discount_amount: order.discount_amount,
            total: order.total,
            payment_method: order.payment_method,
            cash_given: order.cash_given,
            change_due: order.change_due,
            staff_name: order.staff_name,
            note: order.note || null,
          })
          .select()
          .single(),
      );
    }

    return unwrap(response);
  },

  async listOrders({ from = null, to = null, limit = 500 } = {}) {
    let query = sb
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from) {
      query = query.gte("created_at", from);
    }

    if (to) {
      query = query.lt("created_at", to);
    }

    return unwrap(await query);
  },

  async cancelOrder(id, staffName = null) {
    return unwrap(
      await sb.rpc("cancel_order", {
        p_order_id: id,
        p_staff_name: staffName,
      }),
    );
  },

  /* ---------- Schichten ---------- */

  async clockIn(staffId, staffName) {
    return unwrap(
      await sb.rpc("clock_in", {
        p_staff_id: staffId,
        p_staff_name: staffName,
      }),
    );
  },

  async clockOut(shiftId, auto = false) {
    return unwrap(
      await sb.rpc("clock_out", {
        p_shift_id: shiftId,
        p_auto: auto,
      }),
    );
  },

  async resumeShift(staffId) {
    return unwrap(
      await sb.rpc("resume_shift", {
        p_staff_id: staffId,
      }),
    );
  },

  async openShift(staffId) {
    const rows = unwrap(
      await sb
        .from("shifts")
        .select("*")
        .eq("staff_id", staffId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1),
    );

    return rows?.[0] || null;
  },

  async listShifts({
    from = null,
    to = null,
    staffId = null,
    limit = 500,
  } = {}) {
    let query = sb
      .from("shifts")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);

    if (from) {
      query = query.gte("started_at", from);
    }

    if (to) {
      query = query.lt("started_at", to);
    }

    if (staffId) {
      query = query.eq("staff_id", staffId);
    }

    return unwrap(await query);
  },

  /* ---------- Lager ---------- */

  async adjustStock(productId, delta, reason, staffName) {
    return unwrap(
      await sb.rpc("adjust_stock", {
        p_product_id: productId,
        p_delta: delta,
        p_reason: reason,
        p_staff_name: staffName,
      }),
    );
  },

  async listStockMoves({ limit = 120, productId = null } = {}) {
    let query = sb
      .from("stock_moves")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (productId) {
      query = query.eq("product_id", productId);
    }

    return unwrap(await query);
  },

  /* ---------- Einstellungen ---------- */

  async getSettings() {
    const rows = unwrap(
      await sb
        .from("settings")
        .select(SETTINGS_COLUMNS)
        .eq("id", 1),
    );

    if (rows?.length) {
      return {
        ...DEFAULT_SETTINGS,
        ...rows[0],
      };
    }

    const inserted = unwrap(
      await sb
        .from("settings")
        .insert(DEFAULT_SETTINGS)
        .select(SETTINGS_COLUMNS)
        .single(),
    );

    return {
      ...DEFAULT_SETTINGS,
      ...inserted,
    };
  },

  async updateSettings(patch = {}) {
    const safeSettings = sanitizeSettings(patch);

    const updated = unwrap(
      await sb
        .from("settings")
        .upsert(
          {
            ...safeSettings,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "id",
          },
        )
        .select(SETTINGS_COLUMNS)
        .single(),
    );

    return {
      ...DEFAULT_SETTINGS,
      ...updated,
    };
  },

  async saveSettings(patch = {}) {
    return this.updateSettings(patch);
  },
};

window.DB = DB;
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
