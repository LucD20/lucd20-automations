const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 60: Effects Halo — rings of round icons around tokens, under the tokens, only for tokens you see. */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 760, height: 420 } });
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=0");
  await page.waitForFunction(() => window.__done);
  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 760, height: 420, background: 0x6b7a4f });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const grid = new PIXI.Graphics().lineStyle(1, 0x55603d, 1);
    for (let x = 0; x <= 760; x += 100) grid.moveTo(x, 0).lineTo(x, 420);
    for (let y = 0; y <= 420; y += 100) grid.moveTo(0, y).lineTo(760, y);
    app.stage.addChild(grid);
    const primary = app.stage.addChild(new PIXI.Container());
    const interfaceLayer = app.stage.addChild(new PIXI.Container());
    const art = { valeros: await PIXI.Assets.load("icons/valeros.webp"), goblin: await PIXI.Assets.load("icons/goblin.webp"), ezren: await PIXI.Assets.load("icons/ezren.webp") };
    // Effect icons: coloured squares with a mark, as Foundry's icon sprites would hold.
    const COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xd35400, 0x16a085, 0x7f8c8d, 0xf1c40f];
    const iconTex = (i) => app.renderer.generateTexture(new PIXI.Graphics().beginFill(COLORS[i % COLORS.length]).drawRect(0, 0, 64, 64).endFill().beginFill(0xffffff).drawCircle(32, 32, 14).endFill());
    const placeables = [];
    const redraws = [];
    const mk = (id, x, y, { size = 1, effects = 0, overlay = false, visible = true, hidden = false, texture = art.goblin, elevation = 0 } = {}) => {
      const w = size * 100;
      const t = { id, x, y, w, h: w, visible, renderable: true, document: { id, x, y, width: size, height: size, elevation, hidden },
        renderFlags: { set: (f) => redraws.push([id, Object.keys(f)]) } };
      const mesh = new PIXI.Sprite(texture);
      mesh.anchor.set(0.5); mesh.width = w; mesh.height = w; mesh.position.set(x + w / 2, y + w / 2);
      mesh.elevation = elevation;
      t.mesh = mesh;
      primary.addChild(mesh);
      // Foundry's effects: a background, the icons in a column, the overlay.
      const fx = new PIXI.Container();
      fx.position.set(x, y);
      fx.bg = fx.addChild(new PIXI.Graphics().beginFill(0x000000, 0.4).drawRect(0, 0, 20, 20 * Math.max(1, effects)).endFill());
      for (let i = 0; i < effects; i++) { const s = new PIXI.Sprite(iconTex(i)); s.width = s.height = 20; s.y = 20 * i; fx.addChild(s); }
      if (overlay) { fx.overlay = fx.addChild(new PIXI.Sprite(iconTex(7))); fx.overlay.alpha = 0.3; fx.overlay.width = fx.overlay.height = w; }
      t.effects = fx;
      interfaceLayer.addChild(fx);
      placeables.push(t);
      return t;
    };
    mk("valeros", 100, 100, { effects: 3, texture: art.valeros });
    mk("crowded", 300, 100, { effects: 20, texture: art.ezren });
    mk("ogre", 500, 100, { size: 2, effects: 6, overlay: true });
    mk("unseen", 100, 300, { effects: 2, visible: false });
    mk("plain", 300, 300, {});
    Object.assign(canvas, { ready: true, app, primary, stage: app.stage, dimensions: { size: 100, distance: 5 }, tokens: { placeables } });
    window.__tok = id => placeables.find(t => t.id === id);
    window.__redraws = redraws;
  });
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  await set("effectsHalo_enabled", false);
  await set("effectsHalo_enabled", true);
  await page.waitForTimeout(150);

  const info = await page.evaluate(async () => {
    const { haloLayout } = await import("/modules/lucd20-automations/scripts/features/effects-halo.js");
    const ours = (t) => canvas.primary.children.filter(c => !placeablesMesh(c) && c.lucd20 === undefined && c !== t.mesh);
    const placeablesMesh = (c) => canvas.tokens.placeables.some(t => t.mesh === c);
    const halo = canvas.primary.children.filter(c => !placeablesMesh(c));
    const around = (t) => {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      return halo.filter(s => s.visible && Math.hypot(s.x - cx, s.y - cy) < t.w / 2 + 40).map(s => +Math.hypot(s.x - cx, s.y - cy).toFixed(1));
    };
    const v = __tok("valeros"), c = __tok("crowded"), o = __tok("ogre"), u = __tok("unseen");
    const firstMeshIndex = Math.min(...canvas.tokens.placeables.map(t => canvas.primary.getChildIndex(t.mesh)));
    return {
      total: halo.length,
      visible: halo.filter(s => s.visible).length,
      valeros: around(v), crowdedRings: [...new Set(around(c))].sort((a, b) => a - b),
      crowdedCount: around(c).length,
      ogre: [...new Set(around(o))],
      underTokens: halo.every(s => canvas.primary.getChildIndex(s) < firstMeshIndex),
      foundryHidden: [v, c, o].every(t => t.effects.children.filter(x => x !== t.effects.bg && x !== t.effects.overlay).every(x => x.renderable === false)),
      bgHidden: [v, c, o].every(t => t.effects.bg.visible === false),
      overlayKept: o.effects.overlay.renderable !== false,
      unseen: halo.filter(s => !s.visible).length,
      size: Math.round(halo.find(s => s.visible).width),
      layout: haloLayout(3, { grid: 100 }).points.map(p => [Math.round(p.x), Math.round(p.y)])
    };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: `${out}/p60-halo.png` });

  assert.strictEqual(info.total, 3 + 20 + 6 + 2, "one badge per icon");
  assert.strictEqual(info.visible, 3 + 20 + 6, "none for a token this user can't see");
  assert.strictEqual(info.unseen, 2, "the unseen token's badges stay hidden");
  assert.ok(info.valeros.every(d => Math.abs(d - 61) < 0.5), "ring just outside the square: 50 + r 10 + gap 1");
  assert.deepStrictEqual(info.crowdedRings, [61, 82], "a second ring when the first is full");
  assert.strictEqual(info.crowdedCount, 20);
  assert.deepStrictEqual(info.ogre, [111], "2×2: the ring follows the footprint");
  assert.strictEqual(info.underTokens, true, "drawn under every token's art");
  assert.ok(info.foundryHidden && info.bgHidden, "Foundry's own icons and background hidden");
  assert.ok(info.overlayKept, "the overlay icon stays on the token");
  assert.strictEqual(info.size, 20, "a fifth of a square");
  assert.deepStrictEqual(info.layout[0][1] < 0, true, "starts at the top");

  // The token moves: the ring follows. An effect ends: one badge fewer.
  const moved = await page.evaluate(async () => {
    const v = __tok("valeros");
    v.x = 150; v.document.x = 150;
    v.effects.removeChildAt(v.effects.children.length - 1);
    Hooks.callAll("refreshToken", v, {});
    await new Promise(r => setTimeout(r, 100));
    const meshes = new Set(canvas.tokens.placeables.map(t => t.mesh));
    const halo = canvas.primary.children.filter(c => !meshes.has(c));
    return { total: halo.length, near: halo.filter(s => Math.hypot(s.x - 200, s.y - 150) < 70).length };
  });
  assert.deepStrictEqual(moved, { total: 30, near: 2 });

  // Options: bigger icons further out.
  await set("effectsHalo_size", 0.3);
  await set("effectsHalo_distance", 1.2);
  await page.waitForTimeout(100);
  const opts = await page.evaluate(async () => {
    const { _test } = await import("/modules/lucd20-automations/scripts/features/effects-halo.js");
    const mine = _test.entries.get("valeros").sprites;
    return { size: Math.round(mine[0].width), d: mine.map(s => +Math.hypot(s.x - 200, s.y - 150).toFixed(1)) };
  });
  assert.strictEqual(opts.size, 30);
  assert.ok(opts.d.every(d => Math.abs(d - (60 + 15 + 1.5)) < 0.5), `distance × 1.2 + r: ${opts.d}`);

  // Primary canvas objects: at the token's elevation, below every token there.
  const primaryPath = await page.evaluate(async () => {
    foundry.canvas = { primary: { PrimarySpriteMesh: class extends PIXI.Sprite { constructor(t) { super(t); this.elevation = 0; this.sortLayer = 0; this.sort = 0; } } } };
    const v = __tok("valeros");
    v.mesh.elevation = 30; v.mesh.sortLayer = 700;
    await game.settings.set("lucd20-automations", "effectsHalo_enabled", false);
    await game.settings.set("lucd20-automations", "effectsHalo_enabled", true);
    await new Promise(r => setTimeout(r, 100));
    const halo = canvas.primary.children.filter(c => c instanceof foundry.canvas.primary.PrimarySpriteMesh);
    const { _test } = await import("/modules/lucd20-automations/scripts/features/effects-halo.js");
    const near = _test.entries.get("valeros").sprites;
    return { count: halo.length, elevations: [...new Set(near.map(s => s.elevation))], sorts: [...new Set(halo.filter(s => s.visible).map(s => s.sort))], layers: [...new Set(near.map(s => s.sortLayer))] };
  });
  assert.deepStrictEqual(primaryPath, { count: 30, elevations: [30], sorts: [1e6], layers: [700] }, "v0.90.1: above the tokens at their elevation");

  // Off: our badges gone, Foundry redraws its own.
  const off = await page.evaluate(async () => {
    window.__redraws.length = 0;
    await game.settings.set("lucd20-automations", "effectsHalo_enabled", false);
    const meshes = new Set(canvas.tokens.placeables.map(t => t.mesh));
    return { left: canvas.primary.children.filter(c => !meshes.has(c)).length, redraws: window.__redraws.filter(([, f]) => f.includes("redrawEffects")).length,
      shown: __tok("crowded").effects.children.every(x => x.renderable !== false) };
  });
  assert.deepStrictEqual(off, { left: 0, redraws: 5, shown: true });
  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 60 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
