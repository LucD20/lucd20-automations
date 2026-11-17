const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 44: PF2e rule 9, the Commander's Demoralizing Charge. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 50) => new Promise(res => setTimeout(res, ms));
    const dc = await import("/modules/lucd20-automations/scripts/systems/pf2e/commander.js");
    const out = {};
    out.penalties = [dc._test.penaltyFor([{ outcome: "success" }]), dc._test.penaltyFor([{ outcome: "success" }, { outcome: "failure" }]),
      dc._test.penaltyFor([{ outcome: "success" }, { outcome: "success" }]), dc._test.penaltyFor([{ outcome: "criticalSuccess" }, { outcome: "success" }])];
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    window.fromUuid = async uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }, { id: "p2", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    const mkMsg = d => ({ id: `m${++mid}`, author: { id: game.user.id }, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; } };
    game.pf2e = { Modifier: class { constructor(o) { Object.assign(this, o); } } };
    // The scene: the commander (Kyra), Amiri next to her, Valeros 25 ft away, Seelah 40 ft away, a goblin.
    const combatants = [];
    const make = (id, name, col, row, disposition, actorExtra = {}, owner = null) => {
      const actor = { id, name, uuid: `Actor.${id}`, hasPlayerOwner: !!owner, testUserPermission: u => u.id === owner, ...actorExtra };
      const c = { id: `c-${id}`, actor, flags: {}, getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } };
      const doc = { id, uuid: `Scene.s.Token.${id}`, name, actor, x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden: false, combatant: c };
      const t = { id, name, actor, document: doc };
      doc.object = t; registry[doc.uuid] = doc; combatants.push(c); c.combat = null; return t;
    };
    const frightened = [];
    const kyra = make("kyra", "Kyra", 2, 2, 1, { classDC: { dc: { value: 21 } }, rollOptions: { all: { "commanders-banner": true } }, flags: {},
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } }, "p1");
    const amiri = make("amiri", "Amiri", 3, 2, 1, {}, "p2");
    const valeros = make("val", "Valeros", 2, 7, 1, {}, "p2");
    const seelah = make("see", "Seelah", 2, 11, 1, {}, "p2");
    const goblin = make("gob", "Goblin", 4, 3, -1, { saves: { will: { roll: async o => { window.__save = o; return { degreeOfSuccess: window.__degree }; } } }, increaseCondition: async (slug, o) => frightened.push([slug, o.value]) });
    const tactic = { uuid: "Actor.kyra.Item.dc", slug: "demoralizing-charge", name: "Demoralizing Charge", img: "dc.webp", _stats: { compendiumSource: "Compendium.pf2e.actionspf2e.Item.dc" } };
    registry[tactic.uuid] = tactic;
    game.combat = { id: "c1", started: true, round: 2, turn: 0, combatant: kyra.document.combatant, combatants };
    for (const c of combatants) { c.combat = game.combat; c.flags[M] = { reaction: { used: 0 } }; }
    valeros.document.combatant.flags[M].reaction.used = 1; // Valeros used his reaction already
    Object.assign(canvas, { ready: true, scene: { id: "s" }, grid: { size: 100, type: 1 }, tokens: { placeables: [kyra, amiri, valeros, seelah, goblin], controlled: [] }, interface: new PIXI.Container(), app: { view: document.body } });
    canvas.controls = canvas.interface;
    const cards = key => game.messages.filter(m => m.flags[M]?.[key]);
    const txt = h => (h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const click = (col, row) => window.dispatchEvent(new MouseEvent("pointerdown", { clientX: col * 100 + 50, clientY: row * 100 + 50, button: 0, bubbles: true }));

    // 1–2. Kyra uses Demoralizing Charge: allies within 30 ft are offered (Amiri, Valeros; not Seelah, not Kyra).
    const use = ChatMessage.create({ actor: kyra.actor, token: kyra.document, item: tactic });
    await settle(80);
    out.bar = document.querySelector(".lucd20-pick-bar")?.textContent.trim();
    out.offered = canvas.interface.children[0]?.children.length;
    click(2, 11); await settle();   // Seelah is out of the aura: nothing
    click(3, 2); await settle();
    out.barAfter = document.querySelector(".lucd20-pick-bar span")?.textContent;
    click(2, 7); await settle(80);  // the second click signals at once
    // Drilled Reactions: the commander chooses who gets the extra reaction (one click).
    out.drilledBar = document.querySelector(".lucd20-pick-bar span")?.textContent;
    click(2, 7); await use; await settle(120);
    out.remembered = kyra.actor.flags[M]?.dcLast;
    // 3. A card each, to their player and the GM; Drilled Reactions for Valeros (his reaction was spent).
    out.allyCards = cards("dcAlly").map(m => [txt(m.content), m.whisper]);
    out.marks = [amiri.document.combatant.flags[M].tacticRound?.round, valeros.document.combatant.flags[M].tacticRound?.round, kyra.document.combatant.flags[M].drilledRound];
    // 4. Their Strikes, on the goblin: Amiri hits, Valeros crits. Valeros's Strike uses the drilled reaction.
    const strike = (t, outcome) => ChatMessage.create({ actor: t.actor, token: t.document, item: { name: "Sword" }, flags: { pf2e: { context: { type: "attack-roll", outcome, target: { token: goblin.document.uuid } } } } });
    await strike(amiri, "success"); await settle();
    await strike(valeros, "criticalSuccess"); await settle(120);
    out.collapsed = cards("dcAlly").map(m => [txt(m.content), m.whisper]);
    out.reactions = [amiri.document.combatant.flags[M].reaction.used, valeros.document.combatant.flags[M].reaction.used, game.messages.some(m => (m.content ?? "").includes("no reaction left"))];
    // 5. The GM's save card: Will against DC 21, −3 (both hit, one critical).
    const save = cards("dcSave").at(-1);
    out.saveCard = [txt(save?.content), save?.whisper];
    const host = document.createElement("div"); host.innerHTML = save.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", save, host);
    window.__degree = 0;
    host.querySelector("[data-lucd20-dcsave]").click(); await settle(120);
    out.roll = [window.__save.dc.value, window.__save.modifiers[0]?.modifier, window.__save.modifiers[0]?.type, frightened.at(-1), txt(save.content).includes("Frightened 2."), txt(game.messages.at(-1).content), game.messages.at(-1).whisper ?? "public"];
    // v0.48.2 (owner): used again the same round (a misclick): still allowed, the same allies offered and chosen.
    const use2 = ChatMessage.create({ actor: kyra.actor, token: kyra.document, item: tactic }); await settle(80);
    out.second = document.querySelector(".lucd20-pick-bar span")?.textContent;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle(80);
    out.redoDrilled = document.querySelector(".lucd20-pick-bar span")?.textContent ?? "none";
    click(3, 2); await use2; await settle(120);
    // ...and used once more before anyone answered: the open signal is replaced.
    const firstOpen = cards("dcAlly").slice(-2);
    const use2b = ChatMessage.create({ actor: kyra.actor, token: kyra.document, item: tactic }); await settle(80);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle(80);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await use2b; await settle(120);
    out.replaced = firstOpen.map(m => txt(m.content).includes("Replaced by a new signal."));
    // Answer the open one (two misses) so the next round starts clean.
    await strike(amiri, "failure"); await strike(valeros, "failure"); await settle(120);
    // Next round: one ally skips, the other misses: no save card. Then the commander's turn ends before an answer.
    game.combat.round = 3;
    const nSaves = cards("dcSave").length;
    const use3 = ChatMessage.create({ actor: kyra.actor, token: kyra.document, item: tactic }); await settle(80);
    // The last squadmates start chosen: Enter signals; Escape at the Drilled Reactions pick gives it to no one.
    out.preselected = document.querySelector(".lucd20-pick-bar span")?.textContent;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle(80);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await use3; await settle(120);
    out.noDrilled = cards("dcAlly").slice(-2).some(m => (m.content ?? "").includes("Drilled"));
    const [a3, v3] = cards("dcAlly").slice(-2);
    const h3 = document.createElement("div"); h3.innerHTML = a3.content; document.body.append(h3); Hooks.callAll("renderChatMessageHTML", a3, h3);
    h3.querySelector("[data-lucd20-dc]").click(); await settle(80);
    await strike(valeros, "failure"); await settle(120);
    out.skipMiss = [txt(a3.content).includes("Not answered."), cards("dcSave").length - nSaves];
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.penalties, [0, -1, -2, -3], "penalty: one Strike none; both struck −1; both hit −2; both hit with a critical −3");
  assert.deepStrictEqual([r.offered, r.bar], [2, "Demoralizing Charge: click two squadmates within 30 ft (Enter or Signal for fewer) (0/2) Signal Cancel"], "allies within 30 ft are offered, not the commander");
  assert.strictEqual(r.barAfter, "Demoralizing Charge: click two squadmates within 30 ft (Enter or Signal for fewer) (1/2)", "a click out of the aura does nothing; one chosen");
  assert.strictEqual(r.drilledBar, "Drilled Reactions: click who gets the extra reaction (0/1)", "the second click signalled; now the Drilled Reactions pick");
  assert.deepStrictEqual(r.remembered, ["Scene.s.Token.amiri", "Scene.s.Token.val"], "the choice is remembered");
  assert.strictEqual(r.preselected, "Demoralizing Charge: click two squadmates within 30 ft (Enter or Signal for fewer) (2/2)", "next time the last squadmates start chosen");
  assert.strictEqual(r.noDrilled, false, "Escape: no one gets the extra reaction");
  assert.deepStrictEqual(r.allyCards.map(c => c[1]), [["p2", "u1"], ["p2", "u1"]], "each ally's card to their player and the GM");
  assert.ok(r.allyCards[1][0].includes("Drilled Reactions") && !r.allyCards[0][0].includes("Drilled Reactions"), "Drilled Reactions for the ally the commander chose");
  assert.deepStrictEqual(r.marks, ["c1:2", "c1:2", "c1:2"], "the round's marks: answered a tactic; Drilled Reactions used");
  assert.deepStrictEqual(r.collapsed, [["Demoralizing Charge", []], ["Demoralizing Charge", []]], "after their Strikes, the cards show only the tactic, to everyone");
  assert.deepStrictEqual(r.reactions, [1, 1, false], "Amiri's reaction spent; Valeros used the drilled one (no warning)");
  assert.deepStrictEqual(r.saveCard, ["Demoralizing Charge Goblin : Will save against DC 21 (-3) or Frightened 1 (2 on a critical failure). Roll the save", ["u1"]], "one save for the goblin, −3, GM only");
  assert.deepStrictEqual(r.roll, [21, -3, "circumstance", ["frightened", 2], true, "Goblin is Frightened 2 (Demoralizing Charge).", []], "the save: DC, penalty; a critical failure: Frightened 2");
  assert.strictEqual(r.second, "Demoralizing Charge: click two squadmates within 30 ft (Enter or Signal for fewer) (2/2)", "used again the same round: still allowed, the same allies chosen");
  assert.strictEqual(r.redoDrilled, "Drilled Reactions: click who gets the extra reaction (0/1)", "a redo may choose Drilled Reactions again");
  assert.deepStrictEqual(r.replaced, [true, true], "an unanswered earlier signal is replaced");
  assert.deepStrictEqual(r.skipMiss, [true, 0], "a skip and a miss: no save");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 44 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
