const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const MOD = "/modules/lucd20-automations/scripts";

/** Phase 63: Token Reactions — a hit is detected, sent, shown only to who sees the token, animated, and put back. */

/** A small canvas as Foundry's: primary group (sorted by elevation → layer → sort), interface, tokens with actors. */
async function setup(page) {
  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 900, height: 500, background: 0x4a4f45, antialias: true });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const grid = new PIXI.Graphics().lineStyle(1, 0x3c4038, 1);
    for (let x = 0; x <= 900; x += 100) grid.moveTo(x, 0).lineTo(x, 500);
    for (let y = 0; y <= 500; y += 100) grid.moveTo(0, y).lineTo(900, y);
    app.stage.addChild(grid);
    class Primary extends PIXI.Container {
      constructor() { super(); this.sortableChildren = true; }
      sortChildren() {
        this.children.forEach((c, i) => { c._i = i; });
        this.children.sort((a, b) => ((a.elevation || 0) - (b.elevation || 0)) || ((a.sortLayer || 0) - (b.sortLayer || 0)) || ((a.sort || 0) - (b.sort || 0)) || (a.zIndex - b.zIndex) || (a._i - b._i));
        this.sortDirty = false;
      }
    }
    const primary = app.stage.addChild(new Primary());
    const interfaceLayer = app.stage.addChild(new PIXI.Container());
    const art = { valeros: await PIXI.Assets.load("icons/valeros.webp"), goblin: await PIXI.Assets.load("icons/goblin.webp"), ezren: await PIXI.Assets.load("icons/ezren.webp") };
    const placeables = [], docs = new Map();
    game.actors = [];
    const mk = (id, x, y, { size = 1, texture = art.goblin, hp = 100, visible = true, hidden = false, displayBars = 0, owner = false } = {}) => {
      const w = size * 100;
      const actor = { uuid: `Actor.${id}`, name: id, system: { attributes: { hp: { value: hp, max: hp, temp: 0 } } }, isToken: false,
        testUserPermission: () => owner, getActiveTokens: () => [doc] };
      const doc = { id, uuid: `Scene.s1.Token.${id}`, x, y, width: size, height: size, elevation: 0, hidden, sort: 0, displayBars, actor, actorLink: true, parent: { id: "s1" } };
      const t = { id, x, y, w, h: w, visible, renderable: true, document: doc, actor };
      const mesh = new PIXI.Sprite(texture);
      mesh.anchor.set(0.5); mesh.width = w; mesh.height = w; mesh.position.set(x + w / 2, y + w / 2);
      mesh.elevation = 0; mesh.sortLayer = 700; mesh.sort = 0;
      t.mesh = primary.addChild(mesh);
      for (const part of ["bars", "effects", "nameplate", "tooltip"]) t[part] = interfaceLayer.addChild(new PIXI.Container());
      t.bars.addChild(new PIXI.Graphics().beginFill(0x2ecc71).drawRect(x + 5, y + w - 12, w - 10, 8).endFill());
      placeables.push(t); docs.set(doc.uuid, doc); game.actors.push(actor);
      return t;
    };
    mk("valeros", 100, 200, { texture: art.valeros, owner: true });
    mk("ogre", 400, 150, { size: 2 });
    mk("ezren", 700, 100, { texture: art.ezren });
    mk("unseen", 700, 300, { visible: false });
    mk("hiddenGoblin", 100, 400, { hidden: true });
    Object.assign(canvas, { ready: true, app, primary, interface: interfaceLayer, stage: app.stage, scene: { id: "s1" },
      dimensions: { size: 100, distance: 5, sceneRect: { x: 0, y: 0, width: 900, height: 500 } },
      tokens: { placeables, controlled: [], get: id => placeables.find(t => t.id === id) } });
    window.fromUuidSync = uuid => docs.get(uuid) ?? null;
    window.__emits = []; game.socket.emit = (name, data) => window.__emits.push(data);
    window.__payloads = []; Hooks.on("lucd20.tokenReaction", p => window.__payloads.push(p));
    window.__tok = id => placeables.find(t => t.id === id);
    window.__sleep = ms => new Promise(r => setTimeout(r, ms));
    /** What is on the canvas besides the tokens' own meshes. */
    window.__ours = () => { const meshes = new Set(placeables.map(t => t.mesh)); return primary.children.filter(c => !meshes.has(c)); };
    /** An actor's HP goes down, as the system would do it. */
    window.__damage = (id, amount) => { const a = __tok(id).actor, hp = a.system.attributes.hp; hp.value = Math.max(0, hp.value - amount); Hooks.callAll("updateActor", a, {}, {}, "u1"); };
    window.__heal = id => { const a = __tok(id).actor, hp = a.system.attributes.hp; hp.value = hp.max; Hooks.callAll("updateActor", a, {}, {}, "u1"); };
    /** A PF2e damage roll message. */
    window.__pf2eDamage = ({ from, target, instances, outcome = "success", kinds = ["damage"] }) => ({
      id: "m" + Math.random(), speaker: { token: from ?? null, scene: "s1" },
      flags: { pf2e: { context: { type: "damage-roll", outcome, target: target ? { token: `Scene.s1.Token.${target}`, actor: `Actor.${target}` } : null } } },
      rolls: [{ total: instances.reduce((s, i) => s + i.total, 0), instances, kinds: new Set(kinds) }] });
    Hooks.callAll("canvasReady");
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?${query}`);
    await page.waitForFunction(() => window.__done);
    await setup(page);
    return page;
  };
  const page = await open("gm=1&system=pf2e");
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", `tokenReactions_${k}`, v), [k, v]);

  /* ---- the pure parts: what is a hit, when to react, which look, what the systems' rolls say ---- */
  const pure = await page.evaluate(async (MOD) => {
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const pf2e = await import(`${MOD}/systems/pf2e/token-reactions.js`);
    const dnd4e = await import(`${MOD}/systems/dnd4e/token-reactions.mjs`);
    const hp = (value, max = 100, temp = 0) => ({ value, max, temp });
    const opts = { onCrit: true, onKill: true, onBigHit: true, threshold: 25 };
    return {
      hit: tr.hitFrom(hp(100), hp(70)),
      tempAbsorbs: tr.hitFrom(hp(50, 100, 10), hp(45, 100, 0)),
      heal: tr.hitFrom(hp(40), hp(60)),
      drained: tr.hitFrom(hp(100, 100), hp(90, 90)),
      kill: tr.hitFrom(hp(8), hp(0)),
      alreadyDown: tr.hitFrom(hp(0, 100, 5), hp(0, 100, 0)).kill,
      wanted: [
        tr.wanted({ share: 0.3 }, opts), tr.wanted({ share: 0.25 }, opts), tr.wanted({ share: 0.2 }, opts),
        tr.wanted({ share: 0.05, crit: true }, opts), tr.wanted({ share: 0.05, kill: true }, opts),
        tr.wanted({ share: 0.05, crit: true }, { ...opts, onCrit: false }), tr.wanted({ share: 0.05, kill: true }, { ...opts, onKill: false }),
        tr.wanted({ share: 0.9 }, { ...opts, onBigHit: false }), tr.wanted({ share: 0.4 }, { ...opts, threshold: 50 })
      ],
      looks: ["fire", "Slashing", "bleed", "poison", "spirit", "void", "untyped", "lightning", "necrotic", "psychic", "radiant", "thunder", "physical", "something-new", null].map(t => tr.lookOf(t).look),
      pf2e: pf2e.fromMessage(__pf2eDamage({ from: "valeros", target: "ogre", outcome: "criticalSuccess", instances: [{ type: "slashing", total: 14 }, { type: "fire", total: 20 }] })),
      pf2eArea: pf2e.fromMessage(__pf2eDamage({ from: "ezren", instances: [{ type: "electricity", total: 30 }] })),
      pf2eHealing: pf2e.fromMessage(__pf2eDamage({ from: "ezren", instances: [{ type: "vitality", total: 9 }], kinds: ["healing"] })),
      pf2eOther: pf2e.fromMessage({ flags: { pf2e: { context: { type: "attack-roll", outcome: "criticalSuccess" } } }, rolls: [{}] }),
      dnd4e: dnd4e.fromMessage({ speaker: { token: "valeros", scene: "s1" }, flags: { "lucd20-automations": { damageTargets: ["Scene.s1.Token.ogre"] } },
        rolls: [{ total: 23, options: { hitTypeDamage: true, hitType: "crit" }, terms: [{ total: 8, flavor: "fire" }, { operator: "+" }, { total: 15, flavor: "lightning, thunder" }] }] }),
      dnd4eUntyped: dnd4e.fromMessage({ speaker: {}, rolls: [{ total: 7, options: { hitTypeDamage: true, hitType: "normal" }, terms: [{ total: 7 }] }] }),
      dnd4eOther: dnd4e.fromMessage({ rolls: [{ total: 15, options: {} }] })
    };
  }, MOD);
  assert.deepStrictEqual(pure.hit, { amount: 30, share: 0.3, kill: false });
  assert.deepStrictEqual(pure.tempAbsorbs, { amount: 15, share: 0.15, kill: false }, "temporary HP lost counts");
  assert.strictEqual(pure.heal, null, "healing is no hit");
  assert.strictEqual(pure.drained, null, "max HP going down is no hit");
  assert.deepStrictEqual(pure.kill, { amount: 8, share: 0.08, kill: true });
  assert.strictEqual(pure.alreadyDown, false, "already at 0: no second kill");
  assert.deepStrictEqual(pure.wanted, [true, true, false, true, true, false, false, false, false], "crit / kill / big-hit gates and the threshold");
  assert.deepStrictEqual(pure.looks, ["fire", "slashing", "slashing", "acid", "vitality", "void", "bludgeoning", "electricity", "void", "mental", "vitality", "sonic", "bludgeoning", "bludgeoning", "bludgeoning"]);
  assert.deepStrictEqual(pure.pf2e, { type: "fire", crit: true, attacker: "valeros", scene: "s1", targets: ["Scene.s1.Token.ogre"], actors: ["Actor.ogre"] }, "PF2e: the biggest instance's type, the critical, attacker and target");
  assert.deepStrictEqual([pure.pf2eArea.type, pure.pf2eArea.crit, pure.pf2eArea.targets], ["electricity", false, []]);
  assert.strictEqual(pure.pf2eHealing, null, "a healing roll explains no hit");
  assert.strictEqual(pure.pf2eOther, null, "only damage rolls");
  assert.deepStrictEqual(pure.dnd4e, { type: "lightning", crit: true, attacker: "valeros", scene: "s1", targets: ["Scene.s1.Token.ogre"], actors: [] }, "4e: the biggest typed part, crit damage, stored targets");
  assert.deepStrictEqual([pure.dnd4eUntyped.type, pure.dnd4eUntyped.crit], ["physical", false]);
  assert.strictEqual(pure.dnd4eOther, null);

  /* ---- detection on the GM's client → payload, for everyone ---- */
  await set("show", false); // detection only: nothing drawn yet
  const detect = await page.evaluate(async () => {
    const take = () => { const r = { payloads: __payloads.splice(0), emits: __emits.splice(0) }; return r; };
    const res = {};
    // PF2e: a critical Strike for little damage (5% of its HP) still reacts, with the roll's type and attacker.
    Hooks.callAll("createChatMessage", __pf2eDamage({ from: "valeros", target: "ogre", outcome: "criticalSuccess", instances: [{ type: "fire", total: 3 }, { type: "slashing", total: 2 }] }));
    __damage("ogre", 5);
    res.crit = take();
    // The same roll doesn't explain a second drop: a small one then is nothing.
    __damage("ogre", 5);
    res.reused = take();
    // No roll at all (the GM edits HP): a big hit with the default look, no attacker.
    __damage("ezren", 30);
    res.generic = take();
    // Below the threshold, not critical, not a kill: nothing.
    __damage("ezren", 10);
    res.small = take();
    // To 0 HP: a kill, however small.
    __heal("ezren"); __damage("ezren", 100); __heal("ezren");
    res.kill = take();
    // An area roll (aimed at nobody) explains every token it is applied to.
    Hooks.callAll("createChatMessage", __pf2eDamage({ from: "ezren", instances: [{ type: "electricity", total: 40 }] }));
    __damage("valeros", 40); __damage("ogre", 40);
    res.area = take();
    // Aimed at one token, applied to another within the minute: still that roll.
    __heal("valeros"); __heal("ogre");
    Hooks.callAll("createChatMessage", __pf2eDamage({ from: "valeros", target: "ogre", instances: [{ type: "cold", total: 30 }] }));
    __damage("ezren", 30); __heal("ezren");
    res.loose = take();
    // A token hidden from players: played here, nothing sent.
    __damage("hiddenGoblin", 50);
    res.hidden = take();
    // Healing: nothing.
    __heal("hiddenGoblin");
    res.heal = take();
    return res;
  });
  assert.deepStrictEqual(detect.crit.payloads, [{ scene: "s1", token: "ogre", type: "fire", crit: true, kill: false, share: 0.05, amount: 5, attacker: "valeros" }]);
  assert.deepStrictEqual(detect.crit.emits, [{ type: "tokenReaction", payload: detect.crit.payloads[0], senderId: "u1" }], "sent to every other client, nothing more than this");
  assert.deepStrictEqual(detect.reused.payloads, [], "a roll explains one drop per creature");
  assert.deepStrictEqual(detect.generic.payloads, [{ scene: "s1", token: "ezren", type: "default", crit: false, kill: false, share: 0.3, amount: 30, attacker: null }], "HP drop only: the default look");
  assert.deepStrictEqual(detect.small.payloads, []);
  assert.deepStrictEqual(detect.kill.payloads.map(p => [p.token, p.kill, p.share]), [["ezren", true, 1]]);
  assert.deepStrictEqual(detect.area.payloads.map(p => [p.token, p.type, p.attacker]), [["valeros", "electricity", "ezren"], ["ogre", "electricity", "ezren"]]);
  assert.deepStrictEqual(detect.loose.payloads.map(p => [p.token, p.type]), [["ezren", "cold"]]);
  assert.strictEqual(detect.hidden.payloads.length, 1, "the GM's own client plays a hidden token's reaction");
  assert.deepStrictEqual(detect.hidden.emits, [], "nothing is sent for a token hidden from players");
  assert.deepStrictEqual(detect.heal, { payloads: [], emits: [] });

  // The GM's options gate it.
  await set("onCrit", false); await set("onKill", false); await set("threshold", 50);
  const gated = await page.evaluate(() => {
    __heal("ogre"); __heal("ezren");
    Hooks.callAll("createChatMessage", __pf2eDamage({ from: "valeros", target: "ogre", outcome: "criticalSuccess", instances: [{ type: "fire", total: 40 }] }));
    __damage("ogre", 40);
    __damage("ezren", 100); __heal("ezren");
    const a = __payloads.splice(0).map(p => p.token);
    __damage("ezren", 50);
    const b = __payloads.splice(0).map(p => [p.token, p.share]);
    __heal("ogre"); __heal("ezren"); __emits.length = 0; __payloads.length = 0;
    return { a, b };
  });
  assert.deepStrictEqual(gated.a, ["ezren"], "crits off, kills off, threshold 50%: 40% is nothing; 100% is a big hit");
  assert.deepStrictEqual(gated.b, [["ezren", 0.5]]);
  await set("onCrit", true); await set("onKill", true); await set("threshold", 25);
  await set("show", true);

  /* ---- the animation: the token's own drawing steps aside, ours plays, everything is put back ---- */
  const start = await page.evaluate(async (MOD) => {
    const { show } = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const eng = await import(`${MOD}/features/token-reactions/engine.js`);
    window.__show = show; window.__eng = eng;
    window.__stage0 = { x: canvas.stage.position.x, y: canvas.stage.position.y };
    Math.seedrandom?.("x");
    const ok = show({ scene: "s1", token: "ogre", type: "fire", crit: true, kill: false, share: 0.4, amount: 40, attacker: "valeros" });
    const o = __tok("ogre"), v = __tok("valeros");
    const immediately = { ok, running: eng.isRunning(), coins: [...eng.engineState.coins.keys()], ogreMesh: o.mesh.renderable, valerosMesh: v.mesh.renderable, bars: o.bars.renderable };
    await __sleep(650);
    return { immediately, mid: {
      ogreMesh: o.mesh.renderable, bars: o.bars.renderable, effects: o.effects.renderable, name: o.nameplate.renderable,
      docXY: [o.document.x, o.document.y], meshXY: [o.mesh.position.x, o.mesh.position.y],
      parts: eng.engineState.parts.length, marks: eng.engineState.marks.length, nums: eng.engineState.nums.length,
      ours: __ours().length, coinSort: eng.engineState.coins.get("ogre")?.c.sort, z: eng.engineState.coins.get("ogre")?.S.z,
      // ground layer under every token mesh, the airborne coin and the effects over them
      order: (() => { const kids = canvas.primary.children, meshIdx = canvas.tokens.placeables.map(t => kids.indexOf(t.mesh)), set = [...eng.engineState.sets.values()][0];
        return { groundFirst: kids.indexOf(set.ground) < Math.min(...meshIdx), fxLast: kids.indexOf(set.fx) > Math.max(...meshIdx), coinOver: kids.indexOf(eng.engineState.coins.get("ogre").c) > Math.max(...meshIdx) }; })()
    } };
  }, MOD);
  await page.screenshot({ path: `${out}/p63-reaction.png` });
  assert.strictEqual(start.immediately.ok, true);
  assert.strictEqual(start.immediately.running, true);
  assert.deepStrictEqual(start.immediately.coins.sort(), ["ogre", "valeros"], "the target and the lunging attacker");
  assert.deepStrictEqual([start.immediately.ogreMesh, start.immediately.valerosMesh, start.immediately.bars], [false, false, false], "Foundry's own drawing is not rendered meanwhile");
  assert.deepStrictEqual([start.mid.ogreMesh, start.mid.bars, start.mid.effects, start.mid.name], [false, false, false, false]);
  assert.deepStrictEqual(start.mid.docXY, [400, 150], "the token never moves");
  assert.deepStrictEqual(start.mid.meshXY, [500, 250], "nor its mesh");
  assert.ok(start.mid.parts > 10 && start.mid.parts <= 601, `particles, capped: ${start.mid.parts}`);
  assert.ok(start.mid.marks >= 1, "a mark on the ground");
  assert.strictEqual(start.mid.nums, 1, "the GM sees the damage number");
  assert.ok(start.mid.z > 20 && start.mid.coinSort >= 1e6, `airborne, above the other tokens: z ${start.mid.z}, sort ${start.mid.coinSort}`);
  assert.deepStrictEqual(start.mid.order, { groundFirst: true, fxLast: true, coinOver: true });

  // Foundry refreshes the token mid-animation (showing its mesh again): it is hidden again at once.
  const refreshed = await page.evaluate(() => { const o = __tok("ogre"); o.mesh.renderable = true; Hooks.callAll("refreshToken", o, {}); return o.mesh.renderable; });
  assert.strictEqual(refreshed, false);

  await page.waitForFunction(() => !window.__eng.isRunning(), null, { timeout: 20000 });
  const after = await page.evaluate(() => ({
    meshes: canvas.tokens.placeables.map(t => t.mesh.renderable), parts: canvas.tokens.placeables.flatMap(t => [t.bars.renderable, t.effects.renderable, t.nameplate.renderable, t.tooltip.renderable]),
    ours: __ours().length, interface: canvas.interface.children.filter(c => c.zIndex === 1e6).length + (__eng.engineState.numsLayer ? 1 : 0), coins: __eng.engineState.coins.size,
    left: [__eng.engineState.parts.length, __eng.engineState.marks.length, __eng.engineState.nums.length],
    stage: [canvas.stage.position.x - __stage0.x, canvas.stage.position.y - __stage0.y], listeners: canvas.app.ticker.count
  }));
  assert.ok(after.meshes.every(Boolean) && after.parts.every(Boolean), "everything rendered again");
  assert.strictEqual(after.ours, 0, "nothing of ours left on the canvas");
  assert.strictEqual(after.interface, 0, "no number layer left");
  assert.deepStrictEqual([after.coins, ...after.left], [0, 0, 0, 0]);
  assert.deepStrictEqual(after.stage, [0, 0], "the screen shake left the stage where it was");
  const idleListeners = after.listeners;

  /* ---- every look runs to its end; a kill ends back on its square ---- */
  const all = await page.evaluate(async (MOD) => {
    const { TYPES } = await import(`${MOD}/features/token-reactions/reactions.js`);
    const types = Object.keys(TYPES);
    const targets = ["ogre", "valeros", "ezren"];
    types.forEach((type, i) => __show({ scene: "s1", token: targets[i % 3], type, crit: i % 2 === 0, kill: i % 4 === 3, share: 0.2 + 0.06 * i, amount: 10 + i, attacker: i % 3 === 0 ? "valeros" : null }));
    await __sleep(400);
    return { types, coins: __eng.engineState.coins.size, parts: __eng.engineState.parts.length };
  }, MOD);
  assert.strictEqual(all.types.length, 12);
  assert.ok(all.parts <= 601, `particles capped: ${all.parts}`);
  await page.screenshot({ path: `${out}/p63-many.png` });
  await page.waitForFunction(() => !window.__eng.isRunning(), null, { timeout: 30000 });
  const allAfter = await page.evaluate(() => ({ ok: canvas.tokens.placeables.every(t => t.mesh.renderable && t.bars.renderable), ours: __ours().length, listeners: canvas.app.ticker.count }));
  assert.deepStrictEqual(allAfter, { ok: true, ours: 0, listeners: idleListeners }, "all twelve looks ended and cleaned up; off the ticker");

  /* ---- Less motion: a flash and the ground mark, nothing thrown ---- */
  await set("lessMotion", true);
  const less = await page.evaluate(async () => {
    __show({ scene: "s1", token: "ogre", type: "bludgeoning", crit: true, kill: false, share: 0.5, amount: 50, attacker: "valeros" });
    await __sleep(200);
    const o = __tok("ogre"), coin = __eng.engineState.coins.get("ogre");
    const r = { coins: [...__eng.engineState.coins.keys()], parts: __eng.engineState.parts.length, marks: __eng.engineState.marks.length, bars: o.bars.renderable, mesh: o.mesh.renderable,
      still: [coin.S.x, coin.S.y, coin.S.z, coin.S.theta], flash: coin.S.flash > 0, shake: __eng.engineState.shk };
    await __sleep(600);
    r.endedSoon = !__eng.engineState.coins.size && o.mesh.renderable;
    return r;
  });
  assert.deepStrictEqual(less.coins, ["ogre"], "no lunge");
  assert.deepStrictEqual([less.parts, less.shake], [0, 0], "no particles, no shake");
  assert.ok(less.marks >= 1 && less.flash, "the mark and the flash stay");
  assert.deepStrictEqual(less.still, [500, 250].map(v => v / (100 / 90)).concat([0, 0]), "the art stays on its square, flat");
  assert.deepStrictEqual([less.bars, less.mesh], [true, false], "bars stay; the art is ours while it flashes");
  assert.strictEqual(less.endedSoon, true);
  await set("lessMotion", false);
  await page.evaluate(() => __eng.clearAll());

  /* ---- a token deleted, and one re-drawn, mid-animation ---- */
  const gone = await page.evaluate(async () => {
    __show({ scene: "s1", token: "ezren", type: "force", crit: false, kill: false, share: 0.5, amount: 1 });
    __show({ scene: "s1", token: "valeros", type: "sonic", crit: false, kill: false, share: 0.5, amount: 1 });
    await __sleep(250);
    const e = __tok("ezren"), v = __tok("valeros");
    // Deleted: Foundry destroys the token and its mesh.
    e.destroyed = true; e.mesh.destroy();
    // Re-drawn: a new mesh.
    const old = v.mesh, fresh = new PIXI.Sprite(old.texture);
    fresh.anchor.set(0.5); fresh.width = 100; fresh.height = 100; fresh.position.copyFrom(old.position);
    canvas.primary.addChild(fresh); old.destroy(); v.mesh = fresh;
    await __sleep(100);
    return { coins: __eng.engineState.coins.size, fresh: fresh.renderable, bars: v.bars.renderable };
  });
  assert.deepStrictEqual(gone, { coins: 0, fresh: true, bars: true }, "their reactions end; the new drawing is left alone");

  /* ---- the feature is switched off mid-animation ---- */
  const off = await page.evaluate(async () => {
    __show({ scene: "s1", token: "ogre", type: "void", crit: true, kill: true, share: 0.8, amount: 80, attacker: "valeros" });
    await __sleep(450);
    const o = __tok("ogre");
    const before = { mesh: o.mesh.renderable, running: __eng.isRunning(), ours: __ours().length > 0 };
    await game.settings.set("lucd20-automations", "tokenReactions_enabled", false);
    const { TX } = await import("/modules/lucd20-automations/scripts/features/token-reactions/textures.js");
    const after = { mesh: o.mesh.renderable, bars: o.bars.renderable, valeros: __tok("valeros").mesh.renderable, running: __eng.isRunning(), ours: __ours().length,
      interface: canvas.interface.children.filter(c => c.zIndex === 1e6).length + (__eng.engineState.numsLayer ? 1 : 0), textures: Object.keys(TX).length, listeners: canvas.app.ticker.count,
      stage: [canvas.stage.position.x - __stage0.x, canvas.stage.position.y - __stage0.y] };
    // Off: hits are no longer detected or shown.
    __payloads.length = 0;
    __damage("ogre", 90);
    const shown = __show({ scene: "s1", token: "ogre", type: "fire", share: 0.5 });
    return { before, after, payloads: __payloads.length, shown };
  });
  assert.deepStrictEqual(off.before, { mesh: false, running: true, ours: true });
  assert.deepStrictEqual(off.after, { mesh: true, bars: true, valeros: true, running: false, ours: 0, interface: 0, textures: 0, listeners: idleListeners, stage: [0, 0] }, "off: everything restored at once, textures freed");
  assert.deepStrictEqual([off.payloads, off.shown], [0, false]);
  await page.evaluate(() => game.settings.set("lucd20-automations", "tokenReactions_enabled", true));

  // JB2A: nothing without the module; with it, a guessed file that isn't there is skipped quietly.
  const jb2a = await page.evaluate(async (MOD) => {
    const j = await import(`${MOD}/features/token-reactions/jb2a.js`);
    const none = [j.jb2aLibrary(), j.clipPath("fire")];
    game.modules.set("jb2a_patreon", { active: true });
    foundry.utils.getRoute = p => p;
    const path = j.clipPath("fire");
    const shown = __show({ scene: "s1", token: "ogre", type: "fire", crit: true, share: 0.3, amount: 3 });
    await __sleep(900);
    const r = { none, path, shown, missing: j._test.missing.has(path), next: j.clipPath("fire"), running: __eng.isRunning() };
    game.modules.delete("jb2a_patreon");
    __eng.clearAll();
    return r;
  }, MOD);
  assert.deepStrictEqual(jb2a.none, [null, null]);
  assert.ok(/^modules\/jb2a_patreon\/Library\/.+\.webm$/.test(jb2a.path), jb2a.path);
  assert.ok(jb2a.missing && jb2a.next !== jb2a.path && jb2a.running, "a missing clip is skipped, the next candidate is tried next time, the reaction goes on");

  /* ---- a player: only what that user sees ---- */
  const player = await open("gm=0&system=pf2e");
  const seen = await player.evaluate(async (MOD) => {
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const eng = await import(`${MOD}/features/token-reactions/engine.js`);
    const hit = (token, extra = {}) => tr.show({ scene: "s1", token, type: "slashing", crit: true, kill: false, share: 0.3, amount: 30, ...extra });
    const res = {};
    res.unseen = hit("unseen"); // out of this user's sight
    res.hidden = hit("hiddenGoblin"); // hidden by the GM (a client that somehow has it visible still refuses)
    res.otherScene = hit("ogre", { scene: "s2" });
    res.nothingDrawn = eng.engineState.coins.size === 0 && !eng.isRunning() && __ours().length === 0;
    // Seen target, unseen attacker: the reaction, no lunge.
    res.seen = hit("ogre", { attacker: "unseen" });
    res.coins = [...eng.engineState.coins.keys()];
    await __sleep(120);
    res.numberNotOwned = eng.engineState.nums.length; // the ogre's HP bar isn't shown to this player
    res.own = hit("valeros"); // their own character
    await __sleep(60);
    res.numberOwned = eng.engineState.nums.length;
    __tok("ezren").document.displayBars = 50; // bars shown to everyone
    hit("ezren");
    await __sleep(60);
    res.numberBarsAlways = eng.engineState.nums.length;
    // The token goes out of sight mid-animation: our drawing of it hides too.
    __tok("ogre").visible = false;
    await __sleep(80);
    res.hiddenMidway = eng.engineState.coins.get("ogre")?.c.visible;
    // A player's client never detects or sends.
    __damage("valeros", 90);
    res.sent = __emits.length + __payloads.length;
    // Per player: off.
    await game.settings.set("lucd20-automations", "tokenReactions_show", false);
    res.afterOff = { coins: eng.engineState.coins.size, mesh: __tok("valeros").mesh.renderable, shown: hit("valeros") };
    return res;
  }, MOD);
  assert.deepStrictEqual([seen.unseen, seen.hidden, seen.otherScene, seen.nothingDrawn], [false, false, false, true], "nothing for a token this player can't see, a hidden one, or another scene");
  assert.strictEqual(seen.seen, true);
  assert.deepStrictEqual(seen.coins, ["ogre"], "an unseen attacker doesn't lunge (it would give its position away)");
  assert.deepStrictEqual([seen.numberNotOwned, seen.numberOwned, seen.numberBarsAlways], [0, 1, 2], "damage numbers only where this player can see the HP bar");
  assert.strictEqual(seen.hiddenMidway, false);
  assert.strictEqual(seen.sent, 0);
  assert.deepStrictEqual(seen.afterOff, { coins: 0, mesh: true, shown: false }, "Show them to me off: what was playing ends, nothing new");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 63 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
