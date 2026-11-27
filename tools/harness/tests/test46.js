const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 47: PF2e rule 12, flat checks. */
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
    for (const f of ["pf2eShove", "pf2eTrip", "pf2ePunishingShove", "pf2eReactiveStrike", "pf2eReactions", "pf2eShieldBlock", "pf2eRoaringHeart", "pf2eDemoralizingCharge"]) await game.settings.set(M, `${f}_enabled`, false);
    await import("/modules/lucd20-automations/scripts/systems/pf2e/flat-check.js");
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    let d20 = 10;
    window.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = d20; return this; } };
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true, targets: new Set() }], { get(id) { return this.find(u => u.id === id); } });
    const posted = [];
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { posted.push(d); return d; } };
    Object.assign(canvas, { ready: true, grid: { size: 100, type: 1 } });
    const make = (id, name, col, { conds = {}, feats = [], effects = [], level = 1, hidden = false, seeName = true } = {}) => {
      const actor = { id, name, level, cond: conds, items: feats.map(slug => ({ slug, name: slug })),
        hasCondition(s) { return s in this.cond; }, getCondition(s) { return s in this.cond ? { value: this.cond[s] } : null; },
        get itemTypes() { return { condition: [], effect: effects.map(slug => ({ slug })) }; } };
      const doc = { id, uuid: `Scene.s.Token.${id}`, name, actor, x: col * 100, y: 0, width: 1, height: 1, hidden, playersCanSeeName: seeName };
      actor.getActiveTokens = () => [{ document: doc }];
      registry[doc.uuid] = doc;
      return doc;
    };
    let n = 0;
    const msg = (attacker, context, extra = {}) => ({ id: `m${++n}`, actor: attacker.actor, token: attacker, item: extra.item ?? { type: "weapon", system: { traits: { value: [] } } }, author: { id: "p1" }, whisper: [], rolls: context ? [{}] : [], flags: { pf2e: { context, ...(extra.pf2e ?? {}) } }, getFlag() { return null; }, ...extra.msg });
    const run = async m => { posted.length = 0; Hooks.callAll("createChatMessage", m); await settle(); return posted.map(p => [p.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), p.whisper ?? [], p.rolls.length]); };
    const strike = (a, t, extra = {}) => msg(a, { type: "attack-roll", options: [], target: t ? { token: t.uuid } : null, ...extra });
    const out = {};
    const valeros = make("val", "Valeros", 0);
    const fog = make("fog", "Goblin", 1, { conds: { concealed: 1 } });
    const ghost = make("gh", "Ghost", 1, { conds: { invisible: 1 } });
    const plain = make("orc", "Orc", 1);
    out.concealed = await run(strike(valeros, fog));
    d20 = 3; out.fail = await run(strike(valeros, fog)); out.failClass = posted[0].content.includes("lucd20-fc-fail"); d20 = 10;
    out.none = await run(strike(valeros, plain));
    out.reroll = await run(strike(valeros, fog, { isReroll: true }));
    out.invisible = await run(strike(valeros, ghost));
    // v0.90.1: attached to the triggering card (its flag; the flat check's own message hidden), and the result
    // known to other automations (flatCheckFailed waits for it).
    const fcMod = await import("/modules/lucd20-automations/scripts/systems/pf2e/flat-check.js");
    const store = {};
    const attackMsg = strike(valeros, fog, {});
    Object.assign(attackMsg, { setFlag: async (ns, k, v) => { (store[ns] ??= {})[k] = v; }, getFlag: (ns, k) => store[ns]?.[k] ?? null });
    d20 = 3; posted.length = 0; Hooks.callAll("createChatMessage", attackMsg);
    const failedP = fcMod.flatCheckFailed(attackMsg, fog.uuid);
    await settle(150); d20 = 10;
    out.attached = [!!store["lucd20-automations"]?.flatCheckLines, posted[0]?.flags?.["lucd20-automations"]?.flatCheck?.attached, await failedP, await fcMod.flatCheckFailed({ id: "nothing" })];
    const li = document.createElement("li"); li.className = "chat-message"; li.innerHTML = `<div class="message-content"><div class="dice-roll">25</div></div>`;
    Hooks.callAll("renderChatMessageHTML", attackMsg, li);
    const fcLi = document.createElement("li"); fcLi.className = "chat-message";
    Hooks.callAll("renderChatMessageHTML", { getFlag: (ns, k) => (k === "flatCheck" ? { attached: true } : null) }, fcLi);
    out.drawn = [li.querySelector(".lucd20-fc-inline .lucd20-fc-fail") ? "fail line in the card" : "missing", fcLi.classList.contains("lucd20-fc-attached-source")];
    // Dazzled: only with a target; a hidden token: GM only, its real name.
    const dazzled = make("daz", "Kyra", 0, { conds: { dazzled: 1 } });
    out.dazzledNoTarget = await run(strike(dazzled, null));
    const lurker = make("lurk", "Gug", 1, { hidden: true, seeName: false });
    out.dazzledHiddenToken = await run(strike(dazzled, lurker));
    const named = make("nm", "Boss", 1, { seeName: false });
    out.hiddenName = await run(strike(dazzled, named));
    // Spells: cast (not posted) at targets; Stupefied without a target; an area: no target checks; attack spells wait for the roll.
    const ezren = make("ez", "Ezren", 0, { conds: { stupefied: 2 } });
    const spell = (traits, area = null) => ({ type: "spell", system: { traits: { value: traits }, area } });
    game.users.get("p1").targets = new Set([{ document: fog }]);
    out.cast = await run(msg(ezren, null, { item: spell(["concentrate", "manipulate"]), pf2e: { casting: { id: "x" } } }));
    game.users.get("p1").targets = new Set([{ document: fog }, { document: ghost }]);
    out.two = await run(msg(valeros, null, { item: spell(["manipulate"]), pf2e: { casting: { id: "x" } } }));
    game.users.get("p1").targets = new Set([{ document: fog }]);
    out.posted = await run(msg(ezren, null, { item: spell(["concentrate", "manipulate"]) }));
    out.area = await run(msg(ezren, null, { item: spell(["manipulate"], { type: "burst", value: 20 }), pf2e: { casting: { id: "x" } } }));
    out.attackSpellCast = await run(msg(ezren, null, { item: spell(["attack", "manipulate"]), pf2e: { casting: { id: "x" } } }));
    out.spellAttack = await run(msg(ezren, { type: "spell-attack-roll", options: [], target: { token: plain.uuid } }, { item: spell(["attack"]) }));
    // Grabbed: manipulate actions, no target needed; the setting turns it off.
    const grab = make("gr", "Merisiel", 0, { conds: { grabbed: 1 } });
    out.grabbed = await run(msg(grab, null, { item: { type: "action", system: { traits: { value: ["manipulate"] }, actionType: { value: "action" } } } }));
    out.grabbedPassive = await run(msg(grab, null, { item: { type: "action", system: { traits: { value: ["manipulate"] }, actionType: { value: "passive" } } } }));
    // Attack actions (Shove).
    out.shove = await run(msg(valeros, { type: "skill-check", options: ["action:shove"], traits: ["attack"], target: { token: fog.uuid } }));
    out.demoralize = await run(msg(valeros, { type: "skill-check", options: ["action:demoralize"], traits: ["auditory"], target: { token: fog.uuid } }));
    // Feats and effects.
    const fighter = make("bf", "Amiri", 0, { feats: ["blind-fight"], level: 3 });
    out.blindFight = [await run(strike(fighter, fog)), await run(strike(fighter, ghost))];
    const keen = make("ke", "Lem", 0, { feats: ["keen-eyes"] });
    out.keen = [await run(strike(keen, fog)), await run(strike(keen, ghost))];
    const sure = make("su", "Seoni", 0, { effects: ["spell-effect-sure-strike"] });
    out.sure = await run(strike(sure, ghost));
    // Secret roll; settings.
    out.secret = await run(Object.assign(strike(valeros, fog), { whisper: ["u1"], blind: true }));
    await game.settings.set(M, "pf2eFlatCheck_ignoreConcealed", true);
    out.ignoreConcealed = await run(strike(valeros, fog));
    await game.settings.set(M, "pf2eFlatCheck_ignoreConcealed", false);
    await game.settings.set(M, "pf2eFlatCheck_hideValue", true);
    out.hideValue = await run(strike(valeros, fog));
    await game.settings.set(M, "pf2eFlatCheck_enabled", false);
    out.off = await run(strike(valeros, fog));
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.concealed, [["10 Flat check DC 5 (concealed)", [], 1]], "a concealed target: DC 5, public");
  assert.deepStrictEqual(r.fail, [["3 Flat check DC 5 (concealed)", [], 1]], "a failure: the die on red");
  assert.strictEqual(r.failClass, true, "red");
  assert.deepStrictEqual(r.two, [["10 Goblin: Flat check DC 5 (concealed) 10 Ghost: Flat check DC 11 (invisible)", ["u1"], 2]], "two targets: one line each, named; GM only for the invisible one");
  assert.deepStrictEqual([r.none, r.reroll], [[], []], "nothing without a condition, nothing on a reroll");
  assert.deepStrictEqual(r.invisible, [["10 Flat check DC 11 (invisible)", ["u1"], 1]], "invisible: DC 11, GM only");
  assert.deepStrictEqual(r.dazzledNoTarget, [], "Dazzled with no target: nothing");
  assert.deepStrictEqual(r.dazzledHiddenToken, [["10 Flat check DC 5 (concealed)", ["u1"], 1]], "a hidden token: GM only");
  assert.deepStrictEqual(r.hiddenName, [["10 Flat check DC 5 (concealed)", [], 1]], "a hidden NPC name stays hidden");
  assert.deepStrictEqual(r.cast, [["10 Flat check DC 7 (Stupefied 2)", [], 1]], "cast at a concealed target while Stupefied 2: the highest, DC 7");
  assert.deepStrictEqual(r.posted, [], "a spell only posted: nothing");
  assert.deepStrictEqual(r.area, [["10 Flat check DC 7 (Stupefied 2)", [], 1]], "an area: no target checks, Stupefied still");
  assert.deepStrictEqual(r.attackSpellCast, [], "an attack spell waits for its attack roll");
  assert.deepStrictEqual(r.spellAttack, [["10 Flat check DC 7 (Stupefied 2)", [], 1]], "the spell attack: Stupefied against the target");
  assert.deepStrictEqual(r.grabbed, [["10 Flat check DC 5 (Grabbed)", [], 1]], "Grabbed: a manipulate action");
  assert.deepStrictEqual(r.grabbedPassive, [], "not a passive one");
  assert.deepStrictEqual(r.shove, [["10 Flat check DC 5 (concealed)", [], 1]], "an attack action counts");
  assert.deepStrictEqual(r.demoralize, [], "a non-attack action doesn't");
  assert.deepStrictEqual(r.blindFight, [[], [["10 Flat check DC 5 (invisible)", ["u1"], 1]]], "Blind-Fight: no check for concealed, DC 5 for invisible");
  assert.deepStrictEqual(r.keen, [[["10 Flat check DC 3 (concealed)", [], 1]], [["10 Flat check DC 9 (invisible)", ["u1"], 1]]], "Keen Eyes: 3 and 9");
  assert.deepStrictEqual(r.sure, [], "Sure Strike: no flat check for hidden or concealed");
  assert.deepStrictEqual(r.secret[0][1], ["u1"], "a secret roll: GM only");
  assert.deepStrictEqual(r.ignoreConcealed, [], "the Ignore Concealed setting");
  assert.deepStrictEqual(r.hideValue, [["Flat check DC 5 (concealed)", [], 1]], "Hide the number");
  assert.deepStrictEqual(r.off, [], "off without a reload");
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(r.attached, [true, true, true, false], "v0.90.1: the lines on the attack's card; its own message marked attached; flatCheckFailed true for the failed target, false with no flat check");
  assert.deepStrictEqual(r.drawn, ["fail line in the card", true], "drawn inside the attack's card; the flat check's own message hidden");
  console.log("PHASE 47 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
