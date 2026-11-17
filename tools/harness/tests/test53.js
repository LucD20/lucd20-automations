const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 54: PF2e cover (the owner's diagram). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const cv = await import("/modules/lucd20-automations/scripts/systems/pf2e/cover.js");
    Object.assign(canvas, { ready: true, grid: { size: 100, type: 1 } });
    const tok = (id, col, row, extra = {}) => ({ id, x: col * 100, y: row * 100, width: 1, height: 1, hidden: false, actor: { hasCondition: s => (extra.conds ?? []).includes(s), hitPoints: { value: extra.hp ?? 10, max: 10 } }, ...extra });
    const wall = (x1, y1, x2, y2, extra = {}) => ({ c: [x1, y1, x2, y2], move: 20, door: 0, ds: 0, ...extra });
    const run = (a, t, walls, tokens = []) => { canvas.walls = { placeables: walls }; canvas.tokens = { placeables: tokens, controlled: [] }; const x = cv._test.computeCover(a, t); return [x.level, Math.round(x.wallShare * 100)]; };
    const out = {};
    // The diagram, top: the attacker (yellow) and the target (red), the wall (green).
    out.greater = run(tok("y", 3, 2), tok("r", 2, 4), [wall(300, 100, 300, 400)]);
    out.none = run(tok("y", 6, 4), tok("r", 5, 3), [wall(600, 100, 600, 358)]);
    out.standard = run(tok("y", 9, 4), tok("r", 8, 3), [wall(900, 100, 900, 400)]);
    out.openDoor = run(tok("y", 9, 4), tok("r", 8, 3), [wall(900, 100, 900, 400, { door: 1, ds: 1 })]);
    // Bottom: creatures on the line; dead and prone don't count.
    const att = tok("y", 11, 8), c1 = tok("c1", 3, 8), c2 = tok("c2", 5, 8), dead = tok("d", 7, 8, { hp: 0 }), prone = tok("p", 9, 8, { conds: ["prone"] });
    const all = [att, c1, c2, dead, prone];
    out.lesser = run(att, c1, [], all);
    out.behindDeadAndProne = run(att, c2, [], all);
    out.hiddenCreature = run(att, c1, [], [att, c1, tok("h", 5, 8, { hidden: true })]);
    // The roll: the DC goes up for this roll; an existing Cover counts; the window's choice changes it; not on rerolls.
    canvas.walls = { placeables: [wall(900, 100, 900, 400)] }; canvas.tokens = { placeables: [], controlled: [] };
    const ctx = (extra = {}) => ({ type: "attack-roll", dc: { value: 20, statistic: { modifiers: extra.mods ?? [] } }, origin: { token: tok("y", 9, 4) }, target: { token: tok("r", 8, 3) }, ...extra });
    const c = ctx(); cv._test.prepare(c);
    out.prepared = [c.dc.value, { ...c.lucd20Cover }];
    cv._test.choose(c, "greater"); out.chosen = [c.dc.value, c.lucd20Cover.chosen];
    cv._test.choose(c, "none"); out.none2 = c.dc.value;
    const withCover = ctx({ mods: [{ type: "circumstance", slug: "effect-cover", label: "Cover", modifier: 1, enabled: true }] });
    cv._test.prepare(withCover); out.existing = withCover.dc.value;
    const reroll = ctx({ isReroll: true }); cv._test.prepare(reroll); out.reroll = reroll.dc.value;
    // The window: four buttons above Roll, the automatic one chosen; a click re-renders.
    const dlg = document.createElement("div"); dlg.innerHTML = `<div class="window-content"><button class="roll">Roll</button></div>`;
    const c2x = ctx(); cv._test.prepare(c2x);
    let rendered = 0;
    const app = { context: c2x, render() { rendered++; } };
    Hooks.callAll("renderCheckModifiersDialog", app, dlg);
    out.buttons = [...dlg.querySelectorAll("[data-lucd20-cover]")].map(b => `${b.dataset.lucd20Cover}${b.classList.contains("active") ? "*" : ""}`);
    out.beforeRoll = dlg.querySelector(".lucd20-cover-pick").nextElementSibling?.className;
    dlg.querySelector('[data-lucd20-cover="lesser"]').click();
    out.click = [c2x.dc.value, rendered];
    // The card.
    const card = cov => { const h = document.createElement("div"); h.innerHTML = `<div class="dice-roll"></div><div class="degree-of-success"></div>`; Hooks.callAll("renderChatMessageHTML", { flags: { pf2e: { context: { type: "attack-roll", lucd20Cover: cov } } } }, h); return h.querySelector(".lucd20-cover-note")?.textContent.trim() ?? null; };
    out.cards = [card({ auto: "standard", chosen: "standard" }), card({ auto: "standard", chosen: "lesser" }), card({ auto: "none", chosen: "none" })];
    return out;
  });
  console.log(JSON.stringify(r));
  assert.strictEqual(r.greater[0], "greater", "more than half hidden behind the wall: greater");
  assert.ok(r.greater[1] > 50);
  assert.strictEqual(r.none[0], "none", "the line passes beside the wall's end: no cover");
  assert.strictEqual(r.standard[0], "standard", "the line runs through the wall's end: standard");
  assert.ok(r.standard[1] <= 50);
  assert.strictEqual(r.openDoor[0], "none", "an open door doesn't block");
  assert.deepStrictEqual([r.lesser[0], r.behindDeadAndProne[0], r.hiddenCreature[0]], ["lesser", "none", "none"], "a creature on the line: lesser; dead, prone and hidden ones don't count");
  assert.deepStrictEqual(r.prepared, [22, { auto: "standard", chosen: "standard", applied: 2, existing: 0 }], "the DC +2 for this roll");
  assert.deepStrictEqual([r.chosen, r.none2], [[24, "greater"], 20], "the window's choice changes it");
  assert.strictEqual(r.existing, 21, "an existing +1 Cover: only the difference");
  assert.strictEqual(r.reroll, 20, "not on rerolls");
  assert.deepStrictEqual(r.buttons, ["none", "lesser", "standard*", "greater"]);
  assert.strictEqual(r.beforeRoll, "roll", "above the Roll button");
  assert.deepStrictEqual(r.click, [21, 1], "a click: lesser (+1), the window redrawn");
  assert.deepStrictEqual(r.cards, ["Standard cover (+2)", "Lesser cover (+1), set by hand (auto: Standard cover)", null], "the card says the cover used, and when it was set by hand");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 54 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
