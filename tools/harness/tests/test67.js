const { chromium } = require("playwright");
const assert = require("assert");

/** v0.79.0 (Q311): the SF2e system runs every PF2e feature; other systems don't. */
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const system of ["sf2e", "pf2e", "dnd4e"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=${system}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    out[system] = await page.evaluate(async () => {
      const M = "lucd20-automations";
      const has = key => { try { game.settings.get(M, key); return true; } catch { return false; } };
      const c = await import(`/modules/${M}/scripts/core/constants.js`);
      const sys = await import(`/modules/${M}/scripts/systems/pf2e/sys.js`);
      const r = {
        reactions: has("pf2eReactions_enabled"), shove: has("pf2eShove_enabled"), search: has("searchAutomation_enabled"),
        hud: has("dnd4eHud_enabled"), matchesPf2e: c.systemMatches("pf2e"), family: c.systemFamily(),
        flags: sys.sysFlags({ flags: { sf2e: { a: 1 }, pf2e: { a: 2 } } })?.a, config: !!sys.sysConfig()
      };
      if (game.system.id !== "dnd4e") {
        // GM Vision follows the system's own client setting.
        await game.settings.set(M, "gmVision_enabled", true);
        const gv = await import(`/modules/${M}/scripts/systems/pf2e/gm-vision.js`);
        r.gmVisionSetting = sys.sysSetting("gmVision");
      }
      return r;
    });
    out[system].errors = errors;
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(out));
  const { sf2e, pf2e, dnd4e } = out;
  for (const [k, r] of Object.entries(out)) assert.deepStrictEqual(r.errors, [], `${k}: page errors`);
  assert.ok(sf2e.reactions && sf2e.shove && sf2e.search, "SF2e registers the PF2e features");
  assert.ok(!sf2e.hud, "SF2e: no 4e features");
  assert.ok(sf2e.matchesPf2e && sf2e.family === "pf2e");
  assert.strictEqual(sf2e.flags, 1, "SF2e reads flags.sf2e");
  assert.strictEqual(pf2e.flags, 2, "PF2e reads flags.pf2e");
  assert.ok(sf2e.config && pf2e.config, "the system's CONFIG is found");
  assert.strictEqual(sf2e.gmVisionSetting, false, "sf2e.gmVision is read");
  assert.ok(pf2e.reactions && !pf2e.hud);
  assert.ok(!dnd4e.reactions && !dnd4e.search && dnd4e.hud && !dnd4e.matchesPf2e, "4e: no PF2e features");
  console.log("PHASE 67 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
