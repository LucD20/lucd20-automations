const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 26: D&D 4e Combat Automation merged (loads, cards, settings map, API; nothing runs in other systems). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };

  let page = await open("gm=1&system=dnd4e");
  const info = await page.evaluate(async () => {
    const { dnd4eSetting } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/cards.mjs");
    return {
      tabs: [...document.querySelectorAll(".lucd20-hub-tab")].map(t => t.dataset.category),
      api: Object.keys(game.modules.get("lucd20-automations").api?.dnd4e ?? {}),
      quarry: dnd4eSetting("enableQuarry"),
      cover: dnd4eSetting("enableCover"),
      preview: dnd4eSetting("coverPreview"),
      language: dnd4eSetting("gameLanguage"),
      hooks: ["dnd4e.usePower", "dnd4e.rollAttack", "renderChatMessageHTML"].map(h => (Hooks._h[h] ?? []).length)
    };
  });
  console.log(info);
  assert.ok(info.tabs.includes("dnd4e"), "D&D 4e category");
  assert.deepStrictEqual(info.api.sort(), ["applyMark", "computeCover", "drawCoverPreview", "openActionPanel", "translateExisting"], "API under api.dnd4e");
  assert.ok(info.quarry && info.cover && info.preview, "defaults on");
  assert.ok(info.hooks[0] > 0 && info.hooks[1] > 0, "4e hooks registered");
  await page.click('.lucd20-hub-tab[data-category="dnd4e"]');
  await page.waitForTimeout(150);
  const cards = await page.$$eval('.lucd20-hub-category[data-category="dnd4e"] .lucd20-feature', els => els.map(e => [e.innerText.split("\n")[0].trim(), e.classList.contains("planned")]));
  console.log(cards);
  assert.strictEqual(cards.length, 13, "13 cards");
  assert.ok(cards.every(c => !c[1]), "all built");
  await page.evaluate(() => { const f = document.querySelector("form.lucd20-hub"); f.style.height = "960px"; });
  await page.screenshot({ path: `${out}/p26-dnd4e-cards.png` });
  // Switches work without reload: card off → old keys read false; option off → that key false
  const after = await page.evaluate(async () => {
    const { dnd4eSetting } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/cards.mjs");
    await game.settings.set("lucd20-automations", "dnd4eClassFeatures_quarry", false);
    const a = [dnd4eSetting("enableQuarry"), dnd4eSetting("enableCurse")];
    await game.settings.set("lucd20-automations", "dnd4eClassFeatures_enabled", false);
    const b = [dnd4eSetting("enableCurse"), dnd4eSetting("enableCover")];
    return [a, b];
  });
  assert.deepStrictEqual(after, [[false, true], [false, true]], "option and card switches map onto the old keys");

  // ---------- Another system: nothing from 4e ----------
  page = await open("gm=1&system=pf2e");
  const other = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".lucd20-hub-tab")].map(t => t.dataset.category),
    api: !!game.modules.get("lucd20-automations").api?.dnd4e,
    hooks: ["dnd4e.usePower", "dnd4e.rollAttack", "preCreateChatMessage"].map(h => (Hooks._h[h] ?? []).length)
  }));
  console.log(other);
  assert.ok(!other.tabs.includes("dnd4e"), "no 4e category in PF2e");
  assert.ok(!other.api, "no 4e API in PF2e");
  assert.deepStrictEqual(other.hooks.slice(0, 2), [0, 0], "no 4e hooks in PF2e");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 26 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
