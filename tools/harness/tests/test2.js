const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, preset) => {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    page.on("pageerror", e => errors.push(`${query}: ${e.message}`));
    page.on("console", m => m.type() === "error" && errors.push(`${query}: ${m.text()}`));
    const p = preset ? `&preset=${encodeURIComponent(JSON.stringify(preset))}` : "";
    await page.goto(`http://localhost:8765/index.html?${query}${p}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 10000 });
    return page;
  };
  const rules = page => page.evaluate(() => __values.get("lucd20-automations.forceSettings_rules"));

  // ---------- GM ----------
  let page = await open("gm=1");
  // feature off by default → no lock buttons
  assert.strictEqual(await page.$$eval(".lucd20-hub .lucd20-lock", e => e.length), 0);
  await page.click('.lucd20-hub-tab[data-category="playerSettings"]');
  await page.click('.lucd20-feature[data-feature="forceSettings"] .lucd20-switch');
  await page.waitForTimeout(100);
  assert.ok(await page.isVisible("text=No forced settings yet."));
  // lock buttons appear for per-player settings only (Show for me + demoClient switch)
  const lockKeys = await page.$$eval(".lucd20-hub button.lucd20-lock", els => els.map(e => e.dataset.key));
  console.log("GM lock buttons:", lockKeys.join(", "));
  for (const k of [`${M}.demoClient_compact`, `${M}.demoClient_enabled`, `${M}.demoMarker_myClient`, `${M}.cleanTitleBars_enabled`, `${M}.headerButtons_extras`]) assert.ok(lockKeys.includes(k), k);
  assert.ok(!lockKeys.includes(`${M}.demoMarker_scale`), "no lock on world settings");

  // lock "Show for me" (GM value true)
  await page.click('.lucd20-hub-tab[data-category="combat"]');
  await page.click(`button.lucd20-lock[data-key="${M}.demoMarker_myClient"]`);
  await page.waitForTimeout(100);
  let r = await rules(page);
  assert.strictEqual(r[`${M}.demoMarker_myClient`].mode, "lock");
  assert.strictEqual(r[`${M}.demoMarker_myClient`].value, true);
  assert.ok((await page.evaluate(() => __dialogContent)).includes("Demo Marker: Show for me"));
  // GM still edits own value freely (exempt)
  await page.uncheck(`input[name="demoMarker_myClient"]`);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => game.settings.get("lucd20-automations", "demoMarker_myClient")), false);
  assert.ok(await page.isVisible(`button.lucd20-lock.mode-lock[data-key="${M}.demoMarker_myClient"]`));

  // Shift+click = Default, Ctrl+click = Locked (no dialog)
  await page.evaluate(() => { window.__dialogContent = null; });
  await page.click('.lucd20-hub-tab[data-category="sheets"]');
  await page.click(`button.lucd20-lock[data-key="${M}.demoClient_enabled"]`, { modifiers: ["Shift"] });
  await page.waitForTimeout(100);
  assert.strictEqual((await rules(page))[`${M}.demoClient_enabled`].mode, "default");
  await page.click(`button.lucd20-lock[data-key="${M}.demoClient_enabled"]`, { modifiers: ["Control"] });
  await page.waitForTimeout(100);
  assert.strictEqual((await rules(page))[`${M}.demoClient_enabled`].mode, "lock");
  assert.strictEqual(await page.evaluate(() => window.__dialogContent), null, "no dialog for shortcuts");
  // scroll kept on re-render
  await page.click('.lucd20-hub-tab[data-category="combat"]');
  await page.evaluate(() => { document.querySelector(".lucd20-hub-content").scrollTop = 120; });
  const before = await page.evaluate(() => document.querySelector(".lucd20-hub-content").scrollTop);
  console.log("scrollTop before re-render:", before);
  assert.ok(before > 50);
  await page.evaluate(() => __hub.render());
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => document.querySelector(".lucd20-hub-content").scrollTop), before, "scroll kept");
  await page.evaluate(() => game.settings.set("lucd20-automations", "forceSettings_rules",
    Object.fromEntries(Object.entries(game.settings.get("lucd20-automations", "forceSettings_rules")).filter(([k]) => !k.includes("demoClient")))));
  await page.click('.lucd20-hub-tab[data-category="combat"]');

  // core settings window: buttons for client settings only
  await page.evaluate(() => __decorateCore());
  const coreButtons = await page.$$eval("#core-config button.lucd20-lock", els => els.map(e => e.closest(".form-group").querySelector("[name]").name));
  assert.deepStrictEqual(coreButtons, ["core.fontSize", "other.mode"]);
  // lock sits beside the label text
  const box = await page.evaluate(() => {
    const label = document.querySelector('#core-config label[for="c1"]'); const btn = label.querySelector("button");
    const t = document.createRange(); t.selectNodeContents(label.firstChild); const tr = t.getBoundingClientRect(); const br = btn.getBoundingClientRect();
    return { textRight: tr.right, textTop: tr.top, btnLeft: br.left, btnTop: br.top, btnW: br.width };
  });
  assert.ok(box.btnLeft >= box.textRight - 1 && Math.abs(box.btnTop - box.textTop) < 12 && box.btnW <= 24, JSON.stringify(box));
  await page.evaluate(() => {
    window.__dialogMode = "default";
    const el = document.getElementById("core-config");
    class SettingsConfig { constructor() { this.id = "settings-config"; this.element = el; this.rendered = true; } render() { window.__coreRerendered = true; } }
    foundry.applications.settings = { SettingsConfig };
    foundry.applications.instances.set("settings-config", new SettingsConfig());
  });
  await page.click('#core-config .form-group:nth-child(2) button.lucd20-lock');
  await page.waitForTimeout(100);
  r = await rules(page);
  assert.strictEqual(r["other.mode"].mode, "default");
  assert.ok(!(await page.evaluate(() => window.__coreRerendered)), "core window not re-rendered");
  assert.ok(await page.isVisible('#core-config .form-group:nth-child(2) button.lucd20-lock.mode-default'), "core lock updated in place");
  await page.screenshot({ path: `${out}/p2-core-gm.png`, clip: { x: 0, y: 700, width: 700, height: 120 } });
  assert.strictEqual(r["other.mode"].value, "a");

  // panel lists both; screenshot
  await page.click('.lucd20-hub-tab[data-category="playerSettings"]');
  await page.waitForTimeout(100);
  const rows = await page.$$eval(".lucd20-forced-list tbody tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
  console.log("Panel rows:", rows);
  assert.strictEqual(rows.length, 2);
  await page.screenshot({ path: `${out}/p2-gm-panel.png`, clip: { x: 0, y: 0, width: 960, height: 900 } });

  // toggle mode, refresh value, remove
  await page.click(`.lucd20-forced-list button[data-feature-action="toggleMode"][data-key="${M}.demoMarker_myClient"]`);
  await page.waitForTimeout(100);
  r = await rules(page);
  assert.strictEqual(r[`${M}.demoMarker_myClient`].mode, "default");
  assert.strictEqual(r[`${M}.demoMarker_myClient`].value, true, "toggle keeps forced value");
  await page.click(`.lucd20-forced-list button[data-feature-action="refreshValue"][data-key="${M}.demoMarker_myClient"]`);
  await page.waitForTimeout(100);
  assert.strictEqual((await rules(page))[`${M}.demoMarker_myClient`].value, false, "refresh takes GM's current value");
  await page.click(`.lucd20-forced-list button[data-feature-action="remove"][data-key="other.mode"]`);
  await page.waitForTimeout(100);
  assert.ok(!("other.mode" in (await rules(page))));

  // switching feature off removes lock buttons
  await page.click('.lucd20-feature[data-feature="forceSettings"] .lucd20-switch');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval(".lucd20-hub button.lucd20-lock", e => e.length), 0);

  // ---------- Player ----------
  const preset = {
    [`${M}.forceSettings_enabled`]: true,
    [`${M}.forceSettings_rules`]: {
      [`${M}.demoMarker_myClient`]: { mode: "lock", value: false, stamp: 1 },
      [`${M}.demoClient_enabled`]: { mode: "lock", value: true, stamp: 1 },
      "core.fontSize": { mode: "lock", value: 7, stamp: 1 },
      "other.mode": { mode: "default", value: "b", stamp: 5 }
    }
  };
  page = await open("gm=0", preset);
  const v = (ns, k) => page.evaluate(([ns, k]) => game.settings.get(ns, k), [ns, k]);
  assert.strictEqual(await v("core", "fontSize"), 7, "locked value read");
  assert.strictEqual(await page.evaluate(() => __values.get("core.fontSize")), 7, "locked value written to storage");
  await page.evaluate(() => game.settings.set("core", "fontSize", 9));
  assert.strictEqual(await v("core", "fontSize"), 7, "player cannot change locked");
  assert.strictEqual(await v("other", "mode"), "b", "default applied");
  await page.evaluate(() => game.settings.set("other", "mode", "a"));
  assert.strictEqual(await v("other", "mode"), "a", "player can change default");
  assert.deepStrictEqual(await page.evaluate(() => __values.get("lucd20-automations.forceSettings_appliedDefaults")), { "other.mode": 5 });
  assert.ok((await page.evaluate(() => __log)).includes("ctb-enable"), "locked-on client feature started");

  // hub: locked inputs disabled
  assert.ok(await page.isDisabled('input[name="demoMarker_myClient"]'));
  assert.ok(!(await page.isChecked('input[name="demoMarker_myClient"]')));
  assert.strictEqual(await page.$$eval(".lucd20-hub button.lucd20-lock", e => e.length), 0, "players get no lock buttons");
  await page.screenshot({ path: `${out}/p2-player-combat.png`, clip: { x: 0, y: 0, width: 960, height: 720 } });
  await page.click('.lucd20-hub-tab[data-category="sheets"]');
  assert.ok(await page.isDisabled('input[name="demoClient_enabled"]'));
  assert.ok(await page.isChecked('input[name="demoClient_enabled"]'));

  // core window: fontSize disabled, other.mode not
  await page.evaluate(() => __decorateCore());
  assert.ok(await page.isDisabled('#core-config [name="core.fontSize"]'));
  assert.ok(!(await page.isDisabled('#core-config [name="other.mode"]')));
  assert.strictEqual(await page.$$eval("#core-config button", e => e.length), 0);
  await page.screenshot({ path: `${out}/p2-player-core.png`, clip: { x: 0, y: 700, width: 700, height: 160 } });

  // stopping the feature releases locks
  await page.evaluate(() => game.settings.set("lucd20-automations", "forceSettings_enabled", false));
  await page.evaluate(() => game.settings.set("core", "fontSize", 9));
  assert.strictEqual(await v("core", "fontSize"), 9, "unlocked after feature off");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 2 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
