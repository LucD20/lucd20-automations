const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 37: PF2e rules 1–4 (Frightened, Sickened, Shove, Trip). */
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
    const mod = await import("/modules/lucd20-automations/scripts/systems/pf2e/rules.js");
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    // --- actors with PF2e's condition calls ---
    const actor = (id, name, level, conditions = {}) => {
      const a = { id, name, level, uuid: `Actor.${id}`, isOwner: true, cond: { ...conditions }, log: [],
        hasCondition(slug) { return slug in this.cond; },
        async decreaseCondition(slug) { this.log.push(`-${slug}`); if (this.cond[slug] > 1) this.cond[slug]--; else delete this.cond[slug]; },
        async increaseCondition(slug) { this.log.push(`+${slug}`); this.cond[slug] = (this.cond[slug] ?? 0) + 1; },
        get itemTypes() { return { condition: Object.keys(this.cond).map(slug => this.items[slug] ??= mkCondition(this, slug)) }; },
        items: {}, saves: { fortitude: { roll: async opts => { window.__saveAsked = opts; return { degreeOfSuccess: window.__degree }; } } } };
      registry[a.uuid] = a;
      return a;
    };
    const mkCondition = (owner, slug) => ({ type: "condition", slug, actor: owner, flags: {}, system: { description: { value: "<p>Rules text.</p>" } }, get value() { return owner.cond[slug]; },
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async update(d) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); } });
    const amiri = actor("amiri", "Amiri", 1, { frightened: 2 });
    const ogre = actor("ogre", "Ogre", 3);
    const wiz = actor("wiz", "Ezren", 5);
    game.actors = Object.assign([amiri, ogre, wiz], { get(id) { return this.find(a => a.id === id); } });
    // --- chat ---
    window.__chat = [];
    window.ChatMessage = { create: async d => { __chat.push(d); return d; }, getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    const post = (id, pf2e, extra = {}) => { const m = { id, author: { id: extra.author ?? "u1" }, timestamp: Date.now(), rolls: [{}], flags: { pf2e }, getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } }; game.messages.push(m); return m; };
    // --- encounter ---
    const combat = { combatants: { get: id => ({ amiri: { actor: amiri, token: null }, ogre: { actor: ogre, token: null } })[id] } };
    const turn = (from, to) => Hooks.callAll("combatTurnChange", combat, from, to);
    const settle = () => new Promise(res => setTimeout(res, 30));
    const out = {};

    // 1. Frightened: down by 1 at the end of the creature's own turn; not when the GM steps back.
    turn({ round: 1, turn: 0, combatantId: "amiri" }, { round: 1, turn: 1, combatantId: "ogre" }); await settle();
    out.frightened = [amiri.cond.frightened];
    turn({ round: 1, turn: 1, combatantId: "ogre" }, { round: 1, turn: 0, combatantId: "amiri" }); await settle();   // back: nothing ends
    turn({ round: 1, turn: 1, combatantId: "ogre" }, { round: 2, turn: 0, combatantId: "amiri" }); await settle();   // the ogre's turn ends: not Amiri's
    out.frightened.push(amiri.cond.frightened);
    turn({ round: 2, turn: 0, combatantId: "amiri" }, { round: 2, turn: 1, combatantId: "ogre" }); await settle();
    out.frightened.push(amiri.cond.frightened ?? 0);

    // 2. Sickened: the DC comes from what just happened in chat.
    const sicken = async who => { who.cond.sickened = 2; delete who.items.sickened; const c = who.itemTypes.condition.find(x => x.slug === "sickened"); Hooks.callAll("createItem", c); await settle(); return [c.flags[M]?.retch, c.system.description.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()]; };
    post("save1", { context: { type: "saving-throw", actor: "ogre", dc: { value: 21 } } });
    out.fromSave = await sicken(ogre);
    game.messages.length = 0;
    registry["Actor.wiz.Item.spell"] = { type: "spell", actor: wiz, spellcasting: { statistic: { dc: { value: 23 } } } };
    post("card1", { origin: { uuid: "Actor.wiz.Item.spell" } });
    delete ogre.cond.sickened; out.fromSpell = (await sicken(ogre))[0];
    game.messages.length = 0;
    registry["Actor.wiz.Item.feat"] = { type: "action", actor: wiz };
    post("card2", { origin: { uuid: "Actor.wiz.Item.feat" } });
    delete ogre.cond.sickened; out.fromLevel = (await sicken(ogre))[0];
    game.messages.length = 0;
    delete ogre.cond.sickened; out.fromNothing = (await sicken(ogre))[0];
    out.levelDCs = [mod.levelDC(-1), mod.levelDC(0), mod.levelDC(1), mod.levelDC(5), mod.levelDC(20), mod.levelDC(25)];
    // Start of the sickened creature's turn: the line and its button.
    (ogre.items.sickened.flags[M] ??= {}).retch = { dc: 21 };
    turn({ round: 2, turn: 0, combatantId: "amiri" }, { round: 2, turn: 1, combatantId: "ogre" }); await settle();
    const card = __chat.at(-1);
    out.reminder = [card.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), card.speaker.alias, card.whisper ?? "public"];
    const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", card, host);
    window.__degree = 2; host.querySelector("[data-lucd20-retch]").click(); await settle(); await settle();
    out.retchSuccess = [__saveAsked.dc.value, ogre.cond.sickened];
    window.__degree = 1; host.querySelector("[data-lucd20-retch]").click(); await settle(); await settle();
    out.retchFail = ogre.cond.sickened;
    ogre.cond.sickened = 3; window.__degree = 3; host.querySelector("[data-lucd20-retch]").click(); await settle(); await settle();
    out.retchCritical = ogre.cond.sickened;

    // 3. Shove: the squares of the owner's diagram.
    const rel = (shover, critical) => mod.shoveOffsets({ x: shover[0] + 0.5, y: shover[1] + 0.5 }, { x: 0.5, y: 0.5 }, critical).map(o => `${o.dx},${o.dy}:${o.steps}`).sort();
    out.shoveStraight = rel([0, 1], false);
    out.shoveStraightCrit = rel([0, 1], true).filter(s => s.endsWith(":2"));
    out.shoveDiagonal = rel([1, 1], false);
    out.shoveDiagonalCrit = rel([1, 1], true).filter(s => s.endsWith(":2"));
    // On the map: a wall and a bystander take squares away; the pick is checked and done by the GM's side.
    const tok = (id, col, row) => { const t = { id, name: id, x: col * 100, y: row * 100, width: 1, height: 1, hidden: false, parent: null, actor: { amiri, ogre }[id], async update(d) { Object.assign(this, d); window.__moved = [id, d.x / 100, d.y / 100]; } }; registry[`Scene.s.Token.${id}`] = t; return t; };
    const scene = { id: "s", grid: { size: 100 }, tokens: [] };
    const tAmiri = tok("amiri", 5, 6), tOgre = tok("ogre", 5, 5), tBy = tok("bystander", 4, 4);
    for (const t of [tAmiri, tOgre, tBy]) { t.parent = scene; scene.tokens.push(t); }
    Object.assign(canvas, { ready: true, scene, grid: { size: 100 }, dimensions: { sceneRect: { x: 0, y: 0, width: 2000, height: 2000 } }, interface: new PIXI.Container(), stage: null, app: { view: document.body } });
    CONFIG.Canvas.polygonBackends = { move: { testCollision: (a, b) => b.x > 600 } }; // a wall east of column 5
    const shove = post("shove1", { context: { type: "skill-check", options: ["action:shove", "attack"], outcome: "criticalSuccess", actor: "amiri", origin: { actor: "Actor.amiri", token: "Scene.s.Token.amiri" }, target: { actor: "Actor.ogre", token: "Scene.s.Token.ogre" } } });
    out.offered = mod._test.shoveSquares(shove).map(s => `${s.x / 100},${s.y / 100}${s.steps === 2 ? "*" : ""}`).sort();
    Hooks.callAll("createChatMessage", shove); await settle();
    out.bar = document.querySelector(".lucd20-pick-bar")?.textContent;
    out.highlights = canvas.interface.children[0]?.children.length;
    const click = (col, row, button = 0) => window.dispatchEvent(new MouseEvent("pointerdown", { clientX: col * 100 + 50, clientY: row * 100 + 50, button, bubbles: true }));
    click(9, 9); await settle();                    // not a highlighted square: still choosing
    out.stillChoosing = !!document.querySelector(".lucd20-pick-bar");
    click(5, 3); await settle(); await settle();   // two squares straight away
    out.moved = [window.__moved, !!document.querySelector(".lucd20-pick-bar"), canvas.interface.children.length, shove.flags[M]?.shoved];
    out.twice = await CONFIG.queries[`${M}.gm`]({ type: "pf2eRules.shove", payload: { messageId: "shove1", x: 500, y: 400 }, senderId: "u1" }).then(() => "moved again", e => e.message);
    const fail = post("shove2", { context: { type: "skill-check", options: ["action:shove"], outcome: "failure", origin: { token: "Scene.s.Token.amiri" }, target: { token: "Scene.s.Token.ogre" } } });
    Hooks.callAll("createChatMessage", fail); await settle();
    out.failure = !!document.querySelector(".lucd20-pick-bar");
    tOgre.x = 500; tOgre.y = 500;
    const cheat = post("shove3", { context: { type: "skill-check", options: ["action:shove"], outcome: "success", origin: { token: "Scene.s.Token.amiri" }, target: { token: "Scene.s.Token.ogre" } } });
    out.cheat = await CONFIG.queries[`${M}.gm`]({ type: "pf2eRules.shove", payload: { messageId: "shove3", x: 500, y: 300 }, senderId: "u1" }).then(() => "moved", e => e.message); // 10 ft on a plain success
    Hooks.callAll("createChatMessage", cheat); await settle();
    window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await settle();
    out.cancelled = [!!document.querySelector(".lucd20-pick-bar"), cheat.flags[M]?.shoved ?? false];

    // 4. Trip.
    const rolls = [];
    CONFIG.Dice = { rolls: [class DamageRoll { constructor(f) { this.formula = f; } async evaluate() { return this; } async toMessage(d) { rolls.push([this.formula, d.flavor.replace(/<[^>]+>/g, ""), d.speaker.alias]); } }] };
    const trip = async outcome => { amiri.log.length = 0; ogre.log.length = 0; delete amiri.cond.prone; delete ogre.cond.prone; rolls.length = 0;
      Hooks.callAll("createChatMessage", post(`trip-${outcome}`, { context: { type: "skill-check", options: ["action:trip"], outcome, actor: "amiri", origin: { token: "Scene.s.Token.amiri" }, target: { token: "Scene.s.Token.ogre" } } })); await settle();
      return [amiri.log.join(), ogre.log.join(), rolls.map(x => x.join(" | ")).join()]; };
    out.trip = { success: await trip("success"), criticalSuccess: await trip("criticalSuccess"), failure: await trip("failure"), criticalFailure: await trip("criticalFailure") };
    ogre.cond.prone = 1; ogre.log.length = 0;
    Hooks.callAll("createChatMessage", post("trip-again", { context: { type: "skill-check", options: ["action:trip"], outcome: "success", origin: { token: "Scene.s.Token.amiri" }, target: { token: "Scene.s.Token.ogre" } } })); await settle();
    out.alreadyProne = ogre.log.join();

    // Off without a reload.
    for (const f of ["pf2eFrightened", "pf2eSickened", "pf2eShove", "pf2eTrip"]) await game.settings.set(M, `${f}_enabled`, false);
    amiri.cond.frightened = 2; delete ogre.cond.prone; ogre.log.length = 0; __chat.length = 0;
    turn({ round: 3, turn: 0, combatantId: "amiri" }, { round: 3, turn: 1, combatantId: "ogre" });
    Hooks.callAll("createChatMessage", post("trip-off", { context: { type: "skill-check", options: ["action:trip"], outcome: "success", origin: { token: "Scene.s.Token.amiri" }, target: { token: "Scene.s.Token.ogre" } } })); await settle();
    out.off = [amiri.cond.frightened, ogre.log.join(), __chat.length];
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.frightened, [1, 1, 0], "1. Frightened: −1 at the end of the creature's own turn only");
  assert.deepStrictEqual(r.fromSave, [{ dc: 21, source: "save" }, "Rules text. Retch: Fortitude DC 21 (the DC of the save)"], "2. the DC of the save the creature just rolled, noted on the condition");
  assert.deepStrictEqual([r.fromSpell, r.fromLevel, r.fromNothing], [{ dc: 23, source: "spell" }, { dc: 20, source: "level" }, { dc: 18, source: "own" }], "2. spell DC, else level-based DC of the source, else of the creature");
  assert.deepStrictEqual(r.levelDCs, [13, 14, 15, 20, 40, 50]);
  assert.deepStrictEqual(r.reminder, ["Sickened 2 : roll Fortitude DC 21 to retch. Fortitude DC 21", "Ogre", "public"], "2. start of turn: the line, for everyone");
  assert.deepStrictEqual([r.retchSuccess, r.retchFail, r.retchCritical], [[21, 1], 1, 1], "2. success −1, failure nothing, critical success −2");
  assert.deepStrictEqual(r.shoveStraight, ["-1,-1:1", "0,-1:1", "1,-1:1"], "3. straight: the three squares beyond the target");
  assert.deepStrictEqual(r.shoveStraightCrit, ["-1,-2:2", "-2,-1:2", "0,-2:2", "1,-2:2", "2,-1:2"], "3. straight, critical: the row beyond plus the ends of the green row");
  assert.deepStrictEqual(r.shoveDiagonal, ["-1,-1:1", "-1,0:1", "0,-1:1"], "3. diagonal: the far corner");
  assert.deepStrictEqual(r.shoveDiagonalCrit, ["-1,-2:2", "-2,-1:2", "-2,0:2", "0,-2:2"], "3. diagonal, critical: two above and two to the side, not the corner");
  assert.deepStrictEqual(r.offered, ["3,4*", "4,3*", "5,3*", "5,4"].sort(), "3. on the map: no square behind the wall (column 6 and 7) or under the bystander (4,4)");
  assert.deepStrictEqual([r.bar, r.highlights, r.stillChoosing], ["Shove: click a green or blue square to push ogre. Right-click to cancel.", 4, true]);
  assert.deepStrictEqual(r.moved, [["ogre", 5, 3], false, 0, true], "3. the click moves the target; the highlights go");
  assert.deepStrictEqual([r.twice, r.failure, r.cheat, r.cancelled], ["That Shove was already resolved.", false, "That Shove can no longer be resolved.", [false, false]], "3. once per Shove; nothing on a failure; a square that was not offered is refused; right-click cancels");
  assert.deepStrictEqual(r.trip, { success: ["", "+prone", ""], criticalSuccess: ["", "+prone", "1d6[bludgeoning] | Trip (critical success): damage to Ogre | Amiri"], failure: ["", "", ""], criticalFailure: ["+prone", "", ""] }, "4. Trip by degree of success");
  assert.strictEqual(r.alreadyProne, "", "4. a creature that is already Prone is left as it is");
  assert.deepStrictEqual(r.off, [2, "", 0], "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 37 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
