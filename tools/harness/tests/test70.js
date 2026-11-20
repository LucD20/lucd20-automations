const { chromium } = require("playwright");
const assert = require("assert");

/** v0.82.0: Sell (half price per item, stacks, chat line) and Sell all equipment on loot sheets. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    const out = {};
    // PF2e's Coins, enough of it: denominations, copperValue, plus, scale (with spillover), fromPrice, toString.
    class Coins {
      constructor(d = {}) { this.pp = d.pp ?? 0; this.gp = d.gp ?? 0; this.sp = d.sp ?? 0; this.cp = d.cp ?? 0; }
      get copperValue() { return this.pp * 1000 + this.gp * 100 + this.sp * 10 + this.cp; }
      plus(o) { return new Coins({ pp: this.pp + (o.pp ?? 0), gp: this.gp + (o.gp ?? 0), sp: this.sp + (o.sp ?? 0), cp: this.cp + (o.cp ?? 0) }); }
      scale(f) { const c = Math.floor(this.copperValue * f); return new Coins({ gp: Math.floor(c / 100), sp: Math.floor((c % 100) / 10), cp: c % 10 }); }
      static fromPrice(price, factor) { return new Coins(price.value).scale(factor / (price.per ?? 1)); }
      toString() { const p = []; for (const d of ["pp", "gp", "sp", "cp"]) if (this[d]) p.push(`${this[d]} ${d}`); return p.join(", ") || "0 gp"; }
    }
    const posted = [];
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { posted.push(d); return d; } };
    const { DialogV2 } = foundry.applications.api;
    let prompted = null, confirmed = null;
    DialogV2.prompt = async opts => { prompted = opts; return 2; };
    DialogV2.confirm = async opts => { confirmed = opts; return true; };
    const mkActor = (type) => {
      const a = { type, isOwner: true, purse: new Coins(), items: null };
      a.inventory = { addCurrency: async c => { a.purse = a.purse.plus(c); } };
      a.items = [];
      a.items.get = function (id) { return this.find(i => i.id === id); };
      Object.defineProperty(a.items, "contents", { get() { return [...this]; } });
      a.updateEmbeddedDocuments = async (_, ups) => { for (const u of ups) a.items.get(u._id).system.containerId = u["system.containerId"]; };
      a.deleteEmbeddedDocuments = async (_, ids) => { for (const id of ids) a.items.splice(a.items.findIndex(i => i.id === id), 1); };
      return a;
    };
    const mkItem = (actor, id, name, type, gp, qty = 1, extra = {}) => {
      const it = { id, name, type, actor, system: { quantity: qty, containerId: extra.containerId ?? null }, sourceId: extra.sourceId ?? null,
        get quantity() { return this.system.quantity; }, price: { value: { gp } },
        get assetValue() { return Coins.fromPrice(this.price, this.system.quantity); },
        isOfType(t) { return t === "physical" || t === this.type; },
        async delete() { actor.items.splice(actor.items.indexOf(this), 1); }, async update(u) { if ("system.quantity" in u) this.system.quantity = u["system.quantity"]; } };
      actor.items.push(it);
      return it;
    };
    const sell = await import(`/modules/${M}/scripts/systems/pf2e/sell.js`);
    await game.settings.set(M, "pf2eSell_enabled", true);
    await settle();

    // A character sheet: icons on a sword and a stack of rations, not on a gem (treasure).
    const kyra = mkActor("character");
    mkItem(kyra, "sw", "Longsword", "weapon", 1, 1, { sourceId: "Compendium.pf2e.equipment-srd.Item.sword" });
    mkItem(kyra, "ra", "Rations", "consumable", 0.4, 5);
    mkItem(kyra, "gem", "Gem", "treasure", 50);
    const sheetHtml = id => `<li data-item-id="${id}"><div class="item-controls"><a data-action="edit-item"></a><a data-action="delete-item"></a></div></li>`;
    const root = document.createElement("form");
    root.innerHTML = `<ul class="coinage"><li><button data-action="add-coins"></button></li><li><button data-action="sell-all-treasure"></button></li></ul><ol>${["sw", "ra", "gem"].map(sheetHtml).join("")}</ol>`;
    document.body.append(root);
    Hooks.callAll("renderActorSheetPF2e", { actor: kyra }, [root]);
    out.icons = [...root.querySelectorAll(".lucd20-sell")].map(a => a.closest("[data-item-id]").dataset.itemId);
    out.tooltip = root.querySelector('[data-item-id="sw"] .lucd20-sell')?.dataset.tooltip;
    out.beforeEdit = root.querySelector('[data-item-id="sw"] .lucd20-sell')?.nextElementSibling?.dataset.action;
    // Sell the sword (no question), then 2 of the 5 rations (asked).
    root.querySelector('[data-item-id="sw"] .lucd20-sell').click();
    await settle();
    root.querySelector('[data-item-id="ra"] .lucd20-sell').click();
    await settle();
    out.kyraItems = kyra.items.map(i => `${i.id}:${i.system.quantity}`);
    out.purse = kyra.purse.toString();
    out.asked = !!prompted;
    out.askedSingle = prompted?.content?.includes("hidden") ? "stack" : "?";
    // The Sell items button next to Sell all treasure; the window sells several at once (after a confirmation).
    const sellBtn = root.querySelector(".lucd20-sell-items-btn");
    out.itemsBtnAfterTreasure = sellBtn?.closest("li")?.previousElementSibling?.querySelector('[data-action="sell-all-treasure"]') != null;
    mkItem(kyra, "ar", "Arrows", "consumable", 0.1, 10);
    mkItem(kyra, "dg", "Dagger", "weapon", 0.2, 1);
    out.lines = posted.map(p => p.content.replace(/<[^>]+>/g, "").trim());
    posted.length = 0;
    sellBtn.click();
    await settle(150);
    const win = foundry.applications.instances.get("lucd20-sell-window")?.element;
    out.windowRows = [...(win?.querySelectorAll(".lucd20-sell-row .name") ?? [])].map(n => n.textContent);
    const row = id => win.querySelector(`.lucd20-sell-row[data-item-id="${id}"]`);
    row("ar").querySelector("input.qty").value = "4";
    row("ar").querySelector("input.pick").checked = true;
    row("ar").querySelector("input.pick").dispatchEvent(new Event("change"));
    await settle(100);
    const win2 = foundry.applications.instances.get("lucd20-sell-window").element;
    win2.querySelector('.lucd20-sell-row[data-item-id="dg"] input.pick').checked = true;
    win2.querySelector('.lucd20-sell-row[data-item-id="dg"] input.pick').dispatchEvent(new Event("change"));
    await settle(100);
    const win3 = foundry.applications.instances.get("lucd20-sell-window").element;
    out.windowTotal = win3.querySelector(".lucd20-sell-total")?.textContent.replace(/\s+/g, " ").trim();
    win3.querySelector('[data-action="sell"]').click();
    await settle(200);
    out.afterWindow = kyra.items.map(i => `${i.id}:${i.system.quantity}`);
    out.windowChat = posted[0]?.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // A loot sheet: Sell all equipment next to Sell all treasure; treasure kept, taken out of a sold bag.
    const pile = mkActor("loot");
    mkItem(pile, "bag", "Backpack", "backpack", 0.1);
    mkItem(pile, "rope", "Rope", "equipment", 0.5, 2, { containerId: "bag" });
    mkItem(pile, "ring", "Silver Ring", "treasure", 10, 1, { containerId: "bag" });
    mkItem(pile, "junk", "Rock", "equipment", 0);
    const lroot = document.createElement("form");
    lroot.innerHTML = `<ul class="coinage"><li><button data-action="sell-all-treasure"></button></li></ul>`;
    document.body.append(lroot);
    Hooks.callAll("renderActorSheetPF2e", { actor: pile }, [lroot]);
    const btn = lroot.querySelector(".lucd20-sell-all-btn");
    out.sellAllAfterTreasure = btn?.closest("li")?.previousElementSibling?.querySelector('[data-action="sell-all-treasure"]') != null;
    posted.length = 0;
    btn.click();
    await settle(150);
    out.confirmText = confirmed?.content?.replace(/<[^>]+>/g, "");
    out.pileItems = pile.items.map(i => `${i.id}:${i.system.containerId ?? "-"}`);
    out.pilePurse = pile.purse.toString();
    out.allLine = posted[0]?.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.icons, ["sw", "ra"], "no icon on treasure");
  assert.strictEqual(r.tooltip, "Sell for 5 sp (half price)");
  assert.strictEqual(r.beforeEdit, "edit-item", "placed before the edit control");
  assert.deepStrictEqual(r.kyraItems, ["ra:3", "gem:1"], "sword sold, 2 rations sold");
  assert.strictEqual(r.purse, "9 sp", "1 gp sword → 5 sp; 2 rations at 4 sp each (8 sp) → 4 sp");
  assert.ok(r.asked, "a sale asks first (a stack: how many)");
  assert.ok(r.itemsBtnAfterTreasure, "Sell items next to Sell all treasure");
  assert.deepStrictEqual(r.windowRows, ["Arrows", "Dagger", "Rations"], "the window lists sellable priced items");
  assert.strictEqual(r.windowTotal, "Total: 3 sp (half price)", "4 arrows at 1 sp (2 sp) + a dagger at 2 sp (1 sp)");
  assert.deepStrictEqual(r.afterWindow, ["ra:3", "gem:1", "ar:6"], "4 arrows and the dagger sold");
  assert.ok(r.windowChat.startsWith("Sold 2 items for 3 sp."), r.windowChat);
  assert.deepStrictEqual(r.lines, ["@UUID[Compendium.pf2e.equipment-srd.Item.sword]{Longsword}: sold for 5 sp", "Rations ×2: sold for 4 sp"]);
  assert.ok(r.sellAllAfterTreasure, "Sell all equipment next to Sell all treasure");
  assert.strictEqual(r.confirmText, "Sell 2 items (everything but treasure and coins) for 5 sp, 5 cp?", "backpack 5 cp + rope ×2 5 sp; the free rock skipped");
  assert.deepStrictEqual(r.pileItems, ["ring:-", "junk:-"], "treasure kept and taken out of the sold bag; unpriced kept");
  assert.strictEqual(r.pilePurse, "5 sp, 5 cp");
  assert.ok(r.allLine.startsWith("Sold 2 items for 5 sp, 5 cp."));
  console.log("PHASE 70 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
