const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 50: PF2e hand reminders. */
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
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    for (const f of ["pf2eFlatCheck", "pf2eReactions", "pf2eSustain", "pf2eReactiveStrike"]) await game.settings.set(M, `${f}_enabled`, false);
    await import("/modules/lucd20-automations/scripts/systems/pf2e/hands.js");
    const notes = [];
    ui.notifications = { warn: t => notes.push(t), info() {}, error() {} };
    window.foundry.utils.hasProperty ??= (o, k) => k.split(".").reduce((x, p) => (x && p in x ? x[p] : undefined), o) !== undefined;
    const item = (name, type, handsHeld, extra = {}) => ({ name, type, handsHeld, isHeld: handsHeld > 0, traits: new Set(extra.traits ?? []), slug: extra.slug ?? name.toLowerCase(), hands: extra.hands ?? "1", bulk: extra.bulk ?? { light: 0, normal: 1 } });
    const actor = (items, conds = [], effects = []) => ({ name: "Amiri", type: "character", get itemTypes() { return { weapon: items.filter(i => i.type === "weapon"), shield: items.filter(i => i.type === "shield"), equipment: items.filter(i => i.type === "equipment"), condition: conds.map(slug => ({ slug })), effect: effects }; }, hasCondition(s) { return conds.includes(s); } });
    const out = {};
    const run = async fn => { notes.length = 0; fn(); await settle(); return notes.slice(); };
    // More than two hands, whenever a grip changes; a buckler and shield-attached weapons don't count.
    const greataxe = item("Greataxe", "weapon", 2, { hands: "2" }), torch = item("Torch", "equipment", 1), buckler = item("Buckler", "shield", 1, { slug: "buckler" });
    const a1 = actor([greataxe, torch]); greataxe.actor = a1;
    out.tooMany = await run(() => Hooks.callAll("updateItem", greataxe, { system: { equipped: { handsHeld: 2 } } }, {}, game.user.id));
    const a2 = actor([greataxe, buckler]); greataxe.actor = a2;
    out.buckler = await run(() => Hooks.callAll("updateItem", greataxe, { system: { equipped: { handsHeld: 2 } } }, {}, game.user.id));
    // In an encounter only, from here.
    const msg = (a, it, context, extra = {}) => ({ actor: a, item: it, author: { id: game.user.id }, flags: { pf2e: { context, ...extra } } });
    game.combat = null;
    const sword = item("Longsword", "weapon", 0), pick = item("Greatpick", "weapon", 1, { hands: "2" });
    out.outside = await run(() => Hooks.callAll("createChatMessage", msg(actor([sword]), sword, { type: "attack-roll" })));
    game.combat = { started: true };
    out.notHeld = await run(() => Hooks.callAll("createChatMessage", msg(actor([sword]), sword, { type: "attack-roll" })));
    out.oneHand = await run(() => Hooks.callAll("createChatMessage", msg(actor([pick]), pick, { type: "attack-roll" })));
    out.reroll = await run(() => Hooks.callAll("createChatMessage", msg(actor([sword]), sword, { type: "attack-roll", isReroll: true })));
    const spell = { name: "Grease", type: "spell", traits: new Set(["concentrate", "manipulate"]) };
    out.restrained = await run(() => Hooks.callAll("createChatMessage", msg(actor([], ["restrained"]), spell, null, { casting: { id: "x" } })));
    out.restrainedPosted = await run(() => Hooks.callAll("createChatMessage", msg(actor([], ["restrained"]), spell, null)));
    const rage = [{ name: "Effect: Rage", slug: null, sourceId: "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr" }];
    out.rage = await run(() => Hooks.callAll("createChatMessage", msg(actor([], [], rage), { name: "Recall Knowledge", type: "action", traits: new Set(["concentrate", "secret"]) }, null)));
    out.rageSeek = await run(() => Hooks.callAll("createChatMessage", msg(actor([], [], rage), { name: "Seek", slug: "seek", type: "action", traits: new Set(["concentrate", "secret"]) }, null)));
    out.rageTrait = await run(() => Hooks.callAll("createChatMessage", msg(actor([], [], rage), { name: "Sudden Charge", type: "feat", traits: new Set(["concentrate", "rage"]) }, null)));
    // Raise a Shield with a buckler.
    const b2 = item("Buckler", "shield", 1, { slug: "buckler" });
    const busy = actor([b2, item("Longsword", "weapon", 1), item("Wand", "equipment", 1)]);
    out.raise = await run(() => Hooks.callAll("createItem", { slug: "effect-raise-a-shield", actor: busy }, {}, game.user.id));
    const light = actor([b2, item("Longsword", "weapon", 1), item("Dagger", "weapon", 1, { bulk: { light: 1, normal: 0 } })]);
    out.raiseLight = await run(() => Hooks.callAll("createItem", { slug: "effect-raise-a-shield", actor: light }, {}, game.user.id));
    await game.settings.set(M, "pf2eHands_enabled", false);
    out.off = await run(() => Hooks.callAll("createChatMessage", msg(actor([sword]), sword, { type: "attack-roll" })));
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.tooMany, ["Amiri is using more than two hands: Greataxe (2), Torch (1)."]);
  assert.deepStrictEqual(r.buckler, [], "a buckler on the arm takes no hand");
  assert.deepStrictEqual(r.outside, [], "outside an encounter: no Strike warnings");
  assert.deepStrictEqual(r.notHeld, ["Amiri Strikes with Longsword, which isn't held."]);
  assert.deepStrictEqual(r.oneHand, ["Amiri Strikes with Greatpick in one hand; it needs two."]);
  assert.deepStrictEqual(r.reroll, [], "not on a reroll");
  assert.deepStrictEqual(r.restrained, ["Amiri is Restrained: Grease has the manipulate trait."]);
  assert.deepStrictEqual(r.restrainedPosted, [], "a spell only posted: nothing");
  assert.deepStrictEqual(r.rage, ["Amiri is raging: Recall Knowledge has the concentrate trait."]);
  assert.deepStrictEqual([r.rageSeek, r.rageTrait], [[], []], "Seek and rage actions are fine");
  assert.deepStrictEqual(r.raise, ["Amiri raises a buckler with both hands busy (it needs a free hand or one holding a light item)."]);
  assert.deepStrictEqual(r.raiseLight, [], "a light item in the other hand is fine");
  assert.deepStrictEqual(r.off, [], "off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 50 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
