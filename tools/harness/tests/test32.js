const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 32: NPC Health Bars (bars "Always for Owner" on tokens of creatures no player owns). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:8765/index.html?gm=1&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    CONST.TOKEN_DISPLAY_MODES ??= { NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 };
    const token = (hasPlayerOwner, displayBars, actor = true) => ({ displayBars, actor: actor ? { hasPlayerOwner } : null, updateSource(change) { Object.assign(this, change); } });
    const place = t => { Hooks.callAll("preCreateToken", t, {}, {}, "u1"); return t.displayBars; };
    const on = [place(token(false, 20)), place(token(false, 0)), place(token(true, 20)), place(token(false, 20, false))];
    await game.settings.set("lucd20-automations", "npcHealthBars_enabled", false);
    const off = place(token(false, 20));
    return { enabledByDefault: game.settings.settings.get("lucd20-automations.npcHealthBars_enabled")?.default, on, off };
  });
  console.log(result, errors);
  assert.strictEqual(result.enabledByDefault, true, "on by default");
  assert.deepStrictEqual(result.on, [40, 40, 20, 20], "NPC tokens: Always for Owner; a player's token and an actorless token are left alone");
  assert.strictEqual(result.off, 20, "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 32 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
