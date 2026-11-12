const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "modules/lucd20-automations/assets/markers";

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    // ---------- fake canvas ----------
    await page.evaluate(async () => {
      document.querySelector(".lucd20-hub").style.display = "none";
      document.getElementById("core-config").style.display = "none";
      const app = new PIXI.Application({ width: 900, height: 500, background: 0x2b2f2b, antialias: true });
      document.body.append(app.view);
      app.view.style.cssText = "position:absolute;left:20px;top:20px";
      const primary = new PIXI.Container(); primary.sortableChildren = true;
      const tokensLayer = new PIXI.Container();
      app.stage.addChild(primary, tokensLayer);
      // grid
      const g = new PIXI.Graphics(); g.lineStyle(1, 0x444444);
      for (let x = 0; x <= 900; x += 100) g.moveTo(x, 0).lineTo(x, 500);
      for (let y = 0; y <= 500; y += 100) g.moveTo(0, y).lineTo(900, y);
      primary.addChild(g); g.zIndex = -1000;

      class PrimarySpriteMesh extends PIXI.Sprite {
        set sort(v) { this._sort = v; this.zIndex = v; } get sort() { return this._sort; }
      }
      foundry.canvas = { primary: { PrimarySpriteMesh }, loadTexture: src => PIXI.Assets.load("/" + src) };
      const makeToken = (id, x, y, size, color, opts = {}) => {
        const token = new PIXI.Container();
        token.x = x; token.y = y; token.w = size * 100; token.h = size * 100;
        token.document = { width: size, height: size, elevation: 0, texture: { scaleX: opts.art ?? 1, scaleY: opts.art ?? 1 } };
        const art = new PIXI.Graphics(); art.beginFill(color).drawCircle(0, 0, size * 38).endFill();
        art.position.set(x + token.w / 2, y + token.h / 2);
        art.zIndex = opts.sort ?? 10; primary.addChild(art);
        token.mesh = { elevation: 0, sortLayer: 700, sort: opts.sort ?? 10 };
        token.visible = opts.visible ?? true;
        token.id = id;
        tokensLayer.addChild(token);
        return token;
      };
      const t = {
        valeros: makeToken("valeros", 100, 100, 1, 0x3366cc),
        ogre: makeToken("ogre", 300, 100, 2, 0xaa5533),
        goblin: makeToken("goblin", 600, 100, 1, 0x55aa55, { visible: false }), // not visible to this user
        dead: makeToken("dead", 600, 300, 1, 0x777777),
        amiri: makeToken("amiri", 100, 300, 1, 0xcc9933, { art: 2 })
      };
      const cb = (tok, opts = {}) => ({ token: { object: tok }, isDefeated: !!opts.defeated });
      window.__t = t;
      window.__combat = { started: true, turn: 0, turns: [cb(t.valeros), cb(t.ogre), cb(t.dead, { defeated: true }), cb(t.goblin), cb(t.amiri)],
        get combatant() { return this.turns[this.turn]; } };
      game.combat = __combat;
      window.canvas = { ready: true, app, primary, tokens: tokensLayer, dimensions: { size: 100 } };
      window.__markers = () => primary.children.filter(c => c instanceof PrimarySpriteMesh);
      window.__turn = turn => { __combat.turn = turn; Hooks.callAll("updateCombat", __combat, { turn }); };
    });
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const state = page => page.evaluate(() => __markers().map(s => ({
    on: Object.keys(__t).find(k => Math.abs(__t[k].x + __t[k].w / 2 - s.x) < 1 && Math.abs(__t[k].y + __t[k].h / 2 - s.y) < 1) ?? null,
    w: Math.round(s.width), visible: s.visible, alpha: s.alpha, zIndex: s.zIndex, filters: s.filters?.length ?? 0, tex: s.texture.baseTexture.resource?.src?.split("/").pop()
  })));

  const page = await open("gm=1");
  await page.evaluate(() => game.settings.register("core", "combatTrackerConfig", { scope: "world", type: Object,
    default: { resource: "", skipDefeated: false, turnMarker: { enabled: true, animation: "spin", src: "", disposition: false } } }));
  await set(page, "turnMarker_enabled", true);
  await set(page, "nextTurnMarker_enabled", true);
  await page.waitForTimeout(800);
  let s = await state(page);
  console.log("turn 0:", JSON.stringify(s));
  assert.strictEqual(s.length, 2);
  const turnM = s.find(x => x.alpha === 1), nextM = s.find(x => x.alpha === 0.5);
  assert.strictEqual(turnM.on, "valeros"); assert.strictEqual(turnM.w, 120); assert.ok(turnM.visible);
  assert.strictEqual(turnM.tex, "blueRunes.webp", "default image");
  assert.strictEqual(await page.evaluate(() => game.settings.get("core", "combatTrackerConfig").turnMarker.enabled), false, "core turn marker switched off");
  assert.strictEqual(turnM.zIndex, 9.5, "just below the token art");
  assert.strictEqual(nextM.on, "ogre"); assert.strictEqual(nextM.w, 240, "2x2 token → 2x2-sized marker");
  assert.strictEqual(nextM.alpha, 0.5); assert.strictEqual(nextM.filters, 1, "sepia filter");
  assert.strictEqual(nextM.tex, "blueRunes.webp", "next uses turn marker image by default");
  await page.screenshot({ path: `${out}/p5-markers-turn0.png`, clip: { x: 20, y: 20, width: 900, height: 500 } });

  // turn → ogre; next skips defeated → goblin (invisible to this user → marker hidden)
  await page.evaluate(() => __turn(1));
  await page.waitForTimeout(200);
  s = await state(page);
  console.log("turn 1:", JSON.stringify(s));
  assert.strictEqual(s.find(x => x.alpha === 1).on, "ogre");
  assert.strictEqual(s.find(x => x.alpha === 0.5).visible, false, "next = hidden goblin → not shown");

  // turn → amiri (art scale 2): default ignores art scale; option follows it
  await page.evaluate(() => __turn(4));
  await page.waitForTimeout(200);
  s = await state(page);
  assert.strictEqual(s.find(x => x.alpha === 1).on, "amiri"); assert.strictEqual(s.find(x => x.alpha === 1).w, 240, "follows art scale 2 by default");
  assert.strictEqual(s.find(x => x.alpha === 0.5).on, "valeros", "wraps to next round");
  // next marker shares turn marker size: change turn scale → both change
  await set(page, "turnMarker_scale", 0.9);
  await page.waitForTimeout(500);
  s = await state(page);
  console.log("after turn scale 0.9:", JSON.stringify(s.map(x => [x.on, x.w])));
  assert.ok(s.every(x => x.w === (x.on === "amiri" ? 380 : 190)), "both markers use the Turn Marker scale");
  await set(page, "turnMarker_scale", 0.2);
  await page.waitForTimeout(400);


  await set(page, "turnMarker_followArtScale", false);
  await page.waitForTimeout(400);
  s = await state(page);
  assert.strictEqual(s.find(x => x.on === "amiri").w, 120, "option off: footprint only");
  await set(page, "turnMarker_followArtScale", true);
  // option changes don't flip Foundry's marker back on
  assert.strictEqual(await page.evaluate(() => game.settings.get("core", "combatTrackerConfig").turnMarker.enabled), false);

  // custom next image + tint, scale 0.5
  await set(page, "nextTurnMarker_image", `${M}/tolkien_marker.png`);
  await set(page, "nextTurnMarker_color", "tint");
  await set(page, "nextTurnMarker_tint", "#ff4040");
  await set(page, "nextTurnMarker_matchTurnMarker", false);
  await set(page, "nextTurnMarker_scale", 1.5);
  await page.waitForTimeout(800);
  s = await state(page);
  const n = s.find(x => x.on === "valeros");
  console.log("custom next:", JSON.stringify(n));
  assert.strictEqual(n.tex, "tolkien_marker.png"); assert.strictEqual(n.w, 250); assert.strictEqual(n.filters, 0);
  await page.screenshot({ path: `${out}/p5-markers-custom.png`, clip: { x: 20, y: 20, width: 900, height: 500 } });

  // changing the turn marker image updates next marker only when it uses the default (empty) image
  await set(page, "nextTurnMarker_image", "");
  await page.waitForTimeout(500);
  await set(page, "turnMarker_image", `${M}/darksign.png`);
  await page.waitForTimeout(800);
  s = await state(page);
  assert.deepStrictEqual(s.map(x => x.tex), ["darksign.png", "darksign.png"]);

  // rotation happens
  const r1 = await page.evaluate(() => __markers().find(m => m.alpha === 1).rotation);
  await page.waitForTimeout(1000);
  const r2 = await page.evaluate(() => __markers().find(m => m.alpha === 1).rotation);
  console.log("rotation per second at 0.1:", ((r2 - r1) / (2 * Math.PI)).toFixed(3), "turns");
  assert.ok(r2 - r1 > 0.05 * 2 * Math.PI && r2 - r1 < 0.15 * 2 * Math.PI, "≈0.1 rotations per second");

  // combat ended → hidden
  await page.evaluate(() => { __combat.started = false; Hooks.callAll("updateCombat", __combat, { round: 0 }); });
  await page.waitForTimeout(200);
  assert.ok((await state(page)).every(x => !x.visible));
  await page.evaluate(() => { __combat.started = true; __turn(0); });

  // above mode: attaches to token
  await set(page, "turnMarker_above", true);
  await page.waitForTimeout(800);
  assert.strictEqual(await page.evaluate(() => __t.valeros.children.length), 1);

  // feature off → sprites removed, Foundry's marker restored
  await set(page, "turnMarker_enabled", false);
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => game.settings.get("core", "combatTrackerConfig").turnMarker.enabled), true, "core turn marker restored");
  await set(page, "nextTurnMarker_enabled", false);
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => __markers().length + __t.valeros.children.length), 0);

  // canvas teardown/redraw
  await set(page, "turnMarker_above", false);
  await set(page, "turnMarker_enabled", true);
  await page.waitForTimeout(600);
  await page.evaluate(() => Hooks.callAll("canvasTearDown"));
  assert.strictEqual(await page.evaluate(() => __markers().length), 0);
  await page.evaluate(() => Hooks.callAll("canvasReady"));
  await page.waitForTimeout(600);
  assert.strictEqual(await page.evaluate(() => __markers().length), 1);

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 5 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
