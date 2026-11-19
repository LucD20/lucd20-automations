const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 67: PF2e rules 21–22, Combat Assessment and Guardian's Deflection. */
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
    const out = {};
    const gd = await import(`/modules/${M}/scripts/systems/pf2e/guardians-deflection.js`);
    const ca = await import(`/modules/${M}/scripts/systems/pf2e/combat-assessment.js`);
    const imm = await import(`/modules/${M}/scripts/systems/pf2e/immunity.js`);
    for (const f of ["pf2eCombatAssessment", "pf2eGuardiansDeflection"]) await game.settings.set(M, `${f}_enabled`, true);
    await game.settings.set(M, "pf2eReactions_enabled", false);
    await settle();

    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    game.time = { worldTime: 1000 };
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    const mkMsg = d => ({ id: `m${++mid}`, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); this.deleted = true; } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); return m; } };
    const txt = h => { const d = document.createElement("div"); d.innerHTML = (h ?? "").replace(/<[^>]+>/g, " "); return d.textContent.replace(/\s+/g, " ").trim(); };
    const click = async (m, sel) => { const h = document.createElement("div"); h.innerHTML = m.content; document.body.append(h); Hooks.callAll("renderChatMessageHTML", m, h); h.querySelector(sel).click(); await settle(80); h.remove(); };

    // Actors and tokens. Kyra: a swashbuckler with Guardian's Deflection, a rapier in one hand.
    const actor = (id, name, { items = [], owner = null, ac = 20, held = [] } = {}) => {
      const a = { id, name, uuid: `Actor.${id}`, hasPlayerOwner: !!owner, isOwner: true, items, flags: {}, effects: [],
        system: { attributes: { hp: { value: 20, max: 20 }, reach: { base: 5 }, ac: { value: ac } } }, armorClass: { value: ac },
        testUserPermission: u => u.id === owner, hasCondition: () => false,
        getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; },
        get itemTypes() { return { weapon: held.filter(i => i.type === "weapon"), shield: held.filter(i => i.type === "shield"), effect: this.effects }; },
        async createEmbeddedDocuments(t, list) { this.effects.push(...list); return list; } };
      return a;
    };
    const rapier = { type: "weapon", name: "Rapier", handsHeld: 1, isMelee: true };
    const deflect = { type: "feat", name: "Guardian's Deflection", slug: "guardians-deflection-swashbuckler", system: { traits: { value: ["swashbuckler"] } }, img: "gd.webp" };
    const kyraA = actor("kyra", "Kyra", { items: [deflect], owner: "p1", held: [rapier] });
    const amiriA = actor("amiri", "Amiri", { owner: "p1", ac: 20 });
    const ogreA = actor("ogre", "Ogre");
    const scene = { id: "s" };
    const tok = (id, a, col, row, disposition) => { const d = { id, uuid: `Scene.s.Token.${id}`, name: a.name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden: false, parent: scene }; registry[d.uuid] = d; registry[a.uuid] = a; return { document: d }; };
    const tKyra = tok("kyra", kyraA, 4, 5, 1), tAmiri = tok("amiri", amiriA, 5, 5, 1), tOgre = tok("ogre", ogreA, 6, 5, -1);
    Object.assign(canvas, { ready: true, scene, grid: { size: 100 }, tokens: { placeables: [tKyra, tAmiri, tOgre] } });
    game.packs = new Map([["pf2e.feat-effects", { index: [{ _id: "pan", name: "Effect: Panache" }], getDocument: async () => ({ toObject: () => ({ name: "Effect: Panache", type: "effect", system: { duration: { value: -1, unit: "unlimited" } } }) }) }]]);

    // ---------- Guardian's Deflection ----------
    out.degrees = [gd.deflected(21, 20, 10), gd.deflected(31, 20, 10), gd.deflected(23, 20, 10), gd.deflected(19, 20, 20), gd.deflected(30, 20, 1), gd.deflected(12, 20, 10)];
    const attack = (total, outcome, nat = 10, extra = {}) => { const m = mkMsg({ item: { name: "Club" }, token: tOgre.document, rolls: [{ total, dice: [{ faces: 20, total: nat }] }],
      flags: { pf2e: { context: { type: "attack-roll", outcome, dc: { value: 20 }, origin: { token: tOgre.document.uuid }, target: { token: tAmiri.document.uuid } } } }, ...extra }); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; };
    const cards = () => game.messages.filter(m => m.flags[M]?.deflection);
    attack(21, "success"); await settle(80);
    out.card = [cards().length, cards()[0]?.whisper, txt(cards()[0]?.content)];
    // Skip: the card goes.
    await click(cards()[0], '[data-lucd20-gd="skip"]');
    out.skip = cards().length;
    // A critical hit by 11 over: becomes a hit. Deflect: compact card, a line, panache until the end of the next turn.
    attack(31, "criticalSuccess"); await settle(80);
    const c2 = cards().at(-1);
    await click(c2, '[data-lucd20-gd="deflect"]');
    const line = game.messages.filter(m => (m.content ?? "").includes("fa-shield-halved") && !m.flags[M]?.deflection).at(-1);
    out.deflect = [c2.flags[M].deflection.done, txt(c2.content), c2.whisper, txt(line?.content), line?.whisper, kyraA.effects.map(e => [e.name, e.system.duration.expiry, e.system.duration.value])];
    // No card: +2 changes nothing; a miss; out of reach; a shield in the other hand; a hidden attacker.
    const n = cards().length;
    attack(25, "success"); attack(15, "failure"); await settle(80);
    tKyra.document.x = 200; attack(21, "success"); await settle(80); tKyra.document.x = 400;
    const shield = { type: "shield", name: "Buckler", slug: "steel-shield", handsHeld: 1 };
    Object.defineProperty(kyraA, "itemTypes", { get() { return { weapon: [rapier], shield: [shield], effect: this.effects }; }, configurable: true });
    attack(21, "success"); await settle(80);
    Object.defineProperty(kyraA, "itemTypes", { get() { return { weapon: [rapier], effect: this.effects }; }, configurable: true });
    tOgre.document.hidden = true; attack(21, "success"); await settle(80); tOgre.document.hidden = false;
    out.none = cards().length - n;
    // A monster with it: the card goes to the GM only.
    const guardA = actor("guard", "Guard", { items: [{ ...deflect }], held: [rapier] });
    const tGuard = tok("guard", guardA, 7, 5, -1); canvas.tokens.placeables.push(tGuard);
    const kobA = actor("kob", "Kobold"); const tKob = tok("kob", kobA, 8, 5, 1); canvas.tokens.placeables.push(tKob);
    const m = mkMsg({ item: { name: "Sling" }, token: tKob.document, rolls: [{ total: 15, dice: [{ faces: 20, total: 9 }] }], flags: { pf2e: { context: { type: "attack-roll", outcome: "success", dc: { value: 14 }, origin: { token: tKob.document.uuid }, target: { token: tOgre.document.uuid } } } } });
    game.messages.push(m); Hooks.callAll("createChatMessage", m); await settle(80);
    out.monster = [cards().at(-1)?.flags[M].deflection.token, cards().at(-1)?.whisper];

    // ---------- Combat Assessment ----------
    const rolled = [];
    game.pf2e = { Modifier: class { constructor(o) { Object.assign(this, o); } } };
    const commanderA = actor("cmd", "Brannoc", { items: [{ type: "feat", name: "Combat Assessment", slug: "combat-assessment", img: "ca.webp" }], owner: "p1" });
    commanderA.skills = { nature: { label: "Nature", roll: async o => rolled.push(["nature", o]) }, arcana: { label: "Arcana", roll: async o => rolled.push(["arcana", o]) } };
    const tCmd = tok("cmd", commanderA, 5, 4, 1);
    ogreA.identificationDCs = { skills: ["nature", "arcana"], standard: { dc: 18 } };
    const caCards = () => game.messages.filter(m => m.flags[M]?.combatAssessment);
    const use = () => { const m = mkMsg({ actor: commanderA, item: commanderA.items[0], flags: {} }); game.messages.push(m); Hooks.callAll("createChatMessage", m); };
    const strike = (outcome, extra = {}) => { const m = mkMsg({ actor: commanderA, token: tCmd.document, item: { name: "Longsword", isMelee: true }, rolls: [{ total: 25 }], flags: { pf2e: { context: { type: "attack-roll", outcome, options: ["item:melee"], target: { token: tOgre.document.uuid } } } }, ...extra }); game.messages.push(m); Hooks.callAll("createChatMessage", m); };
    // A Strike without the action: nothing.
    strike("success"); await settle(80);
    out.noAction = caCards().length;
    // The action, then a critical hit: a card with the skills, +2; the ogre is immune for a day.
    use(); await settle(); strike("criticalSuccess"); await settle(80);
    const k = caCards().at(-1);
    out.caCard = [caCards().length, txt(k?.content), k?.whisper, imm.isImmune(ogreA, "combatAssessment"), imm.immunitiesOf(ogreA)[0]?.until];
    await click(k, '[data-lucd20-ca="arcana"]');
    out.caRoll = rolled.map(([s, o]) => [s, o.dc?.value, o.rollMode, o.modifiers.map(x => [x.modifier, x.type]), o.extraRollOptions.includes("action:recall-knowledge")]);
    out.caDone = [k.flags[M].combatAssessment.done, txt(k.content)];
    // Again within the day: the card says it is immune, no buttons.
    use(); await settle(); strike("success"); await settle(80);
    out.caImmune = txt(caCards().at(-1)?.content);
    // A day later: immune no more. A miss posts nothing but starts the immunity.
    game.time.worldTime += 86401;
    use(); await settle(); strike("failure"); await settle(80);
    out.caMiss = [caCards().length, imm.isImmune(ogreA, "combatAssessment")];
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.degrees, [{ from: "success", to: "failure" }, { from: "criticalSuccess", to: "success" }, null, null, { from: "success", to: "failure" }, null],
    "+2 AC: a hit by 0–1 becomes a miss, a crit by 10–11 a hit; a natural 20 / 1 counted");
  assert.deepStrictEqual(r.card.slice(0, 2), [1, ["p1", "u1"]], "a card to Kyra's player and the GM");
  assert.strictEqual(r.card[2], "Guardian's Deflection R Kyra Ogre's Club hits Amiri: +2 AC makes the hit a miss. Deflect Skip");
  assert.strictEqual(r.skip, 0, "Skip: the card goes");
  assert.deepStrictEqual(r.deflect, [true, "Guardian's Deflection R Kyra", [], "Amiri : Guardian's Deflection, Ogre's Club is a hit.", [], [["Effect: Panache", "turn-end", 1]]],
    "Deflect: compact card for everyone, the new result in chat, panache until the end of the next turn");
  assert.strictEqual(r.none, 0, "no card: nothing changes, a miss, out of reach, a shield held, a hidden attacker");
  assert.deepStrictEqual(r.monster, ["Scene.s.Token.guard", ["u1"]], "a monster's card: the GM only");
  assert.strictEqual(r.noAction, 0, "Combat Assessment: a Strike without the action does nothing");
  assert.deepStrictEqual(r.caCard, [1, "Combat Assessment 1 Brannoc Recall Knowledge about Ogre: (+2, critical hit) Nature Arcana", ["p1", "u1"], true, 1000 + 86400], "the card: a button per identifying skill; the target immune for a day");
  assert.deepStrictEqual(r.caRoll, [["arcana", 18, "blindroll", [[2, "circumstance"]], true]], "a secret Recall Knowledge against the identification DC, +2 circumstance on the crit");
  assert.deepStrictEqual(r.caDone, [true, "Combat Assessment 1"], "answered: only the feat's name");
  assert.ok(/^Combat Assessment 1 Brannoc Ogre is immune to Combat Assessment \(24 h left\)\.$/.test(r.caImmune), `immune: said, no buttons (${r.caImmune})`);
  assert.deepStrictEqual(r.caMiss, [2, true], "a miss: no card, the immunity starts");
  assert.deepStrictEqual(errors, [], "no page errors");
  await browser.close();
  console.log("PHASE 67 CHECKS PASSED");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
