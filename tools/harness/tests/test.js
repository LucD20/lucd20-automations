const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async query => {
    const page = await browser.newPage({ viewport: { width: 960, height: 740 } });
    page.on("pageerror", e => errors.push(`${query}: ${e.message}`));
    page.on("console", m => m.type() === "error" && errors.push(`${query}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${query}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 10000 });
    return page;
  };

  // --- GM view, PF2e ---
  let page = await open("gm=1&system=pf2e");
  await page.screenshot({ path: `${out}/gm-combat.png` });
  const tabs = await page.$$eval(".lucd20-hub-tab .label", els => els.map(e => e.textContent));
  console.log("GM tabs:", tabs.join(" | "));
  assert.deepStrictEqual(tabs, ["Combat", "Chat", "Tokens & Placement", "GM Vision", "Sheets & Windows", "Statistics", "Player Settings", "Exploration"]);
  assert.strictEqual(await page.textContent('.lucd20-hub-tab[data-category="combat"] .count'), "1/5");
  assert.deepStrictEqual(await page.evaluate(() => __log), ["enable"]);

  // PF2e group shown, dependent option hidden until its checkbox is on
  assert.ok(await page.isVisible("text=Use PF2e disposition colors"));
  assert.ok(!(await page.isVisible("text=Extra size")));
  await page.check('input[name="demoMarker_pf2eExtra"]');
  assert.ok(await page.isVisible("text=Extra size"));

  // change a number → saved
  await page.fill('input[name="demoMarker_scale"]', "2.5");
  await page.press('input[name="demoMarker_scale"]', "Tab");
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => __values.get("lucd20-automations.demoMarker_scale")), 2.5);

  // turn off → options hidden, disable() called, count updated
  await page.waitForTimeout(100);
  await page.evaluate(() => { __log.length = 0; });
  await page.click('.lucd20-feature[data-feature="demoMarker"] .lucd20-switch');
  await page.waitForTimeout(100);
  assert.ok(!(await page.isVisible("text=Marker image")));
  assert.deepStrictEqual(await page.evaluate(() => __log), ["disable"]);
  assert.strictEqual(await page.textContent('.lucd20-hub-tab[data-category="combat"] .count'), "0/5");
  await page.click('.lucd20-feature[data-feature="demoMarker"] .lucd20-switch');
  await page.waitForTimeout(100);
  assert.deepStrictEqual(await page.evaluate(() => __log), ["disable", "enable"]);

  // setting change restarts the feature (debounced)
  await page.selectOption('select[name="demoMarker_mode"]', "a");
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await page.evaluate(() => __log), ["disable", "enable", "disable", "enable"]);

  // requiresReload setting → reload
  await page.check('input[name="demoMarker_reloadMe"]');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => window.__reloaded), true);

  await page.screenshot({ path: `${out}/gm-combat-edited.png` });

  // categories
  await page.click('.lucd20-hub-tab[data-category="exploration"]');
  await page.screenshot({ path: `${out}/gm-exploration.png` });
  assert.ok(await page.isVisible("text=Search Automation"));

  // search across categories
  await page.fill("input[data-search]", "rotation");
  await page.screenshot({ path: `${out}/gm-search.png` });
  assert.ok(await page.isVisible('.lucd20-feature[data-feature="demoMarker"] >> text=Rotation speed'));
  assert.ok(!(await page.isVisible("text=Marker image")));
  assert.ok(!(await page.isVisible("text=Search Automation")));
  assert.ok(!(await page.isVisible(".lucd20-group-label")));
  await page.fill("input[data-search]", "pin");
  assert.ok(await page.isVisible("text=Chat Pins"));
  await page.fill("input[data-search]", "zzzz");
  assert.ok(await page.isVisible("text=No settings match your search."));
  await page.fill("input[data-search]", "");

  // reset
  await page.click('.lucd20-hub-tab[data-category="combat"]');
  await page.click('.lucd20-feature[data-feature="demoMarker"] .lucd20-feature-reset');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => __values.get("lucd20-automations.demoMarker_scale")), 1.2);
  assert.strictEqual(await page.evaluate(() => __values.get("lucd20-automations.demoMarker_enabled")), true);

  // light theme screenshot
  page = await open("gm=1&system=pf2e&light=1");
  await page.screenshot({ path: `${out}/gm-light.png` });

  // --- GM view, 4e: no Exploration, no PF2e group ---
  page = await open("gm=1&system=dnd4e");
  const tabs4e = await page.$$eval(".lucd20-hub-tab .label", els => els.map(e => e.textContent));
  assert.ok(!tabs4e.includes("Exploration"));
  assert.ok(!(await page.isVisible("text=Use PF2e disposition colors")));
  assert.strictEqual(await page.evaluate(() => __registered.has("lucd20-automations.demoMarker_pf2eExtra")), false);

  // --- Player view ---
  page = await open("gm=0&system=pf2e");
  await page.screenshot({ path: `${out}/player.png` });
  const ptabs = await page.$$eval(".lucd20-hub-tab .label", els => els.map(e => e.textContent));
  console.log("Player tabs:", ptabs.join(" | "));
  assert.deepStrictEqual(ptabs, ["Combat", "Sheets & Windows"]);
  assert.ok(await page.isVisible("text=Show for me"));
  assert.ok(!(await page.isVisible("text=Marker image")));
  assert.ok(!(await page.isVisible('.lucd20-feature[data-feature="demoMarker"] .lucd20-switch')));
  // player can toggle their own client feature
  await page.click('.lucd20-hub-tab[data-category="sheets"]');
  await page.click('.lucd20-feature[data-feature="demoClient"] .lucd20-switch');
  await page.waitForTimeout(100);
  assert.deepStrictEqual(await page.evaluate(() => __log), ["enable", "ctb-enable"]);

  await browser.close();
  if (errors.length) {
    console.log("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
