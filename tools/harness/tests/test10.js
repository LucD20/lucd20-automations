const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const errors = [];
  const open = async (q, preset) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    const p = preset ? `&preset=${encodeURIComponent(JSON.stringify(preset))}` : "";
    await page.goto(`http://localhost:8765/index.html?${q}${p}`);
    await page.waitForFunction(() => window.__done);
    await page.evaluate(() => { document.querySelector(".lucd20-hub").style.display = "none"; document.getElementById("core-config").style.display = "none"; });
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  // ===== Features already on when the page loads (= after a reload); UI appears later, no hooks =====
  let page = await open("gm=1&system=pf2e", {
    [`${M}.cleanTitleBars_enabled`]: true,
    [`${M}.diceStats_enabled`]: true,
    [`${M}.diceStats_askNewSession`]: false
  });
  await page.evaluate(() => {
    const win = document.createElement("div");
    win.className = "app window-app";
    win.innerHTML = `<header class="window-header"><h4 class="window-title">Amiri</h4><a class="header-button control configure-sheet"><i class="fas fa-cog"></i>Sheet</a><a class="header-button control close"><i class="fas fa-times"></i>Close</a></header>`;
    document.body.append(win);
    const dir = document.createElement("section");
    dir.id = "actors";
    dir.innerHTML = `<ol class="directory-list"></ol><footer class="directory-footer"></footer>`;
    document.body.append(dir);
  });
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await page.$$eval(".window-app .header-button", els => els.map(e => e.textContent.trim())), ["", ""], "title bar cleaned after reload without hooks");
  assert.strictEqual(await page.$$eval("#actors .directory-footer .lucd20-dice-stats-open", e => e.length), 1, "Dice Stats button appears without hooks");
  // re-drawn footer → button comes back
  await page.evaluate(() => { document.querySelector("#actors .directory-footer").innerHTML = ""; });
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$$eval("#actors .lucd20-dice-stats-open", e => e.length), 1);

  // ===== GM Vision, core implementation (4e) =====
  page = await open("gm=1&system=dnd4e");
  await page.evaluate(() => {
    window.__envInit = 0;
    window.canvas = { ready: true, activeLayer: {}, environment: { initialize() { __envInit++; } }, tokens: { placeables: [] }, perception: { update() {} } };
    ui.controls = { render() { window.__controlsRendered = (window.__controlsRendered ?? 0) + 1; } };
  });
  assert.ok(await page.evaluate(() => !!__keybindings["lucd20-automations.gmVision"]), "Ctrl+G registered for systems without their own");
  await set(page, "gmVision_enabled", true);
  await page.waitForTimeout(100);
  const proto = () => page.evaluate(() => new CONFIG.Token.objectClass()._isVisionSource());
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0xd1ccff, "on at startup, PF2e look");
  assert.strictEqual(await proto(), false, "tokens are not vision sources for the GM");
  const icon = () => page.evaluate(() => { const c = { lighting: { icon: "fa-solid fa-lightbulb", tools: {} } }; Hooks.callAll("getSceneControlButtons", c); return c.lighting.icon; });
  assert.ok((await icon()).includes("fa-lightbulb-cfl-on"));
  // toggle tool in the Lighting controls (besides Ctrl+G)
  const tool = await page.evaluate(() => { const c = { lighting: { icon: "", tools: { day: { order: 3 } } } }; Hooks.callAll("getSceneControlButtons", c); return c.lighting.tools.lucd20GmVision; });
  assert.ok(tool && tool.toggle && tool.active === true && tool.order === 4);
  await page.evaluate(() => { const c = { lighting: { icon: "", tools: {} } }; Hooks.callAll("getSceneControlButtons", c); c.lighting.tools.lucd20GmVision.onChange(new Event("click"), false); });
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0x242448, "tool switches it off");
  await page.evaluate(() => { const c = { lighting: { icon: "", tools: {} } }; Hooks.callAll("getSceneControlButtons", c); c.lighting.tools.lucd20GmVision.onChange(new Event("click"), true); });
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0xd1ccff, "and on again");
  // Ctrl+G toggles
  await page.evaluate(() => __keybindings["lucd20-automations.gmVision"].onDown());
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0x242448);
  assert.strictEqual(await proto(), true);
  assert.strictEqual(await icon(), "fa-solid fa-lightbulb");
  await page.evaluate(() => __keybindings["lucd20-automations.gmVision"].onDown());
  // brightness
  await set(page, "gmVision_brightness", 0.5);
  await page.waitForTimeout(50);
  const half = await page.evaluate(() => CONFIG.Canvas.darknessColor.toString(16));
  console.log("brightness 0.5 →", half);
  assert.strictEqual(half, "7b78a4");
  await set(page, "gmVision_brightness", 1.5);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0xffffff);
  // switched off → everything back
  await set(page, "gmVision_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0x242448);
  assert.strictEqual(await proto(), true);
  // hidden from players in the settings window
  const playerPage = await open("gm=0&system=dnd4e");
  assert.strictEqual(await playerPage.$$eval('.lucd20-feature[data-feature="gmVision"], .lucd20-feature[data-feature="outOfSightOutlines"]', e => e.length), 0);

  // ===== GM Vision, PF2e drives the system's own =====
  page = await open("gm=1&system=pf2e");
  assert.ok(await page.evaluate(() => !__keybindings["lucd20-automations.gmVision"]), "PF2e keeps its own Ctrl+G");
  await page.evaluate(() => { window.canvas = { ready: true, environment: { initialize() {} }, tokens: { placeables: [] }, perception: { update() {} } }; });
  await set(page, "gmVision_enabled", true);
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => game.settings.get("pf2e", "gmVision")), true, "PF2e GM vision switched on at startup");
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor), 0xd1ccff);
  await set(page, "gmVision_brightness", 0.5);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => CONFIG.PF2E.Canvas.darkness.gmVision.toString(16)), "7b78a4");
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor.toString(16)), "7b78a4", "applied while on");
  // PF2e's own toggle uses our color
  await page.evaluate(() => game.settings.set("pf2e", "gmVision", false));
  await page.evaluate(() => game.settings.set("pf2e", "gmVision", true));
  assert.strictEqual(await page.evaluate(() => CONFIG.Canvas.darknessColor.toString(16)), "7b78a4");
  await set(page, "gmVision_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => CONFIG.PF2E.Canvas.darkness.gmVision), 0xd1ccff, "PF2e color restored");

  // ===== Out-of-sight outlines: tokens hidden from the GM's current view =====
  page = await open("gm=1&system=dnd4e");
  await page.evaluate(async () => {
    const app = new PIXI.Application({ width: 900, height: 500, background: 0x2b2f2b, antialias: true });
    document.body.append(app.view);
    app.view.style.cssText = "position:absolute;left:0;top:0";
    const tokensLayer = new PIXI.Container(), iface = new PIXI.Container(), fog = new PIXI.Graphics();
    const g = new PIXI.Graphics(); g.lineStyle(1, 0x444444);
    for (let x = 0; x <= 900; x += 100) g.moveTo(x, 0).lineTo(x, 500);
    for (let y = 0; y <= 500; y += 100) g.moveTo(0, y).lineTo(900, y);
    fog.beginFill(0x000000, 0.6).drawPolygon([480, 0, 900, 0, 900, 500, 600, 500, 420, 260]).endFill(); // what the selected token can't see
    app.stage.addChild(g, tokensLayer, fog, iface);
    const mk = (name, x, y, size, color, opts = {}) => {
      const t = new PIXI.Container();
      Object.assign(t, { x, y, w: size * 100, h: size * 100 });
      t.document = { disposition: opts.disposition ?? -1 };
      t.isVisible = opts.visible ?? true;
      t.visible = t.isVisible; // Foundry hides what the GM can't see
      const art = new PIXI.Graphics(); art.beginFill(color).drawCircle(t.w / 2, t.h / 2, t.w * 0.38).endFill();
      const label = new PIXI.Text(name, { fontSize: 12, fill: 0xffffff }); label.position.set(6, 4);
      t.addChild(art, label);
      tokensLayer.addChild(t);
      return t;
    };
    const T = {
      amiri: mk("Amiri", 100, 200, 1, 0x3366cc, { disposition: 1 }),
      droven: mk("Droven", 300, 350, 1, 0x996633, { disposition: 1 }),
      boar: mk("Boar", 600, 100, 1, 0xaa5533, { visible: false }),
      ogre: mk("Ogre", 650, 300, 2, 0x884422, { visible: false }),
      merchant: mk("Merchant", 520, 380, 1, 0xccaa33, { disposition: 0, visible: false })
    };
    window.__T = T;
    window.canvas = { ready: true, interface: iface, tokens: { placeables: Object.values(T) }, environment: { initialize() {} }, perception: { update() {} } };
  });
  await set(page, "gmVision_onAtStartup", false);
  await set(page, "gmVision_enabled", true);
  await set(page, "outOfSightOutlines_enabled", true);
  await page.waitForTimeout(300);
  const outlined = () => page.evaluate(() => canvas.interface.children[0]?.children.map(gr => Object.keys(__T).find(k => __T[k].x === gr.x && __T[k].y === gr.y)) ?? []);
  let o = await outlined();
  console.log("outlined (real vision):", o);
  assert.deepStrictEqual(o.sort(), ["boar", "merchant", "ogre"], "only tokens the GM can't see");
  await page.screenshot({ path: `${out}/p10-outlines.png`, clip: { x: 0, y: 0, width: 900, height: 500 } });
  // GM Vision on → GM sees everything → no outlines
  await page.evaluate(() => { for (const t of Object.values(__T)) { t.isVisible = true; t.visible = true; } __keybindings["lucd20-automations.gmVision"].onDown(); });
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await outlined(), [], "nothing outlined when the whole map is visible");
  // back to real vision; boar walks into view
  await page.evaluate(() => { __keybindings["lucd20-automations.gmVision"].onDown(); for (const k of ["ogre", "merchant"]) { __T[k].isVisible = false; __T[k].visible = false; } Hooks.callAll("sightRefresh"); });
  await page.waitForTimeout(300);
  assert.deepStrictEqual((await outlined()).sort(), ["merchant", "ogre"]);
  await set(page, "outOfSightOutlines_shape", "square");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/p10-outlines-square.png`, clip: { x: 0, y: 0, width: 900, height: 500 } });
  await set(page, "outOfSightOutlines_enabled", false);
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => canvas.interface.children.length), 0, "layer removed");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 9 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
