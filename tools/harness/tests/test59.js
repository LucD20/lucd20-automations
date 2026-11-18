const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 61: Quick Teleport — the stairs tool, two linked regions (other scene too), one-way, cancel. */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);

  const result = await page.evaluate(async () => {
    const M = "lucd20-automations";
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 800, height: 500 });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    // Scenes and regions, as far as the tool uses them.
    const all = new Map();
    const mkScene = (id) => {
      const scene = { id, regions: [] };
      scene.createEmbeddedDocuments = async (type, list) => list.map((data) => {
        const region = { ...data, id: `${id}-r${scene.regions.length + 1}`, parent: scene, behaviors: [...(data.behaviors ?? [])] };
        region.uuid = `Scene.${id}.Region.${region.id}`;
        region.getFlag = (ns, key) => region.flags?.[ns]?.[key];
        region.createEmbeddedDocuments = async (t, b) => { region.behaviors.push(...b); return b; };
        region.delete = async () => { scene.regions.splice(scene.regions.indexOf(region), 1); all.delete(region.uuid); };
        scene.regions.push(region);
        all.set(region.uuid, region);
        return region;
      });
      return scene;
    };
    const s1 = mkScene("s1"), s2 = mkScene("s2");
    game.scenes = [s1, s2];
    window.fromUuid = async (uuid) => all.get(uuid) ?? null;
    const infos = []; ui.notifications.info = (m) => infos.push(m);
    Object.assign(canvas, { ready: true, app, stage: app.stage, controls: app.stage.addChild(new PIXI.Container()), dimensions: { size: 100 }, scene: s1,
      canvasCoordinatesFromClient: ({ x, y }) => ({ x, y }) });
    ui.controls = { render: () => {} };

    // The tool in the Regions controls.
    const controls = { regions: { tools: {} }, tokens: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls);
    const tool = controls.regions.tools.lucd20Stairs;
    const out = { tool: tool && { icon: tool.icon, button: tool.button }, tokensUntouched: Object.keys(controls.tokens.tools).length === 0 };

    const view = app.view;
    const ptr = (type, x, y, button = 0) => view.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true }));
    const click = async (x, y) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); await new Promise(r => setTimeout(r, 20)); };
    const drag = async (a, b) => { ptr("pointerdown", ...a); ptr("pointermove", ...b); ptr("pointerup", ...b); await new Promise(r => setTimeout(r, 20)); };
    const bar = () => document.querySelector(".lucd20-qt-bar")?.textContent.trim() ?? null;

    // Pair 1: a click on scene 1, then a drag on scene 2.
    tool.onChange();
    out.bar1 = bar();
    await click(150, 150);
    out.bar2 = bar();
    const a1 = s1.regions[0];
    out.a1 = { name: a1.name, visibility: a1.visibility, shape: a1.shapes[0], behaviors: a1.behaviors.length, flag: a1.flags[M].quickTeleport };
    canvas.scene = s2; Hooks.callAll("canvasTearDown");
    await drag([210, 210], [390, 290]);
    const b1 = s2.regions[0];
    out.b1 = { name: b1.name, shape: b1.shapes[0], behaviors: b1.behaviors, flag: b1.flags[M].quickTeleport, color: b1.color === a1.color };
    out.a1Behaviors = a1.behaviors;
    out.bar3 = bar();
    out.placed = infos.at(-1);

    // Pair 2, one-way, on scene 2.
    tool.onChange();
    const box = document.querySelector(".lucd20-qt-bar input[type=checkbox]");
    box.checked = true; box.dispatchEvent(new Event("change"));
    await click(550, 150);
    await click(650, 350);
    const [, a2, b2] = s2.regions;
    out.oneWay = { a: a2.name, aBehaviors: a2.behaviors.map(b => b.system.destination), b: b2.name, bBehaviors: b2.behaviors.length, info: infos.at(-1) };

    // Cancel after the first end: it is deleted.
    tool.onChange();
    await click(50, 450);
    out.beforeCancel = s2.regions.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    out.afterCancel = s2.regions.length;
    out.barAfterCancel = bar();

    // v0.71.1: entering a teleport region on the grid (the owner's record: stopped at y 2351, then displaced).
    const grid = { size: 100, isSquare: true, getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }), getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }) };
    const stairs = { behaviors: [{ type: "teleportToken", disabled: false }], rect: { x: 3700, y: 2400, w: 100, h: 100 } };
    const inside = (region, p) => { const cx = p.x + 50, cy = p.y + 50, r = region.rect; return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h; };
    const token = { parent: { grid }, testInsideRegion: inside };
    const W = (x, y) => ({ x, y, elevation: 0, width: 1, height: 1, action: "walk" });
    const S = (type, from, to) => ({ type, action: "walk", snapped: false, terrain: null, from, to });
    const { snapTeleportEntries } = await import("/modules/lucd20-automations/scripts/features/quick-teleport.js");
    const show = (segs) => segs.map(x => [x.type, x.from.y, x.to.y, !!x.snapped]);
    // 1. Walk 2 squares down onto the stairs: the entry moves from 2351 to the stairs square (2400).
    out.walkOn = show(snapTeleportEntries(token, stairs, [W(3700, 2200), W(3700, 2300), W(3700, 2400)],
      [S(1, W(3700, 2350), W(3700, 2351)), S(0, W(3700, 2351), W(3700, 2400))]));
    // 2. A straight drag through the stairs and beyond: entry at the stairs square, the rest starts there.
    out.passThrough = show(snapTeleportEntries(token, stairs, [W(3700, 2200), W(3700, 2700)],
      [S(1, W(3700, 2350), W(3700, 2351)), S(0, W(3700, 2351), W(3700, 2449)), S(-1, W(3700, 2449), W(3700, 2450))]));
    // 3. Only grazing it (the first square after the crossing is outside): Foundry's segments unchanged.
    const graze = [S(1, W(3651, 2350), W(3652, 2351)), S(-1, W(3652, 2351), W(3653, 2352))];
    out.graze = snapTeleportEntries(token, stairs, [W(3600, 2300), W(3700, 2400)], graze) === graze || show(snapTeleportEntries(token, stairs, [W(3600, 2300), W(3700, 2400)], graze));
    // 4. A region without a teleport: untouched.
    const plain = [S(1, W(3700, 2350), W(3700, 2351))];
    out.plain = snapTeleportEntries(token, { behaviors: [{ type: "modifyMovementCost" }], rect: stairs.rect }, [W(3700, 2200), W(3700, 2400)], plain) === plain;
    // 5. Through Foundry's method while the feature is on.
    class TokenDoc { segmentizeRegionMovementPath() { return [S(1, W(3700, 2350), W(3700, 2351)), S(0, W(3700, 2351), W(3700, 2400))]; } }
    Object.assign(TokenDoc.prototype, { parent: { grid }, testInsideRegion: inside });
    CONFIG.Token.documentClass = TokenDoc;
    await game.settings.set(M, "quickTeleport_enabled", false);
    await game.settings.set(M, "quickTeleport_enabled", true);
    out.wrapped = show(new TokenDoc().segmentizeRegionMovementPath(stairs, [W(3700, 2200), W(3700, 2300), W(3700, 2400)]));

    // Feature off: no tool.
    await game.settings.set(M, "quickTeleport_enabled", false);
    const controls2 = { regions: { tools: {} } };
    Hooks.callAll("getSceneControlButtons", controls2);
    out.offTool = !!controls2.regions.tools.lucd20Stairs;
    return out;
  });
  console.log(JSON.stringify(result));

  assert.deepStrictEqual(result.tool, { icon: "fa-solid fa-stairs", button: true });
  assert.ok(result.tokensUntouched);
  assert.match(result.bar1, /first end/);
  assert.match(result.bar2, /Stairs 1: now the other end/);
  assert.deepStrictEqual(result.a1, { name: "Stairs 1 · A", visibility: 1, shape: { type: "rectangle", x: 100, y: 100, width: 100, height: 100, rotation: 0, hole: false }, behaviors: 0, flag: { pair: 1, end: "a" } });
  assert.deepStrictEqual(result.b1.shape, { type: "rectangle", x: 200, y: 200, width: 200, height: 100, rotation: 0, hole: false }, "a drag snaps to the grid");
  assert.strictEqual(result.b1.name, "Stairs 1 · B");
  assert.deepStrictEqual(result.b1.behaviors, [{ name: "Teleport", type: "teleportToken", system: { destination: "Scene.s1.Region.s1-r1", choice: true } }], "B → A, on another scene, asking first");
  assert.deepStrictEqual(result.a1Behaviors, [{ name: "Teleport", type: "teleportToken", system: { destination: "Scene.s2.Region.s2-r1", choice: true } }], "A → B");
  assert.ok(result.b1.color, "one colour per pair");
  assert.strictEqual(result.bar3, null, "done: the bar goes");
  assert.match(result.placed, /Stairs 1 placed/);
  assert.deepStrictEqual(result.oneWay, { a: "Stairs 2 · A", aBehaviors: ["Scene.s2.Region.s2-r3"], b: "Stairs 2 · B", bBehaviors: 0, info: "Stairs 2 placed: the first end teleports to the second." });
  assert.strictEqual(result.beforeCancel, 4);
  assert.strictEqual(result.afterCancel, 3, "cancel deletes the first end");
  assert.strictEqual(result.barAfterCancel, null);
  assert.strictEqual(result.offTool, false);
  assert.deepStrictEqual(result.walkOn, [[1, 2350, 2400, true]], "the token enters on the stairs square, not half a square early");
  assert.deepStrictEqual(result.passThrough, [[1, 2350, 2400, true], [0, 2400, 2449, false], [-1, 2449, 2450, false]]);
  assert.strictEqual(result.graze, true, "grazing a corner: Foundry's own segments");
  assert.strictEqual(result.plain, true, "no teleport: untouched");
  assert.deepStrictEqual(result.wrapped, [[1, 2350, 2400, true]], "Foundry's method wrapped while on");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 61 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
