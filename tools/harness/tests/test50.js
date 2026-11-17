const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 51: Roll Chances (PF2e and D&D 4e). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async system => {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=${system}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };
  const p2 = await open("pf2e");
  const r = await p2.evaluate(async () => {
    const pf = await import("/modules/lucd20-automations/scripts/systems/pf2e/chances.js");
    const eng = await import("/modules/lucd20-automations/scripts/features/roll-chances.js");
    const pct = segs => segs.map(s => Math.round(s.p * 1000) / 10);
    const out = {};
    // +10 vs DC 20: crit fail on 1 only (1+10=11 > 20-10): 5%; fail 2..9 40%; success 10..19 50%; crit on 20: 5%.
    out.basic = pct(pf._test.pf2eSegments(10, 20));
    out.fortune = pct(pf._test.pf2eSegments(10, 20, { mode: "high" }));
    out.adjusted = pct(pf._test.pf2eSegments(10, 20, { adjustments: { success: { label: "x", amount: 1 } } }));
    out.sum = Math.round(pf._test.pf2eSegments(7, 25, { mode: "low" }).reduce((n, s) => n + s.p, 0) * 1e6) / 1e6;
    out.weights = Math.round(eng.d20Weights("high").reduce((a, b) => a + b, 0) * 1e6) / 1e6;
    // The card: before the degree of success; players only where they could see the DC.
    const msg = (context, extra = {}) => ({ flags: { pf2e: { context } }, rolls: [{ total: 25, dice: [{ faces: 20, number: 1, modifiers: [], results: [{ result: 15, active: true }] }] }], ...extra });
    const card = (m) => { const host = document.createElement("div"); host.innerHTML = `<div class="dice-roll"></div><div class="result degree-of-success"></div>`; Hooks.callAll("renderChatMessageHTML", m, host); const bar = host.querySelector(".lucd20-ch-bar"); return bar ? [bar.textContent, bar.nextElementSibling?.className] : null; };
    out.gm = card(msg({ type: "attack-roll", dc: { value: 20 } }));
    game.user.isGM = false;
    game.pf2e = { settings: { metagame: { dcs: false } } };
    out.playerHidden = card(msg({ type: "attack-roll", dc: { value: 20 }, target: { actor: "Actor.ogre" } }));
    window.fromUuidSync = u => ({ "Actor.ogre": { hasPlayerOwner: false }, "Actor.amiri": { hasPlayerOwner: true } })[u];
    out.playerVsPC = card(msg({ type: "attack-roll", dc: { value: 20 }, target: { actor: "Actor.amiri" } }));
    out.playerSave = card(msg({ type: "saving-throw", dc: { value: 20 }, origin: { actor: "Actor.amiri" } }));
    game.pf2e.settings.metagame.dcs = true;
    out.playerDCs = card(msg({ type: "attack-roll", dc: { value: 20 }, target: { actor: "Actor.ogre" } }));
    out.blind = card(msg({ type: "attack-roll", dc: { value: 20 } }, { blind: true }));
    game.user.isGM = true;
    out.flat = card(msg({ type: "flat-check", dc: { value: 5 } }));
    out.noDC = card(msg({ type: "skill-check" }));
    // The roll window.
    const dlg = document.createElement("div"); dlg.innerHTML = `<div class="window-content"><button class="roll">Roll</button></div>`;
    Hooks.callAll("renderCheckModifiersDialog", { check: { totalModifier: 10 }, context: { type: "attack-roll", dc: { value: 20 }, rollTwice: "keep-higher" } }, dlg);
    out.dialog = [dlg.querySelector(".lucd20-ch-bar")?.textContent, dlg.querySelector(".lucd20-ch-bar")?.nextElementSibling?.className];
    return out;
  });
  const p4 = await open("dnd4e");
  const r4 = await p4.evaluate(async () => {
    const M = "lucd20-automations";
    const d4 = await import("/modules/lucd20-automations/scripts/systems/dnd4e/chances.mjs");
    const pct = segs => segs.map(s => Math.round(s.p * 1000) / 10);
    const out = {};
    // +8 vs AC 18: miss on 1..9 (45%), hit 10..19 (50%), crit 20 (5%). Crit range 19: 10%.
    out.attack = pct(d4._test.attackSegments(8, 18));
    out.critRange = pct(d4._test.attackSegments(8, 18, { crit: 19 }));
    out.highDef = pct(d4._test.attackSegments(0, 30));
    out.save = pct(d4._test.saveSegments(0, 10));
    // The hooks: the defenses and crit range land on the message; the card gets a bar per target row.
    window.fromUuidSync = u => ({ "Item.sword": { system: { critRange: 19 } } })[u];
    Hooks.callAll("dnd4e.preAttackRoll", { system: { weaponType: "melee" } }, null, null, { targetOptions: { weaponUuid: "Item.sword" } });
    Hooks.callAll("dnd4e.rollAttack", {}, { targDefValArray: [18, 25], targImmArray: [false, false] });
    const parts = n => [{ faces: 20, formula: "1d20", rolls: [{ result: n, classes: "d20" }] }, { faces: 6, rolls: [] }];
    const message = { getFlag() {}, flags: {}, rolls: [{ multirollData: [{ total: 20, parts: parts(12) }, { total: 13, parts: parts(5) }] }], updateSource(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); } };
    Hooks.callAll("preCreateChatMessage", message, {}, {}, game.user.id);
    out.flag = message.flags[M]?.chances;
    const host = document.createElement("div");
    host.innerHTML = `<div class="dice-result"></div><div class="hit-prediction">Hit</div><div class="dice-result"></div><div class="hit-prediction">Miss</div>`;
    Hooks.callAll("renderChatMessageHTML", message, host);
    out.bars = [...host.querySelectorAll(".lucd20-ch-bar")].map(b => [b.textContent, b.previousElementSibling.textContent]);
    game.user.isGM = false;
    const host2 = document.createElement("div"); host2.innerHTML = host.innerHTML.replace(/<div class="lucd20-ch-bar[\s\S]*?<\/div>/g, "");
    Hooks.callAll("renderChatMessageHTML", message, host2);
    out.player = host2.querySelectorAll(".lucd20-ch-bar").length;
    await game.settings.set(M, "rollChances_showPlayers4e", true);
    Hooks.callAll("renderChatMessageHTML", message, host2);
    out.playerOn = host2.querySelectorAll(".lucd20-ch-bar").length;
    // A saving throw: everyone.
    const save = { getFlag() {}, flags: {}, rolls: [{ total: 12, dice: [{ faces: 20, number: 1, modifiers: [], options: { target: 10, critical: 21 }, results: [{ result: 10, active: true }] }] }] };
    const host3 = document.createElement("div"); host3.innerHTML = `<div class="dice-roll"></div>`;
    Hooks.callAll("renderChatMessageHTML", save, host3);
    out.saveBar = host3.querySelector(".lucd20-ch-bar")?.textContent;
    return out;
  });
  console.log(JSON.stringify(r), JSON.stringify(r4));
  assert.deepStrictEqual(r.basic, [5, 40, 50, 5], "+10 vs DC 20");
  assert.deepStrictEqual(r.fortune, [0.3, 20, 70, 9.8], "rolling twice, the higher");
  assert.deepStrictEqual(r.adjusted, [5, 40, 0, 55], "a success becomes a critical success");
  assert.strictEqual(r.sum, 1); assert.strictEqual(r.weights, 1);
  assert.deepStrictEqual(r.gm, ["40%50%", "result degree-of-success"], "the GM: before the degree of success (5% segments too small for their text)");
  assert.strictEqual(r.playerHidden, null, "a player, a monster's DC, DCs hidden: nothing");
  assert.ok(r.playerVsPC && r.playerSave, "a player's character's DC: shown");
  assert.ok(r.playerDCs, "PF2e shows DCs: shown");
  assert.strictEqual(r.blind, null, "a blind roll: never to players");
  assert.deepStrictEqual([r.flat, r.noDC], [null, null], "not on flat checks or without a DC");
  assert.deepStrictEqual(r.dialog, ["20%70%10%", "roll"], "the roll window, before the Roll button, with fortune");
  assert.deepStrictEqual(r4.attack, [45, 50, 5]);
  assert.deepStrictEqual(r4.critRange, [45, 45, 10], "crit range 19");
  assert.deepStrictEqual(r4.highDef, [95, 0, 5], "only a crit hits");
  assert.deepStrictEqual(r4.save, [45, 55]);
  assert.deepStrictEqual(r4.flag, { crit: 19, defs: [18, 25], immune: [false, false] }, "the weapon's crit range and the defenses on the message");
  assert.deepStrictEqual(r4.bars, [["45%45%10%", "Hit"], ["80%10%10%", "Miss"]], "one bar per target: +8 vs 18; +8 vs 25 (crit range 19)");
  assert.deepStrictEqual([r4.player, r4.playerOn], [0, 2], "players only with the setting");
  assert.strictEqual(r4.saveBar, "35%65%", "a saving throw for everyone (+2 vs 10)");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 51 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
