const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 45: PF2e rule 10, the Animist's Roaring Heart. */
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
    const settle = (ms = 60) => new Promise(res => setTimeout(res, ms));
    await game.settings.set(M, "pf2eShove_enabled", false); // its square picker is not under test here
    const rh = await import("/modules/lucd20-automations/scripts/systems/pf2e/roaring-heart.js");
    const out = {};
    out.temp = [rh._test.tempHPFor(6, 0), rh._test.tempHPFor(6, 1), rh._test.tempHPFor(7, 1), rh._test.tempHPFor(6, 2)];
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    const mkMsg = d => ({ id: `m${++mid}`, author: { id: game.user.id }, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; } };
    const combatants = [];
    const make = (id, name, col, row, disposition, level = 1, owner = null) => {
      const actor = { id, name, uuid: `Actor.${id}`, level, hasPlayerOwner: !!owner, testUserPermission: u => u.id === owner, effects: [],
        get itemTypes() { return { effect: this.effects }; },
        async createEmbeddedDocuments(t, list) { for (const d of list) this.effects.push({ id: `e${++mid}`, ...d, getFlag(ns, k) { return this.flags?.[ns]?.[k]; } }); },
        async deleteEmbeddedDocuments(t, ids) { this.effects = this.effects.filter(e => !ids.includes(e.id)); } };
      const c = { id: `c-${id}`, actor, initiative: 12 };
      const doc = { id, uuid: `Scene.s.Token.${id}`, name, actor, x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden: false, combatant: c };
      c.token = doc; registry[doc.uuid] = doc; combatants.push(c);
      return { id, name, actor, document: doc };
    };
    const lini = make("lini", "Lini", 2, 2, 1, 6, "p1");
    const amiri = make("amiri", "Amiri", 3, 2, 1);
    const valeros = make("val", "Valeros", 2, 9, 1);
    const gob1 = make("g1", "Goblin", 4, 2, -1), gob2 = make("g2", "Goblin 2", 4, 3, -1);
    game.combat = { id: "c1", started: true, round: 1, turn: 0, combatant: combatants[0], combatants: Object.assign(combatants, { get: id => combatants.find(c => c.id === id) }) };
    for (const c of combatants) c.combat = game.combat;
    Object.assign(canvas, { ready: true, scene: { id: "s" }, grid: { size: 100, type: 1 }, tokens: { placeables: [lini, amiri, valeros, gob1, gob2], controlled: [] } });
    const card = () => game.messages.filter(m => m.flags[M]?.roaringHeart).at(-1);
    const txt = h => (h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const item = { name: "Roaring Heart", slug: "roaring-heart", img: "rh.webp", _stats: { compendiumSource: "Compendium.pf2e.feats-srd.Item.rh" } };
    const shove = (target, outcome) => ChatMessage.create({ actor: lini.actor, token: lini.document, flags: { pf2e: { context: { type: "skill-check", options: ["action:shove"], outcome, target: { token: target.document.uuid } } } } });
    const move = () => Hooks.callAll("moveToken", lini.document, { method: "dragging", passed: { waypoints: [] } }, {});
    const buttons = () => [...card().content.matchAll(/data-lucd20-rh="(\w+)"/g)].map(m => m[1]);
    const click = async value => {
      const host = document.createElement("div"); host.innerHTML = card().content; document.body.append(host);
      Hooks.callAll("renderChatMessageHTML", card(), host);
      host.querySelector(`[data-lucd20-rh="${value}"]`).click(); await settle(120); host.remove();
    };
    const temps = () => [lini, amiri, valeros].map(t => t.actor.effects.find(e => e.flags?.[M]?.roaringHeart)?.system.rules[0].value ?? 0);

    // Used: a card to the player and the GM.
    await ChatMessage.create({ actor: lini.actor, token: lini.document, item }); await settle();
    out.card = [txt(card().content), card().whisper, buttons()];
    // Shove: the system's Shove action for Lini, once a creature is targeted.
    const used = []; let warned = 0;
    game.pf2e = { actions: { get: slug => ({ use: o => used.push([slug, o.actors[0].id]) }) } };
    game.actors = { get: () => null }; lini.actor.isOwner = true;
    ui.notifications = { warn: () => warned++, info() {}, error() {} };
    game.user.targets = new Set(); await click("shove");
    game.user.targets = new Set([gob1]); await click("shove");
    out.shoveButton = [warned, used];
    await shove(gob1, "success"); await settle(); out.afterOneShove = buttons();
    // A Shove on an enemy succeeds; one on an ally doesn't count; a third Shove is ignored.
    await shove(amiri, "success"); await shove(gob2, "criticalSuccess"); await settle();
    out.line = [txt(card().content), game.messages.filter(m => m.flags[M]?.roaringHeart).length, game.messages.at(-1) === card()];
    // Moving doesn't end it; Confirm does: one enemy Shoved → half the level (3), for Lini and Amiri (within 30 ft), not Valeros.
    out.afterTwo = buttons();
    move(); await settle(); move(); await settle(); out.afterMoves = temps();
    await click("confirm");
    out.first = [temps(), txt(game.messages.at(-1).content), card().whisper, card().content.includes("lucd20-card-compact")];
    // Used again: two enemies Shoved, Finish: the level (6); the earlier effects replaced.
    await ChatMessage.create({ actor: lini.actor, token: lini.document, item }); await settle();
    await shove(gob1, "success"); await shove(gob2, "criticalSuccess"); await settle();
    await click("confirm");
    out.second = [temps(), lini.actor.effects.length, lini.actor.effects[0].system.duration, lini.actor.effects[0].system.start.initiative];
    // The start of Lini's next turn: the temporary HP end.
    await rh._test.expire(combatants[0]);
    out.expired = temps();
    // No enemy Shoved, Confirm: no temporary HP.
    await ChatMessage.create({ actor: lini.actor, token: lini.document, item }); await settle();
    await shove(gob1, "failure"); await settle();
    Object.assign(game.combat, { turn: 1, combatant: combatants[1] }); Hooks.callAll("updateCombat", game.combat, { turn: 1 }, {}, "u1"); await settle(120);
    out.stillOpen = buttons();
    await click("confirm");
    out.none = [temps(), txt(card().content)];
    // Cancel: two enemies Shoved, no temporary HP.
    await ChatMessage.create({ actor: lini.actor, token: lini.document, item }); await settle();
    await shove(gob1, "success"); await shove(gob2, "success"); await settle();
    await click("cancel");
    out.cancel = [temps(), game.messages.filter(m => m.flags[M]?.roaringHeart).length, game.messages.filter(m => m.flags[M]?.roaringHeart && !m.flags[M].roaringHeart.done).length];
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.temp, [0, 3, 3, 6], "half the level (rounded down) for one, the level for two, none for none");
  assert.deepStrictEqual(r.card, ["Roaring Heart Lini Shove Cancel", ["p1", "u1"], ["shove", "cancel"]], "the card to the player and the GM: Shove, Cancel");
  assert.deepStrictEqual(r.shoveButton, [1, [["shove", "lini"]]], "Shove: a warning without a target, then the system's Shove for Lini");
  assert.deepStrictEqual(r.afterOneShove, ["shove", "confirm", "cancel"], "one Shove: Shove, Confirm, Cancel");
  assert.deepStrictEqual(r.afterTwo, ["confirm", "cancel"], "two Shoves: Confirm, Cancel");
  assert.deepStrictEqual(r.afterMoves, [0, 0, 0], "moving doesn't end it");
  assert.deepStrictEqual(r.stillOpen, ["shove", "confirm", "cancel"], "the turn's end leaves the card open");
  assert.deepStrictEqual(r.cancel, [[0, 0, 0], 3, 0], "Cancel: none, and the card goes (only the three finished cards remain)");
  assert.deepStrictEqual(r.line, ["Roaring Heart Lini Shoves: 2 of 2. Enemies Shoved: 1. Confirm Cancel", 1, true], "the first two Shoves; an ally Shoved doesn't count; one card, reprinted at the bottom");
  assert.deepStrictEqual(r.first, [[3, 3, 0], "Roaring Heart Lini 3 temporary HP for them and 1 allies until their next turn.", [], true], "Confirm: 3 temporary HP for Lini and Amiri (Valeros is 35 ft away); the card shrinks");
  assert.deepStrictEqual(r.second, [[6, 6, 0], 1, { value: 1, unit: "rounds", expiry: "turn-start", sustained: false }, 12], "two enemies, Confirm: 6; replaced, not stacked; until the start of Lini's next turn");
  assert.deepStrictEqual(r.expired, [0, 0, 0], "the start of Lini's turn: they end");
  assert.deepStrictEqual(r.none, [[0, 0, 0], "Roaring Heart Lini No enemy Shoved: no temporary HP."], "no enemy Shoved, Confirm: none");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 45 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
