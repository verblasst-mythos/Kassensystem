/* ==========================================================================
   Verwaltung: Produkte, Lager, Rabatte, Kooperationen, Personal,
   Dienstzeiten, Einstellungen, Tagesabschluss
   ========================================================================== */
"use strict";

const Admin = {
  tab: "produkte",
  products: [],
  discounts: [],
  coops: [],
  staff: [],
  moves: [],
  shifts: [],
  shiftRange: 7,

  open() {
    const role =
      State.userRole ||
      State.user?.role ||
      "kasse";

    const allowedTabs = {
      produkte: ["admin", "service", "lager"],
      lager: ["admin", "lager"],
      rabatte: ["admin"],
      kooperationen: ["admin"],
      personal: ["admin"],
      dienstzeiten: ["admin", "service"],
      einstellungen: ["admin"],
      abschluss: ["admin"],
    };

    $$("#admin-subnav button").forEach((button) => {
      const tab = button.dataset.tab;
      const allowed = allowedTabs[tab] || ["admin"];

      button.classList.toggle(
        "hidden",
        !allowed.includes(role),
      );
    });

    const firstVisible = $(
      "#admin-subnav button:not(.hidden)",
    );

    if (
      !firstVisible ||
      !allowedTabs[firstVisible.dataset.tab]?.includes(role)
    ) {
      this.tab = "produkte";
    } else {
      this.tab = firstVisible.dataset.tab;
    }

    this.paintTabs();
    this.loadTab();
  },

  paintTabs() {
    $$("#admin-subnav button").forEach((button) => {
      button.setAttribute(
        "aria-current",
        String(button.dataset.tab === this.tab),
      );
    });
  },

  busy(text = "Lade …") {
    const body = $("#admin-body");

    if (body) {
      body.innerHTML = `
        <p
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${esc(text)}
        </p>
      `;
    }
  },

  async loadTab() {
    this.busy();

    try {
      if (this.tab === "produkte") {
        this.products = await DB.listProducts(false);
        this.renderProducts();
      } else if (this.tab === "lager") {
        const result = await Promise.all([
          DB.listProducts(false),
          DB.listStockMoves({ limit: 40 }),
        ]);

        this.products = result[0];
        this.moves = result[1];
        this.renderStock();
      } else if (this.tab === "rabatte") {
        this.discounts = await DB.listDiscounts(false);
        this.renderDiscounts();
      } else if (this.tab === "kooperationen") {
        this.coops = await DB.listCoops(false);
        this.renderCoops();
      } else if (this.tab === "personal") {
        this.staff = await DB.listStaff(false);
        this.renderStaff();
      } else if (this.tab === "dienstzeiten") {
        const from = startOfDay(
          -(this.shiftRange - 1),
        ).toISOString();

        const result = await Promise.all([
          DB.listShifts({ from }),
          DB.listStaff(false),
        ]);

        this.shifts = result[0];
        this.staff = result[1];
        this.renderShifts();
      } else if (this.tab === "einstellungen") {
        State.settings = await DB.getSettings();

        if (
          window.App &&
          typeof App.applySettings === "function"
        ) {
          App.applySettings();
        } else {
          App.paintBrand?.();
          App.paintTheme?.();
          App.paintLogo?.();
        }

        this.renderSettings();
      } else if (this.tab === "abschluss") {
        await this.loadClosing();
      }
    } catch (error) {
      fail(error);

      const body = $("#admin-body");

      if (body) {
        body.innerHTML = `
          <p
            class="muted"
            style="font-size:var(--text-sm)"
          >
            Konnte nicht geladen werden.
          </p>
        `;
      }
    }
  },

  /* ------------------------------------------------------------------------
     Produkte
     ------------------------------------------------------------------------ */

  renderProducts() {
    let html = `
      <div class="toolbar">
        <button
          class="btn btn-primary"
          id="prod-add"
          type="button"
        >
          + Produkt
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${this.products.length} Produkte
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kategorie</th>
                <th class="num">Preis</th>
                <th class="num">MwSt.</th>
                <th>Lager</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const product of this.products) {
      const vatRate =
        Number(product.vat_rate || 0) * 100;

      const stockInfo = product.track_stock
        ? `
          <span class="${
            product.stock <= product.min_stock
              ? "text-error"
              : "muted"
          }">
            ${product.stock} / ${product.min_stock}
          </span>
        `
        : `<span class="muted">—</span>`;

      html += `
        <tr>
          <td>${esc(product.name)}</td>
          <td>${esc(product.category || "Sonstiges")}</td>
          <td class="num">${money(product.price)}</td>
          <td class="num">${vatRate.toFixed(0)} %</td>
          <td>${stockInfo}</td>

          <td class="actions">
            <button
              class="icon-btn"
              type="button"
              data-product-edit="${esc(product.id)}"
              aria-label="Bearbeiten"
            >
              ✎
            </button>

            <button
              class="icon-btn"
              type="button"
              data-product-delete="${esc(product.id)}"
              aria-label="Löschen"
            >
              ×
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#prod-add")?.addEventListener(
      "click",
      () => this.editProduct(),
    );

    $$("#admin-body [data-product-edit]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.editProduct(
            button.dataset.productEdit,
          );
        });
      },
    );

    $$("#admin-body [data-product-delete]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.deleteProduct(
            button.dataset.productDelete,
          );
        });
      },
    );
  },

  async editProduct(id = null) {
    const product = id
      ? this.products.find(
          (item) => String(item.id) === String(id),
        )
      : null;

    const isNew = !product;

    openModal({
      title: isNew
        ? "Produkt hinzufügen"
        : "Produkt bearbeiten",

      bodyHTML: `
        <div class="field">
          <label for="prod-name">Name</label>
          <input
            id="prod-name"
            type="text"
            value="${esc(product?.name || "")}"
          />
        </div>

        <div class="field">
          <label for="prod-cat">Kategorie</label>
          <input
            id="prod-cat"
            type="text"
            value="${esc(product?.category || "")}"
          />
        </div>

        <div class="field">
          <label for="prod-price">Preis (€)</label>
          <input
            id="prod-price"
            type="number"
            step="0.01"
            value="${product?.price ?? ""}"
          />
        </div>

        <div class="field">
          <label for="prod-vat">MwSt. (%)</label>
          <input
            id="prod-vat"
            type="number"
            step="0.1"
            value="${
              Number(product?.vat_rate || 0) * 100
            }"
          />
        </div>

        <div class="field">
          <label for="prod-stock">Lagerbestand</label>
          <input
            id="prod-stock"
            type="number"
            step="0.01"
            value="${product?.stock ?? 0}"
          />
        </div>

        <div class="field">
          <label for="prod-minstock">
            Mindestbestand
          </label>
          <input
            id="prod-minstock"
            type="number"
            step="0.01"
            value="${product?.min_stock ?? 0}"
          />
        </div>

        <div class="field">
          <label>
            <input
              type="checkbox"
              id="prod-track"
              ${product?.track_stock ? "checked" : ""}
            />
            Lagerverwaltung aktivieren
          </label>
        </div>
      `,

      footHTML: `
        <button
          class="btn"
          type="button"
          data-close
        >
          Abbrechen
        </button>

        <button
          class="btn btn-primary"
          type="button"
          data-save
        >
          ${isNew ? "Hinzufügen" : "Speichern"}
        </button>
      `,

      onMount(root) {
        $("[data-save]", root)?.addEventListener(
          "click",
          async () => {
            const name =
              $("#prod-name", root).value.trim();

            const category =
              $("#prod-cat", root).value.trim() ||
              "Sonstiges";

            const price =
              parseFloat(
                $("#prod-price", root).value,
              ) || 0;

            const vat_rate =
              (parseFloat(
                $("#prod-vat", root).value,
              ) || 0) / 100;

            const stock =
              parseFloat(
                $("#prod-stock", root).value,
              ) || 0;

            const min_stock =
              parseFloat(
                $("#prod-minstock", root).value,
              ) || 0;

            const track_stock =
              $("#prod-track", root).checked;

            if (!name) {
              toast(
                "Name darf nicht leer sein",
                "error",
              );
              return;
            }

            try {
              const data = {
                name,
                category,
                price,
                vat_rate,
                stock,
                min_stock,
                track_stock,
              };

              if (isNew) {
                await DB.createProduct(data);
              } else {
                await DB.updateProduct(
                  product.id,
                  data,
                );
              }

              closeModal();
              await Admin.loadTab();

              toast(
                isNew
                  ? "Produkt hinzugefügt"
                  : "Produkt gespeichert",
              );
            } catch (error) {
              fail(error);
            }
          },
        );
      },
    });
  },

  async deleteProduct(id) {
    const product = this.products.find(
      (item) => String(item.id) === String(id),
    );

    if (!product) {
      return;
    }

    const confirmed = await confirmDialog(
      "Produkt löschen?",
      `"${product.name}" wird endgültig gelöscht.`,
      "Löschen",
    );

    if (!confirmed) {
      return;
    }

    try {
      await DB.deleteProduct(id);
      await this.loadTab();
      toast("Produkt gelöscht");
    } catch (error) {
      fail(error);
    }
  },

  /* ------------------------------------------------------------------------
     Lager
     ------------------------------------------------------------------------ */

  renderStock() {
    const trackedProducts =
      this.products.filter(
        (product) => product.track_stock,
      );

    let html = `
      <div class="toolbar">
        <button
          class="btn btn-primary"
          id="stock-add"
          type="button"
        >
          + Wareneingang
        </button>

        <button
          class="btn btn-warn"
          id="stock-warn"
          type="button"
        >
          ⚠️ Warnung senden
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${trackedProducts.length} Lagerprodukte
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Produkt</th>
                <th class="num">Aktuell</th>
                <th class="num">Min.</th>
                <th>Status</th>
                <th>Letzte Bewegung</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const product of trackedProducts) {
      const lastMove = this.moves.find(
        (move) =>
          String(move.product_id) ===
          String(product.id),
      );

      let status = "";

      if (product.stock <= 0) {
        status =
          '<span class="text-error">Ausverkauft</span>';
      } else if (product.stock <= product.min_stock) {
        status =
          '<span class="text-warn">Niedrig</span>';
      } else {
        status =
          '<span class="text-success">OK</span>';
      }

      html += `
        <tr>
          <td>${esc(product.name)}</td>
          <td class="num">${product.stock}</td>
          <td class="num">${product.min_stock}</td>
          <td>${status}</td>
          <td>
            ${
              lastMove
                ? fmtDateTime(lastMove.created_at)
                : "—"
            }
          </td>

          <td class="actions">
            <button
              class="icon-btn"
              type="button"
              data-stock-adjust="${esc(product.id)}"
              aria-label="Bestand anpassen"
            >
              +
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#stock-add")?.addEventListener(
      "click",
      () => this.adjustStock(),
    );

    $("#stock-warn")?.addEventListener(
      "click",
      () => this.checkStockAndWarn(true),
    );

    $$("#admin-body [data-stock-adjust]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.adjustStock(
            button.dataset.stockAdjust,
          );
        });
      },
    );
  },

  async adjustStock(productId = null) {
    const products =
      this.products.filter(
        (product) => product.track_stock,
      );

    const selected = productId
      ? products.find(
          (product) =>
            String(product.id) ===
            String(productId),
        )
      : products[0];

    if (!selected) {
      toast(
        "Keine Produkte mit Lagerverwaltung",
        "error",
      );
      return;
    }

    openModal({
      title: "Lagerbestand anpassen",

      bodyHTML: `
        <div class="field">
          <label for="adj-product">Produkt</label>
          <select id="adj-product">
            ${products
              .map(
                (product) => `
                  <option
                    value="${esc(product.id)}"
                    ${
                      String(product.id) ===
                      String(selected.id)
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(product.name)}
                    (${product.stock})
                  </option>
                `,
              )
              .join("")}
          </select>
        </div>

        <div class="field">
          <label for="adj-delta">
            Änderung (+/-)
          </label>
          <input
            id="adj-delta"
            type="number"
            step="0.01"
            value="0"
          />
        </div>

        <div class="field">
          <label for="adj-reason">Grund</label>
          <select id="adj-reason">
            <option value="wareneingang">
              Wareneingang
            </option>
            <option value="korrektur">
              Korrektur
            </option>
            <option value="schwund">
              Schwund
            </option>
          </select>
        </div>
      `,

      footHTML: `
        <button
          class="btn"
          type="button"
          data-close
        >
          Abbrechen
        </button>

        <button
          class="btn btn-primary"
          type="button"
          data-save
        >
          Buchen
        </button>
      `,

      onMount(root) {
        $("[data-save]", root)?.addEventListener(
          "click",
          async () => {
            const productId =
              $("#adj-product", root).value;

            const delta =
              parseFloat(
                $("#adj-delta", root).value,
              ) || 0;

            const reason =
              $("#adj-reason", root).value;

            if (delta === 0) {
              toast(
                "Änderung darf nicht 0 sein",
                "error",
              );
              return;
            }

            try {
              await DB.adjustStock(
                productId,
                delta,
                reason,
                State.user?.name || "Unbekannt",
              );

              closeModal();
              await Admin.loadTab();
              toast("Lagerbestand aktualisiert");
            } catch (error) {
              fail(error);
            }
          },
        );
      },
    });
  },

  async checkStockAndWarn(showToast = false) {
    try {
      const products =
        await DB.listProducts(false);

      const lowStock = products.filter(
        (product) =>
          product.track_stock &&
          product.stock <= product.min_stock,
      );

      if (!lowStock.length) {
        if (showToast) {
          toast("Lager ist im grünen Bereich");
        }
        return;
      }

      const response = await fetch(
        "https://masora-doener-kasse-worker.finnwoschech.workers.dev/stock-warning",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            products: lowStock.map((product) => ({
              name: product.name,
              stock: product.stock,
              min_stock: product.min_stock,
            })),
            staffName:
              State.user?.name || "System",
          }),
        },
      );

      const result = await response
        .json()
        .catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error ||
            "Lager-Warnung konnte nicht gesendet werden",
        );
      }

      if (showToast) {
        toast(
          `Lager-Warnung gesendet (${lowStock.length} Produkte)`,
        );
      }
    } catch (error) {
      console.error(
        "Lager-Warnung:",
        error,
      );

      if (showToast) {
        fail(error);
      }
    }
  },

  /* ------------------------------------------------------------------------
     Rabatte
     ------------------------------------------------------------------------ */

  renderDiscounts() {
    let html = `
      <div class="toolbar">
        <button
          class="btn btn-primary"
          id="disc-add"
          type="button"
        >
          + Rabatt
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${this.discounts.length} Rabatte
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Art</th>
                <th class="num">Wert</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const discount of this.discounts) {
      const kind =
        discount.kind === "percent"
          ? "Prozent"
          : "Euro";

      const value =
        discount.kind === "percent"
          ? `${discount.value}%`
          : money(discount.value);

      html += `
        <tr>
          <td>${esc(discount.name)}</td>
          <td>${kind}</td>
          <td class="num">${value}</td>

          <td class="actions">
            <button
              class="icon-btn"
              type="button"
              data-discount-edit="${esc(discount.id)}"
              aria-label="Bearbeiten"
            >
              ✎
            </button>

            <button
              class="icon-btn"
              type="button"
              data-discount-delete="${esc(discount.id)}"
              aria-label="Löschen"
            >
              ×
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#disc-add")?.addEventListener(
      "click",
      () => this.editDiscount(),
    );

    $$("#admin-body [data-discount-edit]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.editDiscount(
            button.dataset.discountEdit,
          );
        });
      },
    );

    $$("#admin-body [data-discount-delete]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.deleteDiscount(
            button.dataset.discountDelete,
          );
        });
      },
    );
  },

  async editDiscount(id = null) {
    const discount = id
      ? this.discounts.find(
          (item) =>
            String(item.id) === String(id),
        )
      : null;

    const isNew = !discount;

    openModal({
      title: isNew
        ? "Rabatt hinzufügen"
        : "Rabatt bearbeiten",

      bodyHTML: `
        <div class="field">
          <label for="disc-name">Name</label>
          <input
            id="disc-name"
            type="text"
            value="${esc(discount?.name || "")}"
          />
        </div>

        <div class="field">
          <label for="disc-kind">Art</label>
          <select id="disc-kind">
            <option
              value="percent"
              ${
                discount?.kind === "percent"
                  ? "selected"
                  : ""
              }
            >
              Prozent (%)
            </option>

            <option
              value="fixed"
              ${
                discount?.kind === "fixed"
                  ? "selected"
                  : ""
              }
            >
              Fester Betrag (€)
            </option>
          </select>
        </div>

        <div class="field">
          <label for="disc-value">Wert</label>
          <input
            id="disc-value"
            type="number"
            step="0.01"
            value="${discount?.value ?? ""}"
          />
        </div>
      `,

      footHTML: `
        <button
          class="btn"
          type="button"
          data-close
        >
          Abbrechen
        </button>

        <button
          class="btn btn-primary"
          type="button"
          data-save
        >
          ${isNew ? "Hinzufügen" : "Speichern"}
        </button>
      `,

      onMount(root) {
        $("[data-save]", root)?.addEventListener(
          "click",
          async () => {
            const name =
              $("#disc-name", root).value.trim();

            const kind =
              $("#disc-kind", root).value;

            const value =
              parseFloat(
                $("#disc-value", root).value,
              ) || 0;

            if (!name) {
              toast(
                "Name darf nicht leer sein",
                "error",
              );
              return;
            }

            try {
              const data = {
                name,
                kind,
                value,
              };

              if (isNew) {
                await DB.createDiscount(data);
              } else {
                await DB.updateDiscount(
                  discount.id,
                  data,
                );
              }

              closeModal();
              await Admin.loadTab();

              toast(
                isNew
                  ? "Rabatt hinzugefügt"
                  : "Rabatt gespeichert",
              );
            } catch (error) {
              fail(error);
            }
          },
        );
      },
    });
  },

  async deleteDiscount(id) {
    const discount = this.discounts.find(
      (item) =>
        String(item.id) === String(id),
    );

    if (!discount) {
      return;
    }

    const confirmed = await confirmDialog(
      "Rabatt löschen?",
      `"${discount.name}" wird endgültig gelöscht.`,
      "Löschen",
    );

    if (!confirmed) {
      return;
    }

    try {
      await DB.deleteDiscount(id);
      await this.loadTab();
      toast("Rabatt gelöscht");
    } catch (error) {
      fail(error);
    }
  },

  /* ------------------------------------------------------------------------
     Kooperationen
     ------------------------------------------------------------------------ */

  renderCoops() {
    let html = `
      <div class="toolbar">
        <button
          class="btn btn-primary"
          id="coop-add"
          type="button"
        >
          + Kooperation
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${this.coops.length} Kooperationen
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Art</th>
                <th class="num">Wert</th>
                <th>Code</th>
                <th>Aktiv</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const coop of this.coops) {
      const kind =
        coop.kind === "percent"
          ? "Prozent"
          : "Euro";

      const value =
        coop.kind === "percent"
          ? `${coop.value}%`
          : money(coop.value);

      html += `
        <tr>
          <td>${esc(coop.name)}</td>
          <td>${kind}</td>
          <td class="num">${value}</td>
          <td><code>${esc(coop.code)}</code></td>
          <td>${coop.is_active ? "✅" : "❌"}</td>

          <td class="actions">
            <button
              class="icon-btn"
              type="button"
              data-coop-edit="${esc(coop.id)}"
              aria-label="Bearbeiten"
            >
              ✎
            </button>

            <button
              class="icon-btn"
              type="button"
              data-coop-delete="${esc(coop.id)}"
              aria-label="Löschen"
            >
              ×
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#coop-add")?.addEventListener(
      "click",
      () => this.editCoop(),
    );

    $$("#admin-body [data-coop-edit]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.editCoop(
            button.dataset.coopEdit,
          );
        });
      },
    );

    $$("#admin-body [data-coop-delete]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.deleteCoop(
            button.dataset.coopDelete,
          );
        });
      },
    );
  },

  async editCoop(id = null) {
    const coop = id
      ? this.coops.find(
          (item) =>
            String(item.id) === String(id),
        )
      : null;

    const isNew = !coop;

    openModal({
      title: isNew
        ? "Kooperation hinzufügen"
        : "Kooperation bearbeiten",

      bodyHTML: `
        <div class="field">
          <label for="coop-name">Name</label>
          <input
            id="coop-name"
            type="text"
            value="${esc(coop?.name || "")}"
          />
        </div>

        <div class="field">
          <label for="coop-kind">Art</label>
          <select id="coop-kind">
            <option
              value="percent"
              ${
                coop?.kind === "percent"
                  ? "selected"
                  : ""
              }
            >
              Prozent (%)
            </option>

            <option
              value="fixed"
              ${
                coop?.kind === "fixed"
                  ? "selected"
                  : ""
              }
            >
              Fester Betrag (€)
            </option>
          </select>
        </div>

        <div class="field">
          <label for="coop-value">Wert</label>
          <input
            id="coop-value"
            type="number"
            step="0.01"
            value="${coop?.value ?? ""}"
          />
        </div>

        <div class="field">
          <label for="coop-code">Code</label>
          <input
            id="coop-code"
            type="text"
            value="${esc(coop?.code || "")}"
          />
        </div>

        <div class="field">
          <label>
            <input
              type="checkbox"
              id="coop-active"
              ${coop?.is_active ? "checked" : ""}
            />
            Aktiv
          </label>
        </div>
      `,

      footHTML: `
        <button
          class="btn"
          type="button"
          data-close
        >
          Abbrechen
        </button>

        <button
          class="btn btn-primary"
          type="button"
          data-save
        >
          ${isNew ? "Hinzufügen" : "Speichern"}
        </button>
      `,

      onMount(root) {
        $("[data-save]", root)?.addEventListener(
          "click",
          async () => {
            const name =
              $("#coop-name", root).value.trim();

            const kind =
              $("#coop-kind", root).value;

            const value =
              parseFloat(
                $("#coop-value", root).value,
              ) || 0;

            const code =
              $("#coop-code", root).value.trim();

            const is_active =
              $("#coop-active", root).checked;

            if (!name || !code) {
              toast(
                "Name und Code dürfen nicht leer sein",
                "error",
              );
              return;
            }

            try {
              const data = {
                name,
                kind,
                value,
                code,
                is_active,
              };

              if (isNew) {
                await DB.createCoop(data);
              } else {
                await DB.updateCoop(
                  coop.id,
                  data,
                );
              }

              closeModal();
              await Admin.loadTab();

              toast(
                isNew
                  ? "Kooperation hinzugefügt"
                  : "Kooperation gespeichert",
              );
            } catch (error) {
              fail(error);
            }
          },
        );
      },
    });
  },

  async deleteCoop(id) {
    const coop = this.coops.find(
      (item) =>
        String(item.id) === String(id),
    );

    if (!coop) {
      return;
    }

    const confirmed = await confirmDialog(
      "Kooperation löschen?",
      `"${coop.name}" wird endgültig gelöscht.`,
      "Löschen",
    );

    if (!confirmed) {
      return;
    }

    try {
      await DB.deleteCoop(id);
      await this.loadTab();
      toast("Kooperation gelöscht");
    } catch (error) {
      fail(error);
    }
  },

  /* ------------------------------------------------------------------------
     Personal
     ------------------------------------------------------------------------ */

  renderStaff() {
    const roleNames = {
      admin: "Admin",
      service: "Serviceleitung",
      lager: "Lager",
      kasse: "Kasse",
    };

    let html = `
      <div class="toolbar">
        <button
          class="btn btn-primary"
          id="staff-add"
          type="button"
        >
          + Mitarbeiter
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${this.staff.length} Mitarbeiter
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rolle</th>
                <th>PIN</th>
                <th>Aktiv</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const staff of this.staff) {
      html += `
        <tr>
          <td>${esc(staff.name)}</td>
          <td>${esc(roleNames[staff.role] || staff.role)}</td>
          <td>
            <code>${esc(staff.pin || "—")}</code>
          </td>
          <td>${staff.is_active ? "✅" : "❌"}</td>

          <td class="actions">
            <button
              class="icon-btn"
              type="button"
              data-staff-edit="${esc(staff.id)}"
              aria-label="Bearbeiten"
            >
              ✎
            </button>

            <button
              class="icon-btn"
              type="button"
              data-staff-delete="${esc(staff.id)}"
              aria-label="Löschen"
            >
              ×
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#staff-add")?.addEventListener(
      "click",
      () => this.editStaff(),
    );

    $$("#admin-body [data-staff-edit]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.editStaff(
            button.dataset.staffEdit,
          );
        });
      },
    );

    $$("#admin-body [data-staff-delete]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.deleteStaff(
            button.dataset.staffDelete,
          );
        });
      },
    );
  },

  async editStaff(id = null) {
    const staff = id
      ? this.staff.find(
          (item) =>
            String(item.id) === String(id),
        )
      : null;

    const isNew = !staff;

    openModal({
      title: isNew
        ? "Mitarbeiter hinzufügen"
        : "Mitarbeiter bearbeiten",

      bodyHTML: `
        <div class="field">
          <label for="staff-name">Name</label>
          <input
            id="staff-name"
            type="text"
            value="${esc(staff?.name || "")}"
          />
        </div>

        <div class="field">
          <label for="staff-role">Rolle</label>
          <select id="staff-role">
            <option
              value="admin"
              ${staff?.role === "admin" ? "selected" : ""}
            >
              Admin
            </option>

            <option
              value="service"
              ${staff?.role === "service" ? "selected" : ""}
            >
              Serviceleitung
            </option>

            <option
              value="lager"
              ${staff?.role === "lager" ? "selected" : ""}
            >
              Lager
            </option>

            <option
              value="kasse"
              ${staff?.role === "kasse" ? "selected" : ""}
            >
              Kasse
            </option>
          </select>
        </div>

        <div class="field">
          <label for="staff-pin">
            PIN (4 Ziffern)
          </label>
          <input
            id="staff-pin"
            type="text"
            maxlength="4"
            inputmode="numeric"
            value="${esc(staff?.pin || "")}"
          />
        </div>

        <div class="field">
          <label>
            <input
              type="checkbox"
              id="staff-active"
              ${staff?.is_active ? "checked" : ""}
            />
            Aktiv
          </label>
        </div>
      `,

      footHTML: `
        <button
          class="btn"
          type="button"
          data-close
        >
          Abbrechen
        </button>

        <button
          class="btn btn-primary"
          type="button"
          data-save
        >
          ${isNew ? "Hinzufügen" : "Speichern"}
        </button>
      `,

      onMount(root) {
        $("[data-save]", root)?.addEventListener(
          "click",
          async () => {
            const name =
              $("#staff-name", root).value.trim();

            const role =
              $("#staff-role", root).value;

            const pin =
              $("#staff-pin", root).value.trim();

            const is_active =
              $("#staff-active", root).checked;

            if (!name) {
              toast(
                "Name darf nicht leer sein",
                "error",
              );
              return;
            }

            if (!/^[0-9]{4}$/.test(pin)) {
              toast(
                "PIN muss genau 4 Ziffern enthalten",
                "error",
              );
              return;
            }

            try {
              const data = {
                name,
                role,
                pin,
                is_active,
              };

              if (isNew) {
                await DB.createStaff(data);
              } else {
                await DB.updateStaff(
                  staff.id,
                  data,
                );
              }

              closeModal();
              await Admin.loadTab();

              toast(
                isNew
                  ? "Mitarbeiter hinzugefügt"
                  : "Mitarbeiter gespeichert",
              );
            } catch (error) {
              fail(error);
            }
          },
        );
      },
    });
  },

  async deleteStaff(id) {
    const staff = this.staff.find(
      (item) =>
        String(item.id) === String(id),
    );

    if (!staff) {
      return;
    }

    const confirmed = await confirmDialog(
      "Mitarbeiter löschen?",
      `"${staff.name}" wird endgültig gelöscht.`,
      "Löschen",
    );

    if (!confirmed) {
      return;
    }

    try {
      await DB.deleteStaff(id);
      await this.loadTab();
      toast("Mitarbeiter gelöscht");
    } catch (error) {
      fail(error);
    }
  },

  /* ------------------------------------------------------------------------
     Dienstzeiten
     ------------------------------------------------------------------------ */

  renderShifts() {
    const byStaff = {};

    for (const shift of this.shifts) {
      const key = String(shift.staff_id);

      if (!byStaff[key]) {
        byStaff[key] = [];
      }

      byStaff[key].push(shift);
    }

    let html = `
      <div class="toolbar">
        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${this.shiftRange} Tage ·
          ${this.shifts.length} Schichten
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Schichten</th>
                <th class="num">Gesamtzeit</th>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const [staffId, shifts] of Object.entries(
      byStaff,
    )) {
      const staff = this.staff.find(
        (item) =>
          String(item.id) === String(staffId),
      );

      const totalSeconds = shifts.reduce(
        (total, shift) => {
          const start = new Date(
            shift.started_at,
          ).getTime();

          const end = shift.ended_at
            ? new Date(shift.ended_at).getTime()
            : Date.now();

          return total + (end - start) / 1000;
        },
        0,
      );

      html += `
        <tr>
          <td>${esc(staff?.name || "Unbekannt")}</td>
          <td class="num">${shifts.length}</td>
          <td class="num">
            ${fmtDuration(totalSeconds)}
          </td>
          <td>
            <button
              class="btn btn-sm"
              type="button"
              data-shifts-show="${esc(staffId)}"
            >
              Anzeigen
            </button>
          </td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $$("#admin-body [data-shifts-show]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          this.showShifts(
            button.dataset.shiftsShow,
          );
        });
      },
    );
  },

  showShifts(staffId) {
    const staff = this.staff.find(
      (item) =>
        String(item.id) === String(staffId),
    );

    const shifts = this.shifts
      .filter(
        (shift) =>
          String(shift.staff_id) ===
          String(staffId),
      )
      .sort(
        (a, b) =>
          new Date(b.started_at) -
          new Date(a.started_at),
      );

    let html = `
      <div class="toolbar">
        <button
          class="btn"
          type="button"
          id="shifts-back"
        >
          Zurück
        </button>

        <span class="spacer"></span>

        <span
          class="muted"
          style="font-size:var(--text-sm)"
        >
          ${esc(staff?.name || "")}
        </span>
      </div>

      <div
        class="card"
        style="margin-top:var(--space-4)"
      >
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Start</th>
                <th>Ende</th>
                <th class="num">Dauer</th>
                <th>Auto</th>
              </tr>
            </thead>

            <tbody>
    `;

    for (const shift of shifts) {
      const duration = shift.ended_at
        ? fmtDuration(
            (
              new Date(
                shift.ended_at,
              ).getTime() -
              new Date(
                shift.started_at,
              ).getTime()
            ) / 1000,
          )
        : "—";

      html += `
        <tr>
          <td>${fmtDateTime(shift.started_at)}</td>
          <td>
            ${
              shift.ended_at
                ? fmtDateTime(shift.ended_at)
                : "—"
            }
          </td>
          <td class="num">${duration}</td>
          <td>${shift.ended_auto ? "✅" : "❌"}</td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    $("#admin-body").innerHTML = html;

    $("#shifts-back")?.addEventListener(
      "click",
      () => {
        this.tab = "dienstzeiten";
        this.paintTabs();
        this.loadTab();
      },
    );
  },
  /* ------------------------------------------------------------------------
     Einstellungen und Personalisierung
     ------------------------------------------------------------------------ */

  renderSettings() {
    const defaults = window.DEFAULT_SETTINGS || {
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

    const settings = {
      ...defaults,
      ...(State.settings || {}),
    };

    const validHex = (value, fallback) =>
      /^#[0-9a-fA-F]{6}$/.test(String(value || ""))
        ? String(value)
        : fallback;

    const validTheme = ["dark", "light", "system"].includes(
      settings.theme_mode,
    )
      ? settings.theme_mode
      : "dark";

    const validPreset = [
      "paprika",
      "red",
      "gold",
      "green",
      "blue",
      "purple",
    ].includes(settings.accent_preset)
      ? settings.accent_preset
      : "paprika";

    const validPayment =
      settings.default_payment === "card"
        ? "card"
        : "cash";

    const validSession = [15, 30, 60, 120].includes(
      Number(settings.session_timeout_minutes),
    )
      ? Number(settings.session_timeout_minutes)
      : 30;

    const presets = [
      {
        id: "paprika",
        name: "Paprika",
        color: "#e25a24",
      },
      {
        id: "red",
        name: "Rot",
        color: "#d94c58",
      },
      {
        id: "gold",
        name: "Gold",
        color: "#d89b28",
      },
      {
        id: "green",
        name: "Grün",
        color: "#55a86a",
      },
      {
        id: "blue",
        name: "Blau",
        color: "#4e8edc",
      },
      {
        id: "purple",
        name: "Lila",
        color: "#8a6bd1",
      },
    ];

    const presetHTML = presets
      .map(
        (preset) => `
          <button
            class="accent-option ${
              preset.id === validPreset ? "is-selected" : ""
            }"
            type="button"
            data-accent-option="${preset.id}"
            style="--option-color:${preset.color}"
            aria-pressed="${
              preset.id === validPreset
            }"
          >
            <span class="accent-option-dot"></span>
            <span>${esc(preset.name)}</span>
          </button>
        `,
      )
      .join("");

    $("#admin-body").innerHTML = `
      <div class="settings-layout">
        <section class="card settings-card">
          <div class="card-head">
            <div>
              <span class="card-title">Branding</span>
              <p class="settings-description">
                Name und Erscheinungsbild des Geschäfts.
              </p>
            </div>
          </div>

          <div class="settings-form">
            <div class="field">
              <label for="set-name">
                Geschäftsname
              </label>

              <input
                class="input"
                id="set-name"
                type="text"
                value="${esc(
                  String(
                    settings.business_name || "",
                  ).trim() || "Masora Döner",
                )}"
                placeholder="Masora Döner"
                autocomplete="organization"
              />
            </div>

            <div class="field">
              <label for="set-subtitle">
                Untertitel
              </label>

              <input
                class="input"
                id="set-subtitle"
                type="text"
                value="${esc(
                  String(
                    settings.business_subtitle || "",
                  ).trim() || "Kassensystem",
                )}"
                placeholder="Kassensystem"
              />
            </div>

            <div class="field">
              <label for="set-logo">
                Logo-URL
              </label>

              <input
                class="input"
                id="set-logo"
                type="url"
                value="${esc(
                  String(settings.logo_url || "").trim(),
                )}"
                placeholder="https://example.com/logo.png"
              />
            </div>
          </div>
        </section>

        <section class="card settings-card">
          <div class="card-head">
            <div>
              <span class="card-title">Erscheinung</span>
              <p class="settings-description">
                Theme und Akzentfarben der Anwendung.
              </p>
            </div>
          </div>

          <div class="settings-form">
            <div class="field">
              <label for="set-theme">
                Theme
              </label>

              <select class="select" id="set-theme">
                <option
                  value="dark"
                  ${
                    validTheme === "dark"
                      ? "selected"
                      : ""
                  }
                >
                  Dunkel
                </option>

                <option
                  value="light"
                  ${
                    validTheme === "light"
                      ? "selected"
                      : ""
                  }
                >
                  Hell
                </option>

                <option
                  value="system"
                  ${
                    validTheme === "system"
                      ? "selected"
                      : ""
                  }
                >
                  System
                </option>
              </select>
            </div>

            <div class="field">
              <label>Akzentfarbe</label>

              <div class="accent-options">
                ${presetHTML}
              </div>
            </div>

            <div class="settings-color-grid">
              <div class="field">
                <label for="set-primary-color">
                  Primärfarbe
                </label>

                <input
                  id="set-primary-color"
                  type="color"
                  value="${validHex(
                    settings.primary_color,
                    "#e95420",
                  )}"
                />
              </div>

              <div class="field">
                <label for="set-accent-color">
                  Zusatzfarbe
                </label>

                <input
                  id="set-accent-color"
                  type="color"
                  value="${validHex(
                    settings.accent_color,
                    "#e35d6a",
                  )}"
                />
              </div>
            </div>

            <label class="setting-toggle">
              <input
                id="set-compact"
                type="checkbox"
                ${
                  settings.compact_mode
                    ? "checked"
                    : ""
                }
              />

              <span class="setting-toggle-content">
                <span class="setting-toggle-title">
                  Kompakte Kassenansicht
                </span>

                <span class="setting-toggle-text">
                  Kleinere Produktkarten und Abstände verwenden.
                </span>
              </span>

              <span class="toggle-ui"></span>
            </label>
          </div>
        </section>

        <section class="card settings-card">
          <div class="card-head">
            <div>
              <span class="card-title">Kassenverhalten</span>
              <p class="settings-description">
                Lege den Ablauf beim Kassieren fest.
              </p>
            </div>
          </div>

          <div class="settings-form">
            <div class="field">
              <label for="set-payment">
                Standardzahlungsart
              </label>

              <select class="select" id="set-payment">
                <option
                  value="cash"
                  ${
                    validPayment === "cash"
                      ? "selected"
                      : ""
                  }
                >
                  Bar
                </option>

                <option
                  value="card"
                  ${
                    validPayment === "card"
                      ? "selected"
                      : ""
                  }
                >
                  Karte
                </option>
              </select>
            </div>

            <label class="setting-toggle">
              <input
                id="set-vat"
                type="checkbox"
                ${
                  settings.show_vat !== false
                    ? "checked"
                    : ""
                }
              />

              <span class="setting-toggle-content">
                <span class="setting-toggle-title">
                  MwSt. anzeigen
                </span>

                <span class="setting-toggle-text">
                  Die enthaltene Mehrwertsteuer im Warenkorb anzeigen.
                </span>
              </span>

              <span class="toggle-ui"></span>
            </label>

            <label class="setting-toggle">
              <input
                id="set-print"
                type="checkbox"
                ${
                  settings.auto_print_receipt
                    ? "checked"
                    : ""
                }
              />

              <span class="setting-toggle-content">
                <span class="setting-toggle-title">
                  Bon automatisch drucken
                </span>

                <span class="setting-toggle-text">
                  Nach dem Bezahlen automatisch den Druckdialog öffnen.
                </span>
              </span>

              <span class="toggle-ui"></span>
            </label>

            <label class="setting-toggle">
              <input
                id="set-confirm-clear"
                type="checkbox"
                ${
                  settings.confirm_cart_clear !== false
                    ? "checked"
                    : ""
                }
              />

              <span class="setting-toggle-content">
                <span class="setting-toggle-title">
                  Leeren des Warenkorbs bestätigen
                </span>

                <span class="setting-toggle-text">
                  Verhindert versehentliches Löschen einer Bestellung.
                </span>
              </span>

              <span class="toggle-ui"></span>
            </label>
          </div>
        </section>

        <section class="card settings-card">
          <div class="card-head">
            <div>
              <span class="card-title">Sicherheit</span>
              <p class="settings-description">
                Einstellungen für automatische Sitzungen.
              </p>
            </div>
          </div>

          <div class="settings-form">
            <div class="field">
              <label for="set-session">
                Automatische Abmeldung
              </label>

              <select class="select" id="set-session">
                <option
                  value="15"
                  ${
                    validSession === 15
                      ? "selected"
                      : ""
                  }
                >
                  Nach 15 Minuten
                </option>

                <option
                  value="30"
                  ${
                    validSession === 30
                      ? "selected"
                      : ""
                  }
                >
                  Nach 30 Minuten
                </option>

                <option
                  value="60"
                  ${
                    validSession === 60
                      ? "selected"
                      : ""
                  }
                >
                  Nach 60 Minuten
                </option>

                <option
                  value="120"
                  ${
                    validSession === 120
                      ? "selected"
                      : ""
                  }
                >
                  Nach 120 Minuten
                </option>
              </select>
            </div>

            <div class="settings-info">
              <span class="settings-info-icon">i</span>

              <span>
                Die Sitzung wird nach der gewählten Zeit beendet.
                Eine aktive Schicht wird dabei automatisch beendet.
              </span>
            </div>
          </div>
        </section>
      </div>

      <div class="settings-actions">
        <span
          class="muted"
          id="settings-status"
        ></span>

        <button
          class="btn btn-primary"
          id="set-save"
          type="button"
        >
          Änderungen speichern
        </button>
      </div>
    `;

    let selectedAccent = validPreset;

    const paintAccentSelection = () => {
      $$("#admin-body [data-accent-option]").forEach(
        (button) => {
          const selected =
            button.dataset.accentOption ===
            selectedAccent;

          button.classList.toggle(
            "is-selected",
            selected,
          );

          button.setAttribute(
            "aria-pressed",
            String(selected),
          );
        },
      );
    };

    $$("#admin-body [data-accent-option]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          selectedAccent =
            button.dataset.accentOption;

          const preset =
            window.ACCENT_PRESETS?.[selectedAccent];

          if (preset) {
            const primaryColor =
              $("#set-primary-color");

            const accentColor =
              $("#set-accent-color");

            if (primaryColor) {
              primaryColor.value = preset.primary;
            }

            if (accentColor) {
              accentColor.value = preset.accent;
            }
          }

          paintAccentSelection();
        });
      },
    );

    $("#set-save")?.addEventListener(
      "click",
      async () => {
        const saveButton = $("#set-save");
        const status = $("#settings-status");

        const businessName =
          $("#set-name")?.value.trim() ||
          "Masora Döner";

        const businessSubtitle =
          $("#set-subtitle")?.value.trim() ||
          "Kassensystem";

        const logoUrl =
          $("#set-logo")?.value.trim() || null;

        const themeMode =
          $("#set-theme")?.value || "dark";

        const primaryColor =
          $("#set-primary-color")?.value ||
          "#e95420";

        const accentColor =
          $("#set-accent-color")?.value ||
          "#e35d6a";

        const compactMode =
          Boolean($("#set-compact")?.checked);

        const defaultPayment =
          $("#set-payment")?.value === "card"
            ? "card"
            : "cash";

        const showVat =
          Boolean($("#set-vat")?.checked);

        const autoPrintReceipt =
          Boolean($("#set-print")?.checked);

        const confirmCartClear =
          Boolean($("#set-confirm-clear")?.checked);

        const sessionTimeout =
          Number($("#set-session")?.value) || 30;

        try {
          if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = "Speichert …";
          }

          const saved =
            await DB.updateSettings({
              business_name: businessName,
              business_subtitle: businessSubtitle,
              logo_url: logoUrl,
              theme_mode: themeMode,
              accent_preset: selectedAccent,
              primary_color: primaryColor,
              accent_color: accentColor,
              compact_mode: compactMode,
              default_payment: defaultPayment,
              show_vat: showVat,
              auto_print_receipt: autoPrintReceipt,
              confirm_cart_clear: confirmCartClear,
              session_timeout_minutes: sessionTimeout,
            });

          State.settings = {
            ...(window.DEFAULT_SETTINGS || {}),
            ...saved,
          };

          if (
            window.App &&
            typeof App.applySettings === "function"
          ) {
            App.applySettings();
          } else {
            App.paintBrand?.();
            App.paintTheme?.();
            App.paintLogo?.();
          }

          if (Duty?.isOn?.()) {
            Duty.startSession();
          }

          if (status) {
            status.textContent =
              "Änderungen gespeichert";
          }

          toast("Personalisierung gespeichert");
        } catch (error) {
          fail(error);

          if (status) {
            status.textContent =
              "Speichern fehlgeschlagen";
          }
        } finally {
          if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent =
              "Änderungen speichern";
          }
        }
      },
    );

    paintAccentSelection();
  },
  /* ------------------------------------------------------------------------
     Tagesabschluss (Z-Bericht)
     ------------------------------------------------------------------------ */

  closingDate: null, // "YYYY-MM-DD", null = heute

  localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },

  async loadClosing() {
    const key = this.closingDate || this.localDateKey();
    const [y, m, d] = key.split("-").map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0, 0);
    const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    const orders = await DB.listOrders({
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 2000,
    });

    this.renderClosing(orders, key);
  },

  /** Alle Kennzahlen des Tages berechnen. */
  closingReport(orders) {
    const valid = orders.filter((o) => o.status !== "storniert");
    const cancelled = orders.filter((o) => o.status === "storniert");
    const sum = (list, field = "total") =>
      num(list.reduce((t, o) => t + (Number(o[field]) || 0), 0));

    const cash = valid.filter((o) => o.payment_method === "bar");
    const card = valid.filter((o) => o.payment_method === "karte");

    // MwSt. je Satz über alle Bons
    const vatMap = new Map();
    valid.forEach((o) => {
      vatBreakdown(o.items, o.subtotal, o.total).forEach((g) => {
        const e = vatMap.get(g.rate) || { rate: g.rate, gross: 0, vat: 0 };
        e.gross = num(e.gross + g.gross);
        e.vat = num(e.vat + g.vat);
        vatMap.set(g.rate, e);
      });
    });

    // Rabatte & Kooperationen
    const discMap = new Map();
    valid
      .filter((o) => Number(o.discount_amount) > 0)
      .forEach((o) => {
        const key = `${o.discount_source === "kooperation" ? "Kooperation" : "Rabatt"}: ${o.discount_name || "ohne Name"}`;
        const e = discMap.get(key) || { name: key, count: 0, amount: 0 };
        e.count += 1;
        e.amount = num(e.amount + Number(o.discount_amount));
        discMap.set(key, e);
      });

    // Mitarbeiter
    const staffMap = new Map();
    valid.forEach((o) => {
      const key = o.staff_name || "Ohne Zuordnung";
      const e = staffMap.get(key) || { name: key, count: 0, revenue: 0 };
      e.count += 1;
      e.revenue = num(e.revenue + Number(o.total));
      staffMap.set(key, e);
    });

    // Artikel
    const itemMap = new Map();
    valid.forEach((o) =>
      (o.items || []).forEach((i) => {
        const e = itemMap.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
        e.qty += Number(i.qty) || 0;
        e.revenue = num(e.revenue + Number(i.line_total || 0));
        itemMap.set(i.name, e);
      }),
    );

    return {
      valid,
      cancelled,
      revenue: sum(valid),
      cash: sum(cash),
      card: sum(card),
      cashCount: cash.length,
      cardCount: card.length,
      discounts: sum(valid, "discount_amount"),
      cancelledSum: sum(cancelled),
      avg: valid.length ? num(sum(valid) / valid.length) : 0,
      vat: [...vatMap.values()].sort((x, y) => y.rate - x.rate),
      discList: [...discMap.values()].sort((x, y) => y.amount - x.amount),
      staffList: [...staffMap.values()].sort((x, y) => y.revenue - x.revenue),
      itemList: [...itemMap.values()].sort((x, y) => y.qty - x.qty),
    };
  },

  renderClosing(orders, dateKey) {
    const r = this.closingReport(orders);
    const [y, m, d] = dateKey.split("-").map(Number);
    const dayLabel = new Date(y, m - 1, d).toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const isToday = dateKey === this.localDateKey();
    const shop = State.settings?.business_name || "Masora Döner";

    const rows = (list, cols) =>
      list.length
        ? list.map(cols).join("")
        : `<tr><td colspan="4" class="muted" style="text-align:center;padding:var(--space-6)">Keine Daten</td></tr>`;

    $("#admin-body").innerHTML = `
      <div class="toolbar" style="margin-bottom:var(--space-4)">
        <label class="muted small" for="cl-date">Tag</label>
        <input class="input" id="cl-date" type="date" value="${dateKey}" max="${this.localDateKey()}" style="min-width:160px">
        <button class="btn btn-sm" id="cl-today" type="button" ${isToday ? "disabled" : ""}>Heute</button>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="cl-csv" type="button">CSV</button>
        <button class="btn btn-sm btn-primary" id="cl-print" type="button">Drucken</button>
      </div>

      <div class="print-area" id="closing-print">
        <h2 style="margin-bottom:4px">Tagesabschluss — ${esc(shop)}</h2>
        <p class="muted" style="margin-bottom:var(--space-4)">${esc(dayLabel)}${isToday ? " (heute, Stand " + fmtTime(new Date().toISOString()) + ")" : ""}</p>

        <div class="stats">
          <div class="stat accent"><div class="stat-label">Umsatz</div><div class="stat-value">${money(r.revenue)}</div></div>
          <div class="stat"><div class="stat-label">Bar (${r.cashCount})</div><div class="stat-value">${money(r.cash)}</div></div>
          <div class="stat"><div class="stat-label">Karte (${r.cardCount})</div><div class="stat-value">${money(r.card)}</div></div>
          <div class="stat"><div class="stat-label">Bons</div><div class="stat-value">${r.valid.length}</div></div>
          <div class="stat"><div class="stat-label">Ø pro Bon</div><div class="stat-value">${money(r.avg)}</div></div>
          <div class="stat"><div class="stat-label">Rabatte</div><div class="stat-value">${money(r.discounts)}</div></div>
          <div class="stat"><div class="stat-label">Stornos (${r.cancelled.length})</div><div class="stat-value ${r.cancelled.length ? "text-error" : ""}">${money(r.cancelledSum)}</div></div>
        </div>

        <div class="settings-layout" style="margin-top:var(--space-4)">
          <section class="card">
            <div class="card-head"><span class="card-title">Mehrwertsteuer</span></div>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Satz</th><th class="num">Brutto</th><th class="num">Netto</th><th class="num">Steuer</th></tr></thead>
              <tbody>${rows(
                r.vat,
                (g) => `<tr><td>${Math.round(g.rate * 100)} %</td><td class="num">${money(g.gross)}</td><td class="num">${money(g.gross - g.vat)}</td><td class="num">${money(g.vat)}</td></tr>`,
              )}</tbody>
            </table></div>
          </section>

          <section class="card">
            <div class="card-head"><span class="card-title">Bargeld-Kontrolle</span></div>
            <div class="settings-form">
              <div class="field">
                <label for="cl-float">Wechselgeld-Anfangsbestand (€)</label>
                <input class="input" id="cl-float" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00">
              </div>
              <div class="field">
                <label for="cl-counted">Gezähltes Bargeld in der Kasse (€)</label>
                <input class="input" id="cl-counted" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Nach dem Zählen eintragen">
              </div>
              <div class="change-box" id="cl-diff" style="margin-bottom:var(--space-4)">
                <span class="change-label" id="cl-diff-label">Soll ${money(r.cash)}</span>
                <span class="change-value" id="cl-diff-value">—</span>
              </div>
            </div>
          </section>
        </div>

        <div class="settings-layout" style="margin-top:var(--space-4)">
          <section class="card">
            <div class="card-head"><span class="card-title">Umsatz je Mitarbeiter</span></div>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Mitarbeiter</th><th class="num">Bons</th><th class="num">Umsatz</th><th></th></tr></thead>
              <tbody>${rows(
                r.staffList,
                (e) => `<tr><td>${esc(e.name)}</td><td class="num">${e.count}</td><td class="num">${money(e.revenue)}</td><td></td></tr>`,
              )}</tbody>
            </table></div>
          </section>

          <section class="card">
            <div class="card-head"><span class="card-title">Rabatte &amp; Kooperationen</span></div>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Art</th><th class="num">Bons</th><th class="num">Betrag</th><th></th></tr></thead>
              <tbody>${rows(
                r.discList,
                (e) => `<tr><td>${esc(e.name)}</td><td class="num">${e.count}</td><td class="num">− ${money(e.amount)}</td><td></td></tr>`,
              )}</tbody>
            </table></div>
          </section>
        </div>

        <section class="card" style="margin-top:var(--space-4)">
          <div class="card-head"><span class="card-title">Artikel</span></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Artikel</th><th class="num">Menge</th><th class="num">Umsatz</th><th></th></tr></thead>
            <tbody>${rows(
              r.itemList,
              (e) => `<tr><td>${esc(e.name)}</td><td class="num">${e.qty}</td><td class="num">${money(e.revenue)}</td><td></td></tr>`,
            )}</tbody>
          </table></div>
        </section>
      </div>
    `;

    // Bargeld-Kontrolle live berechnen
    const diffBox = $("#cl-diff");
    const updateDiff = () => {
      const start = parseFloat($("#cl-float").value) || 0;
      const countedRaw = $("#cl-counted").value;
      const soll = num(start + r.cash);
      $("#cl-diff-label").textContent = `Soll ${money(soll)}`;

      if (countedRaw === "") {
        $("#cl-diff-value").textContent = "—";
        diffBox.classList.remove("negative");
        return;
      }

      const diff = num(parseFloat(countedRaw) - soll);
      $("#cl-diff-value").textContent =
        (diff > 0 ? "+ " : diff < 0 ? "− " : "") + money(Math.abs(diff));
      diffBox.classList.toggle("negative", Math.abs(diff) >= 0.01);
    };
    $("#cl-float").addEventListener("input", updateDiff);
    $("#cl-counted").addEventListener("input", updateDiff);

    $("#cl-date").addEventListener("change", (e) => {
      this.closingDate = e.target.value || null;
      this.loadTab();
    });
    $("#cl-today").addEventListener("click", () => {
      this.closingDate = null;
      this.loadTab();
    });
    $("#cl-print").addEventListener("click", () => window.print());
    $("#cl-csv").addEventListener("click", () => this.exportClosingCsv(r, dateKey));
  },

  exportClosingCsv(r, dateKey) {
    const dec = (n) => String(num(n)).replace(".", ",");
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Tagesabschluss", dateKey],
      ["Umsatz", dec(r.revenue)],
      ["Bar", dec(r.cash)],
      ["Karte", dec(r.card)],
      ["Bons", r.valid.length],
      ["Rabatte", dec(r.discounts)],
      ["Stornos (Anzahl)", r.cancelled.length],
      ["Stornos (Summe)", dec(r.cancelledSum)],
      [],
      ["MwSt-Satz", "Brutto", "Netto", "Steuer"],
      ...r.vat.map((g) => [`${Math.round(g.rate * 100)} %`, dec(g.gross), dec(g.gross - g.vat), dec(g.vat)]),
      [],
      ["Artikel", "Menge", "Umsatz"],
      ...r.itemList.map((e) => [e.name, e.qty, dec(e.revenue)]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n");

    const url = URL.createObjectURL(
      new Blob(["﻿" + lines], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `tagesabschluss-${dateKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  bind() {
    $("#admin-subnav")?.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          "button[data-tab]",
        );

        if (!button || button.classList.contains("hidden")) {
          return;
        }

        this.tab = button.dataset.tab;
        this.paintTabs();
        this.loadTab();
      },
    );
  },
};

window.Admin = Admin;
