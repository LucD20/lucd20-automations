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
        tokens: { get placeables() { return [__mover, __enemy]; } }
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
  r = await route(page, [4, 3]);
  console.log("around the enemy:", JSON.stringify(r));
  const cells = [];
  for (let k = 1; k < r.length; k++) {
    let [x, y] = r[k - 1];
    const [tx, ty] = r[k];
    while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); cells.push([x, y]); }
  }
  const threatened = ([x, y]) => Math.abs(x - 3) <= 1 && Math.abs(y - 2) <= 1;
  assert.ok(!cells.slice(0, -1).some(threatened), "goes around the squares next to the enemy");
  // Hold Q → straight through
  await page.evaluate(() => game.keyboard.downKeys.add("KeyQ"));
  const withQ = await route(page, [4, 3]);
  console.log("holding Q:", JSON.stringify(withQ));
  assert.deepStrictEqual(withQ.map(p => p.slice(0, 2)), [[1, 3], [4, 3]], "Q ignores threats: straight line");
  await page.evaluate(() => game.keyboard.downKeys.delete("KeyQ"));

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
