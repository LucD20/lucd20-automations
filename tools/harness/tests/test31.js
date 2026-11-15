const { chromium } = require("playwright");
const assert = require("assert");
const fs = require("fs");
const out = __dirname;

/** Phase 31: Scene Audit (marking squares, the list, the exported report). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, acceptDownloads: true });
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n").slice(1, 3).join(" ")}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  await page.evaluate(() => window.__hub?.close());

  const info = await page.evaluate(async () => {
    const ID = "lucd20-automations";
    // A scene whose map image starts 200 px in (padding), 100 px squares.
    const scene = {
      id: "s1", name: "Test Cellar", width: 1000, height: 800, padding: 0.25, flags: {},
      grid: { size: 100, type: 1, distance: 1, units: "sq" },
      dimensions: { sceneX: 200, sceneY: 200, size: 100 },
      initialLevel: { background: { src: "maps/cellar.webp" } },
      walls: [{ c: [200, 200, 500, 200], door: 0, ds: 0, move: 20, sight: 20, dir: 0 }, { c: [500, 200, 500, 300], door: 1, ds: 2, move: 20, sight: 20, dir: 0 }],
      tokens: [{ name: "Goblin", actorId: "a1", x: 450, y: 600, width: 1, height: 1, hidden: true }],
      notes: [{ x: 250, y: 250, text: "Start", entryId: "j1", pageId: "p1" }],
      lights: [],
      async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = structuredClone(value); Hooks.callAll("updateScene", this, { flags: { [scope]: { [key]: value } } }); }
    };
    const other = { ...scene, id: "s2", name: "Unmarked", flags: {} };
    game.scenes = [scene, other];
    Object.assign(canvas, { ready: true, scene, dimensions: scene.dimensions, interface: new PIXI.Container(), app: { view: document.body } });
    foundry.utils.randomID = () => Math.random().toString(36).slice(2, 12);
    game.version = "14.368";
    window.ui.notifications.warn = m => (window.__warns ??= []).push(m);
    window.ui.controls = { render() { window.__controls = (window.__controls ?? 0) + 1; } };
    await game.settings.set(ID, "sceneAudit_enabled", true);
    await new Promise(r => setTimeout(r, 50));
    const mod = await import("/modules/lucd20-automations/scripts/features/scene-audit.js");
    window.__audit = mod;
    // Scene controls: the two tools land in the Token controls (V13+ object form).
    const controls = { tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls);
    // The dialog: answer with the default button on a real form.
    window.__dialogMode = undefined;
    window.__dialogPrep = form => { form.elements.kind.value = "wallMissing"; form.elements.note.value = " wall along the north side "; };
    // Pick an L: clicks on canvas points inside squares (2,4), (2,5), (3,5) of the map image; one extra click is taken back.
    mod._test.Placer.start();
    const placer = mod._test.state.placer;
    const bar = () => document.querySelector(".lucd20-audit-bar");
    const doneDisabled = bar().querySelector('[data-do="done"]').disabled;
    for (const p of [{ x: 430, y: 610 }, { x: 430, y: 720 }, { x: 560, y: 720 }, { x: 760, y: 720 }, { x: 770, y: 730 }]) placer.toggle(placer.square(p));
    const barText = bar().querySelector(".text").textContent;
    const preview = canvas.interface.children.length;
    bar().querySelector('[data-do="done"]').click();
    await new Promise(r => setTimeout(r, 50));
    window.__dialogPrep = form => { form.elements.kind.value = "token"; form.elements.note.value = ""; };
    await mod._test.addMark([[0, 0]]);
    window.__dialogMode = "lock";
    // A mark saved by v0.33.0 (one rectangle) still reads as squares.
    const old = mod._test.squaresOf({ cells: { c0: 12, r0: 7, c1: 13, r1: 8 } });
    return { tools: Object.keys(controls.tokens.tools), doneDisabled, barText, preview, barGone: !bar(), old, marks: mod._test.marksOf(scene), drawn: canvas.interface.children[0]?.children.length, controls: window.__controls };
  });
  assert.deepStrictEqual(info.tools, ["lucd20AuditMark", "lucd20AuditList"], "two tools in the Token controls");
  assert.deepStrictEqual([info.doneDisabled, info.barText, info.preview, info.barGone], [true, "3 squares picked", 1, true], "a bar shows the count; Done is off until something is picked");
  assert.deepStrictEqual(info.marks.map(m => [m.kind, m.note, m.squares]), [["wallMissing", "wall along the north side", [[2, 4], [2, 5], [3, 5]]], ["token", "", [[0, 0]]]], "an L of three squares, counted from the map image, not the padded canvas");
  assert.deepStrictEqual(info.old, [[12, 7], [13, 7], [12, 8], [13, 8]]);
  assert.strictEqual(info.drawn, 4, "each mark is drawn: a box and its number");

  // The list window.
  await page.evaluate(() => window.__audit._test.AuditWindow.open());
  await page.waitForSelector(".lucd20-audit-row");
  const rows = await page.$$eval(".lucd20-audit-row", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  console.log(rows);
  assert.ok(rows[0].startsWith("1 Missing wall 3 squares between 2, 4 and 3, 5 wall along the north side") && rows[1].startsWith("2 Token square 0, 0"));
  await page.screenshot({ path: `${out}/p31-audit.png` });

  // Export scenes: tick scenes, the report appears as text to copy.
  await page.click('.lucd20-audit-window [data-action="export"]');
  await page.waitForSelector('.lucd20-audit-export input[name="scene"]');
  const picks = await page.$$eval('.lucd20-audit-export .lucd20-audit-row', els => els.map(e => [e.innerText.replace(/\s+/g, " ").trim(), e.querySelector("input").checked]));
  console.log(picks);
  assert.ok(picks[0][0].startsWith("Test Cellar 2 marks") && picks[0][1] === true, "marked scenes first and ticked");
  await page.screenshot({ path: `${out}/p31-export-pick.png` });
  await page.click('.lucd20-audit-export [data-action="make"]');
  await page.waitForSelector(".lucd20-audit-text", { timeout: 3000 }).catch(e => { console.log(errors); throw e; });
  const text = await page.$eval(".lucd20-audit-text", el => el.value);
  const report = JSON.parse(text);
  assert.strictEqual(text.split("\n").length, report.scenes.length + 2, "one line per scene");
  const s = report.scenes.find(x => x.name === "Test Cellar");
  assert.deepStrictEqual([report.format, report.version, s.image], ["lucd20-scene-audit", 2, "maps/cellar.webp"]);
  assert.deepStrictEqual(s.marks, [{ n: 1, kind: "wallMissing", note: "wall along the north side", squares: [[2, 4], [2, 5], [3, 5]] }, { n: 2, kind: "token", note: "", squares: [[0, 0]] }]);
  assert.deepStrictEqual(s.walls.map(w => w.slice(0, 8)), [[0, 0, 3, 0, 0, 0, 20, 20], [3, 0, 3, 1, 1, 2, 20, 20]], "walls in squares from the image corner");
  assert.deepStrictEqual(s.tokens, [["Goblin", 2.5, 4, 1, 1, 1, "a1"]]);
  assert.deepStrictEqual([s.notes[0].col, s.notes[0].row, s.notes[0].entryId, s.size.squaresWide, s.size.sceneX], [0.5, 0.5, "j1", 10, 200]);
  await page.evaluate(() => { window.__copied = null; game.clipboard = { copyPlainText: async t => { window.__copied = t; } }; });
  await page.click('.lucd20-audit-export [data-action="copy"]');
  await page.waitForFunction(() => window.__copied);
  assert.strictEqual(await page.evaluate(() => window.__copied), text, "Copy puts the whole text on the clipboard");
  await page.screenshot({ path: `${out}/p31-export-text.png` });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('.lucd20-audit-export [data-action="file"]')]);
  assert.strictEqual(fs.readFileSync(await dl.path(), "utf8"), text);
  // Back, untick everything: nothing to export.
  await page.click('.lucd20-audit-export [data-action="back"]');
  await page.click('.lucd20-audit-export [data-none="1"]');
  await page.click('.lucd20-audit-export [data-action="make"]');
  assert.strictEqual(await page.locator(".lucd20-audit-text").count(), 0);
  await page.evaluate(() => window.__audit._test.ExportWindow.instance.close());

  // Remove one, then switch the feature off: marks stay on the scene, the drawing and window go.
  await page.click('.lucd20-audit-row:nth-child(2) [data-action="remove"]');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.locator(".lucd20-audit-row").count(), 1);
  const off = await page.evaluate(async () => {
    await game.settings.set("lucd20-automations", "sceneAudit_enabled", false);
    await new Promise(r => setTimeout(r, 50));
    const controls = { tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls);
    await new Promise(r => setTimeout(r, 300));
    return { drawn: canvas.interface.children.length, win: document.querySelectorAll(".lucd20-audit-window").length, tools: Object.keys(controls.tokens.tools).length, kept: window.__audit._test.marksOf(game.scenes[0]).length };
  });
  assert.deepStrictEqual(off, { drawn: 0, win: 0, tools: 0, kept: 1 }, "switched off without a reload");

  // A player's client: nothing.
  const p2 = await browser.newPage();
  await p2.goto("http://localhost:8765/index.html?gm=0&system=dnd4e");
  await p2.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const player = await p2.evaluate(async () => {
    await game.settings.set("lucd20-automations", "sceneAudit_enabled", true);
    await new Promise(r => setTimeout(r, 50));
    const controls = { tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls);
    return Object.keys(controls.tokens.tools).length;
  });
  assert.strictEqual(player, 0, "no tools for players");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 31 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
