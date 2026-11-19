const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 66: Shared Picks for D&D 4e's movement picker (push / pull / slide / shift / charge), with Take over. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=0&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    const out = {};
    for (const el of document.querySelectorAll(".lucd20-hub, #core-config")) el.style.display = "none";
    CONST.GRID_TYPES = { GRIDLESS: 0, SQUARE: 1 };
    foundry.utils.escapeHTML ??= v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    window.addEventListener("unhandledrejection", e => console.error(`unhandled: ${e.reason?.message ?? e.reason}`));
    CONST.TOKEN_DISPOSITIONS ??= { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
    await game.settings.set(M, "sharedPicks_enabled", true);
    await settle();
    const sp = await import(`/modules/${M}/scripts/core/shared-pick.js`);
    const { pickMovement } = await import(`/modules/${M}/scripts/systems/dnd4e/movement/picker.mjs`);

    const sent = [];
    const mk = (id, name, isGM) => ({ id, name, isGM, active: true, async query(n, payload) { sent.push({ to: id, payload }); return true; } });
    game.users = Object.assign([mk("u1", "GM", true), mk("p1", "Kyra", false), mk("p2", "Ezren", false)], { get(id) { return this.find(u => u.id === id); }, get activeGM() { return this[0]; } });
    game.user = game.users.get("p1");

    const registry = {};
    window.fromUuidSync = u => registry[u];
    const scene = { id: "s" };
    const moved = [];
    const token = (id, col, row, disposition) => {
      const t = { name: id, actor: { name: id, statuses: new Set(), system: { attributes: { hp: { value: 10 } } } }, visible: true, center: { x: col * 100 + 50, y: row * 100 + 50 } };
      t.document = { id, uuid: `Scene.s.Token.${id}`, name: id, x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden: false, parent: scene, isOwner: true, object: t,
        async move(waypoints) { moved.push(waypoints.map(w => [w.x / 100, w.y / 100, w.action])); } };
      registry[t.document.uuid] = t.document;
      return t;
    };
    const hero = token("hero", 4, 4, 1), orc = token("orc", 5, 4, -1);
    Object.assign(canvas, { ready: true, scene, grid: { size: 100, type: 1 }, dimensions: { size: 100 }, interface: new PIXI.Container(), tokens: { placeables: [hero, orc] },
      app: { view: document.body }, canvasCoordinatesFromClient: p => ({ x: p.x, y: p.y }), animatePan() {} });
    canvas.controls = canvas.interface;
    const ops = op => sent.filter(s => s.payload.op === op);

    // The hero pushes the orc 1 square: the others see the squares (and the GM can take over).
    let result = "pending";
    pickMovement({ token: orc, mode: "push", squares: 1, source: hero, power: "Tide of Iron" }).then(v => { result = v; });
    await settle(150);
    out.opens = ops("open").map(o => [o.to, o.payload.hint, o.payload.takeover?.type ?? null, o.payload.tokens.length]);
    const id = ops("open")[0].payload.id;
    const st = () => ops("state").at(-1)?.payload.state;
    out.squares = st()?.rects.length;
    // Hover a square: the path and the end square are shared.
    document.body.dispatchEvent(new MouseEvent("pointermove", { clientX: 650, clientY: 450, bubbles: true }));
    await settle(150);
    out.hover = [st()?.path?.points.map(p => [p.x, p.y]), st()?.rects.length];
    // The GM takes over and sends back a one-square push; the chooser's client moves the orc.
    await sp._test.onQuery({ op: "takeover", id, from: "u1" });
    await settle();
    out.afterTaken = [!!document.getElementById(`${M}-move-bar`), canvas.interface.children.length, result];
    await sp._test.onQuery({ op: "result", id, value: { path: [{ i: 3, j: 6 }], steps: 1 }, from: "u1" });
    await settle(80);
    out.result = [result?.moved, result?.squares, moved.at(-1)];

    // The GM's side: Take over opens the same picker for the GM; its click goes back as a path.
    game.user = game.users.get("u1");
    sent.length = 0;
    const data = { token: orc.document.uuid, source: hero.document.uuid, mode: "push", squares: 1, power: "Tide of Iron", targetName: "", action: "shift", moveOptions: { forced: true }, destinations: null };
    await sp._test.onQuery({ op: "open", id: "w1", user: "p1", scene: "s", tokens: [orc.document.uuid, hero.document.uuid], hint: "Tide of Iron: push", takeover: { type: "move4e", data }, from: "p1" });
    document.querySelector(".lucd20-pick-watch button").click();
    await settle(150);
    out.gmBar = !!document.getElementById(`${M}-move-bar`);
    out.gmShares = ops("open").map(o => [o.to, !!o.payload.takeover]);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { clientX: 650, clientY: 550, button: 0, bubbles: true }));
    await settle(150);
    out.gmResult = ops("result").map(s => [s.to, s.payload.value?.path, s.payload.value?.steps]);
    out.gmMoved = moved.length; // the GM's client moved nothing itself
    out.gmClosed = !!document.getElementById(`${M}-move-bar`);
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.opens.map(o => [o[0], o[2], o[3]]), [["u1", "move4e", 2], ["p2", null, 2]], "the GM can take over; the player only watches");
  assert.ok(r.opens[0][1].startsWith("Tide of Iron: "), "the GM's bar names the power");
  assert.strictEqual(r.opens[1][1], "", "no text for the player");
  assert.strictEqual(r.squares, 3, "the push squares (away from the hero) are shared");
  assert.deepStrictEqual(r.hover, [[[550, 450], [650, 450]], 4], "the hovered path and its end square are shared");
  assert.deepStrictEqual(r.afterTaken, [false, 0, "pending"], "taken over: the chooser's bar and squares go; the move waits");
  assert.deepStrictEqual(r.result, [true, 1, [[6, 3, "shift"]]], "the GM's path is moved from the chooser's client");
  assert.strictEqual(r.gmBar, true, "Take over: the GM's picker opens");
  assert.deepStrictEqual(r.gmShares, [["p1", false], ["p2", false]], "the GM's picker is shown to the others");
  assert.deepStrictEqual(r.gmResult, [["p1", [{ i: 5, j: 6 }], 1]], "the GM's choice goes back as a path");
  assert.deepStrictEqual([r.gmMoved, r.gmClosed], [1, false], "the GM's client moves nothing; its picker closes");
  await page.screenshot({ path: `${__dirname}/p66-shared-4e.png` });
  assert.deepStrictEqual(errors, [], "no page errors");
  await browser.close();
  console.log("PHASE 66 (4e) CHECKS PASSED");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
