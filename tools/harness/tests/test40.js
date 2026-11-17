const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 41: PF2e rule 6, reactions tracked (badge on tokens, mark in the Combat Tracker). */
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
    const mod = await import("/modules/lucd20-automations/scripts/systems/pf2e/reactions.js");
    const out = {};
    window.__chat = [];
    window.ChatMessage = { create: async d => { __chat.push(d); return d; }, getSpeaker: () => ({}) };
    game.users = Object.assign([{ id: "u1", isGM: true }, { id: "p1", isGM: false }], { get(id) { return this.find(u => u.id === id); } });
    // Encounter: Amiri (the player's) and an ogre.
    const actor = (id, name, owner) => ({ id, name, testUserPermission: (u) => u.id === owner });
    const amiri = actor("amiri", "Amiri", "p1"), ogre = actor("ogre", "Ogre", null);
    const combatants = new Map();
    const combatant = (id, a) => { const c = { id, name: a.name, actor: a, isOwner: true, flags: {},
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; Hooks.callAll("updateCombatant", this, {}); } }; combatants.set(id, c); return c; };
    const cA = combatant("amiri", amiri), cO = combatant("ogre", ogre);
    const combat = { id: "c1", started: true, round: 1, turn: 0, combatant: cA, combatants: Object.assign([...combatants.values()], { get: id => combatants.get(id) }),
      getCombatantsByActor: a => [...combatants.values()].filter(c => c.actor === a) };
    cA.combat = combat; cO.combat = combat;
    game.combat = combat;
    // Tokens on the canvas (real PIXI containers).
    const token = (c) => { const t = new PIXI.Container(); t.w = 100; t.h = 100; t.document = { hidden: false, combatant: c }; return t; };
    const tA = token(cA), tO = token(cO);
    Object.assign(canvas, { ready: true, tokens: { placeables: [tA, tO], controlled: [] } });
    const msg = (a, extra) => ({ actor: a, token: null, flags: {}, ...extra });
    const used = c => c.getFlag(M, "reaction")?.used ?? 0;

    // A reaction's card spends it (Shield Block; a spell cast as a reaction too).
    Hooks.callAll("createChatMessage", msg(amiri, { item: { name: "Shield Block", system: { actionType: { value: "reaction" } } } })); await settle();
    out.card = used(cA);
    // An ordinary action's card does not.
    await cA.setFlag(M, "reaction", { used: 0 });
    Hooks.callAll("createChatMessage", msg(amiri, { item: { name: "Raise a Shield", system: { actionType: { value: "action" } } } })); await settle();
    out.notReaction = used(cA);
    Hooks.callAll("createChatMessage", msg(amiri, { item: { name: "Feather Fall", system: { time: { value: "reaction" } } } })); await settle();
    out.spell = used(cA);
    // A Strike on the creature's own turn: not a reaction. Off-turn: a reaction.
    await cA.setFlag(M, "reaction", { used: 0 });
    Hooks.callAll("createChatMessage", msg(amiri, { item: { name: "Greataxe" }, flags: { pf2e: { context: { type: "attack-roll" } } } })); await settle();
    out.ownTurn = used(cA);
    Hooks.callAll("createChatMessage", msg(ogre, { item: { name: "Club" }, flags: { pf2e: { context: { type: "attack-roll" } } } })); await settle();
    out.offTurn = [used(cO), cO.getFlag(M, "reaction").source];
    // A second one this round: a warning to the GMs and the owners, nothing blocked.
    Hooks.callAll("createChatMessage", msg(ogre, { item: { name: "Club" }, flags: { pf2e: { context: { type: "attack-roll" } } } })); await settle();
    out.warning = [__chat.at(-1)?.content.replace(/<[^>]+>/g, "").trim(), __chat.at(-1)?.whisper];
    // Rerolls don't count. Reactive Strike's card and then its Strike: one reaction.
    await cO.setFlag(M, "reaction", { used: 0 }); __chat.length = 0;
    Hooks.callAll("createChatMessage", msg(ogre, { flags: { pf2e: { context: { type: "attack-roll", isReroll: true } } } })); await settle();
    out.reroll = used(cO);
    Hooks.callAll("createChatMessage", msg(ogre, { item: { name: "Reactive Strike", system: { actionType: { value: "reaction" } } } })); await settle();
    Hooks.callAll("createChatMessage", msg(ogre, { item: { name: "Club" }, flags: { pf2e: { context: { type: "attack-roll" } } } })); await settle();
    out.reactiveStrike = [used(cO), __chat.length];

    // The badge: gold when available, grey when spent; a click toggles it.
    mod._test.drawBadge(tA); mod._test.drawBadge(tO);
    const badge = t => t.children.find(c => c.name === "lucd20RxBadge");
    out.badges = [badge(tA)?.lucd20Signature.split(":")[0], badge(tO)?.lucd20Signature.split(":")[0]];
    badge(tO).emit("pointerdown", { stopPropagation() {} }); await settle();
    out.badgeClick = [used(cO), badge(tO)?.lucd20Signature.split(":")[0]];
    // The Combat Tracker's mark.
    document.body.insertAdjacentHTML("beforeend", `<section id="combat"><ol><li data-combatant-id="amiri"><div class="token-name"><strong>Amiri</strong></div></li><li data-combatant-id="ogre"><div class="token-name"><strong>Ogre</strong></div></li></ol></section>`);
    await settle(60);
    const mark = id => document.querySelector(`[data-combatant-id="${id}"] .lucd20-rx`);
    out.marks = [mark("amiri")?.dataset.state, mark("ogre")?.dataset.state];
    mark("amiri").click(); await settle(60);
    out.markClick = [used(cA), mark("amiri")?.dataset.state];

    // Start of the ogre's turn: refilled. (Turns as Foundry updates the encounter.)
    await cO.setFlag(M, "reaction", { used: 1 });
    Object.assign(combat, { turn: 1, combatant: cO }); Hooks.callAll("updateCombat", combat, { turn: 1 }, {}, "u1"); await settle();
    out.refilled = used(cO);

    // Off without a reload: badges and marks go, nothing is spent.
    await cA.setFlag(M, "reaction", { used: 0 });
    await game.settings.set(M, "pf2eReactions_enabled", false); await settle(60);
    out.off = [!!badge(tA), !!mark("amiri")];
    Hooks.callAll("createChatMessage", msg(amiri, { item: { name: "Shield Block", system: { actionType: { value: "reaction" } } } })); await settle();
    out.offSpend = used(cA);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual([r.card, r.notReaction, r.spell], [1, 0, 1], "a reaction's card spends it; an action's does not; a reaction spell does");
  assert.deepStrictEqual([r.ownTurn, r.offTurn], [0, [1, "Club"]], "a Strike on one's own turn is not a reaction; off-turn it is");
  assert.deepStrictEqual(r.warning, ["Ogre has no reaction left this round (Club).", ["u1"]], "none left: a note to the GMs and the owners");
  assert.deepStrictEqual([r.reroll, r.reactiveStrike], [0, [1, 0]], "rerolls don't count; a reaction card and its Strike count once");
  assert.deepStrictEqual(r.badges, ["true", "false"], "badge: Amiri available, the ogre spent");
  assert.deepStrictEqual(r.badgeClick, [0, "true"], "a click on the badge gives it back");
  assert.deepStrictEqual(r.marks, ["on", "on"], "the Combat Tracker marks");
  assert.deepStrictEqual(r.markClick, [1, "off"], "a click on the mark spends it");
  assert.strictEqual(r.refilled, 0, "refilled at the start of the creature's turn");
  assert.deepStrictEqual([r.off, r.offSpend], [[false, false], 0], "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 41 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
