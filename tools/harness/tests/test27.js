const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 25: Pathfinding (walls, doors, terrain, threats, Q/T, explored areas, the wrap contract). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await page.evaluate(() => {
      document.querySelector(".lucd20-hub").style.display = "none";
      document.getElementById("core-config").style.display = "none";
      CONST.WALL_MOVEMENT_TYPES = { NONE: 0, NORMAL: 20 };
      CONST.WALL_DOOR_STATES = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
      CONST.TOKEN_DISPOSITIONS = { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
      CONST.GRID_DIAGONALS = { EQUIDISTANT: 0, EXACT: 1, APPROXIMATE: 2, RECTILINEAR: 3, ALTERNATING_1: 4, ALTERNATING_2: 5, ILLEGAL: 6 };
      CONST.GRID_TYPES = { GRIDLESS: 0, SQUARE: 1 };
      game.keyboard = { downKeys: new Set() };
      const size = 100;
      // 12 × 8 squares. A wall from (500,0) to (500,600) with a door at (500,600)-(500,700); bottom row open.
      const wall = (c, door = 0, ds = 0) => ({ document: { c, move: 20, door, ds } });
      window.__walls = [wall([500, 0, 500, 600]), wall([500, 600, 500, 700], 1, 0)];
      const mkToken = (id, x, y, disposition, extra = {}) => ({ id, visible: true, document: { id, x, y, width: 1, height: 1, elevation: 0, disposition, shape: 0, movementAction: "walk" }, actor: { statuses: new Set() }, ...extra });
      window.__mover = mkToken("hero", 100, 300, 1);
      window.__enemy = mkToken("orc", 300, 300, -1);
      window.__regions = [];
      Object.assign(canvas, {
        ready: true,
        scene: { id: "s1" },
        dimensions: { size, distance: 5, sceneRect: { x: 0, y: 0, width: 1200, height: 800 } },
        grid: { size, type: 1, isGridless: false, isSquare: true, diagonals: 4 },
        walls: { get placeables() { return __walls; } },
        regions: { get placeables() { return __regions; } },
        tokens: { get placeables() { return [__mover, __enemy, ...(window.__more ?? [])]; } }
      });
      CONFIG.Token.objectClass.prototype.findMovementPath = function (waypoints) { return { result: waypoints.map(w => ({ ...w, foundry: true })), promise: Promise.resolve(), cancel() {} }; };
    });
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const route = (page, to) => page.evaluate(async to => {
    const proto = CONFIG.Token.objectClass.prototype;
    const res = proto.findMovementPath.call(__mover, [{ x: __mover.document.x, y: __mover.document.y }, { x: to[0] * 100, y: to[1] * 100 }], { constrainOptions: {} });
    const path = res.result ?? (await res.promise);
    return path.map(w => [w.x / 100, w.y / 100, !!w.foundry]);
  }, to);

  let page = await open("gm=1");
  await set(page, "pathfinding_enabled", true);
  await page.waitForTimeout(50);

  // Open floor, enemy at (3,3) next to the straight line → route avoids its neighbours
  let r = await route(page, [3, 1]);
  console.log("to (3,1):", JSON.stringify(r));
  assert.ok(!r.some(p => p[2]), "our route, not Foundry's");
  // Through the closed door / around the wall: target behind the wall at (7,3)
  r = await route(page, [7, 3]);
  console.log("through the wall:", JSON.stringify(r));
  const crossesWallAbove = r.some((p, k) => k && ((r[k - 1][0] < 5) !== (p[0] < 5)) && Math.max(r[k - 1][1], p[1]) < 6);
  assert.ok(!crossesWallAbove, "never crosses the wall");
  assert.ok(r.some(p => p[1] >= 7), "goes round by the open bottom row (the door is closed)");
  // Open the door → shorter, through the door square
  await page.evaluate(() => { __walls[1].document.ds = 1; Hooks.callAll("updateWall", __walls[1].document, {}, {}); });
  const viaDoor = await route(page, [7, 3]);
  console.log("door open:", JSON.stringify(viaDoor));
  assert.ok(viaDoor.some(p => p[1] === 6), "uses the open door");
  assert.ok(!viaDoor.some(p => p[1] >= 7), "no detour any more");

  // Threats: enemy right in the middle of a corridor-free straight line (1,3) → (5,3), enemy at (3,3) blocks the line itself
  await page.evaluate(() => { __enemy.document.x = 300; __enemy.document.y = 200; Hooks.callAll("updateToken", __enemy.document, {}, {}); });
  // v0.39.0: keeping away from enemies is the exception, done while Q is held.
  await page.evaluate(() => game.keyboard.downKeys.add("KeyQ"));
  r = await route(page, [4, 3]);
  await page.evaluate(() => game.keyboard.downKeys.delete("KeyQ"));
  console.log("around the enemy (Q held):", JSON.stringify(r));
  const cells = [];
  for (let k = 1; k < r.length; k++) {
    let [x, y] = r[k - 1];
    const [tx, ty] = r[k];
    while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); cells.push([x, y]); }
  }
  const threatened = ([x, y]) => Math.abs(x - 3) <= 1 && Math.abs(y - 2) <= 1;
  assert.ok(!cells.slice(0, -1).some(threatened), "goes around the squares next to the enemy");
  // Without Q → straight through
  const withQ = await route(page, [4, 3]);
  console.log("without Q:", JSON.stringify(withQ));
  assert.deepStrictEqual(withQ.map(p => p.slice(0, 2)), [[1, 3], [4, 3]], "without Q threats are ignored: straight line");
  // The Q hint sits above the macro bar while dragging, lights up with Q, and goes when the drag ends.
  const hint = await page.evaluate(async () => {
    const bar = document.createElement("div"); bar.id = "hotbar"; Object.assign(bar.style, { position: "fixed", left: "0", right: "0", bottom: "0", height: "60px" }); document.body.append(bar);
    const mod = await import("/modules/lucd20-automations/scripts/features/pathfinding.js");
    const drag = () => new CONFIG.Token.objectClass().findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 400, y: 300 }], {});
    drag();
    const el = () => document.querySelector(".lucd20-drag-hint");
    const out = { text: el()?.textContent, above: el() && el().getBoundingClientRect().bottom <= bar.getBoundingClientRect().top, on: el()?.classList.contains("is-on") };
    game.keyboard.downKeys.add("KeyQ"); drag(); out.onWithQ = el()?.classList.contains("is-on"); game.keyboard.downKeys.delete("KeyQ");
    window.dispatchEvent(new Event("pointerup")); out.afterDrop = !!el();
    await game.settings.set("lucd20-automations", "pathfinding_dragHint", false); drag(); out.switchedOff = !!el();
    await game.settings.set("lucd20-automations", "pathfinding_dragHint", true);
    return out;
  });
  console.log("hint:", JSON.stringify(hint));
  assert.deepStrictEqual(hint, { text: "QHold Q to go around enemies", above: true, on: false, onWithQ: true, afterDrop: false, switchedOff: false });

  // An enemy standing on the line: its square is closed, so the route goes around the token itself (no Q needed).
  await page.evaluate(() => { __enemy.document.x = 300; __enemy.document.y = 300; Hooks.callAll("updateToken", __enemy.document, {}, {}); });
  const around = await route(page, [4, 3]);
  console.log("around the enemy token:", JSON.stringify(around));
  const walked = [];
  for (let k = 1; k < around.length; k++) { let [x, y] = around[k - 1]; const [tx, ty] = around[k]; while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); walked.push(`${x},${y}`); } }
  assert.ok(!walked.includes("3,3") && walked.at(-1) === "4,3" && around.length > 2, "never through the enemy's square");
  // Two enemies corner to corner: slipping diagonally between them is still allowed.
  await page.evaluate(() => {
    const clone = { ...__enemy, document: { ...__enemy.document, id: "orc2", x: 200, y: 200 } };
    __enemy.document.x = 100; __enemy.document.y = 300; window.__more = [clone];
    __mover.document.x = 100; __mover.document.y = 200; Hooks.callAll("updateToken", __enemy.document, {}, {});
  });
  const squeeze = await page.evaluate(() => new CONFIG.Token.objectClass().findMovementPath.call(__mover, [{ x: 100, y: 200 }, { x: 200, y: 300 }], {}).result.map(w => [w.x / 100, w.y / 100]));
  console.log("between two enemies:", JSON.stringify(squeeze));
  assert.deepStrictEqual(squeeze, [[1, 2], [2, 3]], "one diagonal step between the two enemies");
  // Switched off: straight through again.
  await page.evaluate(async () => { window.__more = []; __mover.document.x = 100; __mover.document.y = 300; __enemy.document.x = 300; __enemy.document.y = 300; await game.settings.set("lucd20-automations", "pathfinding_aroundEnemies", false); Hooks.callAll("updateToken", __enemy.document, {}, {}); });
  assert.deepStrictEqual((await route(page, [4, 3])).map(p => p.slice(0, 2)), [[1, 3], [4, 3]], "the option off: enemy tokens do not close squares");
  await page.evaluate(async () => { await game.settings.set("lucd20-automations", "pathfinding_aroundEnemies", true); __enemy.document.x = 300; __enemy.document.y = 200; Hooks.callAll("updateToken", __enemy.document, {}, {}); });

  // Difficult terrain: a region on squares x 2..3, y 3..4 (cost ×2), enemy moved away
  await page.evaluate(() => {
    __enemy.document.x = 1100; __enemy.document.y = 0;
    __regions.push({ document: { behaviors: [{ type: "modifyMovementCost", system: { difficulties: { walk: 2 } } }] }, bounds: { x: 200, y: 300, width: 200, height: 200 }, testPoint: p => p.x >= 200 && p.x < 400 && p.y >= 300 && p.y < 500 });
    Hooks.callAll("createRegion", {}, {}, {});
  });
  r = await route(page, [4, 3]);
  console.log("around difficult terrain:", JSON.stringify(r));
  assert.ok(r.some(p => p[1] === 2), "goes over the difficult squares when that's cheaper (4 vs 5)");
  await page.evaluate(() => game.keyboard.downKeys.add("KeyT"));
  const withT = await route(page, [4, 3]);
  console.log("holding T:", JSON.stringify(withT));
  assert.deepStrictEqual(withT.map(p => p.slice(0, 2)), [[1, 3], [4, 3]], "T ignores terrain: straight line");
  await page.evaluate(() => game.keyboard.downKeys.delete("KeyT"));
  // GM: Foundry passes ignoreCost → still routes around walls, terrain ignored
  const gmPath = await page.evaluate(async () => {
    const res = CONFIG.Token.objectClass.prototype.findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 400, y: 300 }], { constrainOptions: { ignoreCost: true } });
    return (res.result ?? (await res.promise)).map(w => [w.x / 100, w.y / 100, !!w.foundry]);
  });
  console.log("ignoreCost:", JSON.stringify(gmPath));
  assert.deepStrictEqual(gmPath.map(p => p.slice(0, 2)), [[1, 3], [4, 3]], "ignoreCost: our route (terrain ignored)");
  assert.ok(!gmPath.some(p => p[2]), "ignoreCost doesn't switch routing off");

  // Toggle off (per player) → Foundry's own result
  await page.evaluate(() => game.settings.set("lucd20-automations", "pathfindingActive", false));
  r = await route(page, [7, 3]);
  assert.ok(r.every(p => p[2]), "tool off: Foundry's path");
  await page.evaluate(() => game.settings.set("lucd20-automations", "pathfindingActive", true));

  // Timing on a big map: 60×60, maze-ish walls
  const ms = await page.evaluate(async () => {
    canvas.dimensions.sceneRect = { x: 0, y: 0, width: 6000, height: 6000 };
    __regions.length = 0;
    for (let k = 1; k < 30; k++) __walls.push({ document: { c: [k * 200, k % 2 ? 0 : 200, k * 200, k % 2 ? 5800 : 6000], move: 20, door: 0, ds: 0 } });
    Hooks.callAll("updateWall", {}, {}, {});
    const t0 = performance.now();
    const res = CONFIG.Token.objectClass.prototype.findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 5900, y: 5900 }], { constrainOptions: {} });
    const path = await res.promise;
    return [Math.round(performance.now() - t0), path.length];
  });
  console.log("60×60 maze: ms, waypoints =", ms);
  assert.ok(ms[1] > 20, "a winding route was found");
  // A big older scene: 150 × 150 squares with one long wall to go round
  const big = await page.evaluate(async () => {
    canvas.dimensions.sceneRect = { x: 0, y: 0, width: 15000, height: 15000 };
    __walls.length = 0;
    __walls.push({ document: { c: [7500, 0, 7500, 14500], move: 20, door: 0, ds: 0 } });
    Hooks.callAll("updateWall", {}, {}, {});
    const t0 = performance.now();
    const res = CONFIG.Token.objectClass.prototype.findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 14800, y: 300 }], { constrainOptions: {} });
    const path = res.result ?? (await res.promise);
    return [Math.round(performance.now() - t0), path.some(w => w.y >= 14500), path.some(w => w.foundry)];
  });
  console.log("150×150 round a long wall: ms, went round, fallback =", big);
  assert.ok(big[1] && !big[2], "big scene: routed round the wall, not Foundry's fallback");

  // A second drag on the same big scene (same context): fast
  const again = await page.evaluate(async () => {
    const t0 = performance.now();
    const res = CONFIG.Token.objectClass.prototype.findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 14800, y: 400 }], { constrainOptions: {} });
    await (res.result ?? res.promise);
    return Math.round(performance.now() - t0);
  });
  console.log("next mouse move on the big scene: ms =", again);
  // A freehand wall running exactly through square centres (x = 350) blocks
  const centres = await page.evaluate(async () => {
    canvas.dimensions.sceneRect = { x: 0, y: 0, width: 1200, height: 800 };
    __walls.length = 0;
    __walls.push({ document: { c: [350, 0, 350, 650], move: 20, door: 0, ds: 0 } });
    Hooks.callAll("updateWall", {}, {}, {});
    const res = CONFIG.Token.objectClass.prototype.findMovementPath.call(__mover, [{ x: 100, y: 300 }, { x: 500, y: 300 }], { constrainOptions: {} });
    return (res.result ?? (await res.promise)).map(w => [w.x / 100, w.y / 100]);
  });
  console.log("wall through centres:", JSON.stringify(centres));
  assert.ok(centres.some(p => p[1] >= 7), "goes round a wall that runs through square centres");

  // ---------- Player: explored areas only ----------
  page = await open("gm=0");
  await set(page, "pathfinding_enabled", true);
  await page.evaluate(() => {
    canvas.fog = { fogExploration: true, isPointExplored: p => p.x < 500 || p.y >= 700 }; // left part + bottom row explored
    canvas.visibility = { tokenVision: true, testVisibility: () => false };
    __walls[1].document.ds = 1; // door open
    Hooks.callAll("updateWall", {}, {}, {});
  });
  r = await route(page, [7, 7]);
  console.log("player, explored only:", JSON.stringify(r));
  const pts = r.map(p => p.slice(0, 2));
  assert.ok(!pts.slice(1, -1).some(([x, y]) => x >= 5 && y < 7), "never routes through unexplored squares");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 25 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
