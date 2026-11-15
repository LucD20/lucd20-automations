const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

async function setup(page, userId) {
  await page.evaluate(userId => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    const coll = arr => {
      arr.get = function (id) { return this.find(x => x.id === id); };
      Object.defineProperty(arr, "size", { get() { return this.length; } });
      return arr;
    };
    class MockItem {
      constructor(data, parent) { Object.assign(this, foundry.utils.deepClone(data)); this.id ??= Math.random().toString(36).slice(2, 10); this.flags ??= {}; this.system ??= {}; this.parent = parent; }
      get sheet() { return { render: () => { window.__itemSheet = this.name; } }; }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
      isOfType(t) { return t === "physical" && ["weapon", "armor", "equipment", "consumable", "treasure"].includes(this.type); }
      toObject() { const { parent, ...rest } = this; return foundry.utils.deepClone({ ...rest, _id: this.id }); }
      async update(d) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); Hooks.callAll("updateItem", this, d); }
      async delete() { const list = this.parent.items; list.splice(list.indexOf(this), 1); Hooks.callAll("deleteItem", this); }
    }
    let actorN = 0;
    class MockActor {
      constructor(data) {
        Object.assign(this, { id: data.id ?? `a${++actorN}`, name: data.name, type: data.type ?? "npc", img: data.img ?? "icons/svg/mystery-man.svg",
          flags: data.flags ?? {}, system: data.system ?? {}, owners: data.owners ?? [], hasPlayerOwner: !!data.owners?.length, prototypeToken: data.prototypeToken ?? {} });
        this.uuid = `Actor.${this.id}`;
        this.documentName = "Actor";
        this.items = coll((data.items ?? []).map(i => new MockItem(i, this)));
        this.level = data.level;
        registry[this.uuid] = this;
        this.sheet = { render: () => { window.__sheetOpened = this.name; } };
      }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
      async update(d) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); Hooks.callAll("updateActor", this, d); }
      get isOwner() { return game.user.isGM || this.owners.includes(game.user.id); }
      testUserPermission(u, lvl) { return u.isGM || this.owners.includes(u.id); }
      async createEmbeddedDocuments(type, data) { const made = data.map(d => new MockItem(d, this)); this.items.push(...made); made.forEach(i => Hooks.callAll("createItem", i)); return made; }
      async deleteEmbeddedDocuments(type, ids) { for (const id of ids) { const i = this.items.get(id); this.items.splice(this.items.indexOf(i), 1); } }
      async getTokenDocument(o) { return { toObject: () => ({ actorId: this.id, name: this.name, ...o }) }; }
      async delete() { game.actors.splice(game.actors.indexOf(this), 1); Hooks.callAll("deleteActor", this); }
    }
    window.Actor = { create: async d => { const a = new MockActor(d); game.actors.push(a); window.__createdActor = d; return a; } };
    window.Folder = { create: async d => { const f = { id: "f1", ...d }; game.folders.push(f); return f; } };
    game.folders = [];
    const scene = { id: "s1", grid: { size: 100 }, tokens: coll([]),
      async createEmbeddedDocuments(t, data) { for (const d of data) this.tokens.push({ id: "t" + this.tokens.length, ...d }); window.__pileToken = data[0]; },
      async deleteEmbeddedDocuments(t, ids) { for (const id of ids) this.tokens.splice(this.tokens.findIndex(x => x.id === id), 1); } };
    game.scenes = [scene];
    window.canvas = { ready: true, scene, dimensions: { size: 100, width: 1000, height: 600 }, tokens: { placeables: [] } };
    window.CONST.DOCUMENT_OWNERSHIP_LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
    window.CONST.TOKEN_DISPLAY_MODES = { HOVER: 30 };
    window.CONFIG.Actor = { typeLabels: { character: "", npc: "", loot: "", party: "" } };
    game.user.id = userId;
    game.users = Object.assign([{ id: "u1", name: "Gamemaster", isGM: true }, { id: "p1", name: "Alice", isGM: false }, { id: "p2", name: "Bruno", isGM: false }, { id: "p3", name: "Cara", isGM: false }],
      { get(id) { return this.find(u => u.id === id); } });
    game.users.activeGM = { query: (name, data) => CONFIG.queries[name](data) };
    window.__chat = [];
    window.ChatMessage = { create: async d => window.__chat.push(d.content.replace(/<[^>]+>/g, "").trim()) };

    const amiri = new MockActor({ id: "amiri", name: "Amiri", type: "character", owners: ["p1"], items: [{ name: "Gold Pieces", type: "treasure", system: { quantity: 5, stackGroup: "coins" } }] });
    const ezren = new MockActor({ id: "ezren", name: "Ezren", type: "character", owners: ["p2"] });
    const party = new MockActor({ id: "party", name: "The Party", type: "party" });
    const goblin = new MockActor({ id: "goblin", name: "Goblin Warrior", level: -1, items: [
      { name: "Dogslicer", type: "weapon" }, { name: "Leather Armor", type: "armor" }, { name: "Dogslicer Strike", type: "melee" },
      { name: "Gold Pieces", type: "treasure", system: { quantity: 3, stackGroup: "coins" } }, { name: "Sneak Attack", type: "action" }] });
    const boss = new MockActor({ id: "boss", name: "Goblin Boss", level: 1, items: [
      { name: "Healing Potion (Minor)", type: "consumable", system: { quantity: 2 } }, { name: "Ring of Climbing", type: "equipment" }] });
    const alive = new MockActor({ id: "alive", name: "Fleeing Goblin", level: -1, items: [{ name: "Shortbow", type: "weapon" }] });
    game.actors = coll([amiri, ezren, party, goblin, boss, alive]);
    game.actors.party = party;
    party.members = [amiri, ezren];
    game.user.character = userId === "p1" ? amiri : userId === "p2" ? ezren : null;
    const tok = (actor, x, y, w = 1) => ({ x, y, width: w, height: w, name: actor.name, texture: { src: actor.img } });
    window.__combat = { scene, combatants: [
      { actor: amiri, isDefeated: false, token: tok(amiri, 100, 100) },
      { actor: goblin, isDefeated: true, token: { ...tok(goblin, 400, 200), playersCanSeeName: false } },
      { actor: boss, isDefeated: true, token: tok(boss, 600, 200, 2) },
      { actor: alive, isDefeated: false, token: tok(alive, 800, 300) }
    ] };
    window.__A = { amiri, ezren, party, goblin, boss };
    foundry.applications.api.DialogV2.prompt = async opts => {
      const form = document.createElement("form"); form.innerHTML = opts.content; window.__promptPrep?.(form);
      return opts.ok.callback(new Event("click"), { form });
    };
    window.__dialogMode = undefined;
  }, userId);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (q, userId) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    page.on("console", m => m.text().startsWith("STEP") && console.log(m.text()));
    page.on("pageerror", e => { errors.push(`${q}: ${e.message}`); console.log("PAGEERROR", e.message, e.stack?.split("\n")[1]); });
    page.on("console", m => (m.type() === "error" || m.text().startsWith("NOTIFY")) && console.log("CONSOLE", m.text().slice(0, 300)));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await setup(page, userId);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  // ================= GM: combat ends =================
  let page = await open("gm=1&system=pf2e", "u1");
  await set(page, "lootPile_enabled", true);
  await page.evaluate(() => Hooks.callAll("deleteCombat", __combat));
  await page.waitForTimeout(300);
  const R = ".lucd20-loot-review-dialog";
  await page.evaluate(r => { const w = document.querySelector(r); Object.assign(w.style, { left: "20px", top: "20px" }); }, R);
  const order = await page.$$eval(`${R} .npc`, e => e.map(x => x.textContent));
  console.log("review groups:", order);
  assert.deepStrictEqual(order, ["Goblin Boss", "Goblin Warrior"], "highest level first; only defeated NPCs");
  const reviewText = await page.$eval(R, e => e.textContent);
  assert.ok(!reviewText.includes("Strike") && !reviewText.includes("Sneak Attack") && !reviewText.includes("Shortbow"), "no strikes/actions; living NPCs excluded");
  const summary = () => page.$eval(`${R} [data-summary]`, e => e.textContent);
  assert.strictEqual(await summary(), "5 of 5 items selected");
  // uncheck Leather Armor: struck through, group "2 of 3", header toggle shows "some"
  await page.evaluate(r => [...document.querySelectorAll(`${r} .lucd20-loot-check`)].find(l => l.textContent.includes("Leather")).querySelector("input").click(), R);
  assert.strictEqual(await summary(), "4 of 5 items selected");
  const warrior = await page.evaluate(r => { const g = document.querySelectorAll(`${r} [data-group]`)[1]; const t = g.querySelector("[data-group-toggle]");
    const leather = [...g.querySelectorAll(".lucd20-loot-check")].find(l => l.textContent.includes("Leather")).querySelector(".name");
    return { count: g.querySelector("[data-group-count]").textContent, ind: t.indeterminate, checked: t.checked, strike: getComputedStyle(leather).textDecorationLine }; }, R);
  assert.deepStrictEqual(warrior, { count: "2 of 3", ind: true, checked: false, strike: "line-through" });
  await page.screenshot({ path: `${out}/p11-review.png`, clip: { x: 0, y: 0, width: 470, height: 600 } });
  // select none for the boss → toggles every row; nothing selected → Create disabled
  await page.evaluate(r => document.querySelectorAll(`${r} [data-group-toggle]`)[0].click(), R);
  await page.evaluate(r => document.querySelectorAll(`${r} [data-group-toggle]`)[1].click(), R); // some → all
  await page.evaluate(r => document.querySelectorAll(`${r} [data-group-toggle]`)[1].click(), R); // all → none
  assert.strictEqual(await summary(), "0 of 5 items selected");
  assert.ok(await page.$eval(`${R} [data-action="create"]`, b => b.disabled), "Create disabled with nothing selected");
  await page.evaluate(r => { for (const t of document.querySelectorAll(`${r} [data-group-toggle]`)) t.click(); }, R);
  await page.evaluate(r => [...document.querySelectorAll(`${r} .lucd20-loot-check`)].find(l => l.textContent.includes("Leather")).querySelector("input").click(), R);
  await page.click(`${R} [data-action="create"]`);
  await page.waitForTimeout(300);
  // hidden NPC name decided on the GM side: no name/art stored on its items
  const src = await page.evaluate(() => game.actors.find(a => a.getFlag("lucd20-automations", "lootPile")).items.find(i => i.name === "Dogslicer").flags["lucd20-automations"].source);
  console.log("hidden source:", JSON.stringify(src));
  assert.ok(src.hidden && !("name" in src) && !("img" in src), "real name and art not stored for a hidden NPC");

  const pile = await page.evaluate(() => { const p = game.actors.find(a => a.getFlag("lucd20-automations", "lootPile")); return { type: p.type, items: p.items.map(i => i.name).sort(), token: __pileToken, folder: game.folders[0]?.name }; });
  console.log("pile:", JSON.stringify(pile));
  assert.strictEqual(pile.type, "loot", "PF2e native loot actor");
  assert.deepStrictEqual(pile.items, ["Dogslicer", "Gold Pieces", "Healing Potion (Minor)", "Ring of Climbing"]);
  assert.deepStrictEqual([pile.token.x, pile.token.y], [500, 200], "centre of the dead NPCs, snapped");
  assert.strictEqual(pile.folder, "Loot Piles");
  assert.deepStrictEqual(await page.evaluate(() => __A.goblin.items.map(i => i.name).sort()), ["Dogslicer Strike", "Leather Armor", "Sneak Attack"], "moved off the NPC; unchecked item stays");

  // double-click the pile token → Loot window
  await page.evaluate(() => { const p = game.actors.find(a => a.getFlag("lucd20-automations", "lootPile")); window.__pile = p; new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {}); });
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible(".lucd20-loot-window"));
  assert.deepStrictEqual(await page.$$eval(".lucd20-loot-window .npc", e => e.map(x => x.textContent)), ["Goblin Boss", "Goblin Warrior"], "GM sees the real name");
  assert.strictEqual(await page.$$eval(".lucd20-loot-window .lucd20-loot-taker", e => e.length), 0, "the GM claims for nobody: no character bar");
  assert.deepStrictEqual(await page.$$eval(".lucd20-loot-window .lucd20-loot-item .name", e => e.map(x => x.textContent)), ["Healing Potion (Minor)", "Ring of Climbing", "Dogslicer"], "coins are not item rows");
  assert.strictEqual(await page.$eval(".lucd20-loot-window .lucd20-loot-coins", e => e.textContent.replace(/\s+/g, " ").trim()), "Coins3 gp Split evenly Custom split", "coins are one row at the top, with the GM's split buttons");
  assert.deepStrictEqual(await page.$$eval(".lucd20-loot-window .ll-row", e => [...e[0].querySelectorAll(".actions button")].map(b => b.dataset.action)), ["give", "stash"], "unasked items: Give to… and Party Stash");
  await page.evaluate(() => { const w = document.querySelector(".lucd20-loot-window"); w.style.left = "20px"; w.style.top = "20px"; });
  await page.screenshot({ path: `${out}/p11-gm-window.png` });
  // a normal token still opens its sheet
  await page.evaluate(() => { window.__sheetOpened = false; new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: __A.goblin }, {}); });
  assert.strictEqual(await page.evaluate(() => window.__sheetOpened), true);
  // GM: Open sheet
  await page.click('[data-action="openSheet"]');
  assert.strictEqual(await page.evaluate(() => window.__sheetOpened), "Loot Pile");

  const pileState = await page.evaluate(() => ({ items: __pile.items.map(i => i.toObject()), id: __pile.id }));

  // ================= Player: asks, does not take =================
  page = await open("gm=0&system=pf2e", "p1");
  await set(page, "lootPile_enabled", true);
  await page.evaluate(async st => {
    const p = await Actor.create({ name: "Loot Pile", type: "loot", flags: { "lucd20-automations": { lootPile: true } }, owners: [] });
    p.items.length = 0;
    await p.createEmbeddedDocuments("Item", st.items);
    window.__pile = p;
    window.__loot = await import("/modules/lucd20-automations/scripts/features/loot-pile.js");
    // One page plays every user: who() switches who is at the keyboard.
    window.who = id => { const u = game.users.get(id); Object.assign(game.user, { id, name: u.name, isGM: u.isGM, isActiveGM: u.isGM, character: id === "p1" ? __A.amiri : id === "p2" ? __A.ezren : null });
      return foundry.applications.instances.get("lucd20-loot-" + __pile.id)?.render(); };
    window.ask = (senderId, payload) => CONFIG.queries["lucd20-automations.gm"]({ type: "lootPile.request", payload: { pileUuid: __pile.uuid, ...payload }, senderId });
    window.itemId = name => __pile.items.find(i => i.name.includes(name)).id;
    game.user.name = "Alice";
    new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {});
  }, pileState);
  await page.waitForTimeout(200);
  const W = ".lucd20-loot-window";
  await page.evaluate(w => Object.assign(document.querySelector(w).style, { left: "20px", top: "20px" }), W);
  assert.strictEqual(await page.$eval(".lucd20-loot-taker-chip strong", o => o.textContent), "Amiri", "one character: static chip");
  const names = await page.$$eval(`${W} .npc`, e => e.map(x => x.textContent));
  assert.deepStrictEqual(names, ["Goblin Boss", "Unknown creature"], "hidden NPC name for players");
  assert.ok(await page.$eval(`${W} .lucd20-loot-group:nth-child(2) .lucd20-loot-portrait img`, i => i.getAttribute("src") === "icons/svg/mystery-man.svg"), "neutral placeholder portrait");
  assert.strictEqual(await page.$$eval('[data-action="openSheet"], [data-action="deletePile"], [data-action="splitEven"], [data-action="approve"], [data-action="give"], [data-action="approveAll"]', e => e.length), 0, "no GM buttons");
  assert.strictEqual(await page.$eval(`${W} .lucd20-loot-coins`, e => e.textContent.replace(/\s+/g, " ").trim()), "Coins3 gpThe GM splits the coins");

  const row = name => `${W} .ll-row:has-text("${name}")`;
  const rowState = name => page.$eval(row(name), li => ({ cls: [...li.classList].find(c => c.startsWith("is-")), buttons: [...li.querySelectorAll(".actions button")].map(b => b.textContent.trim()),
    tokens: [...li.querySelectorAll(".ll-tokens .lucd20-loot-portrait")].map(t => t.dataset.tooltip + (t.classList.contains("is-me") ? " (me)" : "")), stash: li.querySelector(".ll-stash-count")?.textContent.trim() ?? null, stashTip: li.querySelector(".ll-stash-count")?.dataset.tooltip ?? null }));
  assert.deepStrictEqual(await rowState("Dogslicer"), { cls: "is-none", buttons: ["Claim", "Party Stash"], tokens: [], stash: null, stashTip: null });
  // Claim: nothing moves; the button says so and my token is on the row.
  await page.click(`${row("Dogslicer")} [data-action="claim"]`);
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await rowState("Dogslicer"), { cls: "is-claimed", buttons: ["Claimed, waiting…", "Party Stash"], tokens: ["Amiri (me)"], stash: null, stashTip: null });
  assert.deepStrictEqual(await page.evaluate(() => [__A.amiri.items.length, __pile.items.length, __chat.length]), [1, 4, 0], "a claim moves nothing and says nothing in chat");
  // A stack asks how many (default: all); Shift+click claims the whole stack.
  const Q = ".lucd20-loot-qty-dialog";
  await page.click(`${row("Healing Potion")} [data-action="claim"]`);
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$eval(`${Q} [data-take-label]`, e => e.textContent), "Claim 2");
  assert.strictEqual(await page.$eval(`${Q} .sub`, e => e.textContent), "2 in the pile · for Amiri");
  await page.evaluate(q => Object.assign(document.querySelector(q).style, { left: "680px", top: "120px" }), Q);
  await page.screenshot({ path: `${out}/p11-qty.png`, clip: { x: 660, y: 100, width: 340, height: 260 } });
  await page.click(`${Q} [data-step="-1"]`);
  assert.strictEqual(await page.$eval(`${Q} [data-take-label]`, e => e.textContent), "Claim 1");
  await page.click(`${Q} [data-action="confirm"]`);
  await page.waitForTimeout(150);
  assert.deepStrictEqual((await rowState("Healing Potion")).tokens, ["Amiri (me)"]);
  // Ask for the Party Stash, then take it back by clicking again.
  await page.click(`${row("Ring of Climbing")} [data-action="stash"]`);
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await rowState("Ring of Climbing"), { cls: "is-stash", buttons: ["Claim", "Stash, waiting…"], tokens: [], stash: "1", stashTip: "Party Stash: Alice" });
  await page.click(`${row("Ring of Climbing")} [data-action="stash"]`);
  await page.waitForTimeout(150);
  assert.strictEqual((await rowState("Ring of Climbing")).cls, "is-none", "taken back");
  // Other players: Bruno (Ezren) claims the other potion (fits the stack) and the Dogslicer (does not); Cara asks for the stash.
  const err = await page.evaluate(async () => { try { await ask("p1", { itemId: itemId("Ring"), kind: "claim", actorUuid: "Actor.ezren" }); return null; } catch (e) { return e.message; } });
  assert.strictEqual(err, "You don't own that character.");
  await page.evaluate(async () => {
    await ask("p2", { itemId: itemId("Healing"), kind: "claim", actorUuid: "Actor.ezren", quantity: 1 });
    await ask("p2", { itemId: itemId("Dogslicer"), kind: "claim", actorUuid: "Actor.ezren" });
    await ask("p3", { itemId: itemId("Dogslicer"), kind: "stash" });
    await ask("p3", { itemId: itemId("Ring"), kind: "stash" });
    await ask("p2", { itemId: itemId("Ring"), kind: "stash" });
  });
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await rowState("Dogslicer"), { cls: "is-contested", buttons: ["Claimed, waiting…", "Party Stash"], tokens: ["Amiri (me)", "Ezren"], stash: "1", stashTip: "Party Stash: Cara" }, "everyone sees who asked");
  assert.deepStrictEqual((await rowState("Healing Potion")), { cls: "is-claimed", buttons: ["Claimed, waiting…", "Party Stash"], tokens: ["Amiri (me)", "Ezren"], stash: null, stashTip: null }, "one potion each: no contest");
  assert.deepStrictEqual((await rowState("Ring of Climbing")).stashTip, "Party Stash: Cara, Bruno");
  await page.screenshot({ path: `${out}/p11-player-window.png` });

  // ================= The GM confirms =================
  await page.evaluate(() => who("u1"));
  await page.waitForTimeout(150);
  assert.deepStrictEqual((await rowState("Healing Potion")).buttons, ["Give to Amiri, Ezren", ""]);
  assert.deepStrictEqual((await rowState("Dogslicer")).buttons, ["Who gets it?", ""]);
  assert.deepStrictEqual((await rowState("Ring of Climbing")).buttons, ["Send to Stash", ""]);
  assert.strictEqual(await page.$eval(`${W} [data-action="approveAll"]`, b => b.textContent.trim()), "Approve all (2)");
  await page.screenshot({ path: `${out}/p11-gm-claims.png` });
  // "Who gets it?": for the GM and the claimers, not for Cara.
  await page.click(`${row("Dogslicer")} [data-action="decide"]`);
  await page.waitForTimeout(200);
  const C = ".lucd20-loot-contest";
  await page.evaluate(c => Object.assign(document.querySelector(c).style, { left: "680px", top: "20px" }), C);
  assert.deepStrictEqual(await page.$$eval(`${C} .ll-contender strong`, e => e.map(x => x.textContent)), ["Amiri", "Ezren"]);
  assert.deepStrictEqual(await page.$$eval(`${C} [data-action="award"]`, e => e.map(x => x.textContent.trim())), ["Amiri", "Ezren", "Party Stash"]);
  await page.screenshot({ path: `${out}/p11-who-gets-it.png` });
  await page.click(`${C} [data-action="sheet"]`);
  assert.strictEqual(await page.evaluate(() => window.__itemSheet), "Dogslicer", "the item itself can be opened");
  const seenBy = async id => { await page.evaluate(id => { who(id); Hooks.callAll("updateActor", __pile, {}); }, id); await page.waitForTimeout(150); return page.$$eval(`${C}, ${C} [data-action="award"]`, e => e.length); };
  assert.strictEqual(await seenBy("p3"), 0, "someone who did not claim it does not get the window");
  assert.strictEqual(await seenBy("p2"), 1, "a claimer gets it, without the buttons");
  assert.strictEqual(await page.$eval(`${C} .ll-contest-note`, e => e.textContent.trim()), "The GM decides.");
  assert.strictEqual(await seenBy("u1"), 4);
  await page.click(`${C} [data-action="award"][data-target="Actor.ezren"]`);
  await page.waitForTimeout(250);
  assert.strictEqual(await page.$$eval(C, e => e.length), 0, "decided: the window closes");
  // Approve all: the potions to their claimers, the ring to the stash (only stash requests).
  await page.click(`${W} [data-action="approveAll"]`);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    amiri: __A.amiri.items.map(i => `${i.name}${typeof i.system.quantity === "number" ? "×" + i.system.quantity : ""}`).sort(),
    ezren: __A.ezren.items.map(i => `${i.name}${typeof i.system.quantity === "number" ? "×" + i.system.quantity : ""}`).sort(),
    party: __A.party.items.map(i => i.name),
    pile: __pile.items.map(i => `${i.name}×${i.system.quantity}`),
    claims: __loot._test.claimsOf(__pile).length,
    chat: [...__chat]
  }));
  console.log("after:", JSON.stringify(after));
  assert.deepStrictEqual(after.amiri, ["Gold Pieces×5", "Healing Potion (Minor)×1"]);
  assert.deepStrictEqual(after.ezren, ["Dogslicer", "Healing Potion (Minor)×1"]);
  assert.deepStrictEqual(after.party, ["Ring of Climbing"], "PF2e party inventory is the stash");
  assert.deepStrictEqual(after.pile, ["Gold Pieces×3"], "only the coins are left; the pile stays for them");
  assert.strictEqual(after.claims, 0);
  assert.deepStrictEqual(after.chat, ["Ezren took Dogslicer.", "Amiri took Healing Potion (Minor).", "Ezren took Healing Potion (Minor).", "Ring of Climbing went to The Party."]);

  // ================= Coins: Split evenly =================
  await page.evaluate(() => { __chat.length = 0; });
  await page.click(`${W} [data-action="splitEven"]`);
  await page.waitForTimeout(200);
  const S = ".lucd20-loot-split";
  const shares = () => page.$$eval(`${S} .ll-share`, e => e.map(x => `${x.querySelector(".who").textContent} ${[...x.querySelectorAll(".ll-coin")].map(c => c.textContent).join(" ")}`));
  assert.deepStrictEqual(await shares(), ["Amiri 1 gp", "Ezren 1 gp", "Party Stash 1 gp"], "normal split: each coin as it is, the odd one to the stash");
  await page.click(`${S} [data-action="mode"][data-convert="1"]`);
  await page.waitForTimeout(100);
  assert.deepStrictEqual(await shares(), ["Amiri 1 gp 5 sp", "Ezren 1 gp 5 sp", "Party Stash 0"], "convert: the same value for everyone");
  await page.click(`${S} [data-action="split"]`);
  await page.waitForTimeout(300);
  const coins = await page.evaluate(() => ({ amiri: __A.amiri.items.filter(i => i.system.stackGroup === "coins").map(i => `${i.system.quantity} ${i.name}`).sort(), ezren: __A.ezren.items.filter(i => i.system.stackGroup === "coins").map(i => `${i.system.quantity} ${i.name}`).sort(),
    exists: game.actors.includes(__pile), chat: [...__chat], windows: document.querySelectorAll(".lucd20-loot-window, .lucd20-loot-split").length }));
  console.log("coins:", JSON.stringify(coins));
  assert.deepStrictEqual(coins.amiri, ["5 Silver Pieces", "6 Gold Pieces"]);
  assert.deepStrictEqual(coins.ezren, ["1 Gold Pieces", "5 Silver Pieces"]);
  assert.deepStrictEqual(coins.chat, ["Coins split: Amiri and Ezren each get 1 gp 5 sp."]);
  assert.ok(!coins.exists && coins.windows === 0, "nothing left: the pile and its windows are gone");

  // ================= Coins: Custom split, and the coin arithmetic =================
  const math = await page.evaluate(async () => {
    const c = await import("/modules/lucd20-automations/scripts/core/coins.js");
    const pf = [{ id: "pp", value: 1000 }, { id: "gp", value: 100 }, { id: "sp", value: 10 }, { id: "cp", value: 1 }];
    const e4 = [{ id: "ad", value: 1000000 }, { id: "pp", value: 10000 }, { id: "gp", value: 100 }, { id: "sp", value: 10 }, { id: "cp", value: 1 }];
    const purse = { pp: 0, gp: 47, sp: 23, cp: 8 };
    return { asIs: c.splitAsIs(purse, 4, pf), byValue: c.splitByValue(purse, 4, pf), noPlatinum: c.splitByValue(purse, 4, pf, "gp").share,
      fourE: c.purseFromValue(c.purseValue({ gp: 12345 }, e4), e4), fourEgold: c.purseFromValue(1234500, e4, "gp") };
  });
  assert.deepStrictEqual(math.asIs, { share: { pp: 0, gp: 11, sp: 5, cp: 2 }, rest: { pp: 0, gp: 3, sp: 3, cp: 0 } });
  assert.deepStrictEqual(math.byValue, { share: { pp: 1, gp: 2, sp: 3, cp: 4 }, rest: { pp: 0, gp: 0, sp: 0, cp: 2 } });
  assert.deepStrictEqual(math.noPlatinum, { pp: 0, gp: 12, sp: 3, cp: 4 }, "highest coin: gold");
  assert.deepStrictEqual(math.fourE, { ad: 1, pp: 23, gp: 45, sp: 0, cp: 0 }, "4e: 100 gp = 1 pp, 100 pp = 1 ad");
  assert.deepStrictEqual(math.fourEgold, { ad: 0, pp: 0, gp: 12345, sp: 0, cp: 0 });
  await page.evaluate(async () => {
    const coin = (name, quantity) => ({ name, type: "treasure", system: { quantity, stackGroup: "coins" } });
    const p = await Actor.create({ name: "Loot Pile 2", type: "loot", flags: { "lucd20-automations": { lootPile: true } } });
    await p.createEmbeddedDocuments("Item", [coin("Gold Pieces", 47), coin("Silver Pieces", 23), coin("Copper Pieces", 8), { name: "Rope", type: "equipment" }]);
    window.__pile = p; __chat.length = 0; __A.party.items.length = 0;
    new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {});
  });
  await page.waitForTimeout(200);
  await page.evaluate(w => Object.assign(document.querySelector(w).style, { left: "20px", top: "20px" }), W);
  await page.click(`${W} [data-action="splitCustom"]`);
  await page.waitForTimeout(200);
  const K = ".lucd20-loot-custom-split";
  await page.evaluate(k => Object.assign(document.querySelector(k).style, { left: "680px", top: "20px" }), K);
  const left = () => page.$$eval(`${K} [data-left]`, e => e.map(x => x.textContent).join(" "));
  const type = async (who, coin, value) => { await page.fill(`${K} tr[data-uuid="Actor.${who}"] input[data-coin="${coin}"]`, String(value)); };
  assert.strictEqual(await left(), "0 47 23 8");
  await type("amiri", "gp", 20); await type("ezren", "gp", 30);
  assert.strictEqual(await left(), "0 -3 23 8");
  assert.ok(await page.$eval(`${K} [data-action="give"]`, b => b.disabled), "cannot give more than there is");
  await type("ezren", "gp", 20); await type("ezren", "sp", 3);
  assert.strictEqual(await left(), "0 7 20 8");
  await page.screenshot({ path: `${out}/p11-custom-split.png` });
  // Convert coins: count by value; a platinum piece can be handed out though the pile has none.
  await page.check(`${K} [data-convert]`);
  assert.strictEqual(await left(), "0 9 0 8");
  await type("amiri", "pp", 1); await type("amiri", "gp", 10);
  assert.strictEqual(await left(), "0 9 0 8");
  await page.click(`${K} [data-action="give"]`);
  await page.waitForTimeout(300);
  const custom = await page.evaluate(() => { const purse = a => Object.fromEntries(a.items.filter(i => i.system.stackGroup === "coins").map(i => [i.name.split(" ")[0], i.system.quantity]));
    return { amiri: purse(__A.amiri), ezren: purse(__A.ezren), party: purse(__A.party), pile: __pile.items.map(i => i.name), chat: [...__chat] }; });
  console.log("custom:", JSON.stringify(custom));
  assert.deepStrictEqual(custom.amiri, { Gold: 16, Silver: 5, Platinum: 1 });
  assert.deepStrictEqual(custom.ezren, { Gold: 21, Silver: 8 });
  assert.deepStrictEqual(custom.party, { Gold: 9, Copper: 8 });
  assert.deepStrictEqual(custom.pile, ["Rope"], "items stay in the pile");
  assert.deepStrictEqual(custom.chat, ["Coins handed out: Amiri 1 pp 10 gp; Ezren 20 gp 3 sp. 9 gp 8 cp went to the Party Stash."]);

  // ================= GM shortcuts: Give to…, Party Stash, Send all =================
  await page.click(`${row("Rope")} [data-action="give"]`);
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await page.$$eval(".lucd20-loot-give-dialog .ll-give-row", e => e.map(x => x.textContent.trim())), ["Amiri", "Ezren"]);
  await page.click('.lucd20-loot-give-dialog .ll-give-row[data-uuid="Actor.ezren"]');
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => __A.ezren.items.some(i => i.name === "Rope") && !game.actors.includes(__pile)), "given at once; the empty pile is removed");

  // A player's "Send all to Party Stash" only asks; the GM's does it.
  await page.evaluate(async st => {
    const p = await Actor.create({ name: "Loot Pile 3", type: "loot", flags: { "lucd20-automations": { lootPile: true } } });
    p.items.length = 0; await p.createEmbeddedDocuments("Item", st.items.filter(i => i.type !== "treasure")); window.__pile = p; window.__chat.length = 0;
    __A.party.items.length = 0;
    foundry.applications.api.DialogV2.confirm = async () => true;
    who("p1");
    new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {});
  }, pileState);
  await page.waitForTimeout(200);
  await page.click(`${W} [data-action="stashAll"]`);
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await page.evaluate(() => [__pile.items.length, __loot._test.claimsOf(__pile).map(c => c.kind).join(), __A.party.items.length]), [3, "stash,stash,stash", 0]);
  await page.evaluate(() => who("u1"));
  await page.waitForTimeout(150);
  await page.click(`${W} [data-action="stashAll"]`);
  await page.waitForTimeout(300);
  const all = await page.evaluate(() => ({ party: __A.party.items.map(i => i.name).sort(), exists: game.actors.includes(__pile), chat: [...__chat] }));
  console.log("stash all:", JSON.stringify(all));
  assert.strictEqual(all.party.length, 3);
  assert.ok(!all.exists, "emptied pile removed");
  assert.deepStrictEqual(all.chat, ["Gamemaster sent everything (3 items) to The Party."], "one chat line");

  // ================= 4e (no loot type): flagged npc actor + module Party Stash =================
  page = await open("gm=1&system=dnd4e", "u1");
  await page.evaluate(() => { CONFIG.Actor.typeLabels = { Player: "", NPC: "", npc: "" }; game.actors.party = undefined; for (const it of __A.goblin.items) if (it.type === "melee") it.type = "power"; });
  await set(page, "lootPile_enabled", true);
  await page.evaluate(() => Hooks.callAll("deleteCombat", __combat));
  await page.waitForTimeout(300);
  await page.click(`.lucd20-loot-review-dialog [data-action="create"]`);
  await page.waitForTimeout(300);
  const p4 = await page.evaluate(() => { const p = game.actors.find(a => a.getFlag("lucd20-automations", "lootPile")); window.__pile = p; return { type: p.type, items: p.items.length }; });
  assert.deepStrictEqual(p4, { type: "npc", items: 5 });
  assert.strictEqual(await page.evaluate(() => { new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: __pile }, {}); return new Promise(r => setTimeout(() => r(document.querySelectorAll(".lucd20-loot-coins").length), 150)); }), 0, "no coins row where the system's coins are not known yet");
  await page.evaluate(() => new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: __pile }, {}));
  await page.waitForTimeout(150);
  await page.evaluate(() => [...document.querySelectorAll(".lucd20-loot-item")].find(li => li.textContent.includes("Ring")).querySelector('[data-action="stash"]').click());
  await page.waitForTimeout(200);
  const stash4 = await page.evaluate(() => { const s = game.actors.find(a => a.getFlag("lucd20-automations", "partyStash")); return s && { name: s.name, items: s.items.map(i => i.name) }; });
  assert.deepStrictEqual(stash4, { name: "Party Stash", items: ["Ring of Climbing"] }, "module Party Stash created on first use");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 10 + 33 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
