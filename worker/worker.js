/*
  Cloudflare Worker für Masora Döner Kasse.
  - /receipt → Quittungen an Discord
  - /stock-warning → Lager-Warnungen an Discord
*/

const ALLOWED_ORIGIN = "https://verblasst-mythos.github.io";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=UTF-8",
};

// Sonderzeichen für Discord-Markdown entschärfen (wird bei der Lager-Warnung genutzt).
function esc(value) {
  return String(value ?? "").replace(/([*_`~|>\\])/g, "\\$1").slice(0, 60);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    // CORS-Preflight vom Browser.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // Route prüfen
    if (url.pathname === "/receipt") {
      return handleReceipt(request, env);
    } else if (url.pathname === "/stock-warning") {
      return handleStockWarning(request, env);
    }

    return json(
      {
        ok: false,
        error: "Route nicht gefunden. Nutze /receipt oder /stock-warning.",
      },
      404,
    );
  },
};

// ===========================================================================
// Quittung an Discord senden
// ===========================================================================

async function handleReceipt(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Nur POST ist erlaubt." }, 405);
  }

  if (request.headers.get("Origin") !== ALLOWED_ORIGIN) {
    return json({ ok: false, error: "Diese Webseite darf den Worker nicht verwenden." }, 403);
  }

  if (!env.DISCORD_WEBHOOK_URL) {
    return json({ ok: false, error: "DISCORD_WEBHOOK_URL fehlt in Cloudflare." }, 500);
  }

  let order;

  try {
    order = await request.json();
  } catch {
    return json({ ok: false, error: "Ungültige Daten. JSON wird erwartet." }, 400);
  }

  const orderId = String(order.orderId || "Unbekannt").slice(0, 100);
  const customerName = String(order.customerName || "Gast").slice(0, 100);
  const staffName = String(order.staffName || "Unbekannt").slice(0, 100);
  const currency = String(order.currency || "EUR").slice(0, 10);
  const total = Number(order.total || 0);
  const items = Array.isArray(order.items) ? order.items : [];

  const itemsText =
    items.length > 0
      ? items
          .slice(0, 20)
          .map((item, index) => {
            const name = String(item.name || "Artikel").slice(0, 60);
            const quantity = Math.max(1, Number(item.quantity || 1));
            const price = Number(item.price || 0);
            const lineTotal = quantity * price;

            return `**${index + 1}. ${name}**\n` +
                   `└ ${quantity}× à ${price.toFixed(2).replace(".", ",")} ${currency} = **${lineTotal.toFixed(2).replace(".", ",")} ${currency}**`;
          })
          .join("\n\n")
          .slice(0, 1024)
      : "❌ Keine Artikel vorhanden";

  const totalFormatted = total.toFixed(2).replace(".", ",");

  const discordPayload = {
    username: "🧾 Masora Kasse",
    avatar_url: "https://cdn-icons-png.flaticon.com/512/732/732200.png",
    content: "✅ **Neue Bestellung erfolgreich abgeschlossen**",
    embeds: [
      {
        title: `Quittung #${orderId}`,
        description: `**Kunde:** ${customerName}\n**Kassiert von:** ${staffName}`,
        color: 0x57f287,
        fields: [
          {
            name: "🛒 Artikel",
            value: itemsText,
            inline: false,
          },
          {
            name: "\u200b",
            value: "\u200b",
            inline: false,
          },
          {
            name: "💰 Gesamtbetrag",
            value: `**${totalFormatted} ${currency}**`,
            inline: false,
          },
        ],
        footer: {
          icon_url: "https://cdn-icons-png.flaticon.com/512/732/732200.png",
          text: "Masora Döner Kasse • " + new Date().toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }),
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(discordPayload),
  });

  if (!discordResponse.ok) {
    const details = await discordResponse.text();
    console.error("Discord-WebHook-Fehler:", discordResponse.status, details);
    return json({ ok: false, error: "Discord hat die Quittung nicht angenommen." }, 502);
  }

  return json({ ok: true, message: "Discord-Quittung wurde gesendet." });
}

// ===========================================================================
// Lager-Warnung an Discord senden
// ===========================================================================

async function handleStockWarning(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Nur POST ist erlaubt." }, 405);
  }

  if (request.headers.get("Origin") !== ALLOWED_ORIGIN) {
    return json({ ok: false, error: "Diese Webseite darf den Worker nicht verwenden." }, 403);
  }

  // Verwende DISCORD_WEBHOOK_URL_LAGER für Lager-Warnungen
  if (!env.DISCORD_WEBHOOK_URL_LAGER) {
    return json({ ok: false, error: "DISCORD_WEBHOOK_URL_LAGER fehlt in Cloudflare." }, 500);
  }

  let data;

  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Ungültige Daten. JSON wird erwartet." }, 400);
  }

  const products = Array.isArray(data.products) ? data.products : [];
  const staffName = String(data.staffName || "Unbekannt").slice(0, 100);

  if (products.length === 0) {
    return json({ ok: false, error: "Keine Produkte angegeben." }, 400);
  }

  // Produkte nach Status gruppieren
  const outOfStock = products.filter(p => p.stock <= 0);
  const lowStock = products.filter(p => p.stock > 0 && p.stock <= p.min_stock);

  const discordPayload = {
    username: "📦 Masora Lager",
    avatar_url: "https://cdn-icons-png.flaticon.com/512/2913/2913528.png",
    content: "⚠️ **Lager-Warnung**",
    embeds: [
      {
        title: "📊 Lagerbestand Übersicht",
        description: `**Meldung von:** ${staffName}\n**Zeit:** ${new Date().toLocaleString("de-DE")}`,
        color: outOfStock.length > 0 ? 0xff0000 : 0xffa500, // Rot wenn ausverkauft, sonst Orange
        fields: [],
        footer: {
          icon_url: "https://cdn-icons-png.flaticon.com/512/2913/2913528.png",
          text: "Masora Döner Kasse • Lagerverwaltung",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  // Ausverkaufte Produkte
  if (outOfStock.length > 0) {
    const outOfStockText = outOfStock
      .slice(0, 10)
      .map(p => `❌ **${esc(p.name)}** — ${p.stock} / ${p.min_stock} (Mindestbestand)`)
      .join("\n");

    discordPayload.embeds[0].fields.push({
      name: `🔴 Ausverkauft (${outOfStock.length})`,
      value: outOfStockText,
      inline: false,
    });
  }

  // Niedriger Bestand
  if (lowStock.length > 0) {
    const lowStockText = lowStock
      .slice(0, 10)
      .map(p => `⚠️ **${esc(p.name)}** — ${p.stock} / ${p.min_stock} (Mindestbestand)`)
      .join("\n");

    discordPayload.embeds[0].fields.push({
      name: `🟠 Niedriger Bestand (${lowStock.length})`,
      value: lowStockText,
      inline: false,
    });
  }

  const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL_LAGER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(discordPayload),
  });

  if (!discordResponse.ok) {
    const details = await discordResponse.text();
    console.error("Discord-WebHook-Fehler:", discordResponse.status, details);
    return json({ ok: false, error: "Discord hat die Lager-Warnung nicht angenommen." }, 502);
  }

  return json({ ok: true, message: "Lager-Warnung wurde gesendet." });
}

// Hilfsfunktion zum Escapen von Discord-Nachrichten
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c] || c;
  });
}
