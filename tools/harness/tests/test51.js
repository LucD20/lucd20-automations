const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 52: Modifiers Matter (PF2e and D&D 4e). */
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
    const M = "lucd20-automations";
    await game.settings.set(M, "rollChances_enabled", false);
    const mm = await import("/modules/lucd20-automations/scripts/features/modifiers-matter.js");
    await import("/modules/lucd20-automations/scripts/systems/pf2e/modifiers-matter.js");
    const out = {};
    // The core: alone, then together.
    const lst = x => x.map(m => `${m.label}${m.good ? "+" : "-"}`);
    out.alone = lst(mm.mattered([{ label: "A", value: 2, side: "roll" }, { label: "B", value: 1, side: "roll" }], d => 14 + d >= 13));
    out.together = lst(mm.mattered([{ label: "A", value: 1, side: "roll" }, { label: "B", value: 1, side: "roll" }], d => 14 + d >= 13));
    out.dcSide = lst(mm.mattered([{ label: "Off-Guard", value: -2, side: "dc" }, { label: "Shield", value: 2, side: "dc" }], d => 19 + d >= 20));
    // A Strike: total 20 vs AC 20 (natural 12, +8): Inspire +1 made it; the target is off-guard (AC 20 includes −2).
    const ogre = { armorClass: { modifiers: [{ slug: "dex", label: "Dex", modifier: 1, type: "ability", enabled: true }, { slug: "item", label: "Hide Armor", modifier: 3, type: "item", enabled: true }, { slug: "frightened", label: "Frightened", modifier: -1, type: "status", enabled: true }] } };
    window.fromUuidSync = u => ({ "Actor.ogre": ogre })[u];
    const context = { type: "attack-roll", dc: { value: 20, slug: "ac" }, target: { actor: "Actor.ogre" }, options: ["target:condition:off-guard"] };
    const message = { flags: { pf2e: { context, modifiers: [
      { slug: "str", label: "Strength", modifier: 4, type: "ability", enabled: true }, { slug: "proficiency", label: "Trained", modifier: 3, type: "proficiency", enabled: true },
      { slug: "inspire", label: "Courageous Anthem", modifier: 1, type: "status", enabled: true }, { slug: "map", label: "Untyped bonus", modifier: 1, type: "untyped", enabled: false } ] } },
      rolls: [{ total: 20, dice: [{ faces: 20, number: 1, modifiers: [], results: [{ result: 12, active: true }] }] }],
      updateSource(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); } };
    Hooks.callAll("preCreateChatMessage", message, {}, {}, game.user.id);
    out.snap = message.flags[M]?.mm?.dcMods;
    const host = document.createElement("div");
    host.innerHTML = `<div class="tags modifiers"><span class="tag" data-slug="str">Strength +4</span><span class="tag" data-slug="inspire">Courageous Anthem +1</span></div><div class="dice-roll"></div><div class="degree-of-success"></div>`;
    Hooks.callAll("renderChatMessageHTML", message, host);
    out.tags = [...host.querySelectorAll(".tag")].map(t => t.className);
    out.line = host.querySelector(".lucd20-mm-line")?.textContent;
    // Failure ↔ critical failure on an attack doesn't count: natural 2, total 11 vs 20 (crit fail at ≤10).
    const miss = { flags: { pf2e: { context: { type: "attack-roll", dc: { value: 20 } }, modifiers: [{ slug: "x", label: "Bless", modifier: 1, type: "status", enabled: true }] } }, rolls: [{ total: 10, dice: [{ faces: 20, number: 1, modifiers: [], results: [{ result: 9, active: true }] }] }] };
    const h2 = document.createElement("div"); h2.innerHTML = `<div class="tags modifiers"><span class="tag" data-slug="x">Bless +1</span></div><div class="degree-of-success"></div>`;
    Hooks.callAll("renderChatMessageHTML", miss, h2);
    out.critFailAttack = h2.querySelector(".tag").className;
    // A player who can't see the DC: tags yes, target line no.
    game.user.isGM = false; game.pf2e = { settings: { metagame: { dcs: false } } };
    const h3 = document.createElement("div"); h3.innerHTML = host.innerHTML.replace(/ lucd20-mm-(good|bad)/g, "").replace(/<div class="lucd20-mm-line">[\s\S]*?<\/div>/, "");
    Hooks.callAll("renderChatMessageHTML", message, h3);
    out.player = [h3.querySelectorAll(".lucd20-mm-good").length, !!h3.querySelector(".lucd20-mm-line")];
    return out;
  });
  const p4 = await open("dnd4e");
  const r4 = await p4.evaluate(async () => {
    const M = "lucd20-automations";
    await game.settings.set(M, "rollChances_enabled", false);
    await import("/modules/lucd20-automations/scripts/systems/dnd4e/modifiers-matter.mjs");
    const loc = game.i18n.localize.bind(game.i18n);
    game.i18n.localize = k => ({ "DND4E.CommonAttackComAdv": "Combat Advantage", "DND4E.CommonAttackCover": "Cover" })[k] ?? loc(k);
    window.fromUuidSync = () => null;
    Hooks.callAll("dnd4e.preAttackRoll", {}, null, null, { commonAttackBonuses: { comAdv: { value: 2, shouldApply: true, label: "DND4E.CommonAttackComAdv" }, cover: { value: -2, shouldApply: false, label: "DND4E.CommonAttackCover" } } });
    Hooks.callAll("dnd4e.preAttackRoll", {}, null, null, { commonAttackBonuses: { cover: { value: -2, shouldApply: true, label: "DND4E.CommonAttackCover" } } });
    Hooks.callAll("dnd4e.rollAttack", {}, { targDefValArray: [18, 18] });
    const parts = n => [{ faces: 20, rolls: [{ result: n, classes: "" }] }];
    const message = { getFlag() {}, flags: {}, rolls: [{ multirollData: [{ total: 19, parts: parts(11) }, { total: 17, parts: parts(11) }] }], updateSource(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); } };
    Hooks.callAll("preCreateChatMessage", message, {}, {}, game.user.id);
    const host = document.createElement("div");
    host.innerHTML = `<div class="dice-result"></div><div class="hit-prediction">Hit</div><div class="dice-result"></div><div class="hit-prediction">Miss</div>`;
    Hooks.callAll("renderChatMessageHTML", message, host);
    return [...host.querySelectorAll(".lucd20-mm-line")].map(l => [l.textContent, l.previousElementSibling.textContent, l.querySelector("span").className]);
  });
  console.log(JSON.stringify(r), JSON.stringify(r4));
  assert.deepStrictEqual([r.alone, r.together], [["A+"], ["A+", "B+"]], "alone first; else a side together");
  assert.deepStrictEqual(r.dcSide, ["Shield-"], "a +2 to the DC cost the hit");
  assert.deepStrictEqual(r.snap, [{ label: "Frightened", value: -1, side: "dc" }, { label: "Off-Guard", value: -2, side: "dc" }], "the target's AC modifiers when rolled: not its armor or Dex; Off-Guard from the roll");
  assert.deepStrictEqual(r.tags, ["tag", "tag lucd20-mm-good"], "the bonus that made the hit is green; Strength (an attribute) is never marked");
  assert.strictEqual(r.line, "Target: Frightened −1, Off-Guard −2", "the target's Frightened and Off-Guard each made the hit");
  assert.strictEqual(r.critFailAttack, "tag", "failure vs critical failure on an attack: not marked");
  assert.deepStrictEqual(r.player, [1, false], "players: the tags, not the target line when its DC is hidden");
  assert.deepStrictEqual(r4, [["Mattered: Combat Advantage +2", "Hit", "lucd20-mm-good"], ["Mattered: Cover −2", "Miss", "lucd20-mm-bad"]], "4e: per target, the bonus that turned a miss into a hit, the cover that cost one");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 52 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
