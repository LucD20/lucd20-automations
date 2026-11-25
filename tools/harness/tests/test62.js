const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const MOD = "/modules/lucd20-automations/scripts";

/** Phase 64: Signature Spells — Chain Lightning on Dice So Nice's dice, then from token to token. */

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


/** A stand-in for Dice So Nice: its hooks in its order, a dice list, getScreenPosition, its canvas element. */
async function mockDsn(page) {
  await page.evaluate(() => {
    game.modules.set("dice-so-nice", { active: true });
    const el = document.createElement("div");
    el.id = "dice-box-canvas";
    el.style.cssText = "position:absolute;left:0;top:0;width:900px;height:500px;pointer-events:none;z-index:1000";
    document.body.append(el);
    const engine = { diceList: [], deadDiceList: [] };
    const mesh = (x, y) => ({ parent: { parent: {} }, userData: {}, __p: { x, y } });
    game.dice3d = {
      canvas: el, box: { throwEngine: engine },
      getScreenPosition: m => ({ ...m.__p }),
      // The preview's throw: resolves true when the dice have landed.
      showForRoll: async (roll, user, synchronize) => {
        window.__showForRoll = { formula: roll.formula, synchronize };
        engine.diceList = [mesh(380, 80), mesh(470, 110), mesh(560, 70)];
        await __sleep(450);
        return true;
      }
    };
    // Dice drawn on the screen so the screenshots show them.
    const dots = [];
    const drawDice = () => { dots.splice(0).forEach(d => d.remove()); for (const m of engine.diceList) { const d = document.createElement("div"); d.style.cssText = `position:absolute;left:${m.__p.x - 22}px;top:${m.__p.y - 22}px;width:44px;height:44px;border-radius:9px;background:#8a2be2;border:2px solid #fff;box-sizing:border-box`; el.append(d); dots.push(d); } };
    /** DSN's own createChatMessage handler (registered after ours, the worse order), then the throw. */
    Hooks.on("createChatMessage", message => {
      if (!message.__dsn) return;
      Hooks.callAll("diceSoNiceMessageProcessed", message.id, { willTrigger3DRoll: true });
      message._dice3danimating = true;
      Hooks.callAll("diceSoNiceRollStart", message.id, { roll: message.rolls[0], blind: false });
      const dice = [mesh(300, 60), mesh(450, 40), mesh(600, 60)];
      setTimeout(() => { engine.diceList = dice; }, 150);
      const t0 = performance.now();
      const move = setInterval(() => { const u = Math.min(1, (performance.now() - t0 - 150) / 600); dice.forEach((m, i) => { m.__p.y = 60 + u * (40 + i * 25); }); drawDice(); }, 16);
      setTimeout(() => { clearInterval(move); drawDice(); delete message._dice3danimating; Hooks.callAll("diceSoNiceRollComplete", message.id, []); window.__landedAt = performance.now(); }, message.__dsn);
    });
    window.__clearDice = () => { engine.deadDiceList = []; engine.diceList = []; drawDice(); };
  });
}

async function helpers(page) {
  await page.evaluate(async (MOD) => {
    const fxm = await import(`${MOD}/features/signature-spells/effects.js`);
    const eng = await import(`${MOD}/features/token-reactions/engine.js`);
    const sig = await import(`${MOD}/features/signature-spells/signature-spells.js`);
    window.__fx = fxm; window.__eng = eng; window.__sig = sig;
    /** Chain Lightning's damage roll: Target Helper's rows in the order targeted. */
    window.__chain = ({ targets = ["ogre", "hiddenGoblin", "valeros"], dsn = 0, secret = false, helper = true, slug = "chain-lightning", viaOptions = false } = {}) => ({
      id: "m" + Math.random().toString(36).slice(2), __dsn: dsn, visible: true, isContentVisible: !secret,
      speaker: { token: "ezren", scene: "s1" },
      author: { id: "u2", targets: new Set(helper ? [] : targets.map(id => __tok(id))) },
      item: viaOptions ? null : { slug, name: "Chain Lightning", type: "spell" },
      flags: { pf2e: { context: { type: "damage-roll", sourceType: "save", options: ["item:type:spell", "item:magical", `item:slug:${slug}`] }, origin: { type: "spell" } },
        ...(helper ? { "pf2e-toolbelt": { targetHelper: { targets: targets.map(id => `Scene.s1.Token.${id}`) } } } : {}) },
      rolls: [{ total: 52, instances: [{ type: "electricity", total: 52 }], kinds: new Set(["damage"]) }] });
    /** Watch a run: when each token's reaction starts, what is drawn where, sampled every 10 ms. */
    window.__watch = () => {
      const log = { coins: [], samples: [], t0: performance.now(), overlayZ: null, overlayEvents: null, firstScreenTarget: null, firstWorldFrom: null };
      const seenCoins = new Set();
      const timer = setInterval(() => {
        const t = Math.round(performance.now() - log.t0), S = fxm.effectsState;
        for (const id of eng.engineState.coins.keys()) if (!seenCoins.has(id)) { seenCoins.add(id); log.coins.push({ id, t, less: eng.engineState.coins.get(id).less }); }
        const el = document.getElementById("lucd20-signature-overlay");
        if (el && log.overlayZ == null) { log.overlayZ = getComputedStyle(el).zIndex; log.overlayEvents = getComputedStyle(el).pointerEvents; }
        const screen = S.bolts.filter(b => b.space === "screen"), world = S.bolts.filter(b => b.space === "world");
        const long = screen.filter(b => b.life >= 300 && !b.grow || (b.life >= 300 && b.grow && b.life !== 380));
        const strike = screen.find(b => b.life === 380);
        if (strike && !log.firstScreenTarget) log.firstScreenTarget = { a: strike.a(), b: strike.b() };
        if (world.length && !log.firstWorldFrom) { const w = world.find(b => b.life === 380); if (w) log.firstWorldFrom = w.a(); }
        log.samples.push({ t, screen: screen.length, world: world.length, glows: S.glows.length, overlay: !!el, flicker: screen.some(b => b.flicker > 0), forks: [...screen, ...world].some(b => b.forks > 0) });
      }, 10);
      log.stop = () => { clearInterval(timer); return log; };
      return log;
    };
    window.__idle = () => ({ bolts: fxm.effectsState.bolts.length, glows: fxm.effectsState.glows.length, frames: fxm.effectsState.frames.size, holds: fxm.effectsState.holds, raf: fxm.effectsState.raf,
      overlay: !!document.getElementById("lucd20-signature-overlay"), layer: !!fxm.effectsState.g, runs: sig._test.runs.size });
    /** Wait for the spell to end; `full`: also for the tokens' reactions (seconds: marks fade slowly), else end those now. */
    window.__settle = async (full = false) => {
      for (let i = 0; i < 400 && (sig._test.runs.size || fxm.effectsState.raf != null || (full && eng.isRunning())); i++) await __sleep(25);
      if (!full) eng.clearAll();
    };
    window.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { return this; } };
  }, MOD);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, { dsn = true } = {}) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?${query}`);
    await page.waitForFunction(() => window.__done);
    await setup(page);
    if (dsn) await mockDsn(page);
    await helpers(page);
    return page;
  };
  const ID = "lucd20-automations";
  const page = await open("gm=1&system=pf2e");

  /* ---- the pure parts ---- */
  const pure = await page.evaluate(async (MOD) => {
    const reg = await import(`${MOD}/features/signature-spells/registry.js`);
    const pf2e = await import(`${MOD}/systems/pf2e/signature-spells.js`);
    const dsn = await import(`${MOD}/features/signature-spells/dsn.js`);
    const { getFeature } = await import(`${MOD}/core/registry.js`);
    const { FEATURE_ORDER } = await import(`${MOD}/core/catalog.js`);
    const f = getFeature("signatureSpells");
    const info = pf2e.read(__chain());
    const at = (x, y, id) => ({ token: id, x, y });
    // A die the old way: no getScreenPosition, projected with the box's camera.
    const V = class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } clone() { return new V(this.x, this.y, this.z); } project() { this.x = this.x / 10; this.y = -this.z / 10; return this; } };
    const keep = game.dice3d.getScreenPosition; game.dice3d.getScreenPosition = undefined; game.dice3d.box.camera = {};
    const old = { parent: { parent: {}, scale: { x: 1 } }, scale: { x: 1 }, userData: {}, position: new V(), geometry: { boundingSphere: { radius: 1 } }, getWorldPosition(v) { v.x = 5; v.z = 0; return v; } };
    game.dice3d.box.throwEngine.diceList = [old, { parent: null, userData: {}, __p: { x: 1, y: 1 } }, { parent: { parent: {} }, userData: { persistent: true }, __p: { x: 1, y: 1 } }];
    const manual = dsn.dicePoints().map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.r)]);
    game.dice3d.getScreenPosition = keep; delete game.dice3d.box.camera; game.dice3d.box.throwEngine.diceList = [];
    return {
      catalog: FEATURE_ORDER.find(e => e.id === "signatureSpells"),
      def: [f.category, f.scope, f.def.defaultEnabled, f.settings.map(s => `${s.key}:${s.scope}:${s.default}`)],
      texts: [f.name, game.i18n.localize("LUCD20.Feature.signatureSpells.Setting.chainLightning.Name"), game.i18n.localize("LUCD20.Feature.signatureSpells.Setting.show.Name")],
      panel: f.def.renderPanel(f),
      info,
      viaOptions: pf2e.read(__chain({ viaOptions: true }))?.slug,
      noHelper: (({ targets, ordered }) => ({ targets, ordered }))(pf2e.read(__chain({ helper: false, targets: ["valeros", "ogre"] }))),
      notDamage: pf2e.read({ item: { slug: "chain-lightning" }, flags: { pf2e: { context: { type: "spell-attack-roll" } } } }),
      sig: reg.signatureFor(info)?.id,
      otherSpell: reg.signatureFor(pf2e.read(__chain({ slug: "fireball" }))),
      otherRoll: reg.signatureFor({ ...info, roll: "attack" }),
      nearest: __sig.nearestNext([at(900, 0, "far"), at(100, 0, "near"), at(400, 0, "mid")], { x: 0, y: 0 }),
      nearestNoStart: __sig.nearestNext([at(900, 0, "far"), at(100, 0, "near"), at(800, 0, "mid")], null),
      manual,
      timeout: await dsn.diceLanded("never", 40)
    };
  }, MOD);
  assert.deepStrictEqual(pure.catalog, { id: "signatureSpells", category: "tokens", phase: 64 });
  assert.deepStrictEqual([pure.def.slice(0, 3), pure.def[3].slice(0, 3)], [["tokens", "world", true], ["show:client:true", "chainLightning:world:true", "finisher:world:true"]], "on by default, per-player switch, one GM switch per spell (the finisher's own options follow: test63)");
  assert.deepStrictEqual(pure.texts, ["Signature Spells", "Chain Lightning", "Show them to me"]);
  assert.ok(pure.panel.includes('value="chainLightning"') && pure.panel.includes('data-feature-action="preview"'), "the preview panel lists the spell");
  assert.deepStrictEqual({ ...pure.info, options: undefined, outcome: undefined, finisher: undefined }, { options: undefined, outcome: undefined, finisher: undefined, slug: "chain-lightning", name: "Chain Lightning", roll: "damage", caster: "ezren", scene: "s1", targets: ["Scene.s1.Token.ogre", "Scene.s1.Token.hiddenGoblin", "Scene.s1.Token.valeros"], ordered: true });
  assert.strictEqual(pure.viaOptions, "chain-lightning", "the slug from the roll options when the item is gone");
  assert.deepStrictEqual(pure.noHelper, { targets: ["Scene.s1.Token.valeros", "Scene.s1.Token.ogre"], ordered: false }, "without Target Helper: the author's targets, to be ordered by distance");
  assert.strictEqual(pure.notDamage, null);
  assert.deepStrictEqual([pure.sig, pure.otherSpell, pure.otherRoll], ["chainLightning", null, null]);
  assert.deepStrictEqual(pure.nearest, ["near", "mid", "far"]);
  assert.deepStrictEqual(pure.nearestNoStart, ["far", "mid", "near"], "no caster seen: from the first, then the nearest next");
  assert.deepStrictEqual(pure.manual, [[675, 250, 45]], "a die without getScreenPosition: projected with the camera; unspawned and persistent dice left out");
  assert.strictEqual(pure.timeout, false, "dice that never land: go on without them");

  /* ---- the GM, with Dice So Nice: rolling → result → the chain ---- */
  const started = page.evaluate(async () => {
    window.__log = __watch();
    Hooks.callAll("createChatMessage", __chain({ dsn: 900 }), {}, "u2");
    await __sleep(100);
    const early = { ...__idle() };
    await __sleep(500); // dice in the air
    return { early };
  });
  const { early } = await started;
  await page.screenshot({ path: `${out}/p64-rolling.png` });
  await page.waitForFunction(() => window.__landedAt && performance.now() - window.__landedAt > 350);
  await page.screenshot({ path: `${out}/p64-result.png` });
  await page.waitForFunction(() => window.__eng.engineState.coins.size >= 2);
  await page.screenshot({ path: `${out}/p64-chain.png` });
  const gm = await page.evaluate(async () => {
    await __settle(true);
    const log = __log.stop();
    const landed = Math.round(__landedAt - log.t0);
    const before = log.samples.filter(s => s.t < landed), rolling = before.filter(s => s.t > 250);
    const result = log.samples.filter(s => s.t > landed + 60 && s.t < landed + 600);
    return { landed, coins: log.coins, overlayZ: log.overlayZ, overlayEvents: log.overlayEvents, strike: log.firstScreenTarget,
      boltsBeforeDice: before.filter(s => s.t < 140).some(s => s.screen + s.world > 0),
      rollingBolts: rolling.filter(s => s.screen > 0).length / rolling.length, rollingWorld: rolling.some(s => s.world > 0),
      resultMin: Math.min(...result.map(s => s.screen)), resultGlows: Math.max(...result.map(s => s.glows)), resultWorld: result.some(s => s.world > 0),
      chainWorld: log.samples.some(s => s.world > 0),
      after: __idle(), meshes: ["ogre", "hiddenGoblin", "valeros"].map(id => __tok(id).mesh.renderable), ours: __ours().length, dsnCanvas: !!document.getElementById("dice-box-canvas") };
  });
  assert.deepStrictEqual(early, { bolts: 0, glows: 0, frames: 1, holds: 1, raf: early.raf, overlay: false, layer: false, runs: 1 }, "armed, nothing drawn before the dice are thrown");
  assert.strictEqual(gm.boltsBeforeDice, false);
  assert.ok(gm.rollingBolts > 0.5, `lightning darts around the dice while they roll (${gm.rollingBolts})`);
  assert.strictEqual(gm.rollingWorld, false, "nothing on the canvas while the dice roll");
  assert.deepStrictEqual([gm.overlayZ, gm.overlayEvents], ["1001", "none"], "the overlay: one above Dice So Nice's canvas, takes no clicks");
  assert.ok(gm.resultMin >= 2 && gm.resultGlows >= 3, `the result: a bolt through all three dice, a glow on each (${gm.resultMin}, ${gm.resultGlows})`);
  assert.strictEqual(gm.resultWorld, false, "the chain waits for the result");
  assert.deepStrictEqual(gm.coins.map(c => c.id), ["ogre", "hiddenGoblin", "valeros"], "each target reacts in Target Helper's order (the GM sees the hidden one)");
  assert.ok(gm.coins[0].t >= gm.landed + 700 + 100 && gm.coins[0].t < gm.landed + 2000, `the first target after the result (${gm.coins[0].t - gm.landed} ms after landing)`);
  const gaps = [gm.coins[1].t - gm.coins[0].t, gm.coins[2].t - gm.coins[1].t];
  assert.ok(gaps.every(g => g >= 250 && g < 1800), `a short delay between targets (${gaps})`);
  assert.deepStrictEqual([Math.round(gm.strike.a.x), Math.round(gm.strike.a.y), Math.round(gm.strike.b.x), Math.round(gm.strike.b.y)], [600, 150, 500, 250], "from the last die on the screen to the first target's token");
  assert.strictEqual(gm.chainWorld, true, "target to target on the canvas");
  assert.deepStrictEqual(gm.after, { bolts: 0, glows: 0, frames: 0, holds: 0, raf: null, overlay: false, layer: false, runs: 0 }, "afterwards: overlay and layer removed, nothing running");
  assert.deepStrictEqual([gm.meshes, gm.ours, gm.dsnCanvas], [[true, true, true], 0, true], "tokens back, Dice So Nice untouched");

  /* ---- Token Reactions doesn't play twice: the damage applied afterwards is the quiet one ---- */
  const dedupe = await page.evaluate(async (MOD) => {
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const res = { claims: [...tr._test.claims.keys()].sort() };
    __payloads.length = 0;
    __damage("ogre", 40);
    res.payload = __payloads.map(p => [p.token, p.type]);
    res.ogre = { less: __eng.engineState.coins.get("ogre")?.less, phases: __eng.engineState.coins.get("ogre")?.q?.length, nums: __eng.engineState.nums.length };
    res.claimsLeft = [...tr._test.claims.keys()].sort();
    await __settle();
    // The claim is used up: the next electricity hit plays in full.
    Hooks.callAll("createChatMessage", { id: "x", speaker: {}, flags: { pf2e: { context: { type: "damage-roll" } } }, rolls: [{ instances: [{ type: "electricity", total: 30 }], kinds: new Set(["damage"]) }] });
    __damage("ogre", 30);
    res.second = __eng.engineState.coins.get("ogre")?.less;
    // A claimed token that drops to 0 HP: always in full.
    __damage("valeros", 100);
    res.kill = { less: __eng.engineState.coins.get("valeros")?.less, payload: __payloads.at(-1)?.kill };
    // Another kind of damage doesn't use the claim.
    Hooks.callAll("createChatMessage", { id: "y", speaker: {}, flags: { pf2e: { context: { type: "damage-roll" } } }, rolls: [{ instances: [{ type: "fire", total: 30 }], kinds: new Set(["damage"]) }] });
    __damage("hiddenGoblin", 30);
    res.fire = { less: __eng.engineState.coins.get("hiddenGoblin")?.less, claim: tr._test.claims.has("hiddenGoblin") };
    await __settle();
    __heal("ogre"); __heal("valeros"); __heal("hiddenGoblin"); tr._test.claims.clear(); tr._test.records.length = 0;
    return res;
  }, MOD);
  assert.deepStrictEqual(dedupe.claims, ["hiddenGoblin", "ogre", "valeros"], "the chain claims the tokens it threw");
  assert.deepStrictEqual(dedupe.payload, [["ogre", "electricity"]]);
  assert.deepStrictEqual([dedupe.ogre.less, dedupe.ogre.nums], [true, 1], "applied damage on a claimed token: flash and number, not thrown again");
  assert.deepStrictEqual(dedupe.claimsLeft, ["hiddenGoblin", "valeros"]);
  assert.strictEqual(dedupe.second, false, "one quiet reaction per claim");
  assert.deepStrictEqual(dedupe.kill, { less: false, payload: true }, "a kill always plays in full");
  assert.deepStrictEqual(dedupe.fire, { less: false, claim: true }, "another damage type is not the spell's");

  /* ---- Less motion: no darting bolts, one plain chain, a flash on each token ---- */
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_lessMotion", true), ID);
  const less = await page.evaluate(async () => {
    __clearDice();
    const log = __watch();
    Hooks.callAll("createChatMessage", __chain({ dsn: 500, targets: ["ogre", "valeros"] }), {}, "u2");
    await __sleep(450);
    const rolling = log.samples.some(s => s.screen + s.world > 0);
    await __sleep(100); await __settle();
    log.stop();
    return { rolling, result: log.samples.some(s => s.screen >= 2), flicker: log.samples.some(s => s.flicker), forks: log.samples.some(s => s.forks), coins: log.coins.map(c => [c.id, c.less]), after: __idle() };
  });
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_lessMotion", false), ID);
  assert.deepStrictEqual([less.rolling, less.result, less.flicker, less.forks], [false, true, false, false], "Less motion: nothing while rolling, a still chain through the dice, no forks");
  assert.deepStrictEqual(less.coins, [["ogre", true], ["valeros", true]], "Less motion: the tokens only flash");
  assert.strictEqual(less.after.overlay, false);

  /* ---- Token Reactions off for this user: the bolts and a small burst, no token moves ---- */
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_show", false), ID);
  const noTR = await page.evaluate(async (MOD) => {
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    __clearDice(); tr._test.claims.clear();
    const log = __watch();
    Hooks.callAll("createChatMessage", __chain({ targets: ["ogre", "valeros"] }), {}, "u2");
    await __sleep(60); await __settle();
    log.stop();
    return { coins: log.coins.length, world: Math.max(...log.samples.map(s => s.world)), overlay: log.samples.some(s => s.overlay) };
  }, MOD);
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_show", true), ID);
  assert.strictEqual(noTR.coins, 0);
  assert.ok(noTR.world >= 5, "a burst of small bolts on the token instead");
  assert.strictEqual(noTR.overlay, false, "a roll Dice So Nice doesn't animate: no dice part, no overlay");

  /* ---- switches: the spell's, mine, the feature's ---- */
  const off = await page.evaluate(async (ID) => {
    const res = {};
    const tryIt = async () => { const log = __watch(); Hooks.callAll("createChatMessage", __chain({ dsn: 200 }), {}, "u2"); await __sleep(450); log.stop(); const r = log.samples.some(s => s.screen + s.world + s.glows > 0) || log.coins.length > 0 || __sig._test.runs.size > 0; await __settle(); return r; };
    await game.settings.set(ID, "signatureSpells_chainLightning", false); res.spellOff = await tryIt(); await game.settings.set(ID, "signatureSpells_chainLightning", true);
    await game.settings.set(ID, "signatureSpells_show", false); res.showOff = await tryIt(); await game.settings.set(ID, "signatureSpells_show", true);
    // Switched off in the middle: everything ends at once.
    Hooks.callAll("createChatMessage", __chain({ dsn: 300 }), {}, "u2");
    await __sleep(250);
    res.midBefore = __idle().overlay;
    await game.settings.set(ID, "signatureSpells_enabled", false);
    res.mid = __idle();
    await __sleep(600);
    res.midLater = { ...__idle(), coins: __eng.engineState.coins.size };
    res.featureOff = await tryIt();
    await game.settings.set(ID, "signatureSpells_enabled", true);
    res.backOn = await tryIt();
    return res;
  }, ID);
  assert.deepStrictEqual([off.spellOff, off.showOff, off.featureOff, off.backOn], [false, false, false, true], "the spell's switch, my switch, the feature: nothing; back on: it plays");
  assert.strictEqual(off.midBefore, true);
  assert.deepStrictEqual(off.mid, { bolts: 0, glows: 0, frames: 0, holds: 0, raf: null, overlay: false, layer: false, runs: 0 }, "switched off mid-roll: gone at once");
  assert.deepStrictEqual(off.midLater, { ...off.mid, coins: 0 }, "and the chain never comes");

  /* ---- the GM's preview: dice for the GM, the chain for everyone, nothing about hidden tokens sent ---- */
  const preview = await page.evaluate(async (MOD) => {
    const { getFeature } = await import(`${MOD}/core/registry.js`);
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const f = getFeature("signatureSpells");
    __clearDice(); __emits.length = 0; tr._test.claims.clear();
    const warned = []; ui.notifications.warn = m => warned.push(m);
    game.user.targets = new Set(); canvas.tokens.controlled = [];
    await f.def.hubActions.preview(f, null);
    game.user.targets = new Set([__tok("ogre"), __tok("hiddenGoblin"), __tok("valeros")]); canvas.tokens.controlled = [__tok("ezren")];
    const log = __watch();
    await f.def.hubActions.preview(f, null);
    await __settle();
    log.stop();
    return { warned, emits: __emits.splice(0), roll: window.__showForRoll, coins: log.coins.map(c => c.id), screen: log.samples.some(s => s.screen >= 2), claims: tr._test.claims.size, after: __idle() };
  }, MOD);
  assert.deepStrictEqual(preview.warned, ["Select or target a token first."]);
  assert.deepStrictEqual(preview.emits, [{ type: "signaturePreview", payload: { spell: "chainLightning", scene: "s1", caster: "ezren", targets: ["ogre", "valeros"] }, senderId: "u1" }], "the preview sent to the others: never a hidden token");
  assert.deepStrictEqual(preview.roll, { formula: "8d12", synchronize: false }, "the spell's dice, thrown for the GM");
  assert.deepStrictEqual([preview.coins, preview.screen, preview.claims], [["ogre", "hiddenGoblin", "valeros"], true, 0], "dice part and chain; a preview claims nothing");
  assert.strictEqual(preview.after.overlay, false);

  /* ---- a player: the hidden target is skipped; a secret roll shows nothing ---- */
  const player = await open("gm=0&system=pf2e");
  const pl = await player.evaluate(async (MOD) => {
    const res = {};
    let log = __watch();
    Hooks.callAll("createChatMessage", __chain({ dsn: 250, targets: ["ogre", "hiddenGoblin", "unseen", "valeros"] }), {}, "u2");
    await __sleep(100); await __settle();
    log.stop();
    res.coins = log.coins.map(c => c.id);
    res.gap = log.coins[1].t - log.coins[0].t;
    res.dice = log.samples.some(s => s.screen > 0);
    // A roll this player may not see (Dice So Nice may still throw ghost dice): nothing.
    __clearDice();
    log = __watch();
    Hooks.callAll("createChatMessage", __chain({ dsn: 200, secret: true }), {}, "u2");
    await __sleep(700);
    log.stop();
    res.secret = { drawn: log.samples.some(s => s.screen + s.world + s.glows > 0), coins: log.coins.length, idle: __idle() };
    // The GM's preview arrives: the chain alone, from the caster.
    const { _test } = await import(`${MOD}/core/socket.js`).catch(() => ({}));
    return res;
  }, MOD);
  assert.deepStrictEqual(pl.coins, ["ogre", "valeros"], "a player: the hidden and the unseen target are skipped, the chain jumps on");
  assert.ok(pl.gap >= 250 && pl.gap < 1500, `no pause where the hidden token would be (${pl.gap})`);
  assert.strictEqual(pl.dice, true);
  assert.deepStrictEqual(pl.secret, { drawn: false, coins: 0, idle: { bolts: 0, glows: 0, frames: 0, holds: 0, raf: null, overlay: false, layer: false, runs: 0 } }, "a secret roll: nothing on the dice, nothing on the tokens");

  /* ---- no Dice So Nice: the reduced chain, from the caster, at once ---- */
  const plain = await open("gm=0&system=pf2e", { dsn: false });
  const reduced = await plain.evaluate(async () => {
    const res = {};
    let log = __watch();
    Hooks.callAll("createChatMessage", __chain(), {}, "u2");
    await __sleep(60);
    res.from = log.firstWorldFrom ?? null;
    await __settle();
    log.stop();
    res.from ??= log.firstWorldFrom;
    res.coins = log.coins.map(c => c.id);
    res.coinTimes = log.coins.map(c => c.t);
    res.overlay = log.samples.some(s => s.overlay || s.screen > 0);
    // Without Target Helper: nearest next from the caster (ezren at 750,150: the ogre, then valeros).
    log = __watch();
    Hooks.callAll("createChatMessage", __chain({ helper: false, targets: ["valeros", "ogre"] }), {}, "u2");
    await __sleep(60); await __settle();
    log.stop();
    res.nearest = log.coins.map(c => c.id);
    // The caster out of sight: the first bolt comes from above, not from where it stands.
    __tok("ezren").visible = false;
    log = __watch();
    Hooks.callAll("createChatMessage", __chain({ targets: ["ogre"] }), {}, "u2");
    await __sleep(60); await __settle();
    log.stop();
    res.sky = log.firstWorldFrom;
    res.after = __idle();
    return res;
  });
  await plain.screenshot({ path: `${out}/p64-reduced-end.png` });
  assert.deepStrictEqual([Math.round(reduced.from.x), Math.round(reduced.from.y)], [750, 150], "no dice: the chain starts at the caster's token");
  assert.deepStrictEqual(reduced.coins, ["ogre", "valeros"], "in order, the hidden one skipped");
  assert.ok(reduced.coinTimes[0] < 1000 && reduced.coinTimes[1] - reduced.coinTimes[0] >= 250, `at once, then the chain delay (${reduced.coinTimes})`);
  assert.strictEqual(reduced.overlay, false, "no dice part: the screen overlay is never made");
  assert.deepStrictEqual(reduced.nearest, ["ogre", "valeros"], "nearest next from the caster");
  assert.ok(reduced.sky.y < 0 && Math.abs(reduced.sky.x - 500) <= 130, `an unseen caster's place is not given away (${JSON.stringify(reduced.sky)})`);
  assert.deepStrictEqual(reduced.after, { bolts: 0, glows: 0, frames: 0, holds: 0, raf: null, overlay: false, layer: false, runs: 0 });

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 64 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
