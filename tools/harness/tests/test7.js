const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);
  await page.evaluate(() => { const f = document.querySelector("form.lucd20-hub"); f.style.height = "960px"; });
  for (const k of ["turnMarker_enabled", "nextTurnMarker_enabled", "turnAnnouncer_enabled"]) await page.evaluate(k => game.settings.set("lucd20-automations", k, true), k);
  await page.evaluate(() => __hub.render());
  await page.waitForTimeout(200);

  // alignment: within each grid row, labels and controls start at the same y
  const rows = await page.evaluate(() => {
    const out = [];
    for (const grid of document.querySelectorAll(".lucd20-hub-category.active .lucd20-setting-grid")) {
      const cells = [...grid.children].filter(c => c.offsetParent);
      const byTop = new Map();
      for (const c of cells) {
        const top = Math.round(c.getBoundingClientRect().top);
        if (!byTop.has(top)) byTop.set(top, []);
        byTop.get(top).push({
          name: c.querySelector(".lucd20-setting-label").textContent.trim(),
          label: Math.round(c.querySelector(".lucd20-setting-label").getBoundingClientRect().bottom),
          control: Math.round(c.querySelector(".form-fields").getBoundingClientRect().top)
        });
      }
      out.push(...byTop.values());
    }
    return out;
  });
  for (const row of rows) {
    console.log(row.map(r => r.name).join("  |  "));
    if (row.length === 2) {
      assert.strictEqual(row[0].control, row[1].control, `controls aligned: ${row.map(r => r.name)}`);
      assert.strictEqual(row[0].label, row[1].label, `labels aligned: ${row.map(r => r.name)}`);
    }
  }
  assert.ok(rows.some(r => r.length === 2), "some options side by side");
  await page.screenshot({ path: `${out}/p7-layout-combat.png`, clip: { x: 0, y: 0, width: 960, height: 1000 } });

  // next marker: own size options hidden while "same size and speed" is on
  const visible = n => page.isVisible(`.lucd20-feature[data-feature="nextTurnMarker"] [name="nextTurnMarker_${n}"]`);
  assert.ok(!(await visible("scale")) && !(await visible("speed")) && !(await visible("followArtScale")));
  assert.ok(await visible("opacity"));
  await page.uncheck('[name="nextTurnMarker_matchTurnMarker"]');
  await page.waitForTimeout(100);
  assert.ok((await visible("scale")) && (await visible("speed")));
  // tint only when color = tint
  assert.ok(!(await visible("tint")));
  await page.selectOption('[name="nextTurnMarker_color"]', "tint");
  await page.waitForTimeout(100);
  assert.ok(await visible("tint"));
  await page.screenshot({ path: `${out}/p7-layout-next.png`, clip: { x: 0, y: 0, width: 960, height: 1000 } });

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("LAYOUT CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
