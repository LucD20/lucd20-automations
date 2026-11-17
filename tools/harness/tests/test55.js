const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 57: Instant Range (every system). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const ir = await import("/modules/lucd20-automations/scripts/features/instant-range.js");
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    // A 5-ft grid where every square counts (4e-like): Chebyshev distance × 5.
    canvas.grid = { size: 100, units: "ft", isGridless: false, measurePath: ([a, b]) => ({ distance: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) * 20) / 100 * 5 }) };
    canvas.controls = new PIXI.Container();
    CONST.GRID_TYPES ??= { SQUARE: 1, GRIDLESS: 0 }; canvas.grid.type = 1;
    canvas.ready = true;
    const tok = (id, i, j, extra = {}) => ({ id, document: { id, x: i * 100, y: j * 100, width: extra.w ?? 1, height: extra.w ?? 1, elevation: extra.elev ?? 0, hidden: !!extra.hidden }, visible: extra.visible ?? true, center: { x: i * 100 + 50, y: j * 100 + 50 } });
    const me = tok("me", 0, 0), wolf = tok("wolf", 3, 0), ogre = tok("ogre", 2, 4, { w: 2 }), bird = tok("bird", 1, 0, { elev: 15 }), ghost = tok("ghost", 5, 5, { hidden: true });
    canvas.tokens = { placeables: [me, wolf, ogre, bird, ghost], controlled: [me] };
    game.user.targets = new Set();
    const shown = () => [...ir._test.labels.entries()].map(([id, l]) => `${id}:${l.text}@${Math.round(l.position.y)}`).sort();
    const out = {};
    out.measures = [ir.measure(me, wolf), ir.measure(me, ogre), ir.measure(me, bird)].map(m => `${m.distance} ${m.units}`);
    // Hover one token: its label above it.
    Hooks.callAll("hoverToken", wolf, true); await settle();
    out.hover = shown();
    Hooks.callAll("hoverToken", wolf, false); await settle();
    out.unhover = shown();
    // Alt: every token you can see (the GM sees hidden ones; a player wouldn't).
    Hooks.callAll("highlightObjects", true); await settle();
    out.alt = shown().length;
    Hooks.callAll("highlightObjects", false); await settle();
    // Targets keep theirs; a token claimed by a cover preview is left to it.
    game.user.targets = new Set([ogre, wolf]); Hooks.callAll("targetToken", game.user, ogre, true); await settle();
    out.targets = shown();
    ir.claimed.add("wolf"); ir.refreshRange(); await settle();
    out.claimed = shown();
    ir.claimed.clear();
    // Combat only.
    await game.settings.set(M, "instantRange_combatOnly", true); await settle();
    out.combatOnly = shown();
    await game.settings.set(M, "instantRange_combatOnly", false);
    // No token of yours: nothing.
    canvas.tokens.controlled = []; game.user.character = null; Hooks.callAll("controlToken", me, false); await settle();
    out.noSource = shown();
    // The ruler icon beside the distance; the size in screen pixels (zoom 2: half the scale).
    canvas.tokens.controlled = [me]; canvas.stage = { scale: { x: 2 } };
    Hooks.callAll("hoverToken", wolf, true); await settle();
    const l = ir._test.labels.get("wolf");
    out.icon = [l.children.length, l.children[0].text, Math.round(l.scale.x * 100) / 100];
    await game.settings.set(M, "instantRange_size", 24); await settle();
    out.size = Math.round(ir._test.labels.get("wolf").words.style.fontSize);
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.measures, ["15 ft", "20 ft", "15 ft"], "nearest squares; the 2x2 ogre four squares down; elevation counts");
  assert.deepStrictEqual(r.hover, ["wolf:15 ft@-2"], "hovering: the distance just above the token");
  assert.deepStrictEqual(r.unhover, []);
  assert.strictEqual(r.alt, 4, "Alt: every other token (the GM sees the hidden one)");
  assert.deepStrictEqual(r.targets, ["ogre:20 ft@398", "wolf:15 ft@-2"], "targets keep their distance");
  assert.deepStrictEqual(r.claimed, ["ogre:20 ft@398"], "a target the cover preview labels is left to it");
  assert.deepStrictEqual(r.combatOnly, [], "only in combat: none out of combat");
  assert.deepStrictEqual(r.noSource, [], "no token of yours: none");
  assert.deepStrictEqual(r.icon, [2, "\uf545", 0.25], "a ruler icon and the distance; scaled for the zoom");
  assert.strictEqual(r.size, 48, "the size setting (drawn at twice, for sharpness)");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 57 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
