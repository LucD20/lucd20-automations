const { chromium } = require("playwright");
const assert = require("assert");

/** v0.91.0: PF2e rule 31, Shoving Sweep (Mauler 8): the move trigger, rewinding the move, the outcome. */
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
    const ss = await import(`/modules/${M}/scripts/systems/pf2e/shoving-sweep.js`);
    const out = {};
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); }, activeGM: null });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    window.ChatMessage = { getSpeaker: ({ token }) => ({ alias: token?.name }), create: async d => { const m = { id: `m${++mid}`, author: { id: game.user.id }, flags: {}, ...d,
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { Object.assign(this, u); },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); } }; game.messages.push(m); return m; } };
    for (const f of ["pf2eShovingSweep"]) await game.settings.set(M, `${f}_enabled`, true);
    await game.settings.set(M, "pf2eReactions_enabled", false);
    await game.settings.set(M, "pf2eReactiveStrike_enabled", false);
    await settle();

    const weapon = (hands, ranged = false) => ({ handsHeld: hands, isMelee: !ranged, isRanged: ranged, isEquipped: true });
    const sweepFeat = { type: "feat", slug: "shoving-sweep", name: "Shoving Sweep", img: "sweep.webp", id: "f1" };
    const actor = (id, name, { owner = null, items = [], weapons = [] } = {}) => ({ id, name, uuid: `Actor.${id}`, hasPlayerOwner: !!owner, isOwner: true,
      items, itemTypes: { weapon: weapons, feat: items }, system: { attributes: { hp: { value: 20, max: 20 }, reach: { base: 5 } } },
      testUserPermission: u => u.id === owner, hasCondition: () => false });
    const amiriA = actor("amiri", "Amiri", { owner: "p1", items: [sweepFeat], weapons: [weapon(2)] });
    const ogreA = actor("ogre", "Ogre");
    const gobA = actor("gob", "Goblin", { items: [sweepFeat], weapons: [weapon(1)] }); // one hand: no
    const scene = { id: "s" };
    const combatants = [];
    const moves = [];
    const token = (id, a, col, row, disposition) => { const c = { id, actor: a, flags: {}, getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } };
      const doc = { id, uuid: `Scene.s.Token.${id}`, name: a.name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, disposition, parent: scene, combatant: c,
        async update(u, o) { moves.push([id, u.x, u.y, !!o?.[M]?.forced]); Object.assign(this, u); } };
      const t = { id, name: a.name, actor: a, visible: true, document: doc, setTarget() { window.__target = id; } };
      doc.object = t; c.token = doc; registry[doc.uuid] = doc; combatants.push(c); return t; };
    const tAmiri = token("amiri", amiriA, 5, 6, 1), tOgre = token("ogre", ogreA, 5, 5, -1), tGob = token("gob", gobA, 4, 7, -1);
    game.combat = { id: "c1", started: true, round: 1, turn: 0, combatant: combatants[1], combatants };
    for (const c of combatants) c.combat = game.combat;
    Object.assign(canvas, { ready: true, scene, grid: { size: 100, type: 1 }, tokens: { placeables: [tAmiri, tOgre, tGob], controlled: [] }, interface: new PIXI.Container() });
    const shoves = [];
    game.pf2e = { actions: { get: k => (k === "shove" ? { use: async ({ actors }) => { shoves.push([actors[0].name, window.__target]); } } : null) } };
    const cards = () => game.messages.filter(m => m.flags[M]?.shovingSweep);
    const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const walkOgre = (to) => {
      const from = { x: tOgre.document.x, y: tOgre.document.y };
      tOgre.document.x = to[0] * 100; tOgre.document.y = to[1] * 100;
      ss._test.onMoveToken(tOgre.document, { origin: from, passed: { waypoints: [{ x: 500, y: 400, action: "walk" }, { x: to[0] * 100, y: to[1] * 100, action: "walk" }] } }, {});
    };

    // The ogre walks away from Amiri (greatsword in two hands): her card, to her player and the GM.
    walkOgre([5, 3]); await settle();
    const c1 = cards().at(-1);
    out.card = [cards().length, c1?.whisper, txt(c1?.content ?? ""), [...(c1?.content ?? "").matchAll(/data-lucd20-ss="([^"]+)"/g)].map(m => m[1]), c1?.flags[M].shovingSweep.from, c1?.flags[M].shovingSweep.dest];
    // Forced movement: none; within 15 s: none again.
    ss._test.onMoveToken(tOgre.document, { origin: { x: 500, y: 300 }, passed: { waypoints: [{ x: 500, y: 200 }] } }, { [M]: { forced: true } });
    walkOgre([5, 3]); await settle();
    out.again = cards().length;
    // Amiri with the greatsword in one hand: no card (the requirement).
    ss._test.recent.clear(); game.messages.length = 0;
    amiriA.itemTypes.weapon = [weapon(1)];
    tOgre.document.x = 500; tOgre.document.y = 500;
    walkOgre([5, 3]); await settle();
    out.oneHand = cards().length;
    amiriA.itemTypes.weapon = [weapon(2)];

    // Shove: the card shrinks, the ogre goes back to the square it was leaving, then PF2e's Shove on it.
    ss._test.recent.clear(); game.messages.length = 0;
    tOgre.document.x = 500; tOgre.document.y = 500;
    walkOgre([5, 3]); await settle();
    let card = cards().at(-1);
    const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", card, host);
    host.querySelector('[data-lucd20-ss="shove"]').click(); await settle(80);
    out.answered = [card.flags[M].shovingSweep.done, txt(card.content), card.whisper, moves.at(-1), shoves.at(-1), ss._test.pending.has(tOgre.document.uuid)];
    host.remove();

    // A success: shoved (the Shove automation pushes), then continues; no move back.
    const shoveMsg = (outcome, by = tAmiri) => ({ id: `s${++mid}`, flags: { pf2e: { context: { type: "skill-check", options: ["action:shove"], outcome, origin: { token: by.document.uuid }, target: { token: tOgre.document.uuid } } } }, token: by.document });
    const movesBefore = moves.length;
    Hooks.callAll("createChatMessage", shoveMsg("success")); await settle(80);
    out.success = [txt(game.messages.at(-1).content), moves.length - movesBefore, ss._test.pending.size];

    // A failure: the ogre goes back to where its move ended.
    ss._test.recent.clear(); tOgre.document.x = 500; tOgre.document.y = 500;
    walkOgre([5, 3]); await settle();
    card = cards().at(-1);
    await ss._test.answer({ card: card.id, use: true }, "p1");
    Hooks.callAll("createChatMessage", shoveMsg("failure")); await settle(80);
    out.failure = [txt(game.messages.at(-1).content), moves.at(-1)];

    // A critical success: stops. Another creature's Shove doesn't count.
    ss._test.recent.clear(); tOgre.document.x = 500; tOgre.document.y = 500;
    walkOgre([5, 3]); await settle();
    card = cards().at(-1);
    await ss._test.answer({ card: card.id, use: true }, "u1");
    const n = game.messages.length;
    Hooks.callAll("createChatMessage", shoveMsg("criticalSuccess", tGob)); await settle(80);
    out.other = game.messages.length - n;
    Hooks.callAll("createChatMessage", shoveMsg("criticalSuccess")); await settle(80);
    out.crit = txt(game.messages.at(-1).content);

    // Skip: the card goes. A non-owner can't answer.
    ss._test.recent.clear(); tOgre.document.x = 500; tOgre.document.y = 500;
    walkOgre([5, 3]); await settle();
    card = cards().at(-1);
    game.users.push({ id: "p2", isGM: false, active: true });
    out.stranger = await ss._test.answer({ card: card.id, use: true }, "p2");
    out.skip = [await ss._test.answer({ card: card.id, use: false }, "p1"), cards().includes(card)];
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.strictEqual(r.card[0], 1, "one card: Amiri (the goblin holds its weapon in one hand)");
  assert.deepStrictEqual(r.card[1], ["p1", "u1"], "to her player and the GM");
  assert.ok(r.card[2].includes("Ogre left your reach"), r.card[2]);
  assert.deepStrictEqual(r.card[3], ["shove", "skip"]);
  assert.deepStrictEqual(r.card[4], { x: 500, y: 500 }, "the square it was leaving");
  assert.deepStrictEqual(r.card[5], { x: 500, y: 300 }, "where the move ended");
  assert.strictEqual(r.again, 1, "forced movement and a repeat within 15 s: no card");
  assert.strictEqual(r.oneHand, 0, "no melee weapon in two hands: no card");
  assert.strictEqual(r.answered[0], true);
  assert.ok(r.answered[1].includes("Shove") && r.answered[2].length === 0, "compact, shown to everyone");
  assert.deepStrictEqual(r.answered[3], ["ogre", 500, 500, true], "the move rewound (forced)");
  assert.deepStrictEqual(r.answered[4], ["Amiri", "ogre"], "PF2e's Shove, the ogre targeted");
  assert.ok(r.answered[5], "waiting for the Shove");
  assert.ok(r.success[0].includes("continues its movement") && r.success[1] === 0 && r.success[2] === 0, `success ${r.success}`);
  assert.ok(r.failure[0].includes("isn't shoved"), r.failure[0]);
  assert.deepStrictEqual(r.failure[1], ["ogre", 500, 300, true], "failure: back to where its move ended");
  assert.strictEqual(r.other, 0, "another creature's Shove doesn't count");
  assert.ok(r.crit.includes("movement ends"), r.crit);
  assert.strictEqual(r.stranger, false, "not their creature");
  assert.deepStrictEqual(r.skip, [true, false], "Skip deletes the card");
  console.log("PHASE 80 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
