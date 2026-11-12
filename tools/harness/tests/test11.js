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
        this.items = coll((data.items ?? []).map(i => new MockItem(i, this)));
        this.level = data.level;
        registry[this.uuid] = this;
        this.sheet = { render: () => { window.__sheetOpened = this.name; } };
      }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
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
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
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
  assert.ok(await page.$eval(".lucd20-loot-window [data-taker]", s => s.tagName === "SELECT"), "GM gets a dropdown");
  await page.evaluate(() => { const w = document.querySelector(".lucd20-loot-window"); w.style.left = "20px"; w.style.top = "20px"; });
  await page.screenshot({ path: `${out}/p11-gm-window.png` });
  // a normal token still opens its sheet
  await page.evaluate(() => { window.__sheetOpened = false; new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: __A.goblin }, {}); });
  assert.strictEqual(await page.evaluate(() => window.__sheetOpened), true);
  // GM: Open sheet
  await page.click('[data-action="openSheet"]');
  assert.strictEqual(await page.evaluate(() => window.__sheetOpened), "Loot Pile");

  const pileState = await page.evaluate(() => ({ items: __pile.items.map(i => i.toObject()), id: __pile.id }));

  // ================= Player =================
  page = await open("gm=0&system=pf2e", "p1");
  await set(page, "lootPile_enabled", true);
  await page.evaluate(async st => {
    const p = await Actor.create({ name: "Loot Pile", type: "loot", flags: { "lucd20-automations": { lootPile: true } }, owners: [] });
    p.items.length = 0;
    await p.createEmbeddedDocuments("Item", st.items);
    window.__pile = p;
    new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {});
  }, pileState);
  await page.waitForTimeout(200);
  assert.strictEqual(await page.$eval(".lucd20-loot-taker-chip strong", o => o.textContent), "Amiri", "one character: static chip");
  assert.strictEqual(await page.$$eval("[data-taker]", e => e.length), 0);
  const names = await page.$$eval(".lucd20-loot-window .npc", e => e.map(x => x.textContent));
  assert.deepStrictEqual(names, ["Goblin Boss", "Unknown creature"], "hidden NPC name for players");
  assert.ok(await page.$eval(".lucd20-loot-window .lucd20-loot-group:nth-child(2) .lucd20-loot-portrait img", i => i.getAttribute("src") === "icons/svg/mystery-man.svg"), "neutral placeholder portrait");
  assert.strictEqual(await page.$$eval('[data-action="openSheet"], [data-action="deletePile"]', e => e.length), 0);
  await page.screenshot({ path: `${out}/p11-player-window.png` });

  const take = name => page.evaluate(n => { console.log("STEP take " + n + " | items: " + [...document.querySelectorAll(".lucd20-loot-item .name")].map(e => e.textContent.trim()).join(", ")); return [...document.querySelectorAll(".lucd20-loot-item")].find(li => li.textContent.includes(n)).querySelector('[data-action="take"]').click(); }, name);
  const stash = name => page.evaluate(n => [...document.querySelectorAll(".lucd20-loot-item")].find(li => li.textContent.includes(n)).querySelector('[data-action="stash"]').click(), name);
  await take("Dogslicer");
  await page.waitForTimeout(150);
  // coins stack onto Amiri's existing gold; Shift+click takes the whole stack without asking
  await page.click('.lucd20-loot-item:has-text("Gold Pieces") [data-action="take"]', { modifiers: ["Shift"] });
  await page.waitForTimeout(150);
  const Q = ".lucd20-loot-qty-dialog";
  assert.strictEqual(await page.$$eval(Q, e => e.length), 0, "no 'How many?' with Shift");
  // without Shift: "How many?" defaults to the whole stack
  await take("Healing Potion");
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$eval(`${Q} [data-take-label]`, e => e.textContent), "Take 2");
  assert.strictEqual(await page.$eval(`${Q} .sub`, e => e.textContent), "2 in the pile · taking for Amiri");
  await page.click(`${Q} [data-action="cancel"]`);
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$$eval(Q, e => e.length), 0, "cancel closes");
  // take 1 of 2 potions with the − stepper
  await take("Healing Potion");
  await page.waitForTimeout(150);
  await page.evaluate(q => Object.assign(document.querySelector(q).style, { left: "460px", top: "120px" }), Q);
  await page.screenshot({ path: `${out}/p11-qty.png`, clip: { x: 440, y: 100, width: 340, height: 260 } });
  await page.click(`${Q} [data-step="-1"]`);
  assert.strictEqual(await page.$eval(`${Q} [data-take-label]`, e => e.textContent), "Take 1");
  assert.ok(await page.$eval(`${Q} [data-step="-1"]`, b => b.disabled), "− disabled at 1");
  await page.click(`${Q} [data-action="confirm"]`);
  await page.waitForTimeout(150);
  await stash("Ring of Climbing");
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    amiri: __A.amiri.items.map(i => `${i.name}${typeof i.system.quantity === "number" ? "×" + i.system.quantity : ""}`).sort(),
    party: __A.party.items.map(i => i.name),
    pile: __pile.items.map(i => `${i.name}×${i.system.quantity}`),
    chat: __chat
  }));
  console.log("after:", JSON.stringify(after));
  assert.deepStrictEqual(after.amiri, ["Dogslicer", "Gold Pieces×8", "Healing Potion (Minor)×1"]);
  assert.deepStrictEqual(after.party, ["Ring of Climbing"], "PF2e party inventory is the stash");
  assert.deepStrictEqual(after.pile, ["Healing Potion (Minor)×1"]);
  assert.ok(after.chat[0].includes("Alice took Dogslicer for Amiri"));
  assert.ok(after.chat.some(c => c.includes("Alice sent Ring of Climbing to The Party")));
  // can't take for someone else's character
  const err = await page.evaluate(async () => {
    try { await CONFIG.queries["lucd20-automations.gm"]({ type: "lootPile.transfer", payload: { pileUuid: __pile.uuid, itemId: __pile.items[0].id, target: "Actor.ezren" }, senderId: "p1" }); return null; }
    catch (e) { return e.message; }
  });
  assert.strictEqual(err, "You don't own that character.");
  // last item → pile removed
  await take("Healing Potion");
  await page.waitForTimeout(200);
  assert.ok(!(await page.evaluate(() => game.actors.includes(__pile))), "empty pile deleted");
  assert.strictEqual(await page.$$eval(".lucd20-loot-window", e => e.length), 0, "window closed");

  // Send all to Party Stash
  await page.evaluate(async st => {
    const p = await Actor.create({ name: "Loot Pile 2", type: "loot", flags: { "lucd20-automations": { lootPile: true } } });
    p.items.length = 0; await p.createEmbeddedDocuments("Item", st.items.slice(0, 3)); window.__pile2 = p; window.__chat.length = 0;
    __A.party.items.length = 0;
    foundry.applications.api.DialogV2.confirm = async () => true;
    new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: p }, {});
  }, pileState);
  await page.waitForTimeout(200);
  await page.evaluate(() => foundry.applications.instances.get("lucd20-loot-" + __pile2.id).element.querySelector('[data-action="stashAll"]').click());
  await page.waitForTimeout(300);
  const all = await page.evaluate(() => ({ party: __A.party.items.map(i => i.name).sort(), exists: game.actors.includes(__pile2), chat: [...__chat] }));
  console.log("stash all:", JSON.stringify(all));
  assert.strictEqual(all.party.length, 3);
  assert.ok(!all.exists, "emptied pile removed");
  assert.deepStrictEqual(all.chat, ["Alice sent everything (3 items) to The Party."], "one chat line");

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
  await page.evaluate(() => new CONFIG.Token.objectClass()._onClickLeft2.call({ actor: __pile }, {}));
  await page.waitForTimeout(150);
  await page.evaluate(() => [...document.querySelectorAll(".lucd20-loot-item")].find(li => li.textContent.includes("Ring")).querySelector('[data-action="stash"]').click());
  await page.waitForTimeout(200);
  const stash4 = await page.evaluate(() => { const s = game.actors.find(a => a.getFlag("lucd20-automations", "partyStash")); return s && { name: s.name, items: s.items.map(i => i.name) }; });
  assert.deepStrictEqual(stash4, { name: "Party Stash", items: ["Ring of Climbing"] }, "module Party Stash created on first use");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 10 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
