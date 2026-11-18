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
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 61 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
