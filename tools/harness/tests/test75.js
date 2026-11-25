const { chromium } = require("playwright");
const assert = require("assert");

/** v0.87.0: Hero Start Area (mark squares on encounter creation, wall-aware drag, heroes teleported in). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    const out = {};
    const hs = await import(`/modules/${M}/scripts/features/hero-start.js`);

    // Pure parts. A wall between columns 2 and 3 (x = 300).
    const wallAt300 = (a, b) => (a.x < 300) !== (b.x < 300);
    out.reach = hs.reachableCells({ c: 0, r: 0 }, { c: 4, r: 1 }, { size: 100, blocked: wallAt300 }).sort();
    out.place = hs.placeTokens(["0,0", "1,0", "0,1", "1,1", "2,0"], [{ id: "big", w: 2, h: 2 }, { id: "a", w: 1, h: 1 }, { id: "b", w: 1, h: 1 }]);

    // The canvas: a 100 px grid, no camera transform, the same wall.
    for (const el of document.querySelectorAll(".lucd20-hub, #core-config")) el.style.display = "none";
    canvas.ready = true;
    canvas.grid = { size: 100, type: 1 };
    canvas.stage = new PIXI.Container();
    canvas.interface = new PIXI.Container();
    canvas.app = { view: document.body };
    CONFIG.Canvas = { polygonBackends: { move: { testCollision: (a, b) => wallAt300(a, b) } } };
    const updates = [];
    const mkTok = (id, name, x, y, actor, w = 1) => ({ id, name, x, y, width: w, height: w, actor });
    const hero = name => ({ name, type: "character", hasPlayerOwner: true });
    const tokens = [mkTok("t1", "Uri", 900, 900, hero("Uri")), mkTok("t2", "Madzoog", 900, 1000, hero("Madzoog")), mkTok("t3", "Schmekcho", 1000, 900, hero("Schmekcho")),
      mkTok("n1", "Goblin", 100, 100, { name: "Goblin", type: "npc", hasPlayerOwner: false })];
    const scene = { id: "s1", grid: { size: 100, type: 1 }, tokens,
      async updateEmbeddedDocuments(type, ups, opts) { updates.push({ ups, opts }); for (const u of ups) Object.assign(tokens.find(t => t.id === u._id), u); } };
    canvas.scene = scene;
    const flags = {};
    // Not linked to a scene (V12+ default for a new encounter): the viewed scene.
    const combat = { id: "c1", started: false, scene: null, combatants: [],
      getFlag: (ns, k) => flags[ns]?.[k], async setFlag(ns, k, v) { (flags[ns] ??= {})[k] = JSON.parse(JSON.stringify(v)); Hooks.callAll("updateCombat", combat, {}); },
      async unsetFlag(ns, k) { delete flags[ns]?.[k]; } };
    game.combats = [combat];
    await game.settings.set(M, "heroStart_enabled", true);
    await settle();

    // Creating the encounter: the bar.
    Hooks.callAll("createCombat", combat, {}, game.user.id);
    await settle(150);
    const bar = document.querySelector(".lucd20-hero-start-bar");
    out.prompt = bar?.textContent.trim();
    const target = document.createElement("div");
    Object.assign(target.style, { position: "fixed", inset: "0", zIndex: "0" });
    document.body.append(target);
    const pointer = (type, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
    // Drag from (1,1) to (4,2): the wall at x = 300 keeps columns 3 and 4 out.
    pointer("pointerdown", 150, 150);
    pointer("pointermove", 450, 250);
    await settle(30);
    out.previewDrawn = canvas.interface.children.length > 0;
    pointer("pointerup", 450, 250);
    await settle(200);
    out.cells = [...(flags[M]?.heroStart?.cells ?? [])].sort();
    // The goblin stands on (1,1): the three heroes go to the free squares, in reading order, by name.
    out.teleport = updates[0]?.ups.map(u => `${u._id}@${u.x / 100},${u.y / 100}`);
    out.teleportOpts = updates[0] && updates[0].opts.animate === false && updates[0].opts.teleport === true;
    out.adding = document.querySelector(".lucd20-hero-start-bar")?.textContent.trim();
    // Shift + click removes a square; a click adds one; no second teleport.
    pointer("pointerdown", 250, 250, { shiftKey: true });
    pointer("pointerup", 250, 250, { shiftKey: true });
    await settle(120);
    pointer("pointerdown", 150, 350);
    pointer("pointerup", 150, 350);
    await settle(120);
    out.cells2 = [...flags[M].heroStart.cells].sort();
    out.teleports = updates.length;
    // Escape ends adding; the area stays (everyone sees it).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(80);
    out.barGone = !document.querySelector(".lucd20-hero-start-bar");
    out.overlay = canvas.interface.children.length;
    // Starting the encounter deletes the area.
    combat.started = true;
    Hooks.callAll("updateCombat", combat, { round: 1 });
    await settle(120);
    out.afterStart = !!flags[M]?.heroStart;
    out.overlayAfter = canvas.interface.children.length;
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.reach, ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1"], "only the squares on this side of the wall");
  assert.deepStrictEqual(r.place, { big: { c: 0, r: 0 }, a: { c: 2, r: 0 }, b: { c: 0, r: 0 } }, "the 2×2 fits; then one more; the last stacks on the first square");
  assert.ok(r.prompt?.startsWith("Click on the map to create the start area"), r.prompt);
  assert.ok(r.previewDrawn, "the drag is previewed");
  assert.deepStrictEqual(r.cells, ["1,1", "1,2", "2,1", "2,2"], "the wall-aware drag");
  assert.deepStrictEqual(r.teleport, ["t2@2,1", "t3@1,2", "t1@2,2"], "Madzoog, Schmekcho, Uri into the free squares");
  assert.ok(r.teleportOpts, "a teleport, not a walk");
  assert.ok(r.adding?.startsWith("Click or drag to add squares"), r.adding);
  assert.deepStrictEqual(r.cells2, ["1,1", "1,2", "1,3", "2,1"], "(2,2) removed, (1,3) added");
  assert.strictEqual(r.teleports, 1, "only the first area teleports");
  assert.ok(r.barGone && r.overlay > 0, "Escape ends adding; the area stays");
  assert.ok(!r.afterStart && r.overlayAfter === 0, "starting the encounter deletes the area");
  console.log("PHASE 75 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
