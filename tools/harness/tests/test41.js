const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 42: PF2e rule 7, Reactive Strike prompts and the warning while dragging. */
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
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    const rs = await import("/modules/lucd20-automations/scripts/systems/pf2e/reactive-strike.js");
    const out = {};
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    window.ChatMessage = { getSpeaker: ({ token }) => ({ alias: token?.name }), create: async d => { const m = { id: `m${++mid}`, author: { id: game.user.id }, flags: {}, ...d,
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { Object.assign(this, u); } }; game.messages.push(m); return m; } };
    // Actors: the ogre (Reactive Strike; a club and a javelin), Amiri (the player's fighter, Reactive Strike), a goblin (none).
    const rolled = [];
    const strike = (label, ranged, degree = 2) => ({ type: "strike", label, ready: true, item: { isMelee: !ranged, isRanged: ranged }, variants: [{ roll: async () => { rolled.push(label); return { degreeOfSuccess: degree }; } }] });
    const actor = (id, name, { rs = true, owner = null, strikes = [] } = {}) => ({ id, name, uuid: `Actor.${id}`, hasPlayerOwner: !!owner, isOwner: true,
      items: rs ? [{ type: "action", slug: "reactive-strike", name: "Reactive Strike" }] : [], system: { attributes: { hp: { value: 20, max: 20 }, reach: { base: 5 } }, actions: strikes },
      testUserPermission: u => u.id === owner, hasCondition: () => false });
    const ogreA = actor("ogre", "Ogre", { strikes: [strike("Club", false), strike("Javelin", true)] });
    const amiriA = actor("amiri", "Amiri", { owner: "p1", strikes: [strike("Greataxe", false, 3)] });
    const gobA = actor("gob", "Goblin", { rs: false, strikes: [strike("Dogslicer", false)] });
    const scene = { id: "s" };
    const combatants = [];
    const token = (id, a, col, row, disposition) => { const c = { id, actor: a, flags: {}, getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } };
      const t = { id, name: a.name, actor: a, visible: true, document: { id, uuid: `Scene.s.Token.${id}`, name: a.name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, disposition, parent: scene, combatant: c }, setTarget() { window.__target = id; } };
      t.document.object = t; c.token = t.document; registry[t.document.uuid] = t.document; combatants.push(c); return t; };
    const tOgre = token("ogre", ogreA, 5, 5, -1), tAmiri = token("amiri", amiriA, 5, 6, 1), tGob = token("gob", gobA, 8, 6, -1);
    game.combat = { id: "c1", started: true, round: 1, turn: 0, combatant: combatants[1], combatants };
    for (const c of combatants) c.combat = game.combat;
    Object.assign(canvas, { ready: true, scene, grid: { size: 100, type: 1 }, tokens: { placeables: [tOgre, tAmiri, tGob], controlled: [] }, interface: new PIXI.Container() });
    canvas.controls = canvas.interface;
    // The reaction tracker is on: everyone has their reaction.
    for (const c of combatants) c.flags[M] = { reaction: { used: 0 } };
    const cards = () => game.messages.filter(m => m.flags[M]?.reactiveStrike);
    const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // Geometry: PF2e counting; 10-ft reach takes two squares diagonally.
    const box = (x, y) => ({ x0: x, y0: y, x1: x, y1: y });
    out.geometry = [rs.feetBetween(box(0, 0), box(1, 1)), rs.feetBetween(box(0, 0), box(2, 2)), rs.withinReach(box(0, 0), box(2, 2), 10), rs.withinReach(box(0, 0), box(2, 0), 5), rs.withinReach(box(0, 0), box(3, 3), 10)];

    // Amiri walks away from the ogre: the ogre's card, to the GM only (a monster).
    rs._test.onMoveToken(tAmiri.document, { origin: { x: 500, y: 600 }, passed: { waypoints: [{ x: 500, y: 700, action: "walk" }, { x: 500, y: 800, action: "walk" }] } }, {}); await settle();
    const c1 = cards().at(-1);
    out.moveCard = [cards().length, c1.whisper, txt(c1.content), [...c1.content.matchAll(/data-lucd20-rs="([^"]+)"/g)].map(m => m[1])];
    // Again within 15 s: no second card. Forced movement and teleports: none. Starting out of reach: none.
    rs._test.onMoveToken(tAmiri.document, { origin: { x: 500, y: 600 }, passed: { waypoints: [{ x: 500, y: 800, action: "walk" }] } }, {}); await settle();
    rs._test.recent.clear();
    rs._test.onMoveToken(tAmiri.document, { origin: { x: 500, y: 600 }, passed: { waypoints: [{ x: 500, y: 800, action: "walk" }] } }, { [M]: { forced: true } });
    rs._test.onMoveToken(tAmiri.document, { origin: { x: 500, y: 600 }, passed: { waypoints: [{ x: 500, y: 900, action: "blink" }] } }, {});
    rs._test.onMoveToken(tAmiri.document, { origin: { x: 100, y: 100 }, passed: { waypoints: [{ x: 100, y: 300, action: "walk" }] } }, {}); await settle();
    out.noCards = cards().length;

    // The ogre throws its javelin while next to Amiri: Amiri's card, to her player and the GM.
    const msg = (a, t, extra) => ({ actor: a, token: t.document, flags: {}, ...extra });
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Javelin", isRanged: true }, flags: { pf2e: { context: { type: "attack-roll", options: ["item:ranged"] } } } })); await settle();
    const c2 = cards().at(-1);
    out.ranged = [cards().length, c2.whisper, txt(c2.content)];
    // A manipulate action (casting a spell) and a move action (Stand); Step and Stride don't count here.
    rs._test.recent.clear();
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Fear", slug: "fear", system: { traits: { value: ["concentrate", "manipulate"] } } } })); await settle();
    out.manipulate = txt(cards().at(-1).content);
    rs._test.recent.clear();
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Stand", slug: "stand", system: { traits: { value: ["move"] } } } })); await settle();
    out.moveAction = txt(cards().at(-1).content);
    const before = cards().length;
    rs._test.recent.clear();
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Step", slug: "step", system: { traits: { value: ["move"] } } } }));
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Stride", slug: "stride", system: { traits: { value: ["move"] } } } })); await settle();
    // A creature without Reactive Strike (the goblin) or out of reach gets nothing; nor one whose reaction is spent.
    combatants[1].flags[M].reaction.used = 1;
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Javelin", isRanged: true }, flags: { pf2e: { context: { type: "attack-roll", options: ["item:ranged"] } } } })); await settle();
    out.none = cards().length - before;
    combatants[1].flags[M].reaction.used = 0;

    // Amiri answers the manipulate card with her greataxe: targets the ogre, rolls (no MAP); a critical hit disrupts.
    const card = game.messages.find(m => m.flags[M]?.reactiveStrike?.kind === "manipulate");
    const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", card, host);
    host.querySelector('[data-lucd20-rs="0"]').click(); await settle(80);
    const note = game.messages.filter(m => (m.content ?? "").includes("fa-ban")).at(-1);
    out.answer = [window.__target, rolled.at(-1), card.flags[M].reactiveStrike.done, txt(card.content).includes("Answered."), txt(note?.content ?? ""), note?.whisper];

    // The warning while dragging: any enemy whose reach the path leaves (the goblin too), for everyone.
    await rs._test.onPath(tAmiri, { result: [{ x: 500, y: 600 }, { x: 600, y: 600 }, { x: 700, y: 600 }, { x: 700, y: 700 }] });
    out.warning = canvas.interface.children.filter(c => c.children?.length).map(c => c.children.length / 2)[0] ?? 0;
    window.dispatchEvent(new Event("pointerup"));
    out.cleared = canvas.interface.children.filter(c => !c.destroyed && c.children?.length).length;
    tGob.visible = false; game.user.isGM = false;
    await rs._test.onPath(tAmiri, { result: [{ x: 500, y: 600 }, { x: 600, y: 600 }, { x: 700, y: 600 }, { x: 700, y: 700 }] });
    out.playerWarning = canvas.interface.children.filter(c => !c.destroyed && c.children?.length).map(c => c.children.length / 2)[0] ?? 0;
    game.user.isGM = true; tGob.visible = true;
    window.dispatchEvent(new Event("pointerup"));

    // Off without a reload.
    await game.settings.set(M, "pf2eReactiveStrike_enabled", false);
    rs._test.recent.clear();
    const n = cards().length;
    Hooks.callAll("createChatMessage", msg(ogreA, tOgre, { item: { name: "Javelin", isRanged: true }, flags: { pf2e: { context: { type: "attack-roll", options: ["item:ranged"] } } } })); await settle();
    out.off = cards().length - n;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.geometry, [5, 15, true, false, false], "PF2e distances; 10-ft reach takes two diagonal squares");
  assert.deepStrictEqual(r.moveCard, [1, ["u1"], "Reactive Strike: Ogre Amiri left a square within your reach. Not if it was a Step (or other movement that doesn't trigger reactions). Club Skip", ["0", "skip"]], "leaving reach: the monster's card to the GM, melee Strikes only, the Step reminder");
  assert.strictEqual(r.noCards, 1, "no repeat within 15 s; forced movement, teleport and moves out of reach don't trigger");
  assert.deepStrictEqual(r.ranged, [2, ["p1", "u1"], "Reactive Strike: Amiri Ogre made a ranged attack (Javelin) within your reach. Greataxe Skip"], "a ranged attack in reach: the PC's card to her player and the GM");
  assert.strictEqual(r.manipulate, "Reactive Strike: Amiri Ogre used a manipulate action (Fear) within your reach: a critical hit disrupts it. Greataxe Skip");
  assert.strictEqual(r.moveAction, "Reactive Strike: Amiri Ogre used a move action (Stand) within your reach. Greataxe Skip");
  assert.strictEqual(r.none, 0, "Step and Stride cards don't trigger; a spent reaction gets no card");
  assert.deepStrictEqual(r.answer, ["ogre", "Greataxe", true, true, "Ogre 's Fear is disrupted (critical Reactive Strike).", ["u1"]], "the Strike targets the trigger; the card is answered; a critical hit on a manipulate action: disrupted, to the GM");
  assert.strictEqual(r.warning, 2, "dragging: the ogre and the goblin (any enemy, reach only)");
  assert.strictEqual(r.cleared, 0, "the marks go when the drag ends");
  assert.strictEqual(r.playerWarning, 1, "a player sees only enemies they can see");
  assert.strictEqual(r.off, 0, "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 42 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
