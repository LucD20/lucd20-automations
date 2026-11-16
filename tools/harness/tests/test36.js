const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 36: D&D 4e Opportunity Attack Warning (marks while a move is planned). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=0&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    CONST.GRID_TYPES = { GRIDLESS: 0, SQUARE: 1 };
    foundry.utils.mergeObject ??= (a, b) => ({ ...a, ...b, used: { ...a.used, ...(b.used ?? {}) } });
    const combatants = new Map();
    const token = (name, col, row, disposition, { used = 0, visible = true, hidden = false, statuses = [] } = {}) => {
      const actor = { name, statuses: new Set(statuses), system: { attributes: { hp: { value: 10 } } }, type: "NPC" };
      const combatant = { id: name, getFlag: () => ({ used: { opportunity: used } }) };
      combatant.combat = null;
      combatants.set(actor, combatant);
      const t = { name, actor, visible, document: { x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden, combatant } };
      return t;
    };
    const hero = token("Hero", 2, 2, 1);
    const orc = token("Orc", 3, 2, -1);            // adjacent, has its opportunity action
    const spent = token("Spent Orc", 2, 3, -1, { used: 1 }); // adjacent, already used it
    const dazed = token("Dazed Orc", 1, 2, -1, { statuses: ["dazed"] });
    const unseen = token("Unseen Orc", 1, 1, -1, { visible: false }); // adjacent but this player cannot see it
    const far = token("Far Orc", 6, 2, -1);        // the path passes next to it later
    const ally = token("Ally", 1, 3, 1);
    Object.assign(canvas, { ready: true, grid: { size: 100, type: 1 }, interface: new PIXI.Container(), tokens: { placeables: [hero, orc, spent, dazed, unseen, far, ally] } });
    game.combat = { started: true, combatant: { id: "Hero" }, getCombatantsByActor: actor => [combatants.get(actor)] };
    for (const c of combatants.values()) c.combat = game.combat;
    const mod = await import("/modules/lucd20-automations/scripts/systems/dnd4e/reactions/opportunity-warning.mjs");
    const marks = () => (canvas.interface.children[0]?.children.length ?? 0) / 3; // an arrow, a badge and its "!" per enemy
    const plan = async (path) => { await mod._test.onPath(hero, { result: path.map(([c, r, action = "walk"]) => ({ x: c * 100, y: r * 100, action })) }); return marks(); };
    const out = {};
    game.settings.register("core", "globalInterfaceVolume", { scope: "client", config: false, type: Number, default: 0.5 });
    out.away = await plan([[2, 2], [2, 1], [2, 0]]);                 // leaves the Orc's side: 1 mark (not the spent, dazed or unseen ones)
    // The sound: once when an enemy becomes a threat, not again while the same ones stay marked; above the tokens.
    const heard = () => mod._test.state.shings ?? 0;
    out.sound = [heard()]; await plan([[2, 2], [2, 1], [2, 0]]); out.sound.push(heard());
    out.zIndex = canvas.interface.children[0].zIndex;
    out.pastFar = await plan([[2, 2], [2, 1], [5, 1], [5, 3], [7, 3]]); // also walks past the Far Orc and on: 2 marks
    out.sound.push(heard());
    out.shift = await plan([[2, 2], [2, 1, "shift"]]);               // shifting never provokes
    out.stay = await plan([[2, 2]]);
    out.asGM = (game.user.isGM = true, await plan([[2, 2], [2, 1], [2, 0]])); // the GM also sees the unseen enemy's mark
    game.user.isGM = false;
    game.combat.started = false;
    out.noCombat = await plan([[2, 2], [2, 1]]);
    game.combat.started = true;
    await plan([[2, 2], [2, 1]]);
    out.before = marks();
    window.dispatchEvent(new Event("pointerup"));                    // the drag ends
    out.afterDrop = marks();
    // With Pathfinding answering the search, its announcement draws the marks.
    Hooks.callAll("lucd20MovementPath", hero, { result: [{ x: 200, y: 200 }, { x: 200, y: 100, action: "walk" }] });
    await new Promise(r => setTimeout(r, 20));
    out.fromHook = marks();
    await game.settings.set("lucd20-automations", "dnd4eOpportunityWarning_enabled", false);
    out.off = [canvas.interface.children.length, (Hooks._h.lucd20MovementPath ?? []).length];
    return out;
  });
  console.log(result, errors);
  assert.deepStrictEqual(result, { away: 1, sound: [1, 1, 2], zIndex: 10000, pastFar: 2, shift: 0, stay: 0, asGM: 2, noCombat: 0, before: 1, afterDrop: 0, fromHook: 1, off: [0, 0] });
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 36 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
