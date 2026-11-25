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
    const caMod = await import(`/modules/${M}/scripts/systems/pf2e/combat-assessment.js`);
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
    // v0.78.0: a hit rolls our Recall Knowledge at once on the GM's client (+2 on a crit), GM-only; no card.
    game.time.worldTime += 86401;
    window.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = window.__d20 ?? 12; return this; } };
    const skill = (slug, label, mod, rank, lore = false) => ({ slug, label, rank, lore, check: { mod }, modifiers: slug === "nature" ? [{ slug: "fey-bonus", label: "Fey Lore bonus", modifier: 1, predicate: Object.assign(["action:recall-knowledge", "target:trait:fey"], { test: o => o.includes("target:trait:fey") }) },
        { slug: "combat-assessment", label: "Combat Assessment", modifier: 2, predicate: Object.assign(["action:recall-knowledge", "combat-assessment"], { test: o => o.includes("combat-assessment") }) }] : [],
      roll: async o => { if (o.createMessage === false) return o.callback({ options: { totalModifier: mod } }, null, { flags: { pf2e: { context: { options: o.extraRollOptions, domains: ["skill-check"] } } } }); rolled.push([slug, o]); } });
    commanderA.skills = { nature: skill("nature", "Nature", 7, 2), arcana: skill("arcana", "Arcana", 5, 1), society: skill("society", "Society", 3, 1), "goblin-lore": skill("goblin-lore", "Goblin Lore", 4, 1, true) };
    commanderA.itemTypes; commanderA.synthetics = { degreeOfSuccessAdjustments: {} };
    ogreA.identificationDCs = { skills: ["nature", "arcana"], standard: { dc: 18, progression: [18, 20, 23, 28] }, lore: [{ progression: [16, 18, 20, 23] }, { progression: [13, 16, 18, 20] }] };
    ogreA.getSelfRollOptions = () => ["target:trait:giant"];
    tCmd.document.object = { actor: commanderA, name: "Brannoc", document: tCmd.document };
    tOgre.document.object = { actor: ogreA, name: "Ogre", document: tOgre.document };
    const rkCards = () => game.messages.filter(m => m.flags[M]?.recallKnowledge);
    const before = caCards().length;
    use(); await settle(); strike("criticalSuccess"); await settle(200);
    const rk = rkCards().at(-1);
    const rows = rk ? [...new DOMParser().parseFromString(rk.content, "text/html").querySelectorAll("tr")].map(tr => txt(tr.innerHTML)) : [];
    out.auto = [caCards().length - before, rkCards().length, rk?.whisper, rk?.blind, rk?.flags.pf2e.context.options.includes("secret"), rows];
    out.autoHeader = txt(rk?.content.match(/<header>[\s\S]*?<\/header>/)?.[0]);
    window.__rkCard = rk?.content ?? "";
    out.maybe = txt(rk?.content.match(/<p class="lucd20-rk-maybe">[\s\S]*?<\/p>/)?.[0] ?? "");
    // The module's Recall Knowledge without targets: every RK skill and Lore with its total.
    const rkMod = await import(`/modules/${M}/scripts/systems/pf2e/recall-knowledge.js`);
    window.__d20 = 20;
    game.user.targets = new Set();
    const plain = await rkMod.recallKnowledge({ actor: commanderA });
    out.plain = [...new DOMParser().parseFromString(plain.content, "text/html").querySelectorAll("tr")].map(tr => txt(tr.innerHTML));
    // PF2e gives no identification data: worked out the same way (level, rarity, traits).
    out.fallback = [rkMod._test.levelDC(-1), rkMod._test.levelDC(0), rkMod._test.levelDC(3), rkMod._test.levelDC(21),
      rkMod._test.identification({ level: 5, rarity: "rare", system: { traits: { value: ["fey", "humanoid"] } } })];
    // v0.87.8: a Combat Assessment toggle in PF2e's Strike roll window (melee, with the feat); the name opens it.
    let opened = 0;
    commanderA.items[0].sheet = { render: () => { opened++; } };
    const dialog = (extra = {}) => {
      const root = document.createElement("div");
      root.innerHTML = `<div class="window-content"><ul class="mods"></ul><button class="roll">Roll</button></div>`;
      document.body.append(root);
      const app = { context: { type: "attack-roll", origin: { actor: commanderA, item: { isMelee: true } }, target: { actor: ogreA }, options: new Set(["item:melee"]), ...extra }, element: root };
      Hooks.callAll("renderCheckModifiersDialog", app, root);
      return { app, root };
    };
    const immuneDlg = dialog();   // the ogre is immune (assessed above)
    out.dlgImmune = txt(immuneDlg.root.querySelector(".lucd20-so")?.innerHTML ?? "");
    out.dlgImmuneSwitch = !immuneDlg.root.querySelector(".lucd20-so input")?.disabled;
    game.time.worldTime += 86401;
    const d = dialog();
    const row = d.root.querySelector(".lucd20-so");
    out.dlgPlace = row?.nextElementSibling?.matches("button.roll");
    row.querySelector(".lucd20-so-name").click();
    row.querySelector("img.lucd20-so-open").click();
    out.dlgOpened = opened;
    out.dlgCount0 = row.querySelector(".lucd20-so-count").textContent;
    const box = row.querySelector("input");
    box.checked = true; box.dispatchEvent(new Event("change"));
    out.dlgTagged = d.app.context.options.has(caMod.TAG);
    out.dlgCount1 = row.querySelector(".lucd20-so-count").textContent;
    // Folding is remembered for the next roll window.
    row.open = false; row.dispatchEvent(new Event("toggle"));
    out.dlgFoldKept = !dialog().root.querySelector(".lucd20-so").open;
    try { localStorage.removeItem("lucd20-automations.strikeOptionsFolded"); } catch {}
    box.checked = false; box.dispatchEvent(new Event("change"));
    out.dlgUntagged = !d.app.context.options.has(caMod.TAG);
    out.dlgRanged = !!dialog({ origin: { actor: commanderA, item: { isMelee: false } } }).root.querySelector(".lucd20-so");
    out.dlgSave = !!dialog({ type: "saving-throw" }).root.querySelector(".lucd20-so");
    // A Strike rolled with the toggle on is the assessment, without the action first.
    const n2 = rkCards().length;
    strike("success", { flags: { pf2e: { context: { type: "attack-roll", outcome: "success", options: ["item:melee", caMod.TAG], target: { token: tOgre.document.uuid } } } } });
    await settle(200);
    out.dlgStrike = rkCards().length - n2;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.degrees, [{ from: "success", to: "failure" }, { from: "criticalSuccess", to: "success" }, null, null, { from: "success", to: "failure" }, null],
    "+2 AC: a hit by 0–1 becomes a miss, a crit by 10–11 a hit; a natural 20 / 1 counted");
  assert.deepStrictEqual(r.card.slice(0, 2), [1, ["p1", "u1"]], "a card to Kyra's player and the GM");
  assert.strictEqual(r.card[2], "Guardian's Deflection R Kyra Ogre's Club hits Amiri: +2 AC makes the hit a miss. Deflect Skip");
  assert.strictEqual(r.skip, 0, "Skip: the card goes");
  assert.deepStrictEqual(r.deflect, [true, "Guardian's Deflection R Kyra Deflected", [], "Amiri : Guardian's Deflection, Ogre's Club is a hit.", [], [["Effect: Panache", "turn-end", 1]]],
    "Deflect: compact card for everyone, the new result in chat, panache until the end of the next turn");
  assert.strictEqual(r.none, 0, "no card: nothing changes, a miss, out of reach, a shield held, a hidden attacker");
  assert.deepStrictEqual(r.monster, ["Scene.s.Token.guard", ["u1"]], "a monster's card: the GM only");
  assert.strictEqual(r.noAction, 0, "Combat Assessment: a Strike without the action does nothing");
  assert.deepStrictEqual(r.caCard, [1, "Combat Assessment 1 Brannoc Recall Knowledge about Ogre: (+2, critical hit) Nature Arcana", ["p1", "u1"], true, 1000 + 86400], "the card: a button per identifying skill; the target immune for a day");
  assert.deepStrictEqual(r.caRoll, [["arcana", 18, "blindroll", [[2, "circumstance"]], true]], "a secret Recall Knowledge against the identification DC, +2 circumstance on the crit");
  assert.deepStrictEqual(r.caDone, [true, "Combat Assessment 1 Rolled"], "answered: only the feat's name");
  assert.ok(/^Combat Assessment 1 Brannoc Ogre is immune to Combat Assessment \(24 h left\)\.$/.test(r.caImmune), `immune: said, no buttons (${r.caImmune})`);
  assert.deepStrictEqual(r.caMiss, [2, true], "a miss: no card, the immunity starts");
  assert.deepStrictEqual(r.auto, [0, 1, ["u1"], true, true, [
    "Skill Total 18 20 23 28",
    "Nature E 21 +9 ✓ ✓ ✗ ✗",
    "Arcana T 19 +7 ✓ ✗ ✗ ✗",
    "Lore Total Unspec. 16 Spec. 13",
    "Goblin Lore T 18 +6 ✓ ✓"
  ]], "Combat Assessment's hit: our Recall Knowledge at once, GM-only, +2 on every total; no card");
  assert.strictEqual(r.autoHeader, "Combat Assessment d20 12 Critical hit +2", "the card names the reason and the bonus");
  assert.strictEqual(r.maybe, "Might apply: Fey Lore bonus +1", "a Recall Knowledge modifier whose condition isn't met is listed; the feat's own +2 (already added) isn't");
  assert.deepStrictEqual(r.plain, ["Skill Total", "Arcana T 25 +5", "Nature E 27 +7", "Society T 23 +3", "Goblin Lore T 24 +4"], "no target: every RK skill the actor has and its Lores");
  assert.deepStrictEqual(r.fallback, [13, 14, 18, 42, { skills: ["nature", "society"], standard: [25, 30], lore: [[22, 25, 30], [20, 22, 25, 30]] }], "DCs without PF2e's data: level, rarity, lore steps, traits");
  assert.deepStrictEqual(errors, [], "no page errors");
  if (process.env.SHOT) {
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "rk-shot";
      Object.assign(box.style, { position: "fixed", left: "10px", top: "10px", width: "290px", zIndex: 99999, padding: "6px 8px", background: "#efe7d6", color: "#191813", border: "1px solid #b9a98f", borderRadius: "4px", font: "13px Signika, sans-serif" });
      box.innerHTML = window.__rkCard;
      document.body.append(box);
    });
    await page.locator("#rk-shot").screenshot({ path: process.env.SHOT });
  }
  await browser.close();
  assert.ok(/Feats for this Strike.*Combat Assessment.*Target immune/.test(r.dlgImmune) && !r.dlgImmuneSwitch, `immune target: said, the checkbox off (${r.dlgImmune})`);
  assert.ok(r.dlgPlace, "the section sits above the Roll button");
  assert.strictEqual(r.dlgOpened, 2, "the name and the icon open the feat");
  assert.ok(r.dlgCount0 === "0 on" && r.dlgCount1 === "1 on", "the heading counts what is on");
  assert.ok(r.dlgFoldKept, "folded stays folded in the next window");
  assert.ok(r.dlgTagged && r.dlgUntagged, "the toggle adds / removes the roll option");
  assert.ok(!r.dlgRanged && !r.dlgSave, "not for ranged Strikes or other rolls");
  assert.strictEqual(r.dlgStrike, 1, "a Strike with the toggle on rolls Recall Knowledge (no action needed)");
  console.log("PHASE 67 CHECKS PASSED");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
