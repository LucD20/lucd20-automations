const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 22: Token Scatter. */
async function setup(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    CONST.TOKEN_DISPLAY_MODES = { NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 };
    const app = new PIXI.Application({ width: 800, height: 600, background: 0x3a3f36 });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const grid = new PIXI.Graphics().lineStyle(1, 0x555555, 1);
    for (let x = 0; x <= 800; x += 100) grid.moveTo(x, 0).lineTo(x, 600);
    for (let y = 0; y <= 600; y += 100) grid.moveTo(0, y).lineTo(800, y);
    app.stage.addChild(grid);
    const meshes = app.stage.addChild(new PIXI.Container());
    const layer = app.stage.addChild(new PIXI.Container());
    const colors = { a: 0xd94c4c, b: 0x4c7bd9, c: 0x4cd98a, d: 0xd9c14c, e: 0xb04cd9, f: 0xffffff };
    const placeables = [];
    const mk = (id, x, y, w, elevation = 0, opts = {}) => {
      const doc = { id, name: opts.name ?? id.toUpperCase(), x, y, width: w, height: w, elevation, sort: opts.sort ?? 0, hidden: !!opts.hidden, isOwner: !!opts.owner, displayName: 50, texture: { src: "icons/goblin.webp" } };
      const t = new PIXI.Container();
      t.id = id; t.document = doc; t.visible = !opts.hidden; t.controlled = false; t.isTargeted = false;
      t.actor = { statuses: new Set(opts.dead ? ["dead"] : []) };
      const border = new PIXI.Graphics().lineStyle(3, 0xffffff, 0.9).drawRect(0, 0, w * 100, w * 100);
      t.addChild(border);
      t.position.set(x, y);
      const mesh = new PIXI.Graphics().beginFill(colors[id[0]] ?? 0x999999, 0.85).drawCircle(0, 0, w * 40).endFill();
      mesh.position.set(x + w * 50, y + w * 50);
      meshes.addChild(mesh);
      t.mesh = mesh;
      t.control = () => { t.controlled = true; window.__controlled = id; };
      t.setTarget = v => { t.isTargeted = v; window.__targeted = id; };
      layer.addChild(t);
      placeables.push(t);
      return t;
    };
    // Same square, same elevation: a1 a2 a3
    mk("a1", 100, 100, 1); mk("a2", 100, 100, 1); mk("a3", 100, 100, 1);
    // Partial overlap: b1 b2
    mk("b1", 400, 100, 1); mk("b2", 450, 100, 1);
    // Flyer over a large creature: c (Large on the ground) + d (flying 20 ft) + e (flying 30 ft)
    mk("c1", 200, 300, 2); mk("d1", 250, 350, 1, 20); mk("e1", 250, 350, 1, 30, { owner: true });
    // Dead overlap: f1 f2 (f2 dead)
    mk("f1", 600, 400, 1); mk("f2", 600, 400, 1, 0, { dead: true });
    // Hidden token stacked on b1 for players
    mk("h1", 400, 100, 1, 10, { hidden: true });
    Object.assign(canvas, { ready: true, stage: app.stage, app, dimensions: { size: 100 }, grid: { size: 100 }, scene: { grid: { units: "ft" } },
      tokens: { placeables, get: id => placeables.find(t => t.id === id) } });
    window.__tok = id => placeables.find(t => t.id === id);
    window.__app = app;
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=0");
  await page.waitForFunction(() => window.__done);
  await setup(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const offs = () => page.evaluate(() => Object.fromEntries(canvas.tokens.placeables.map(t => [t.id, [Math.round(t.position.x - t.document.x), Math.round(t.position.y - t.document.y)]])));
  const meshOff = id => page.evaluate(id => { const t = __tok(id); return [Math.round(t.mesh.position.x - (t.document.x + 50 * t.document.width)), Math.round(t.mesh.position.y - (t.document.y + 50 * t.document.height))]; }, id);

  assert.ok(await page.evaluate(() => game.settings.get("lucd20-automations", "tokenScatter_enabled")), "on by default");
  await set("tokenScatter_enabled", false);
  await set("tokenScatter_enabled", true);
  await page.waitForTimeout(250);
  let o = await offs();
  console.log("offsets:", o);
  // Same-square trio spread to different places
  const trio = [o.a1, o.a2, o.a3].map(p => p.join(","));
  assert.strictEqual(new Set(trio).size, 3, "stacked trio spread apart");
  assert.ok([o.a1, o.a2, o.a3].every(p => Math.hypot(...p) > 10), "each one moved");
  assert.deepStrictEqual(await meshOff("a1"), o.a1, "art moves with the token");
  // Partial overlap pushed apart along x
  assert.ok(o.b1[0] < 0 && o.b2[0] > 0, "partial overlap pushed apart");
  // Flyers over a Large creature spread too (any elevation)
  assert.ok([o.c1, o.d1, o.e1].every(p => p[0] || p[1]), "flyers spread over the creature below");
  // Dead token doesn't spread (f1 alone then)
  assert.deepStrictEqual([o.f1, o.f2], [[0, 0], [0, 0]], "defeated left alone");
  // Hidden token (h1 on b1, 10 ft) isn't counted for players: b1/b2 offsets are a plain pair
  assert.deepStrictEqual(o.h1, [0, 0], "hidden token not moved");
  assert.strictEqual(await page.$$eval(".lucd20-stack-badge", e => e.length), 0, "no badges any more");
  await page.screenshot({ path: `${out}/p22-scatter.png` });

  // A token moves away → re-layout (b2 leaves b1)
  await page.evaluate(() => { const t = __tok("b2"); t.document.x = 700; t.position.set(700, 100); t.mesh.position.set(750, 150); Hooks.callAll("updateToken", t.document, { x: 700 }, {}); });
  await page.waitForTimeout(400);
  o = await offs();
  assert.deepStrictEqual([o.b1, o.b2], [[0, 0], [0, 0]], "no longer overlapping: back in place");
  // Foundry re-positions a scattered token → offset re-applied
  await page.evaluate(() => { const t = __tok("a1"); t.position.set(t.document.x, t.document.y); t.mesh.position.set(t.document.x + 50, t.document.y + 50); Hooks.callAll("refreshToken", t, {}); });
  assert.notDeepStrictEqual((await offs()).a1, [0, 0], "offset survives Foundry's refresh");
  assert.deepStrictEqual(await meshOff("a1"), (await offs()).a1, "art too");

  // Off → everything back, badges gone
  await set("tokenScatter_enabled", false);
  o = await offs();
  assert.ok(Object.values(o).every(p => !p[0] && !p[1]), "off: all tokens back in place");
  assert.ok(await page.evaluate(() => Object.values(canvas.tokens.placeables).every(t => Math.round(t.mesh.position.x - t.document.x - 50 * t.document.width) === 0)), "art back too");
  assert.strictEqual(await page.$$eval(".lucd20-stack-badge", e => e.length), 0, "badges gone");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 22 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
