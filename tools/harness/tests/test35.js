const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

/** Phase 35: D&D 4e loot (coins on the actor), the Party Stash window, ledgers and coin tracking. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on("pageerror", e => { errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`); console.log("PAGEERROR", errors.at(-1)); });
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) { errors.push(m.text()); console.log("CONSOLE", m.text().slice(0, 400)); } });
  await page.goto("http://localhost:8765/index.html?gm=1&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    // Items by uuid too ("Actor.kara.Item.<id>"), for drops.
    window.fromUuid = async uuid => registry[uuid] ?? (() => { const m = /^Actor\.([^.]+)\.Item\.(.+)$/.exec(uuid); return m ? registry[`Actor.${m[1]}`]?.items.get(m[2]) : (window.__worldItems ?? {})[uuid]; })() ?? null;
    const coll = arr => { arr.get = function (id) { return this.find(x => x.id === id); }; Object.defineProperty(arr, "size", { get() { return this.length; } }); return arr; };
    const expand = flat => { const o = {}; for (const [k, v] of Object.entries(flat)) foundry.utils.setProperty(o, k, v); return o; };
    class MockItem {
      constructor(data, parent) { Object.assign(this, foundry.utils.deepClone(data)); this.id ??= Math.random().toString(36).slice(2, 10); this.flags ??= {}; this.system ??= {}; this.img ??= "icons/svg/item-bag.svg"; this.parent = parent; }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
      get uuid() { return `${this.parent?.uuid}.Item.${this.id}`; }
      get sheet() { return { render: () => { window.__itemSheet = this.name; } }; }
      toObject() { const { parent, ...rest } = this; return foundry.utils.deepClone({ ...rest, _id: this.id }); }
      async update(d) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); Hooks.callAll("updateItem", this, d); }
      async delete() { const list = this.parent.items; list.splice(list.indexOf(this), 1); Hooks.callAll("deleteItem", this); }
    }
    let n = 0;
    class MockActor {
      constructor(data) {
        Object.assign(this, { id: data.id ?? `a${++n}`, name: data.name, type: data.type ?? "NPC", img: "icons/svg/mystery-man.svg", flags: data.flags ?? {}, owners: data.owners ?? [], hasPlayerOwner: !!data.owners?.length, prototypeToken: {},
          system: { currency: { ad: 0, pp: 0, gp: 0, sp: 0, cp: 0, ...(data.coins ?? {}) }, details: { level: data.level ?? 1 } } });
        this.uuid = `Actor.${this.id}`; this.documentName = "Actor";
        this.items = coll((data.items ?? []).map(i => new MockItem(i, this)));
        registry[this.uuid] = this;
      }
      get sheet() { return { render: () => { window.__sheet = this.name; } }; }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
      get isOwner() { return game.user.isGM || this.owners.includes(game.user.id); }
      testUserPermission(u) { return u.isGM || this.owners.includes(u.id); }
      async update(d, options = {}) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); Hooks.callAll("updateActor", this, expand(d), options, window.__actingUser ?? game.user.id); }
      async createEmbeddedDocuments(type, data) { const made = data.map(d => new MockItem(d, this)); this.items.push(...made); made.forEach(i => Hooks.callAll("createItem", i)); return made; }
      async deleteEmbeddedDocuments(type, ids) { for (const id of ids) { const i = this.items.get(id); this.items.splice(this.items.indexOf(i), 1); Hooks.callAll("deleteItem", i); } }
      async updateEmbeddedDocuments(type, updates) { for (const { _id, ...d } of updates) { const i = this.items.get(_id); for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(i, k, v); Hooks.callAll("updateItem", i, d); } }
      async getTokenDocument(o) { return { toObject: () => ({ actorId: this.id, name: this.name, ...o }) }; }
      async delete() { game.actors.splice(game.actors.indexOf(this), 1); Hooks.callAll("deleteActor", this); }
    }
    window.Actor = { create: async d => { const a = new MockActor(d); game.actors.push(a); Hooks.callAll("createActor", a); return a; } };
    window.Folder = { create: async d => { const f = { id: "f1", ...d }; game.folders.push(f); return f; } };
    game.folders = [];
    const scene = { id: "s1", grid: { size: 100 }, tokens: coll([]), async createEmbeddedDocuments(t, data) { for (const d of data) this.tokens.push({ id: "t" + this.tokens.length, ...d }); }, async deleteEmbeddedDocuments(t, ids) { for (const id of ids) this.tokens.splice(this.tokens.findIndex(x => x.id === id), 1); } };
    game.scenes = [scene];
    window.canvas = { ready: true, scene, dimensions: { size: 100, width: 1000, height: 600 }, tokens: { placeables: [] } };
    CONST.DOCUMENT_OWNERSHIP_LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
    CONST.TOKEN_DISPLAY_MODES = { HOVER: 30, OWNER: 40 };
    CONFIG.Actor = { typeLabels: { "Player Character": "", NPC: "", Hazard: "" } };
    CONFIG.Item = { typeLabels: { weapon: "Weapon", equipment: "Equipment", consumable: "Consumable", loot: "Loot" } };
    game.user.id = "u1"; game.user.name = "Gamemaster";
    game.users = Object.assign([{ id: "u1", name: "Gamemaster", isGM: true }, { id: "p1", name: "Alice", isGM: false }, { id: "p2", name: "Bruno", isGM: false }], { get(id) { return this.find(u => u.id === id); }, filter: Array.prototype.filter });
    game.users.activeGM = { query: (name, data) => CONFIG.queries[name](data) };
    window.__chat = [];
    window.ChatMessage = { create: async d => window.__chat.push({ text: d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([:.,)])/g, "$1").replace(/\( /g, "(").trim(), whisper: d.whisper ?? [] }) };
    game.paused = false; game.togglePause = on => { game.paused = on; };
    const kara = new MockActor({ id: "kara", name: "Kara", type: "Player Character", owners: ["p1"], coins: { gp: 10 } });
    const dorn = new MockActor({ id: "dorn", name: "Dorn", type: "Player Character", owners: ["p2"], coins: { gp: 5, sp: 4 } });
    const orc = new MockActor({ id: "orc", name: "Orc Raider", level: 3, coins: { gp: 31, sp: 7 }, items: [
      { name: "Battleaxe", type: "weapon", system: { quantity: 1 } }, { name: "Cleave", type: "power" }, { name: "Potion of Healing", type: "consumable", system: { quantity: 2, level: 5 } }] });
    const rat = new MockActor({ id: "rat", name: "Dire Rat", level: 1, coins: { cp: 9 }, items: [{ name: "Bite", type: "power" }] });
    game.actors = coll([kara, dorn, orc, rat]);
    game.user.character = null;
    const tok = (actor, x, y) => ({ x, y, width: 1, height: 1, name: actor.name, texture: { src: actor.img } });
    window.__combat = { scene, combatants: [{ actor: kara, isDefeated: false, token: tok(kara, 100, 100) }, { actor: orc, isDefeated: true, token: tok(orc, 400, 200) }, { actor: rat, isDefeated: true, token: tok(rat, 500, 200) }] };
    window.__A = { kara, dorn, orc, rat };
    window.who = id => { const u = game.users.get(id); Object.assign(game.user, { id, name: u.name, isGM: u.isGM, isActiveGM: u.isGM, character: id === "p1" ? kara : id === "p2" ? dorn : null }); };
    // One page plays every user: a request to the GM runs as the GM, as it would on the GM's own client.
    game.users.activeGM.query = async (name, data) => { const me = game.user.id; who("u1"); try { return await CONFIG.queries[name](data); } finally { who(me); await foundry.applications.instances.get("lucd20-party-stash")?.render(); } };
    foundry.applications.api.DialogV2.confirm = async () => true;
    window.__dialogMode = undefined;
    const side = document.createElement("section"); side.id = "actors"; window.__side = side; Object.assign(side.style, { position: "fixed", right: "0", bottom: "0", width: "220px", background: "#222" }); document.body.append(side); ui.actors = { element: side };
  });
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  await set("lootPile_enabled", true);
  // The features read actors when they start: start them again now that the world exists.
  for (const f of ["dnd4eCoinLog", "dnd4ePartyStash"]) { await set(`${f}_enabled`, false); await set(`${f}_enabled`, true); }

  // ---- Loot the fallen: a 4e NPC's coins are a line of their own ----
  await page.evaluate(() => Hooks.callAll("deleteCombat", __combat));
  await page.waitForSelector(".lucd20-loot-review-dialog [data-item]");
  const R = ".lucd20-loot-review-dialog";
  const review = await page.$$eval(`${R} [data-group]`, gs => gs.map(g => `${g.querySelector(".npc").textContent}: ${[...g.querySelectorAll(".lucd20-loot-check")].map(l => l.textContent.replace(/\s+/g, " ").trim()).join(" | ")}`));
  console.log(review);
  assert.deepStrictEqual(review, ["Orc Raider: Coins 31 gp7 sp | Battleaxe | Potion of Healing ×2", "Dire Rat: Coins 9 cp"], "coins offered per NPC; powers are not loot; an NPC with only coins is listed");
  await page.click(`${R} [data-action="create"]`);
  await page.waitForSelector(".lucd20-loot-window");
  const pile = await page.evaluate(() => { const p = game.actors.find(a => a.getFlag("lucd20-automations", "lootPile")); window.__pile = p; return { type: p.type, coins: p.system.currency, items: p.items.map(i => i.name), orc: __A.orc.system.currency, rat: __A.rat.system.currency, chat: __chat.length }; });
  assert.deepStrictEqual(pile, { type: "NPC", coins: { ad: 0, pp: 0, gp: 31, sp: 7, cp: 9 }, items: ["Battleaxe", "Potion of Healing"], orc: { ad: 0, pp: 0, gp: 0, sp: 0, cp: 0 }, rat: { ad: 0, pp: 0, gp: 0, sp: 0, cp: 0 }, chat: 0 },
    "the pile is an NPC-type actor holding the coins as its own; the fallen lose them; NPC coins are not tracked");
  const W = ".lucd20-loot-window";
  assert.strictEqual(await page.$eval(`${W} .ll-coin-list`, e => [...e.children].map(c => c.textContent).join(" ")), "31 gp 7 sp 9 cp");

  // ---- Split evenly between the player characters: coins land on their sheets, each change tracked ----
  await page.click(`${W} [data-action="splitEven"]`);
  await page.waitForSelector(".lucd20-loot-split .ll-share");
  assert.deepStrictEqual(await page.$$eval(".lucd20-loot-split .ll-share", e => e.map(x => `${x.querySelector(".who").textContent} ${[...x.querySelectorAll(".ll-coin")].map(c => c.textContent).join(" ")}`)), ["Dorn 15 gp 3 sp 4 cp", "Kara 15 gp 3 sp 4 cp", "Party Stash 1 gp 1 sp 1 cp"]);
  await page.click('.lucd20-loot-split [data-action="split"]');
  await page.waitForFunction(() => __chat.length >= 4);
  const split = await page.evaluate(() => { const stash = game.actors.find(a => a.getFlag("lucd20-automations", "partyStash")); window.__stash = stash;
    return { kara: __A.kara.system.currency, dorn: __A.dorn.system.currency, stash: stash.system.currency, stashType: stash.type, pile: __pile.system.currency, chat: __chat.map(c => `${c.text} → ${c.whisper.join(",") || "all"}`),
      karaLog: __A.kara.flags["lucd20-automations"].ledger.map(e => [e.kind, e.delta, e.total.gp, e.reason, e.user]) }; });
  console.log(JSON.stringify(split, null, 1));
  assert.deepStrictEqual([split.kara, split.dorn, split.stash, split.pile], [{ ad: 0, pp: 0, gp: 25, sp: 3, cp: 4 }, { ad: 0, pp: 0, gp: 20, sp: 7, cp: 4 }, { ad: 0, pp: 0, gp: 1, sp: 1, cp: 1 }, { ad: 0, pp: 0, gp: 0, sp: 0, cp: 0 }]);
  assert.strictEqual(split.stashType, "NPC");
  assert.deepStrictEqual(split.karaLog, [["coins", { gp: 15, sp: 3, cp: 4 }, 25, "split", "u1"]]);
  assert.ok(split.chat.includes("Dorn: +15 gp, +3 sp, +4 cp (now 20 gp 7 sp 4 cp) coin split · Gamemaster → u1,p2"), "a character's coins: whispered to the GM and the owner");
  assert.ok(split.chat.includes("Party Stash: +1 gp, +1 sp, +1 cp (now 1 gp 1 sp 1 cp) coin split · Gamemaster → all"), "the stash's coins: to everyone");
  assert.ok(split.chat.some(c => c.startsWith("Coins split: Dorn and Kara each get 15 gp 3 sp 4 cp. 1 gp 1 sp 1 cp went to the Party Stash.")));

  // ---- A change typed on the sheet by the player is tracked the same way ----
  await page.evaluate(async () => { __chat.length = 0; window.__actingUser = "p1"; await __A.kara.update({ "system.currency.gp": 13, "system.currency.sp": 5 }); window.__actingUser = null; await __A.orc.update({ "system.currency.gp": 99 }); });
  await page.waitForFunction(() => __chat.length >= 1);
  assert.deepStrictEqual(await page.evaluate(() => [__chat.map(c => `${c.text} → ${c.whisper.join(",")}`), __A.kara.flags["lucd20-automations"].ledger.length]), [["Kara: −12 gp, +2 sp (now 13 gp 5 sp 4 cp) Alice → u1,p1"], 2], "who did it is named; NPCs are not tracked");

  // ---- Items to the stash, then the Party Stash window ----
  await page.evaluate(async () => { __chat.length = 0; await __stash.createEmbeddedDocuments("Item", [{ name: "Sunrod", type: "loot", system: { quantity: 4 } }, { name: "Amulet of Protection +1", type: "equipment", system: { quantity: 1, level: 1 } }]); });
  await page.click(`${W} [data-action="stashAll"]`); // Approve (Party Stash): everything nobody claimed
  await page.waitForFunction(() => !game.actors.includes(__pile));
  await page.waitForSelector("#actors .lucd20-party-stash-open");
  await page.click("#actors .lucd20-party-stash-open");
  const S = ".lucd20-stash:not(.lucd20-stash-ledger)";
  await page.waitForSelector(`${S} .ls-item`);
  await page.evaluate(s => Object.assign(document.querySelector(s).style, { left: "10px", top: "10px" }), S);
  const gmView = await page.evaluate(s => ({ boxes: [...document.querySelectorAll(`${s} .ls-box`)].map(b => (b.querySelector("input")?.value ?? b.querySelector("b").textContent) + b.querySelector("span").textContent).join(" "),
    tabs: [...document.querySelectorAll(`${s} nav a`)].map(a => a.textContent.replace(/\s+/g, " ").trim()), items: [...document.querySelectorAll(`${s} .ls-item`)].map(li => `${li.classList.contains("is-magic") ? "✦" : "·"} ${li.querySelector(".n b").textContent} ${li.querySelector(".n > span").textContent} ${li.querySelector(".q").textContent} [${li.querySelector("button").textContent.trim()}]`),
    ledger: [...document.querySelectorAll(`${s} .ls-ledger li`)].map(li => li.textContent.replace(/\s+/g, " ").trim().replace(/(just now|\d+ min ago)$/, "").trim()), gm: [...document.querySelectorAll(`${s} .ls-gm button`)].map(b => b.textContent.trim()) }), S);
  console.log(JSON.stringify(gmView, null, 1));
  assert.strictEqual(gmView.boxes, "0ad 0pp 1gp 1sp 1cp");
  assert.deepStrictEqual(gmView.tabs, ["All4", "Weapons & Armor1", "Magic Items1", "Consumables1", "Gear1"]);
  assert.deepStrictEqual(gmView.items, ["✦ Amulet of Protection +1 Equipment · Level 1  [Give]", "· Battleaxe Weapon  [Give]", "✦ Potion of Healing Consumable · Level 5 ×2 [Give]", "· Sunrod Loot ×4 [Give]"]);
  assert.deepStrictEqual(gmView.ledger.slice(0, 3).sort(), ["Coins +1 gp, +1 sp, +1 cp · coin split", "Loot Pile put in Battleaxe", "Loot Pile put in Potion of Healing ×2"].sort(), "the ledger records what came in from the pile and the coins");
  assert.deepStrictEqual(gmView.gm, ["Split evenly", "Custom split", "Open sheet"]);
  await page.screenshot({ path: `${out}/p35-stash-gm.png` });
  // The GM types a new amount in a coin box: saved, logged and said in chat like any other change.
  assert.strictEqual(await page.$$eval(`${S} .ls-box input[data-coin]`, e => e.length), 5);
  await page.evaluate(() => { __chat.length = 0; });
  await page.fill(`${S} input[data-coin="gp"]`, "41");
  await page.press(`${S} input[data-coin="gp"]`, "Tab");
  await page.waitForFunction(() => __chat.length === 1);
  assert.deepStrictEqual(await page.evaluate(() => [__stash.system.currency.gp, __chat[0].text]), [41, "Party Stash: +40 gp (now 41 gp 1 sp 1 cp) Gamemaster"]);
  await page.fill(`${S} input[data-coin="gp"]`, "1");
  await page.press(`${S} input[data-coin="gp"]`, "Tab");
  await page.waitForFunction(() => __stash.system.currency.gp === 1);
  // Clicking an item opens its sheet.
  await page.click(`${S} .ls-item:has-text("Battleaxe") .n a`);
  assert.strictEqual(await page.evaluate(() => window.__itemSheet), "Battleaxe");
  // The stash actor is not listed in the Actors tab (it is reached with P or the button).
  await page.evaluate(() => { const li = document.createElement("li"); li.dataset.entryId = __stash.id; li.textContent = "Party Stash"; __side.prepend(li); const other = document.createElement("li"); other.dataset.entryId = "kara"; other.textContent = "Kara"; __side.prepend(other); });
  await page.waitForFunction(() => document.querySelector(`#actors [data-entry-id="${__stash.id}"]`).hidden);
  assert.strictEqual(await page.evaluate(() => document.querySelector('#actors [data-entry-id="kara"]').hidden), false);
  // P closes and opens the window.
  const key = await page.evaluate(async () => { const k = __keybindings["lucd20-automations.dnd4ePartyStash"]; const out = [k.editable[0].key, k.onDown()]; await new Promise(r => setTimeout(r, 100)); out.push(document.querySelectorAll(".lucd20-stash").length); k.onDown(); await new Promise(r => setTimeout(r, 200)); out.push(document.querySelectorAll(".lucd20-stash").length); return out; });
  assert.deepStrictEqual(key, ["KeyP", true, 0, 1]);
  await page.waitForSelector(`${S} .ls-item`);
  await page.evaluate(s => Object.assign(document.querySelector(s).style, { left: "10px", top: "10px" }), S);
  await page.click(`${S} [data-tab="consumables"]`);
  assert.deepStrictEqual(await page.$$eval(`${S} .ls-item .n b`, e => e.map(x => x.textContent)), ["Potion of Healing"]);
  await page.click(`${S} [data-tab="all"]`);

  // ---- A player takes without asking; the ledger and chat record it ----
  await page.evaluate(() => { who("p1"); __chat.length = 0; return foundry.applications.instances.get("lucd20-party-stash").render(); });
  await page.waitForSelector(`${S} [data-action="take"]`);
  assert.deepStrictEqual(await page.evaluate(s => [document.querySelector(`${s} .ls-taker`).textContent.trim(), document.querySelectorAll(`${s} .ls-gm`).length], S), ["Taking for Kara", 0]);
  await page.click(`${S} .ls-item:has-text("Sunrod") [data-action="take"]`, { modifiers: ["Shift"] });
  await page.waitForFunction(() => __A.kara.items.length === 1);
  await page.click(`${S} .ls-item:has-text("Potion") [data-action="take"]`);
  await page.waitForSelector(".lucd20-loot-qty-dialog");
  assert.strictEqual(await page.$eval(".lucd20-loot-qty-dialog [data-take-label]", e => e.textContent), "Take 2");
  await page.click('.lucd20-loot-qty-dialog [data-step="-1"]');
  await page.click('.lucd20-loot-qty-dialog [data-action="confirm"]');
  await page.waitForFunction(() => __A.kara.items.length === 2);
  const taken = await page.evaluate(async () => { let other = null; try { await CONFIG.queries["lucd20-automations.gm"]({ type: "partyStash.take", payload: { itemId: __stash.items[0].id, target: "Actor.dorn" }, senderId: "p1" }); } catch (e) { other = e.message; }
    return { kara: __A.kara.items.map(i => `${i.name}×${i.system.quantity}`), stash: __stash.items.map(i => `${i.name}×${i.system.quantity}`).sort(), chat: __chat.map(c => c.text), other,
      ledger: __stash.flags["lucd20-automations"].ledger.slice(-2).map(e => [e.kind, e.actor, e.item, e.n]) }; });
  console.log(JSON.stringify(taken));
  assert.deepStrictEqual(taken, { kara: ["Sunrod×4", "Potion of Healing×1"], stash: ["Amulet of Protection +1×1", "Battleaxe×1", "Potion of Healing×1"], chat: ["Kara took 4× Sunrod.", "Kara took Potion of Healing."], other: "You don't own that character.",
    ledger: [["take", "Kara", "Sunrod", 4], ["take", "Kara", "Potion of Healing", 1]] });

  // ---- Dropping an item on the window puts it in: a player's own item moves; someone else's is refused ----
  const put = await page.evaluate(async () => {
    __chat.length = 0;
    await __A.dorn.createEmbeddedDocuments("Item", [{ name: "Rope", type: "loot", system: { quantity: 1 } }, { name: "Twin Strike", type: "power" }]);
    const sunrod = __A.kara.items.find(i => i.name === "Sunrod");
    const drop = uuid => { const e = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(e, "shiftKey", { value: true }); e.dataTransfer = { getData: () => JSON.stringify({ type: "Item", uuid }) }; document.querySelector(".lucd20-stash:not(.lucd20-stash-ledger)").dispatchEvent(e); };
    const ask = (uuid, quantity) => CONFIG.queries["lucd20-automations.gm"]({ type: "partyStash.put", payload: { uuid, quantity }, senderId: "p1" }).then(() => null, e => e.message);
    const out = { theirs: await ask(__A.dorn.items.find(i => i.name === "Rope").uuid), power: null };
    drop(sunrod.uuid); // the whole stack
    await new Promise(r => setTimeout(r, 400));
    who("u1"); out.power = await CONFIG.queries["lucd20-automations.gm"]({ type: "partyStash.put", payload: { uuid: __A.dorn.items.find(i => i.name === "Twin Strike").uuid }, senderId: "u1" }).then(() => null, e => e.message); who("p1");
    return { ...out, kara: __A.kara.items.map(i => i.name), stash: __stash.items.map(i => `${i.name}×${i.system.quantity}`).sort(), chat: __chat.map(c => c.text), last: __stash.flags["lucd20-automations"].ledger.at(-1) };
  });
  console.log(JSON.stringify(put));
  assert.deepStrictEqual([put.theirs, put.power], ["You don't own that character.", "That kind of item cannot go in the stash."]);
  assert.deepStrictEqual(put.kara, ["Potion of Healing"]);
  assert.ok(put.stash.includes("Sunrod×4"));
  assert.deepStrictEqual(put.chat, ["Kara put 4× Sunrod in the Party Stash."]);
  assert.deepStrictEqual([put.last.kind, put.last.actor, put.last.item, put.last.n], ["add", "Kara", "Sunrod", 4]);
  await page.evaluate(async () => { who("u1"); await __stash.items.find(i => i.name === "Sunrod").delete(); who("p1"); await foundry.applications.instances.get("lucd20-party-stash").render(); });

  // ---- The full ledger, the coin log button on a character sheet, dark mode ----
  await page.click(`${S} [data-action="ledger"]`);
  await page.waitForSelector(".lucd20-stash-ledger .ls-ledger-full li");
  assert.ok((await page.$eval(".lucd20-stash-ledger .ls-ledger-full li", e => e.textContent.replace(/\s+/g, " ").trim())).includes("Kara put in Sunrod ×4"), "newest first");
  await page.evaluate(() => {
    const sheet = document.createElement("div"); sheet.className = "application"; sheet.innerHTML = '<header class="window-header"><h1>Kara</h1><button data-action="close"></button></header>'; Object.assign(sheet.style, { left: "720px", top: "500px", width: "300px" }); document.body.append(sheet);
    foundry.applications.instances.set("kara-sheet", { id: "kara-sheet", element: sheet, document: __A.kara, rendered: true });
    const other = document.createElement("div"); other.className = "application"; other.innerHTML = '<header class="window-header"><h1>Dorn</h1><button data-action="close"></button></header>'; Object.assign(other.style, { left: "720px", top: "600px", width: "300px" }); document.body.append(other);
    foundry.applications.instances.set("dorn-sheet", { id: "dorn-sheet", element: other, document: __A.dorn, rendered: true });
  });
  await page.evaluate(() => foundry.applications.instances.get("lucd20-ledger-" + __stash.id).close());
  await page.waitForSelector(".lucd20-coin-log");
  assert.strictEqual(await page.$$eval(".lucd20-coin-log", e => e.length), 1, "only on sheets of characters this user owns");
  await page.click(".lucd20-coin-log");
  await page.waitForSelector(".lucd20-stash-ledger .ls-ledger-full li");
  const log = await page.$$eval(".lucd20-stash-ledger .ls-ledger-full li", e => e.map(li => li.querySelector(".what").textContent.replace(/\s+/g, " ").trim() + " / " + li.querySelector(".by").textContent));
  assert.deepStrictEqual(log, ["Coins −12 gp, +2 spnow 13 gp 5 sp 4 cp / Alice", "Coins +15 gp, +3 sp, +4 cp · coin splitnow 25 gp 3 sp 4 cp / Gamemaster"]);
  await page.evaluate(() => { foundry.applications.instances.get("lucd20-ledger-kara").close(); document.body.classList.add("theme-dark"); return foundry.applications.instances.get("lucd20-party-stash").render(); });
  await page.waitForSelector(`${S} .ls-page.is-dark`);
  const dark = await page.$eval(`${S} .ls-page`, e => getComputedStyle(e).backgroundColor);
  assert.strictEqual(dark, "rgb(29, 30, 25)", "dark variant with Foundry's dark theme");
  await page.screenshot({ path: `${out}/p35-stash-player-dark.png` });

  // ---- The GM splits the stash's own coins: what is left stays, one ledger line ----
  await page.evaluate(async () => { document.body.classList.remove("theme-dark"); who("u1"); await __stash.update({ "system.currency.gp": 21 }); __chat.length = 0; window.__before = __stash.flags["lucd20-automations"].ledger.length; return foundry.applications.instances.get("lucd20-party-stash").render(); });
  await page.click(`${S} [data-action="splitEven"]`);
  await page.waitForSelector(".lucd20-loot-split .ll-share");
  await page.click('.lucd20-loot-split [data-action="split"]');
  await page.waitForFunction(() => __chat.length >= 4);
  const own = await page.evaluate(() => ({ stash: __stash.system.currency, kara: __A.kara.system.currency.gp, lines: __stash.flags["lucd20-automations"].ledger.length - __before, exists: game.actors.includes(__stash), chat: __chat.map(c => c.text) }));
  console.log(JSON.stringify(own));
  assert.deepStrictEqual([own.stash, own.kara, own.lines, own.exists], [{ ad: 0, pp: 0, gp: 1, sp: 1, cp: 1 }, 23, 1, true], "the odd coins stay in the stash (never deleted), in one ledger line");
  assert.ok(own.chat.includes("Coins split: Dorn and Kara each get 10 gp.") && own.chat.includes("Party Stash: −20 gp (now 1 gp 1 sp 1 cp) coin split · Gamemaster"));

  // ---- Off without a reload ----
  await set("dnd4ePartyStash_enabled", false); await set("dnd4eCoinLog_enabled", false);
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await page.evaluate(() => [document.querySelectorAll(".lucd20-party-stash-open").length, document.querySelectorAll(".lucd20-stash").length, document.querySelectorAll(".lucd20-coin-log").length]), [0, 0, 0]);
  await page.evaluate(async () => { __chat.length = 0; await __A.kara.update({ "system.currency.gp": 1 }); });
  assert.strictEqual(await page.evaluate(() => __chat.length), 0, "no tracking when the Coin Log is off");

  assert.deepStrictEqual(errors, []);
  console.log("PHASE 35 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
