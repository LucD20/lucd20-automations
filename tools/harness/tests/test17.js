const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 16: Active Effect Highlight, Scene Navigation, Scene Palette. */
async function setupMocks(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    // Token HUD status palette
    const hud = document.createElement("div");
    hud.id = "token-hud";
    hud.style.cssText = "position:fixed;left:20px;top:20px;background:#111;padding:6px";
    hud.innerHTML = `<div class="status-effects" style="display:grid;grid-template-columns:repeat(4,28px);gap:4px">
      ${["blind", "dead", "prone", "stunned"].map((s, i) => `<img class="effect-control ${i % 2 ? "active" : ""}" data-status-id="${s}" src="icons/goblin.webp" style="width:24px;height:24px;opacity:${i % 2 ? 1 : 0.5}">`).join("")}</div>`;
    document.body.append(hud);
    // Scenes sidebar
    const scenes = [
      { id: "sA", name: "Goblin Cave", navigation: true },
      { id: "sB", name: "Town Square", navigation: false }
    ].map(s => Object.assign(s, {
      viewed: 0,
      view() { this.viewed++; window.__viewed = this.id; },
      async update(d) { Object.assign(this, d); Hooks.callAll("updateScene", this, d, {}); __drawScenes(); },
      sheet: { render() { window.__sheet = true; } }
    }));
    game.scenes = Object.assign(scenes, { get: id => scenes.find(s => s.id === id) });
    const dir = document.createElement("section");
    dir.id = "scenes";
    dir.style.cssText = "position:fixed;right:0;top:0;width:280px;background:#222;color:#ddd";
    document.body.append(dir);
    window.__drawScenes = () => {
      dir.innerHTML = `<header class="directory-header"><button class="create">Create</button></header><ol class="directory-list">
        ${scenes.map(s => `<li class="directory-item entry scene" data-entry-id="${s.id}" style="display:flex;align-items:center;padding:4px"><a class="entry-name" style="flex:1">${s.name}</a></li>`).join("")}</ol>`;
    };
    __drawScenes();
    // Foundry's own handler: opens the sheet
    dir.addEventListener("click", e => { const li = e.target.closest("[data-entry-id]"); if (li) window.__sheetFor = li.dataset.entryId; });
    ui.scenes = { element: dir };
    // Scene navigation bar
    window.__nav = { expanded: true, collapse() { this.expanded = false; }, expand() { this.expanded = true; } };
    ui.nav = __nav;
    game.combats = [];
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);
  await setupMocks(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  // ---------- Active Effect Highlight ----------
  await set("statusHighlight_enabled", true);
  await page.waitForTimeout(50);
  const looks = await page.$$eval("#token-hud .effect-control", els => els.map(e => [e.classList.contains("active"), getComputedStyle(e).borderTopWidth, getComputedStyle(e).boxShadow !== "none"]));
  assert.deepStrictEqual(looks.map(l => l[1]), ["0px", "2px", "0px", "2px"], "only active effects get a border");
  assert.ok(looks[1][2] && !looks[0][2], "active effects glow");
  await set("statusHighlight_color", "#00c8ff");
  await page.waitForTimeout(50);
  assert.ok((await page.$eval("#token-hud .effect-control.active", e => getComputedStyle(e).borderTopColor)).includes("0, 200, 255"), "color option");
  await page.screenshot({ path: `${out}/p16-status.png`, clip: { x: 10, y: 10, width: 150, height: 50 } });
  await set("statusHighlight_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$eval("#token-hud .effect-control.active", e => getComputedStyle(e).borderTopWidth), "0px", "off without reload");

  // ---------- Scene Navigation ----------
  await set("sceneNavigation_enabled", true);
  await page.waitForTimeout(80);
  assert.strictEqual(await page.$$eval("#scenes .lucd20-scene-nav", e => e.length), 2, "compass on each scene");
  assert.deepStrictEqual(await page.$$eval("#scenes .lucd20-scene-nav", e => e.map(b => b.classList.contains("on"))), [true, false]);
  await page.click('#scenes [data-entry-id="sB"] .entry-name');
  assert.deepStrictEqual(await page.evaluate(() => [window.__viewed, window.__sheetFor]), ["sB", undefined], "left-click views, no sheet");
  await page.click('#scenes [data-entry-id="sB"] .lucd20-scene-nav');
  await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => game.scenes.get("sB").navigation), true, "compass toggles navigation");
  assert.deepStrictEqual(await page.$$eval("#scenes .lucd20-scene-nav", e => e.map(b => b.classList.contains("on"))), [true, true], "redrawn after the update");
  assert.strictEqual(await page.evaluate(() => window.__viewed), "sB", "compass click doesn't view");
  await page.screenshot({ path: `${out}/p16-scenes.png`, clip: { x: 720, y: 0, width: 280, height: 90 } });
  // option off → Foundry's click
  await set("sceneNavigation_clickToView", false);
  await page.click('#scenes [data-entry-id="sA"] .entry-name');
  assert.strictEqual(await page.evaluate(() => window.__sheetFor), "sA", "option off: Foundry opens the settings");
  await set("sceneNavigation_navToggle", false);
  await page.waitForTimeout(80);
  assert.strictEqual(await page.$$eval(".lucd20-scene-nav", e => e.length), 0, "toggle option off");
  // Collapse during combat
  await page.evaluate(() => { const c = { id: "c1", started: true }; game.combats.push(c); Hooks.callAll("updateCombat", c, { round: 1 }, {}); });
  assert.strictEqual(await page.evaluate(() => __nav.expanded), false, "collapsed on combat start");
  await page.evaluate(() => { const c = game.combats.pop(); Hooks.callAll("deleteCombat", c, {}, "u1"); });
  assert.strictEqual(await page.evaluate(() => __nav.expanded), true, "re-opened on end");
  // Was already collapsed by the user → left collapsed after combat
  await page.evaluate(() => { __nav.expanded = false; const c = { id: "c2", started: true }; game.combats.push(c); Hooks.callAll("updateCombat", c, { round: 1 }, {}); game.combats.pop(); Hooks.callAll("deleteCombat", c, {}, "u1"); });
  assert.strictEqual(await page.evaluate(() => __nav.expanded), false, "user's own collapse kept");
  await set("sceneNavigation_enabled", false);

  // ---------- Scene Palette ----------
  await set("scenePalette_enabled", true);
  const imgSrc = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 100; c.height = 100;
    const ctx = c.getContext("2d");
    const fills = [["#1b3a5c", 0, 0, 100, 50], ["#c9a227", 0, 50, 50, 50], ["#7a2e1d", 50, 50, 30, 50], ["#2f6b2f", 80, 50, 20, 25], ["#e8e1d0", 80, 75, 20, 25]];
    for (const [f, x, y, w, h] of fills) { ctx.fillStyle = f; ctx.fillRect(x, y, w, h); }
    return c.toDataURL("image/png");
  });
  await page.evaluate(src => {
    const app = document.createElement("div");
    app.className = "application scene-config";
    app.id = "SceneConfig-Scene-sA";
    app.style.cssText = "position:fixed;left:200px;top:120px;width:420px;background:#2a2a2a;color:#ddd;padding:8px";
    app.innerHTML = `<form><fieldset><legend>Current Level</legend>
      <div class="form-group"><label>Background image</label><div class="form-fields"><input type="text" name="levels.l1.background.src" value="${src}"></div></div>
      <div class="form-group"><label>Background color</label><div class="form-fields"><input type="color" name="levels.l1.background.color" value="#000000"></div></div>
      </fieldset></form>`;
    document.body.append(app);
    window.__changes = 0;
    app.querySelector("[name$='background.color']").addEventListener("change", () => __changes++);
  }, imgSrc);
  await page.waitForTimeout(400);
  const swatches = await page.$$eval(".lucd20-palette .lucd20-swatch", e => e.map(s => s.dataset.color));
  console.log("Swatches:", swatches);
  assert.strictEqual(swatches.length, 5, "five swatches");
  assert.ok(swatches[0] === "#1b3a5c", "most common color first");
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const near = (a, b) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) <= 6);
  for (const c of ["#c9a227", "#7a2e1d", "#2f6b2f", "#e8e1d0"]) assert.ok(swatches.some(s => near(s, c)), `has ${c}`);
  await page.click(`.lucd20-swatch[data-color="${swatches[1]}"]`);
  assert.deepStrictEqual(await page.evaluate(() => [document.querySelector("[name$='background.color']").value, __changes]), [swatches[1], 1], "click sets the color");
  await page.screenshot({ path: `${out}/p16-palette.png`, clip: { x: 190, y: 110, width: 440, height: 140 } });
  // Image cleared → swatches gone
  await page.evaluate(() => { const f = document.querySelector("[name$='background.src']"); f.value = ""; f.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval(".lucd20-palette", e => e.length), 0, "no image: no swatches");
  await set("scenePalette_enabled", false);

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 16 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
