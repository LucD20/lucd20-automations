const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);

  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 1000, height: 600, background: 0x2b2f2b });
    document.body.append(app.view);
    app.view.style.cssText = "position:absolute;left:0;top:0";
    const tokensLayer = new PIXI.Container(); const controls = new PIXI.Container();
    const g = new PIXI.Graphics(); g.lineStyle(1, 0x444444);
    for (let x = 0; x <= 1000; x += 100) g.moveTo(x, 0).lineTo(x, 600);
    for (let y = 0; y <= 600; y += 100) g.moveTo(0, y).lineTo(1000, y);
    g.lineStyle(6, 0xffcc00).moveTo(700, 0).lineTo(700, 600); // wall at x=700
    app.stage.addChild(g, tokensLayer, controls);
    foundry.canvas = { loadTexture: src => PIXI.Assets.load(src.startsWith("/") ? src : "/" + src) };
    foundry.utils.flattenObject = (obj, _d = 0) => { const out = {}; for (const [k, v] of Object.entries(obj)) { if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) { for (const [k2, v2] of Object.entries(foundry.utils.flattenObject(v))) out[`${k}.${k2}`] = v2; } else out[k] = v; } return out; };
    foundry.utils.isEmpty = o => !o || !Object.keys(o).length;
    window.CONFIG.Canvas = { polygonBackends: { move: { testCollision: (a, b) => (a.x - 700) * (b.x - 700) < 0 } } };

    const colors = { Valeros: 0x3366cc, Ezren: 0x9955cc, Kyra: 0xcc9933, Merisiel: 0x33aa88, Goblin: 0x55aa55, Ogre: 0xaa5533, "Goblin Boss": 0x226622 };
    const drawToken = data => {
      const c = new PIXI.Graphics(); c.beginFill(colors[data.name] ?? 0x888888, data.hidden ? 0.4 : 1).drawRoundedRect(4, 4, data.width * 100 - 8, data.height * 100 - 8, 10).endFill();
      const t = new PIXI.Text(data.name, { fontSize: 13, fill: 0xffffff }); t.position.set(8, 8); c.addChild(t);
      c.position.set(data.x, data.y); tokensLayer.addChild(c);
      return c;
    };
    const tokens = new Map();
    const scene = {
      id: "s1", tokens,
      async createEmbeddedDocuments(type, data) {
        for (const d of data) {
          const id = "t" + (tokens.size + 1); const doc = { id, ...d, parent: scene };
          doc.object = drawToken(doc); doc.object.document = doc; tokens.set(id, doc);
        }
        window.__created = (window.__created ?? 0) + data.length;
      },
      async updateEmbeddedDocuments(type, updates, options) { window.__updates = { updates, options }; }
    };
    window.canvas = {
      ready: true, app, controls, scene, stage: app.stage,
      dimensions: { size: 100, width: 1000, height: 600, sceneRect: { x: 0, y: 0, width: 1000, height: 600 } },
      grid: { isGridless: false },
      tokens: { get placeables() { return [...tokens.values()].map(d => ({ document: d })); }, controlled: [] }
    };
    const actor = (name, size = 1) => ({
      name, documentName: "Actor", type: "character", img: "/modules/lucd20-automations/assets/markers/blueCircle.png",
      prototypeToken: { width: size, height: size, hidden: false, texture: { src: "/modules/lucd20-automations/assets/markers/blueCircle.png" } },
      async getTokenDocument(o) { return { toObject: () => ({ name, width: size, height: size, ...o }) }; }
    });
    const A = Object.fromEntries(["Valeros", "Ezren", "Kyra", "Merisiel", "Goblin", "Goblin Boss"].map(n => [n, actor(n)]));
    A.Ogre = actor("Ogre", 2);
    const sub = { type: "Actor", contents: [A.Ogre], getSubfolders: () => [] };
    const monsters = { type: "Actor", contents: [A["Goblin Boss"], A.Goblin], getSubfolders: () => [sub] };
    const party = { type: "party", name: "Party", members: [A.Valeros, A.Ezren, A.Kyra, A.Merisiel] };
    window.fromUuidSync = uuid => ({ "Folder.monsters": monsters, "Actor.party": party, "Actor.valeros": A.Valeros })[uuid];
    window.__drop = (data, event) => Hooks.call ? Hooks.call("dropCanvasData", canvas, data, event) : null;
    Hooks.call = (n, ...a) => { for (const h of Hooks._h[n] ?? []) if (h.f(...a) === false) return false; return true; };
    window.__dialog = { mode: "random", hidden: false };
    foundry.applications.api.DialogV2.wait = async opts => { window.__dialogContent = opts.content; return window.__dialog; };
    game.keyboard = { isModifierActive: () => false };
  });
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const tokenNames = () => page.evaluate(() => [...canvas.scene.tokens.values()].map(t => `${t.name}@${t.x},${t.y}${t.hidden ? "(h)" : ""}`));

  // ================= Folder Drop =================
  await set("folderDrop_enabled", true);
  await page.waitForTimeout(50);

  // Random, folder without subfolders; drop near the wall (x=650)
  let r = await page.evaluate(() => __drop({ type: "Folder", uuid: "Folder.monsters", x: 650, y: 250 }));
  assert.strictEqual(r, false, "default drop prevented");
  await page.waitForTimeout(200);
  let names = await tokenNames();
  console.log("random monsters:", names);
  assert.strictEqual(names.length, 2, "subfolders off → Ogre not included");
  assert.ok((await page.evaluate(() => __dialogContent)).includes("Goblin, Goblin Boss"), "alphabetical in dialog");
  for (const n of names) assert.ok(Number(n.split("@")[1].split(",")[0]) < 700, `never across the wall: ${n}`);

  // Include subfolders + hidden
  await set("folderDrop_includeSubfolders", true);
  await page.evaluate(() => { __dialog = { mode: "random", hidden: true }; });
  await page.evaluate(() => __drop({ type: "Folder", uuid: "Folder.monsters", x: 250, y: 250 }));
  await page.waitForTimeout(200);
  names = await tokenNames();
  console.log("with subfolders, hidden:", names.slice(2));
  assert.strictEqual(names.length, 5);
  assert.ok(names.slice(2).every(n => n.endsWith("(h)")));
  // no overlaps
  const rects = await page.evaluate(() => [...canvas.scene.tokens.values()].map(t => [t.x, t.y, t.width * 100, t.height * 100]));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, b] = [rects[i], rects[j]];
    assert.ok(!(a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]), "no overlap");
  }
  await page.screenshot({ path: `${out}/p6-random.png`, clip: { x: 0, y: 0, width: 1000, height: 600 } });

  // Normal actor drop → not intercepted
  r = await page.evaluate(() => __drop({ type: "Actor", uuid: "Actor.valeros", x: 100, y: 100 }));
  assert.strictEqual(r, true);
  // Party + Alt → party token (not intercepted)
  r = await page.evaluate(() => __drop({ type: "Actor", uuid: "Actor.party", x: 100, y: 100 }, { altKey: true }));
  assert.strictEqual(r, true);

  // ---- Select places with PF2e party ----
  await page.evaluate(() => { __dialog = { mode: "select", hidden: false }; });
  r = await page.evaluate(() => __drop({ type: "Actor", uuid: "Actor.party", x: 100, y: 100 }));
  assert.strictEqual(r, false);
  await page.waitForTimeout(400);
  const listed = await page.$$eval(".lucd20-placement-entry .name", els => els.map(e => e.textContent));
  assert.deepStrictEqual(listed, ["Ezren", "Kyra", "Merisiel", "Valeros"]);
  // preview follows cursor (snapped)
  await page.mouse.move(150, 450);
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => { const p = canvas.controls.children[0]; return p && [p.x, p.y, p.alpha]; });
  assert.deepStrictEqual(preview, [150, 450, 0.5], "centred on the footprint");
  await page.screenshot({ path: `${out}/p6-select-preview.png` });
  // click to place Ezren, then pick Valeros out of order, place
  await page.mouse.click(150, 450);
  await page.waitForTimeout(300);
  await page.$eval('.lucd20-placement-entry[data-index="3"]', el => el.click());
  await page.waitForTimeout(200);
  await page.mouse.click(350, 450);
  await page.waitForTimeout(300);
  names = await tokenNames();
  console.log("after 2 placements:", names.slice(5));
  assert.deepStrictEqual(names.slice(5), ["Ezren@100,400", "Valeros@300,400"]);
  const current = await page.$eval(".lucd20-placement-entry.current .name", e => e.textContent);
  assert.strictEqual(current, "Kyra", "continues with the next unplaced");
  await page.screenshot({ path: `${out}/p6-select-panel.png` });
  // random for the rest
  await page.$eval('[data-action="randomRest"]', el => el.click());
  await page.waitForTimeout(400);
  names = await tokenNames();
  assert.strictEqual(names.length, 9);
  assert.strictEqual(await page.$$eval(".lucd20-placement", e => e.length), 0, "panel closed");
  assert.strictEqual(await page.evaluate(() => canvas.controls.children.length), 0, "preview removed");

  // Esc stops
  r = await page.evaluate(() => __drop({ type: "Actor", uuid: "Actor.party", x: 100, y: 100 }));
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.strictEqual(await page.$$eval(".lucd20-placement", e => e.length), 0);
  assert.strictEqual((await tokenNames()).length, 9);

  // ================= Multi-Token Edit =================
  await set("multiTokenEdit_enabled", true);
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const mk = id => { const doc = { id, parent: canvas.scene, canUserModify: () => true }; const obj = { document: doc }; doc.object = obj; canvas.scene.tokens.set(id, doc); return obj; };
    const a = mk("A"), b = mk("B"), c = mk("C");
    canvas.tokens.controlled = [a, b, c];
    const sheetEl = document.createElement("form");
    sheetEl.className = "application";
    sheetEl.innerHTML = `<section class="window-content"><div class="form-group"><label>Name</label><input name="name"></div><div class="form-group"><label>Light</label><input name="light.dim"></div></section>`;
    sheetEl.style.cssText = "position:absolute;left:620px;top:20px;width:420px;background:#222;padding:8px";
    const sheet = { rendered: false, element: sheetEl, render() { this.rendered = true; document.body.append(sheetEl); Hooks.callAll("renderTokenConfig", this, sheetEl); } };
    a.document.sheet = sheet;
    window.__mte = { a, b, c, sheet };
    const hudEl = document.createElement("div");
    hudEl.innerHTML = `<div class="col left"></div><div class="col right"><button class="control-icon" data-action="config"></button></div>`;
    document.body.append(hudEl);
    window.__hud = { object: a, element: hudEl, close() { window.__hudClosed = true; } };
    Hooks.callAll("renderTokenHUD", __hud, hudEl);
  });
  assert.ok(await page.evaluate(() => !!__hud.element.querySelector(".col.left .lucd20-mte .fa-gears")), "gears button in HUD");
  assert.ok((await page.evaluate(() => __hud.element.querySelector(".lucd20-mte").dataset.tooltip)).includes("3"));
  await page.evaluate(() => __hud.element.querySelector(".lucd20-mte").click());
  assert.ok(await page.evaluate(() => __mte.sheet.rendered && window.__hudClosed));
  assert.ok(await page.isVisible(".lucd20-mte-banner"));
  await page.fill('input[name="light.dim"]', "30");
  await page.press('input[name="light.dim"]', "Tab");
  assert.ok(await page.evaluate(() => document.querySelector('input[name="light.dim"]').closest(".form-group").classList.contains("lucd20-mte-changed")));
  await page.screenshot({ path: `${out}/p6-mte-sheet.png`, clip: { x: 600, y: 0, width: 480, height: 160 } });
  // Foundry saves the base token → only the difference is applied to the others
  await page.evaluate(() => Hooks.callAll("updateToken", __mte.a.document, { _id: "A", light: { dim: 30 }, x: 500 }, {}, game.user.id));
  await page.waitForTimeout(50);
  const upd = await page.evaluate(() => window.__updates);
  console.log("applied:", JSON.stringify(upd));
  assert.deepStrictEqual(upd.updates, [{ _id: "B", "light.dim": 30 }, { _id: "C", "light.dim": 30 }]);
  assert.ok(upd.options.lucd20MultiEdit);
  // after closing, normal edits of A are not copied
  await page.evaluate(() => { window.__updates = null; Hooks.callAll("closeTokenConfig", __mte.sheet); Hooks.callAll("updateToken", __mte.a.document, { name: "X" }, {}, game.user.id); });
  assert.strictEqual(await page.evaluate(() => window.__updates), null);
  // only one token selected → no button
  await page.evaluate(() => { canvas.tokens.controlled = [__mte.a]; Hooks.callAll("renderTokenHUD", __hud, __hud.element); });
  assert.ok(await page.evaluate(() => !__hud.element.querySelector(".lucd20-mte")));

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 6 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
