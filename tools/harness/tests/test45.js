const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 46: PF2e rule 11, the Guardian's Punishing Shove. */
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
    const ps = await import("/modules/lucd20-automations/scripts/systems/pf2e/punishing-shove.js");
    const out = {};
    const D = ps._test.punishingDamage;
    out.amounts = [D(4, 1, false), D(4, 1, true), D(4, 2, false), D(4, 3, false), D(5, 4, true), D(0, 1, false)];
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    const rolls = [];
    CONFIG.Dice = { rolls: [class DamageRoll { constructor(f) { this.formula = f; } async evaluate() { return this; } async toMessage(d) { rolls.push(d.whisper ? [this.formula, d.flavor.replace(/<[^>]+>/g, ""), d.whisper, !!d.blind] : [this.formula, d.flavor.replace(/<[^>]+>/g, ""), d.flags["pf2e-toolbelt"].targetHelper.targets]); } }] };
    window.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }], { get(id) { return this.find(u => u.id === id); } });
    const guardian = { id: "g", name: "Valeros", items: [{ slug: "punishing-shove", name: "Punishing Shove" }], abilities: { str: { mod: 4 } }, skills: { athletics: { rank: 2 } } };
    const plain = { id: "p", name: "Amiri", items: [], abilities: { str: { mod: 4 } }, skills: { athletics: { rank: 2 } } };
    const ogre = { uuid: "Scene.s.Token.ogre", name: "Ogre", actor: { id: "o" }, playersCanSeeName: true };
    const lurker = { uuid: "Scene.s.Token.lurk", name: "Gug", actor: { id: "l" }, playersCanSeeName: false };
    registry[ogre.uuid] = ogre; registry[lurker.uuid] = lurker;
    const shove = async (actor, outcome, target = ogre, extra = {}) => {
      rolls.length = 0;
      Hooks.callAll("createChatMessage", { id: `m${Math.random()}`, actor, token: null, whisper: [], ...extra, flags: { pf2e: { context: { type: "skill-check", options: ["action:shove"], outcome, target: target ? { token: target.uuid } : null } } } });
      await settle();
      return rolls.slice();
    };
    out.success = await shove(guardian, "success");
    out.critical = await shove(guardian, "criticalSuccess");
    out.failure = await shove(guardian, "failure");
    out.noFeat = await shove(plain, "success");
    out.noTarget = await shove(guardian, "success", null);
    out.hiddenName = await shove(guardian, "success", lurker);
    out.secret = await shove(guardian, "success", ogre, { whisper: ["u1"], blind: true });
    await game.settings.set(M, "pf2ePunishingShove_enabled", false);
    out.off = await shove(guardian, "success");
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.amounts, [4, 8, 6, 10, 34, 0], "Str, +2 / +6 / +12 by rank, doubled on a critical");
  assert.deepStrictEqual(r.success, [["6[bludgeoning]", "Punishing Shove: damage to Ogre", ["Scene.s.Token.ogre"]]], "a success: Str 4 + 2 (expert), on the shoved creature");
  assert.deepStrictEqual(r.critical, [["12[bludgeoning]", "Punishing Shove (critical success): damage to Ogre", ["Scene.s.Token.ogre"]]], "a critical: doubled");
  assert.deepStrictEqual([r.failure, r.noFeat, r.noTarget, r.off], [[], [], [], []], "nothing on a failure, without the feat, without a target, or off");
  assert.strictEqual(r.hiddenName[0][1], "Punishing Shove: damage to the creature", "a hidden NPC name stays hidden");
  assert.deepStrictEqual(r.secret[0].slice(2), [["u1"], true], "as secret as the Shove");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 46 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
