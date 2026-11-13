const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Flying Tokens (hover + ground shadow). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 700, height: 420 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=0");
  await page.waitForFunction(() => window.__done);
  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 700, height: 420, background: 0x6b7a4f });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const grid = new PIXI.Graphics().lineStyle(1, 0x55603d, 1);
    for (let x = 0; x <= 700; x += 100) grid.moveTo(x, 0).lineTo(x, 420);
    for (let y = 0; y <= 420; y += 100) grid.moveTo(0, y).lineTo(700, y);
    app.stage.addChild(grid);
    const primary = app.stage.addChild(new PIXI.Container());
    const placeables = [];
    const tex = await PIXI.Assets.load("icons/goblin.webp");
    const mk = (id, x, elevation, visible = true) => {
      const t = { id, visible, document: { id, x, y: 150, width: 1, height: 1, elevation } };
      const mesh = new PIXI.Sprite(tex);
      mesh.anchor.set(0.5); mesh.width = 100; mesh.height = 100;
      mesh.position.set(x + 50, 200);
      t.mesh = mesh;
      primary.addChild(mesh);
      placeables.push(t);
      return t;
    };
    mk("ground", 50, 0); mk("low", 250, 10); mk("high", 450, 40); mk("hidden", 600, 30, false);
    Object.assign(canvas, { ready: true, app, primary, stage: app.stage, dimensions: { size: 100, distance: 5 }, tokens: { placeables } });
    window.__tok = id => placeables.find(t => t.id === id);
  });
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  await set("flyingTokens_enabled", false);
  await set("flyingTokens_enabled", true);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ["ground", "low", "high", "hidden"].map(id => {
    const t = __tok(id);
    const shadow = canvas.primary.children.filter(c => c !== t.mesh && c instanceof PIXI.Graphics);
    return { id, pivot: [Math.round(t.mesh.pivot.x * 10) / 10, Math.round(t.mesh.pivot.y * 10) / 10] };
  }));
  console.log(info);
  const shadows = await page.evaluate(() => canvas.primary.children.filter(c => c instanceof PIXI.Graphics).map(g => ({ visible: g.visible, x: Math.round(g.position.x), y: Math.round(g.position.y), r: Math.round(g.scale.x * 50), a: +g.alpha.toFixed(2) })));
  console.log("shadows:", shadows);
  assert.deepStrictEqual(info[0].pivot, [0, 0], "ground token doesn't hover");
  assert.ok(info[1].pivot.some(v => v !== 0) || info[2].pivot.some(v => v !== 0), "flyers hover");
  assert.strictEqual(shadows.length, 3, "one shadow per flyer");
  const hidden = shadows.find(s => !s.visible);
  const [low, high] = shadows.filter(s => s.visible).sort((a, b) => a.x - b.x);
  assert.ok(high.y > low.y - 0 && (high.y - 200) > (low.y - 200), "higher → shadow falls further");
  assert.ok(high.r > low.r && high.a < low.a, "higher → bigger and fainter");
  assert.strictEqual(hidden.visible, false, "no shadow for a token this user can't see");
  // hover moves over time
  const p1 = await page.evaluate(() => __tok("low").mesh.pivot.y);
  await page.waitForTimeout(400);
  const p2 = await page.evaluate(() => __tok("low").mesh.pivot.y);
  assert.notStrictEqual(p1, p2, "hover animates");
  await page.screenshot({ path: `${out}/p22-flying.png` });
  // Lands → shadow gone, pivot back
  await page.evaluate(() => { const t = __tok("low"); t.document.elevation = 0; Hooks.callAll("updateToken", t.document, { elevation: 0 }, {}); });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => canvas.primary.children.filter(c => c instanceof PIXI.Graphics).length), 2, "landed: shadow removed");
  assert.deepStrictEqual(await page.evaluate(() => [__tok("low").mesh.pivot.x, __tok("low").mesh.pivot.y]), [0, 0], "landed: art back in place");
  await set("flyingTokens_enabled", false);
  assert.strictEqual(await page.evaluate(() => canvas.primary.children.filter(c => c instanceof PIXI.Graphics).length), 0, "off: shadows gone");
  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("FLYING TOKENS CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
