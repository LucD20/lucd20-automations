const { chromium } = require("playwright");
const assert = require("assert");

/** v0.92.0: lasting area effects (PLAN §29 C5): the window's fold, conditions when placed / entering / turns, leaving, rounds. */
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
    const settle = (ms = 60) => new Promise(res => setTimeout(res, ms));
    const ar = await import(`/modules/${M}/scripts/systems/pf2e/area.js`);
    const ae = await import(`/modules/${M}/scripts/systems/pf2e/area-effects.js`);
    const out = {};
    await game.settings.set(M, "pf2eAreas_enabled", true);
    await game.settings.set(M, "pf2eAreas_reach", false);
    await settle();
    const registry = {};
    window.fromUuidSync = u => registry[u] ?? null;
    game.users = Object.assign([{ id: game.user.id, isGM: true, active: true }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = { id: `c${++mid}`, ...d }; (window.__chat ??= []).push(m); return m; } };
    canvas.grid = { size: 100, type: 1, getOffset: ({ x, y }) => ({ i: Math.floor(x / 100), j: Math.floor(y / 100) }) };
    canvas.walls = { placeables: [] };
    // Actors with PF2e-like conditions.
    const mkActor = (id, alliance) => {
      const conds = new Map();
      const a = { id, uuid: `Actor.${id}`, alliance, isOfType: () => true, isDead: false, conds,
        getCondition: s => (conds.has(s) ? { slug: s, value: conds.get(s), update: async u => conds.set(s, u["system.value.value"]) } : null),
        hasCondition: s => conds.has(s),
        increaseCondition: async (s, o = {}) => { conds.set(s, o.value ?? (conds.has(s) ? (conds.get(s) ?? 0) + 1 : null)); },
        decreaseCondition: async (s, o = {}) => { conds.delete(s); } };
      registry[a.uuid] = a; return a;
    };
    const caster = mkActor("caster", "party");
    const tok = (id, i, j, actor, extra = {}) => { const d = { id, uuid: `Scene.s.Token.${id}`, x: i * 100, y: j * 100, width: 1, height: 1, hidden: false, actor, ...extra }; registry[d.uuid] = d; return d; };
    const gob = tok("gob", 2, 2, mkActor("gob", "opposition")), orc = tok("orc", 8, 8, mkActor("orc", "opposition")), ghost = tok("ghost", 3, 2, mkActor("ghost", "opposition"), { hidden: true }),
      ally = tok("ally", 4, 2, mkActor("ally", "party")), me = tok("me", 3, 3, caster);
    me.actor = caster;
    // The goblin already frightened 2: the area's frightened 1 leaves it alone (and never removes it).
    gob.actor.conds.set("frightened", 2);
    const docs = [gob, orc, ghost, ally, me];
    canvas.tokens = { placeables: docs.map(d => ({ document: d })), controlled: [], setTargets: () => {} };
    const inArea = new Set(["2,2", "3,3", "4,2", "3,2", "2,3"]);
    const region = { id: "r1", uuid: "Scene.s.Region.r1", name: "Stinking Cloud", flags: { pf2e: { areaShape: "burst", origin: { actor: "Actor.caster", name: "Stinking Cloud" } } }, shapes: [{ type: "circle", x: 300, y: 300, radius: 200 }],
      getCoverage: () => ({ covers: o => inArea.has(`${o.i},${o.j}`) }),
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = JSON.parse(JSON.stringify(v)); },
      testUserPermission: () => true, async delete() { out.deleted = true; Hooks.callAll("preDeleteRegion", this); } };
    registry[region.uuid] = region;
    canvas.regions = { placeables: [{ document: region }] };
    game.messages = { get: () => null };

    // The combat: the caster's turn, round 1.
    const cbt = (id, d) => ({ id, token: d, actor: d.actor });
    const cs = [cbt("cMe", me), cbt("cGob", gob), cbt("cOrc", orc)];
    game.combat = { id: "k1", started: true, round: 1, turn: 0, combatant: cs[0], combatants: cs };
    for (const c of cs) c.combat = game.combat;

    // The window: the fold is there; two conditions added with +, rounds 2, on entering and at turn start, removed on leaving.
    window.__dialogPrep = form => {
      out.fold = !!form.querySelector(".lucd20-area-lasting summary");
      out.condOptions = form.querySelectorAll("[name='condition'] option").length;
      ar.wireLasting(form);
      const sel = form.querySelector("[name='condition']"), val = form.querySelector("[name='condValue']"), add = form.querySelector("[data-lucd20-add-cond]");
      sel.value = "sickened"; sel.dispatchEvent(new Event("change")); out.valueShown = !val.hidden; val.value = "1"; add.click();
      sel.value = "off-guard"; sel.dispatchEvent(new Event("change")); out.valueHidden = val.hidden; add.click();
      sel.value = "frightened"; val.value = "1"; add.click();
      out.chips = [...form.querySelectorAll(".lucd20-area-chip")].map(c => `${c.dataset.slug}${c.dataset.value ?? ""}`);
      form.querySelector("[name='rounds']").value = "2";
      for (const n of ["enter", "turnStart", "leave"]) form.querySelector(`[name="${n}"]`).checked = true;
      form.querySelector("[name='targets'][value='enemies']").checked = true;
      form.querySelector("[name='dismiss']").checked = true; // ignored: the area lasts
    };
    window.__dialogMode = undefined;
    Hooks.callAll("createRegion", region, {}, game.user.id);
    await settle(250);
    window.__dialogPrep = null;
    const fx = region.flags[M]?.areaEffect;
    out.stored = [fx?.rounds, fx?.conditions?.map(c => `${c.slug}${c.value ?? ""}`).join(","), JSON.stringify(fx?.when), fx?.leave, fx?.filter?.targets, JSON.stringify(fx?.start), !out.deleted];
    const c = d => [...d.actor.conds.entries()].map(([k, v]) => `${k}${v ?? ""}`).sort().join(",");
    // "Those inside now" on by default: enemies inside (goblin, the hidden ghost) got them; the ally and me didn't.
    out.placed = [c(gob), c(ghost), c(ally), c(me), JSON.stringify(region.flags[M]?.areaEffect?.applied)];

    // The orc walks in: on entering. Then the goblin walks out: removed on leaving (only what the area added).
    orc.x = 200; orc.y = 300; Hooks.callAll("updateToken", orc, { x: 200, y: 300 }); await settle(250);
    out.entered = c(orc.actor ? orc : orc);
    gob.x = 900; gob.y = 900; Hooks.callAll("updateToken", gob, { x: 900, y: 900 }); await settle(250);
    out.left = c(gob);
    // The orc's off-guard removed by hand; its turn starts inside: back on (start of turn).
    orc.actor.conds.delete("off-guard");
    await ae._test.onTurn(cs[2], "start");
    out.turnStart = c(orc);
    // No chat line for any of it (hidden creatures are never named).
    out.chatBefore = (window.__chat ?? []).length;

    // Rounds: round 2, the caster's turn: still there; round 3, the caster's turn: ends; what it added goes.
    game.combat.round = 2; await ae._test.onTurn(cs[0], "start");
    out.round2 = !out.deleted;
    game.combat.round = 3; await ae._test.onTurn(cs[0], "start"); await settle(80);
    out.ended = [!!out.deleted, c(orc), c(ghost), (window.__chat ?? []).at(-1)?.content?.replace(/<[^>]+>/g, "").trim()];

    // By code (for spells later): setAreaEffect with no window; turn end only; all creatures.
    const region2 = { ...region, id: "r2", uuid: "Scene.s.Region.r2", name: "Web", flags: { pf2e: {} }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = JSON.parse(JSON.stringify(v)); }, async delete() {} };
    registry[region2.uuid] = region2;
    canvas.regions.placeables = [{ document: region2 }];
    gob.x = 200; gob.y = 200;
    await ae.setAreaEffect(region2, { conditions: [{ slug: "immobilized" }], when: { turnEnd: true }, filter: { targets: "all" } });
    out.codeNotYet = c(gob).includes("immobilized");
    await ae._test.onTurn(cs[1], "end");
    out.codeTurnEnd = c(gob).includes("immobilized");
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.ok(r.fold && r.condOptions > 10, "the fold, with the system's conditions");
  assert.ok(r.valueShown && r.valueHidden, "a value only for valued conditions");
  assert.deepStrictEqual(r.chips, ["sickened1", "off-guard", "frightened1"]);
  assert.deepStrictEqual(r.stored, [2, "sickened1,off-guard,frightened1", JSON.stringify({ placed: true, enter: true, turnStart: true, turnEnd: false }), true, "enemies", JSON.stringify({ combat: "k1", round: 1, combatant: "cMe" }), true], `stored ${r.stored}`);
  assert.strictEqual(r.placed[0], "frightened2,off-guard,sickened1", "the goblin: frightened 2 kept, the rest added");
  assert.strictEqual(r.placed[1], "frightened1,off-guard,sickened1", "a hidden enemy too");
  assert.deepStrictEqual([r.placed[2], r.placed[3]], ["", ""], "not the ally, not me");
  assert.strictEqual(r.entered, "frightened1,off-guard,sickened1", "on entering");
  assert.strictEqual(r.left, "frightened2", "on leaving: only what the area added goes");
  assert.strictEqual(r.turnStart, "frightened1,off-guard,sickened1", "start of turn inside");
  assert.strictEqual(r.chatBefore, 0, "no chat lines");
  assert.ok(r.round2, "round 2: still there");
  assert.deepStrictEqual(r.ended.slice(0, 3), [true, "", ""], "after 2 rounds: the area and its conditions go");
  assert.strictEqual(r.ended[3], "Stinking Cloud ends.");
  assert.deepStrictEqual([r.codeNotYet, r.codeTurnEnd], [false, true], "by code: end of turn only");
  console.log("PHASE 82 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
