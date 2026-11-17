const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 55: PF2e effect areas: the 25% rule, targeting, hover cover. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const cv = await import("/modules/lucd20-automations/scripts/systems/pf2e/cover.js");
    const ar = await import("/modules/lucd20-automations/scripts/systems/pf2e/area.js");
    const out = {};
    const grid = (size, ox = 0) => ({ size, type: 1, getTopLeftPoint: ({ i, j }) => ({ x: ox + i * size, y: j * size }), getOffset: ({ x, y }) => ({ i: Math.floor((x - ox) / size), j: Math.floor(y / size) }) });
    const wall = (x1, y1, x2, y2) => ({ c: [x1, y1, x2, y2], move: 20, door: 0, ds: 0 });
    const burst = (x, y, radius) => ({ shapes: [{ type: "circle", x, y, radius }], flags: { pf2e: { areaShape: "burst", origin: { actor: "Actor.caster", name: "Fireball" }, messageId: "m1" } } });
    // The owner's two cases.
    Object.assign(canvas, { ready: true, grid: grid(110, 5) });
    canvas.walls = { placeables: [wall(225, -100, 225, 303)] };
    out.caseA = Math.round(cv.squareReach(burst(337, 330, 220), { i: 1, j: 2 }, null) * 100);
    canvas.grid = grid(135); canvas.walls = { placeables: [wall(270, 133, 270, 500)] };
    out.caseB = Math.round(cv.squareReach(burst(405, 403, 270), { i: 1, j: 3 }, null) * 100);
    const wideB = cv.widenCoverage(burst(405, 403, 270), { covered: [], blocked: [{ i: 1, j: 3 }], covers: () => false }, null);
    out.caseBCounted = wideB.covers({ i: 1, j: 3 });
    canvas.grid = grid(110, 5); canvas.walls = { placeables: [wall(225, -100, 225, 303)] };
    const wideA = cv.widenCoverage(burst(337, 330, 220), { covered: [], blocked: [{ i: 1, j: 2 }], covers: () => false }, null);
    out.caseACounted = wideA.covers({ i: 1, j: 2 });
    // Targeting: by the area's squares; the caster's alliance; hidden, dead, neutral and self rules.
    canvas.grid = grid(100); canvas.walls = { placeables: [] };
    const caster = { alliance: "party", isOfType: () => true };
    window.fromUuidSync = u => (u === "Actor.caster" ? caster : null);
    const tok = (id, i, j, actor, extra = {}) => ({ id, uuid: `Token.${id}`, x: i * 100, y: j * 100, width: 1, height: 1, hidden: false, actor, ...extra });
    const npc = (alliance, extra = {}) => ({ alliance, isOfType: () => true, isDead: false, ...extra });
    const docs = [tok("me", 3, 3, caster), tok("gob", 2, 2, npc("opposition")), tok("ally", 4, 2, npc("party")), tok("cow", 2, 4, npc(null)), tok("dead", 4, 4, npc("opposition", { isDead: true })), tok("ghost", 3, 2, npc("opposition"), { hidden: true }), tok("far", 9, 9, npc("opposition"))];
    canvas.tokens = { placeables: docs.map(d => ({ document: d })), controlled: [] };
    const inArea = new Set(["2,2", "3,3", "4,2", "2,4", "4,4", "3,2"]);
    const region = { ...burst(350, 350, 200), getCoverage: () => ({ covers: o => inArea.has(`${o.i},${o.j}`) }), delete: async () => { out.deleted = true; } };
    const ids = choice => ar._test.chooseTargets(region, choice).map(d => d.id).sort();
    out.enemies = ids({ targets: "enemies" });
    out.allies = ids({ targets: "allies", self: true });
    out.all = ids({ targets: "all", neutral: true });
    // The window → targets and the message's Toolbelt targets; remove the area after.
    let set = null; canvas.tokens.setTargets = x => { set = x; };
    const msg = { isOwner: true, update: async u => { out.msgUpdate = u; } };
    game.messages = { get: id => (id === "m1" ? msg : null) };
    foundry.applications.api.DialogV2.wait = async () => ({ targets: "enemies", self: false, neutral: false, dismiss: true });
    out.both = ids({ targets: "both", neutral: true });
    Hooks.callAll("createRegion", region, {}, game.user.id);
    await new Promise(res => setTimeout(res, 200));
    out.set = set;
    // Hover: a line to each creature in the area you can see, with its cover.
    canvas.walls = { placeables: [wall(250, 150, 250, 260)] };
    out.hover = ar._test.hoverLines(region).map(l => `${l.token.id}:${l.level}`);
    return out;
  });
  console.log(JSON.stringify(r));
  assert.ok(r.caseA >= 25 && r.caseA <= 45, `the earlier case reaches about a third of its square (${r.caseA}%)`);
  assert.ok(r.caseB < 10, `the sliver: under 10% (${r.caseB}%)`);
  assert.deepStrictEqual([r.caseACounted, r.caseBCounted], [true, false], "25%: the first counts, the sliver doesn't");
  assert.deepStrictEqual(r.enemies, ["gob"], "enemies: not hidden, dead, neutral, allies, me or outside");
  assert.deepStrictEqual(r.allies, ["ally", "me"], "allies and me");
  assert.deepStrictEqual(r.all, ["ally", "cow", "gob"], "all with neutral; not me unless asked");
  assert.deepStrictEqual(r.both, ["ally", "cow", "gob"], "Both = all sides");
  assert.deepStrictEqual(r.set, ["gob"], "the window's choice targets them");
  assert.deepStrictEqual(r.msgUpdate, { "flags.pf2e-toolbelt.targetHelper.targets": ["Token.gob"] }, "the spell message's Toolbelt targets");
  assert.strictEqual(r.deleted, true, "remove the area after");
  assert.ok(r.hover.includes("gob:greater") || r.hover.includes("gob:standard"), "hover: the goblin behind the wall has cover");
  assert.ok(r.hover.includes("ally:none") && !r.hover.some(h => h.startsWith("ghost")), "the ally in the open has none; the hidden one isn't shown");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 55 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
