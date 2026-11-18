const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const MOD = "/modules/lucd20-automations/scripts";

/** Phase 65: the Swashbuckler finisher — a signature animation on the damage roll of a Strike made with a finisher. */

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
    const mk = (id, x, y, { size = 1, texture = art.goblin, hp = 100, visible = true, hidden = false, owner = false, name = id, img = null, seeName = true } = {}) => {
      const w = size * 100;
      const actor = { uuid: `Actor.${id}`, name, img, system: { attributes: { hp: { value: hp, max: hp, temp: 0 } } }, isToken: false, isOwner: owner || game.user.isGM,
        testUserPermission: () => owner, getActiveTokens: () => [doc] };
      const doc = { id, uuid: `Scene.s1.Token.${id}`, name, x, y, width: size, height: size, elevation: 0, hidden, sort: 0, displayBars: 0, actor, actorLink: true, parent: { id: "s1" }, playersCanSeeName: seeName };
      const t = { id, name, x, y, w, h: w, visible, renderable: true, document: doc, actor, isOwner: owner || game.user.isGM };
      const mesh = new PIXI.Sprite(texture);
      mesh.anchor.set(0.5); mesh.width = w; mesh.height = w; mesh.position.set(x + w / 2, y + w / 2);
      mesh.elevation = 0; mesh.sortLayer = 700; mesh.sort = 0;
      t.mesh = primary.addChild(mesh);
      for (const part of ["bars", "effects", "nameplate", "tooltip"]) t[part] = interfaceLayer.addChild(new PIXI.Container());
      t.bars.addChild(new PIXI.Graphics().beginFill(0x2ecc71).drawRect(x + 5, y + w - 12, w - 10, 8).endFill());
      placeables.push(t); docs.set(doc.uuid, doc); game.actors.push(actor);
      return t;
    };
    mk("valeros", 200, 300, { texture: art.valeros, owner: true, name: "Mireille, the Scarlet Blade", img: "icons/valeros.webp" });
    mk("ogre", 400, 150, { size: 2, name: "Ogre" });
    mk("ezren", 700, 100, { texture: art.ezren, name: "Ezren" });
    mk("boss", 100, 100, { name: "Grax the Secret Boss", img: "icons/boss-actor.png", seeName: false });
    mk("unseen", 700, 300, { visible: false, name: "Lurker" });
    mk("hiddenGoblin", 100, 400, { hidden: true });
    mk("video", 600, 400, { owner: true, name: "Moving Picture", img: "icons/portrait.webm" });
    Object.assign(canvas, { ready: true, app, primary, interface: interfaceLayer, stage: app.stage, scene: { id: "s1" },
      dimensions: { size: 100, distance: 5, sceneRect: { x: 0, y: 0, width: 900, height: 500 } },
      tokens: { placeables, controlled: [], get: id => placeables.find(t => t.id === id) } });
    window.fromUuidSync = uuid => docs.get(uuid) ?? null;
    window.__emits = []; game.socket.emit = (name, data) => window.__emits.push(data);
    window.__payloads = []; Hooks.on("lucd20.tokenReaction", p => window.__payloads.push(p));
    window.__tok = id => placeables.find(t => t.id === id);
    window.__sleep = ms => new Promise(r => setTimeout(r, ms));
    window.__ours = () => { const meshes = new Set(placeables.map(t => t.mesh)); return primary.children.filter(c => !meshes.has(c)); };
    window.__damage = (id, amount) => { const a = __tok(id).actor, hp = a.system.attributes.hp; hp.value = Math.max(0, hp.value - amount); Hooks.callAll("updateActor", a, {}, {}, "u1"); };
    window.__heal = id => { const a = __tok(id).actor, hp = a.system.attributes.hp; hp.value = hp.max; Hooks.callAll("updateActor", a, {}, {}, "u1"); };
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
    const dots = [];
    const drawDice = () => { dots.splice(0).forEach(d => d.remove()); for (const m of engine.diceList) { const d = document.createElement("div"); d.style.cssText = `position:absolute;left:${m.__p.x - 22}px;top:${m.__p.y - 22}px;width:44px;height:44px;border-radius:9px;background:#8f1626;border:2px solid #ffd24a;box-sizing:border-box`; el.append(d); dots.push(d); } };
    game.dice3d = {
      canvas: el, box: { throwEngine: engine },
      getScreenPosition: m => ({ ...m.__p }),
      showForRoll: async (roll, user, synchronize) => {
        window.__showForRoll = { formula: roll.formula, synchronize };
        engine.diceList = [mesh(380, 400), mesh(470, 420), mesh(560, 395)];
        drawDice();
        await __sleep(450);
        return true;
      }
    };
    Hooks.on("createChatMessage", message => {
      if (!message.__dsn) return;
      Hooks.callAll("diceSoNiceMessageProcessed", message.id, { willTrigger3DRoll: true });
      message._dice3danimating = true;
      Hooks.callAll("diceSoNiceRollStart", message.id, { roll: message.rolls[0], blind: false });
      const dice = [mesh(340, 380), mesh(450, 380), mesh(560, 380)];
      setTimeout(() => { engine.diceList = dice; }, 100);
      const t0 = performance.now();
      const move = setInterval(() => { const u = Math.min(1, (performance.now() - t0 - 100) / 400); dice.forEach((m, i) => { m.__p.y = 380 + u * (30 + (i % 2) * 25); }); drawDice(); }, 16);
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
    const tr = await import(`${MOD}/features/token-reactions/token-reactions.js`);
    const cvs = await import(`${MOD}/features/signature-spells/spells/finisher-canvas.js`);
    window.__fx = fxm; window.__eng = eng; window.__sig = sig; window.__tr = tr; window.__cvs = cvs;
    /**
     * The damage roll of a Strike. finisher: a slug (PF2e names it), null (a finisher PF2e doesn't name), false
     * (an ordinary Strike). viaAction: the finisher named by the action's slug instead.
     */
    window.__strike = ({ from = "valeros", targets = ["ogre"], finisher = "confident", viaAction = false, dsn = 0, secret = false, outcome = "success", total = 17 } = {}) => ({
      id: "m" + Math.random().toString(36).slice(2), __dsn: dsn, visible: true, isContentVisible: !secret,
      speaker: { token: from, scene: "s1" },
      author: { id: "u2", targets: new Set() },
      item: { slug: "rapier", name: "Rapier", type: "weapon" },
      flags: { pf2e: { context: { type: "damage-roll", sourceType: "attack", outcome,
        options: ["item:type:weapon", "item:slug:rapier", ...(finisher !== false ? ["finisher"] : []), ...(finisher ? [viaAction ? `origin:item:slug:${finisher}-finisher` : `finisher:${finisher}`] : [])],
        target: targets.length === 1 ? { token: `Scene.s1.Token.${targets[0]}`, actor: `Actor.${targets[0]}` } : null } },
        ...(targets.length > 1 ? { "pf2e-toolbelt": { targetHelper: { targets: targets.map(id => `Scene.s1.Token.${id}`) } } } : {}) },
      rolls: [{ total, instances: [{ type: "piercing", total }], kinds: new Set(["damage"]) }] });
    window.__chain = () => ({ id: "c" + Math.random(), visible: true, isContentVisible: true, speaker: { token: "ezren", scene: "s1" }, author: { targets: new Set() },
      item: { slug: "chain-lightning", name: "Chain Lightning", type: "spell" },
      flags: { pf2e: { context: { type: "damage-roll", options: ["item:slug:chain-lightning"] } }, "pf2e-toolbelt": { targetHelper: { targets: ["Scene.s1.Token.ogre"] } } },
      rolls: [{ total: 52, instances: [{ type: "electricity", total: 52 }], kinds: new Set(["damage"]) }] });
    /** The run's own log (what happened, ms since it began) and what was seen along the way, sampled every 10 ms. */
    window.__watch = () => {
      const w = { coins: [], t0: performance.now(), overlayZ: null, overlayEvents: null, maxPainters: 0, maxLayers: 0, frozen: false, hiddenStage: false, sigil: false };
      const seen = new Set();
      const timer = setInterval(() => {
        const t = Math.round(performance.now() - w.t0), S = fxm.effectsState;
        for (const id of eng.engineState.coins.keys()) if (!seen.has(id)) { seen.add(id); w.coins.push({ id, t, less: eng.engineState.coins.get(id).less }); }
        const el = document.getElementById("lucd20-signature-overlay");
        if (el && w.overlayZ == null) { w.overlayZ = getComputedStyle(el).zIndex; w.overlayEvents = getComputedStyle(el).pointerEvents; }
        w.maxPainters = Math.max(w.maxPainters, S.painters.length);
        w.maxLayers = Math.max(w.maxLayers, S.layers.size);
        if (eng.engineState.freezeT > 0) w.frozen = true;
        if (canvas.stage.children.some(c => c.renderable === false)) w.hiddenStage = true;
      }, 10);
      w.stop = () => { clearInterval(timer); return w; };
      return w;
    };
    window.__log = () => (sig._test.lastRun?.log ?? []).map(e => ({ ...e }));
    window.__names = () => __log().map(e => e.name);
    window.__at = name => __log().find(e => e.name === name)?.t ?? null;
    window.__idle = () => ({ painters: fxm.effectsState.painters.length, flash: fxm.effectsState.flashA, frames: fxm.effectsState.frames.size, holds: fxm.effectsState.holds, raf: fxm.effectsState.raf,
      overlay: !!document.getElementById("lucd20-signature-overlay"), layers: fxm.effectsState.layers.size, runs: sig._test.runs.size });
    /** Everything of the canvas that a run may touch, to compare before and after. */
    window.__state = () => ({ stage: [canvas.stage.position.x, canvas.stage.position.y, canvas.stage.scale.x, canvas.stage.children.length], stageRenderable: canvas.stage.children.every(c => c.renderable !== false),
      meshes: canvas.tokens.placeables.map(t => t.mesh.renderable), bars: canvas.tokens.placeables.map(t => t.bars.renderable), interface: canvas.interface.children.length, freeze: eng.engineState.freezeT > 0 });
    /** Wait for the signature to end; `full`: also for the thrown art (seconds), else end that now. */
    window.__settle = async (full = false) => {
      for (let i = 0; i < 600 && (sig._test.runs.size || fxm.effectsState.raf != null || (full && eng.isRunning())); i++) await __sleep(25);
      if (!full) eng.clearAll();
    };
    window.Roll = class { constructor(formula) { this.formula = formula; this.total = 14; } async evaluate() { return this; } };
  }, MOD);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, { dsn = true } = {}) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => (m.type() === "error" || m.type() === "warning") && !m.text().includes("Failed to load resource") && !m.text().includes("Door Icon Size") && !m.text().includes("GPU stall") && !m.text().includes("GL Driver") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?${query}`);
    await page.waitForFunction(() => window.__done);
    await setup(page);
    if (dsn) await mockDsn(page);
    await helpers(page);
    return page;
  };
  const ID = "lucd20-automations";
  const page = await open("gm=1&system=pf2e");

  /* ---- what starts it ---- */
  const pure = await page.evaluate(async (MOD) => {
    const reg = await import(`${MOD}/features/signature-spells/registry.js`);
    const pf2e = await import(`${MOD}/systems/pf2e/signature-spells.js`);
    const fin = await import(`${MOD}/features/signature-spells/spells/finisher.js`);
    const { getFeature } = await import(`${MOD}/core/registry.js`);
    const f = getFeature("signatureSpells");
    const sigOf = m => { const info = pf2e.read(m); return [reg.signatureFor(info, m)?.id ?? null, info?.finisher ?? null, fin.kindOf(info)]; };
    const both = __chain(); both.flags.pf2e.context.options.push("finisher", "finisher:confident");
    const loc = k => game.i18n.localize(k);
    const spell = __strike({ finisher: "confident" }); spell.flags.pf2e.context.options.push("item:type:spell");
    return {
      spell: sigOf(spell)[0],
      finisher: sigOf(__strike({ finisher: "unbalancing" })),
      viaAction: sigOf(__strike({ finisher: "bleeding", viaAction: true })),
      plain: sigOf(__strike({ finisher: false })),
      unnamed: sigOf(__strike({ finisher: null })),
      unknown: sigOf(__strike({ finisher: "stunning" })),
      chain: sigOf(__chain()),
      both: sigOf(both)[0],
      attack: reg.signatureFor({ ...pf2e.read(__strike()), roll: "attack" }),
      order: reg.allSignatures().map(s => s.id),
      settings: f.settings.map(s => `${s.key}:${s.scope}:${s.default}${s.dependsOn ? `<${s.dependsOn}` : ""}`),
      texts: f.settings.filter(s => s.key.startsWith("finisher")).map(s => loc(`LUCD20.Feature.signatureSpells.Setting.${s.key}.Name`)),
      missing: [...f.settings.filter(s => s.kind === "select").flatMap(s => Object.values(s.choices)), ...Object.values(reg.signatureById("finisher").previewOptions).flatMap(o => [o.label, ...Object.values(o.choices)]),
        "LUCD20.SignatureSpells.Finisher.Shout", "LUCD20.SignatureSpells.Finisher.Critical", "LUCD20.Feature.signatureSpells.Setting.finisher.Hint"].filter(k => loc(k) === k),
      panel: f.def.renderPanel(f),
      webgl: canvas.app.renderer.context?.webGLVersion
    };
  }, MOD);
  assert.deepStrictEqual(pure.finisher, ["finisher", { slug: "unbalancing" }, "unbalancing"], "the damage roll of a Strike with the finisher option starts it");
  assert.deepStrictEqual(pure.viaAction, ["finisher", { slug: "bleeding" }, "bleeding"], "the finisher named by the action's slug");
  assert.deepStrictEqual(pure.plain, [null, null, null], "the same Strike without the finisher option: nothing");
  assert.deepStrictEqual(pure.unnamed, ["finisher", { slug: null }, null], "a finisher PF2e doesn't name: the general one");
  assert.deepStrictEqual(pure.unknown, ["finisher", { slug: "stunning" }, null], "a finisher we have no look for: the general one");
  assert.deepStrictEqual(pure.chain, ["chainLightning", null, null], "Chain Lightning still starts its own");
  assert.strictEqual(pure.both, "chainLightning", "a spell with its own signature is never taken by the finisher");
  assert.strictEqual(pure.attack, null, "only the damage roll");
  assert.strictEqual(pure.spell, null, "never a spell's damage, even with the finisher option on");
  assert.deepStrictEqual(pure.order, ["chainLightning", "finisher"]);
  assert.deepStrictEqual(pure.settings, ["show:client:true", "chainLightning:world:true", "finisher:world:true", "finisherDice:world:true<finisher", "finisherStrip:world:true<finisher", "finisherMark:world:true<finisher",
    "finisherSigil:world:S<finisherMark", "finisherFrame:world:true<finisher", "finisherSlash:world:true<finisher", "finisherConfetti:world:true<finisher", "finisherConfettiKind:world:hat<finisherConfetti"],
  "every part on, the S sigil and the twirling hat by default; all GM (world) options");
  assert.deepStrictEqual(pure.texts, ["Swashbuckler finisher", "Dice flourish", "Cut-in strip", "Signature mark", "Sigil", "Impact frame", "Screen slash", "Confetti", "Confetti kind"]);
  assert.deepStrictEqual(pure.missing, [], "every text is in lang/en.json");
  assert.ok(pure.panel.includes('value="finisher"') && pure.panel.includes('data-for="finisher" data-option="kind"') && pure.panel.includes('value="lethal"') && pure.panel.includes(" hidden>"), "the preview lists the finisher, with its kind select (hidden until it is picked)");
  assert.strictEqual(pure.webgl, 2, "the harness renders with WebGL 2 (the screen slash needs it)");

  /* ---- the GM, with Dice So Nice: dice flourish → strip → lunge → sigil → impact frame + screen slash → throw ---- */
  // An ordinary Strike first: nothing of ours plays (other features add their own layers at a first damage roll).
  const before = await page.evaluate(async () => {
    Hooks.callAll("createChatMessage", __strike({ finisher: false, dsn: 150 }), {}, "u2");
    await __sleep(400);
    if (__sig._test.runs.size || __sig._test.lastRun || document.getElementById("lucd20-signature-overlay")) throw new Error("an ordinary Strike started a signature");
    __clearDice();
    return __state();
  });
  await page.evaluate(() => { window.__w = __watch(); window.__landedAt = 0; Hooks.callAll("createChatMessage", __strike({ dsn: 600 }), {}, "u2"); });
  await page.waitForFunction(() => __fx.effectsState.painters.length > 0 && !window.__landedAt);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/p65-rolling.png` });
  await page.waitForFunction(() => __at("dice") != null && performance.now() - __landedAt > 330);
  await page.screenshot({ path: `${out}/p65-dice.png` });
  await page.waitForFunction(() => __at("strip") != null && performance.now() - __sig._test.lastRun.t0 - __at("strip") > 380);
  await page.screenshot({ path: `${out}/p65-strip.png` });
  await page.waitForFunction(() => __at("mark") != null && performance.now() - __sig._test.lastRun.t0 - __at("mark") > 190);
  await page.screenshot({ path: `${out}/p65-carve.png` });
  await page.waitForFunction(() => __at("throw") != null && performance.now() - __sig._test.lastRun.t0 - __at("throw") > 300);
  await page.screenshot({ path: `${out}/p65-throw.png` });
  const gm = await page.evaluate(async () => {
    const mid = { claims: [...__tr._test.claims.entries()].map(([id, c]) => [id, c.look]) };
    await __settle(true);
    const w = __w.stop(), log = __log(), t0 = __sig._test.lastRun.t0;
    return { log, landed: Math.round(__landedAt - t0), coins: w.coins, w: { z: w.overlayZ, events: w.overlayEvents, painters: w.maxPainters, layers: w.maxLayers, frozen: w.frozen, hiddenStage: w.hiddenStage }, mid,
      after: __idle(), state: __state(), ours: __ours().length, running: __eng.isRunning(), dsnCanvas: !!document.getElementById("dice-box-canvas") };
  });
  const at = (log, name) => log.find(e => e.name === name)?.t;
  const names = gm.log.map(e => e.name);
  assert.deepStrictEqual(names, ["dice", "strip", "lunge", "mark", "frame", "slash", "hit", "confetti", "throw"].sort((a, b) => names.indexOf(a) - names.indexOf(b)), `every part plays (${names})`);
  assert.deepStrictEqual(names.filter(n => ["dice", "strip", "lunge", "mark", "hit", "throw"].includes(n)), ["dice", "strip", "lunge", "mark", "hit", "throw"], "in the mockup's order");
  const gaps = { dice: at(gm.log, "dice") - gm.landed, strip: at(gm.log, "strip") - at(gm.log, "dice"), lunge: at(gm.log, "lunge") - at(gm.log, "strip"), mark: at(gm.log, "mark") - at(gm.log, "lunge"), hit: at(gm.log, "hit") - at(gm.log, "mark"), throw: at(gm.log, "throw") - at(gm.log, "hit") };
  assert.ok(gaps.dice >= 0 && gaps.dice < 120, `the flourish when the dice have landed (${gaps.dice})`);
  assert.ok(gaps.strip >= 460 && gaps.strip < 640, `the strip 0.47 s after the dice settle (${gaps.strip})`);
  assert.ok(gaps.lunge >= 690 && gaps.lunge < 860, `the lunge 0.7 s into the strip (${gaps.lunge})`);
  assert.ok(gaps.mark >= 150 && gaps.mark < 420, `the art arrives in 0.19 s, then the blade carves (${gaps.mark})`);
  assert.ok(gaps.hit >= 215 && gaps.hit < 520, `three strokes of 0.075 s (${gaps.hit})`);
  assert.ok(gaps.throw >= 195 && gaps.throw < 700, `the freeze with the screen slash: 0.2 s, more where the renderer is slow (${gaps.throw})`);
  const stripNote = gm.log.find(e => e.name === "strip");
  assert.deepStrictEqual([stripNote.finisher, stripNote.portrait, stripNote.crit], ["confident", true, false], "the strip: the finisher, the actor's portrait");
  assert.strictEqual(gm.log.find(e => e.name === "frame").tokens, 2, "the impact frame inks the attacker and the target");
  assert.strictEqual(gm.log.find(e => e.name === "confetti").kind, "hat");
  assert.deepStrictEqual(gm.coins.map(c => c.id), ["valeros", "ogre"], "the attacker's art lunges, then the target's stands in and is thrown");
  assert.ok(gm.coins[0].t >= at(gm.log, "lunge") - 30 && gm.coins[1].t >= at(gm.log, "mark") - 30, "nothing moves on the canvas before the strip has named it");
  assert.deepStrictEqual([gm.w.z, gm.w.events], ["1001", "none"], "the overlay: one above Dice So Nice's canvas, takes no clicks");
  assert.ok(gm.w.painters >= 1 && gm.w.layers >= 2 && gm.w.frozen && gm.w.hiddenStage, `painters on the screen, the sigil's and the frame's containers, the freeze, the stage hidden under the slash (${JSON.stringify(gm.w)})`);
  assert.deepStrictEqual(gm.mid.claims, [["ogre", null]], "the thrown target is claimed, whatever the weapon's damage type");
  assert.deepStrictEqual(gm.after, { painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0 }, "afterwards: overlay and containers removed, nothing running");
  assert.deepStrictEqual(gm.state, before, "the stage where it was and fully rendered, every token's own drawing back, nothing left on the interface");
  assert.deepStrictEqual([gm.ours, gm.running, gm.dsnCanvas], [0, false, true], "nothing of ours left on the canvas, Dice So Nice untouched");

  /* ---- Token Reactions doesn't throw it again: the damage applied afterwards is the quiet one ---- */
  const dedupe = await page.evaluate(async () => {
    const res = {};
    __payloads.length = 0;
    __damage("ogre", 40);
    res.payload = __payloads.map(p => [p.token, p.type, p.attacker]);
    res.ogre = { less: __eng.engineState.coins.get("ogre")?.less, nums: __eng.engineState.nums.length, attacker: __eng.engineState.coins.has("valeros") };
    res.left = __tr._test.claims.size;
    await __settle();
    __heal("ogre"); __tr._test.claims.clear(); __tr._test.records.length = 0;
    return res;
  });
  assert.deepStrictEqual(dedupe.payload, [["ogre", "piercing", "valeros"]]);
  assert.deepStrictEqual([dedupe.ogre, dedupe.left], [{ less: true, nums: 1, attacker: false }, 0], "applied damage on the claimed target: flash and number, no second lunge or throw");

  /* ---- mid-sequence pictures: the impact frame held for the camera; a critical Lethal ---- */
  await page.evaluate(() => { __clearDice(); __cvs._test.hold = 4; Hooks.callAll("createChatMessage", __strike({ finisher: "lethal", outcome: "criticalSuccess" }), {}, "u2"); });
  await page.waitForFunction(() => __at("strip") != null && performance.now() - __sig._test.lastRun.t0 - __at("strip") > 380);
  await page.screenshot({ path: `${out}/p65-strip-crit.png` });
  await page.waitForFunction(() => __at("frame") != null && performance.now() - __sig._test.lastRun.t0 - __at("frame") > 150);
  await page.screenshot({ path: `${out}/p65-frame-inverted.png` });
  await page.waitForFunction(() => performance.now() - __sig._test.lastRun.t0 - __at("frame") > 1800);
  await page.screenshot({ path: `${out}/p65-frame.png` });
  const held = await page.evaluate(async () => {
    const res = { names: __names(), crit: __log().find(e => e.name === "strip"), noDice: __at("dice"), stageHidden: canvas.stage.children.filter(c => c.renderable === false).length, frozen: __eng.engineState.freezeT > 0,
      interfaceTop: canvas.interface.children.at(-1).children.length };
    __cvs._test.hold = null;
    await __settle();
    res.state = __state();
    return res;
  });
  assert.deepStrictEqual([held.crit.finisher, held.crit.crit, held.noDice], ["lethal", true, null], "Lethal, critical; a roll Dice So Nice doesn't animate: no dice part, straight to the strip");
  assert.ok(held.stageHidden >= 3 && held.frozen && held.interfaceTop === 4, `while the hit is held: the stage under the slash, the engine frozen, the frame on top (${JSON.stringify(held)})`);
  assert.deepStrictEqual(held.state, before, "and everything is put back afterwards");

  /* ---- Dual: two targets, in Target Helper's order ---- */
  const dual = await page.evaluate(async () => {
    __tr._test.claims.clear();
    const w = __watch();
    Hooks.callAll("createChatMessage", __strike({ finisher: "dual", targets: ["ogre", "ezren"] }), {}, "u2");
    await __sleep(100); await __settle();
    w.stop();
    const one = { names: __names(), coins: w.coins.map(c => c.id), claims: [...__tr._test.claims.keys()].sort(), frame: __log().find(e => e.name === "frame")?.tokens };
    // Any other finisher has one target, even when two are named.
    __tr._test.claims.clear();
    Hooks.callAll("createChatMessage", __strike({ finisher: "confident", targets: ["ogre", "ezren"] }), {}, "u2");
    await __sleep(100); await __settle();
    return { ...one, single: __names().filter(n => /2|1/.test(n)), singleClaims: [...__tr._test.claims.keys()] };
  });
  assert.deepStrictEqual(dual.names.filter(n => n !== "confetti"), ["strip", "lunge", "mark", "hit1", "throw1", "lunge2", "mark2", "hit", "frame", "slash", "throw"], "Dual: a quick first hit, the art spins on, the big hit on the second");
  assert.deepStrictEqual([dual.coins, dual.claims, dual.frame], [["valeros", "ogre", "ezren"], ["ezren", "ogre"], 3], "both targets thrown and claimed; all three in the impact frame");
  assert.deepStrictEqual([dual.single, dual.singleClaims], [[], ["ogre"]], "another finisher: the first target only");

  /* ---- the GM's options: parts off, another sigil, other confetti ---- */
  const opts = await page.evaluate(async (ID) => {
    const res = {}, set = (k, v) => game.settings.set(ID, `signatureSpells_${k}`, v);
    const go = async (m = {}) => { const w = __watch(); Hooks.callAll("createChatMessage", __strike(m), {}, "u2"); await __sleep(100); await __settle(); w.stop(); return { names: __names(), w, log: __log() }; };
    await set("finisherStrip", false); await set("finisherFrame", false); await set("finisherSlash", false); await set("finisherConfettiKind", "petals"); await set("finisherSigil", "X");
    let r = await go();
    res.noStrip = { names: r.names, hold: __at("throw") - __at("hit"), hidden: r.w.hiddenStage, confetti: r.log.find(e => e.name === "confetti")?.kind };
    await set("finisherStrip", true); await set("finisherFrame", true); await set("finisherSlash", true);
    await set("finisherMark", false); await set("finisherConfetti", false);
    r = await go();
    res.noMark = { names: r.names, layers: r.w.maxLayers, gap: __at("hit") - __at("mark") };
    await set("finisherMark", true); await set("finisherConfetti", true); await set("finisherConfettiKind", "hat"); await set("finisherSigil", "S");
    await set("finisher", false);
    Hooks.callAll("createChatMessage", __strike(), {}, "u2"); await __sleep(150);
    res.off = { runs: __sig._test.runs.size, idle: __idle().overlay };
    await set("finisher", true);
    // Token Reactions off for this user: nothing lunges or is thrown; the strip, the mark and the frame still play.
    await game.settings.set(ID, "tokenReactions_show", false);
    __tr._test.claims.clear();
    r = await go();
    res.noTR = { names: r.names, coins: r.w.coins.length, claims: __tr._test.claims.size, state: __state() };
    await game.settings.set(ID, "tokenReactions_show", true);
    return res;
  }, ID);
  assert.deepStrictEqual(opts.noStrip.names, ["lunge", "mark", "hit", "throw", "confetti"], "strip, impact frame and screen slash switched off");
  assert.ok(opts.noStrip.hold >= 45 && opts.noStrip.hold < 160 && !opts.noStrip.hidden, `without B and C the freeze is a blink (${opts.noStrip.hold})`);
  assert.strictEqual(opts.noStrip.confetti, "petals");
  assert.deepStrictEqual([opts.noMark.names, opts.noMark.layers], [["strip", "lunge", "mark", "hit", "frame", "slash", "throw"], 1], "no sigil (only the frame's container), no confetti");
  assert.ok(opts.noMark.gap >= 45 && opts.noMark.gap < 160, `no carving: straight to the hit (${opts.noMark.gap})`);
  assert.deepStrictEqual(opts.off, { runs: 0, idle: false }, "the finisher's own switch off: nothing");
  assert.deepStrictEqual([opts.noTR.names, opts.noTR.coins, opts.noTR.claims], [["strip", "lunge", "mark", "hit", "frame", "slash", "throw", "confetti"], 0, 0], "Token Reactions off for me: no art is moved, nothing claimed");
  assert.deepStrictEqual(opts.noTR.state, before);

  /* ---- Less motion: no B, C, F, no lunge, no throw; a short still strip, the mark, a flash ---- */
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_lessMotion", true), ID);
  await page.evaluate(() => { __clearDice(); window.__w = __watch(); window.__landedAt = 0; Hooks.callAll("createChatMessage", __strike({ finisher: "dual", targets: ["ogre", "ezren"], dsn: 300 }), {}, "u2"); });
  await page.waitForFunction(() => __at("strip") != null && performance.now() - __sig._test.lastRun.t0 - __at("strip") > 200);
  await page.screenshot({ path: `${out}/p65-less-strip.png` });
  const less = await page.evaluate(async () => {
    const rolling = __fx.effectsState.painters.length;
    await __settle(true);
    const w = __w.stop();
    return { names: __names(), coins: w.coins.map(c => [c.id, c.less]), frozen: w.frozen, hidden: w.hiddenStage, flash: w.maxFlash ?? 0, strip: __at("lunge"), gap: __at("mark") - __at("strip"), second: __at("mark2") - __at("mark"),
      claims: [...__tr._test.claims.keys()].sort(), after: __idle(), state: __state() };
  });
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_lessMotion", false), ID);
  assert.deepStrictEqual(less.names, ["dice", "strip", "mark", "hit", "mark2", "hit2"], "Less motion: dice (still), strip, the mark and the hit on each target; no lunge, frame, slash, confetti or throw");
  assert.deepStrictEqual(less.coins, [["ogre", true], ["ezren", true]], "the targets only flash; the attacker's art never moves");
  assert.deepStrictEqual([less.frozen, less.hidden], [false, false], "no freeze, the stage never hidden");
  assert.ok(less.gap >= 450 && less.gap < 620 && less.second >= 440 && less.second < 640, `the short strip (0.46 s), 0.45 s between the two marks (${less.gap}, ${less.second})`);
  assert.deepStrictEqual([less.claims, less.after.overlay, less.after.layers], [["ezren", "ogre"], false, 0]);
  assert.deepStrictEqual(less.state, before);

  /* ---- switched off in the middle: during the strip, and during the held hit ---- */
  const off = await page.evaluate(async (ID) => {
    const res = {};
    Hooks.callAll("createChatMessage", __strike(), {}, "u2");
    await __sleep(350);
    res.stripBefore = { ...__idle(), names: __names() };
    await game.settings.set(ID, "signatureSpells_enabled", false);
    res.strip = { ...__idle(), state: __state() };
    await __sleep(900);
    res.stripLater = { names: __names(), coins: __eng.engineState.coins.size, idle: __idle() };
    await game.settings.set(ID, "signatureSpells_enabled", true);
    // … and in the middle of the hit: the stage is hidden under the slash, the engine frozen, the art off its square.
    __cvs._test.hold = 2;
    Hooks.callAll("createChatMessage", __strike({ finisher: "bleeding" }), {}, "u2");
    for (let i = 0; i < 200 && __at("slash") == null; i++) await __sleep(20);
    await __sleep(120);
    res.hitBefore = { hidden: canvas.stage.children.filter(c => c.renderable === false).length, frozen: __eng.engineState.freezeT > 0, coins: __eng.engineState.coins.size, layers: __fx.effectsState.layers.size, mesh: __tok("ogre").mesh.renderable };
    await game.settings.set(ID, "signatureSpells_enabled", false);
    res.hit = { idle: __idle(), state: __state(), coins: __eng.engineState.coins.size, ours: __ours().length, running: __eng.isRunning() };
    await __sleep(400);
    res.hitLater = { names: __names(), state: __state(), coins: __eng.engineState.coins.size };
    __cvs._test.hold = null;
    await game.settings.set(ID, "signatureSpells_enabled", true);
    // A new signature while one plays: the old one ends, cleanly.
    Hooks.callAll("createChatMessage", __strike(), {}, "u2");
    await __sleep(1100);
    const first = __sig._test.lastRun;
    Hooks.callAll("createChatMessage", __strike({ finisher: "impaling" }), {}, "u2");
    await __sleep(80);
    res.again = { firstDead: first.dead, runs: __sig._test.runs.size, second: __sig._test.lastRun !== first };
    await __settle();
    res.againAfter = { names: __names(), state: __state(), idle: __idle() };
    // The canvas torn down in the middle.
    Hooks.callAll("createChatMessage", __strike(), {}, "u2");
    await __sleep(1000);
    Hooks.callAll("canvasTearDown", canvas);
    res.teardown = { idle: __idle(), state: __state(), coins: __eng.engineState.coins.size };
    return res;
  }, ID);
  assert.deepStrictEqual([off.stripBefore.overlay, off.stripBefore.painters > 0, off.stripBefore.names], [true, true, ["strip"]]);
  assert.deepStrictEqual(off.strip, { painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0, state: before }, "switched off during the strip: gone at once");
  assert.deepStrictEqual(off.stripLater, { names: [], coins: 0, idle: { painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0 } }, "and the attack never comes");
  assert.ok(off.hitBefore.hidden >= 3 && off.hitBefore.frozen && off.hitBefore.coins === 2 && off.hitBefore.layers === 2 && off.hitBefore.mesh === false, `in the middle of the hit (${JSON.stringify(off.hitBefore)})`);
  assert.deepStrictEqual(off.hit, { idle: { painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0 }, state: before, coins: 0, ours: 0, running: false }, "switched off mid-hit: stage rendered again, freeze let go, tokens back, containers and overlay removed");
  assert.deepStrictEqual(off.hitLater, { names: off.hitLater.names, state: before, coins: 0 });
  assert.ok(!off.hitLater.names.includes("throw"), "and the throw never comes");
  assert.deepStrictEqual(off.again, { firstDead: true, runs: 1, second: true }, "a new signature ends the one that plays");
  assert.deepStrictEqual([off.againAfter.names.includes("throw"), off.againAfter.state, off.againAfter.idle.layers], [true, before, 0]);
  assert.deepStrictEqual(off.teardown, { idle: { painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0 }, state: before, coins: 0 }, "canvas torn down mid-sequence: all gone");

  /* ---- the GM's preview: the selected token → the targets, 2d8+1d6, the finisher picked ---- */
  const preview = await page.evaluate(async (MOD) => {
    const { getFeature } = await import(`${MOD}/core/registry.js`);
    const f = getFeature("signatureSpells");
    __clearDice(); __emits.length = 0; __tr._test.claims.clear();
    const host = document.createElement("div");
    host.innerHTML = f.def.renderPanel(f);
    document.body.append(host);
    const [pick, kind, hit] = host.querySelectorAll("select");
    const res = { hiddenFirst: [kind.hidden, hit.hidden] };
    pick.value = "finisher"; pick.dispatchEvent(new Event("change"));
    res.shown = [kind.hidden, hit.hidden, [...kind.options].map(o => o.textContent)];
    kind.value = "unbalancing"; hit.value = "criticalSuccess";
    game.user.targets = new Set([__tok("ogre"), __tok("hiddenGoblin")]); canvas.tokens.controlled = [__tok("valeros")];
    const w = __watch();
    await f.def.hubActions.preview(f, host.querySelector("button"));
    await __settle();
    w.stop();
    host.remove();
    const strip = __log().find(e => e.name === "strip");
    return { ...res, emits: __emits.splice(0), roll: window.__showForRoll, names: __names(), strip: [strip.finisher, strip.crit, strip.who], coins: w.coins.map(c => c.id), claims: __tr._test.claims.size, after: __idle() };
  }, MOD);
  assert.deepStrictEqual(preview.hiddenFirst, [true, true], "the finisher's selects are hidden while Chain Lightning is picked");
  assert.deepStrictEqual(preview.shown, [false, false, ["Confident", "Any other finisher", "Unbalancing", "Bleeding", "Dual", "Lethal", "Impaling"]]);
  assert.deepStrictEqual(preview.emits, [{ type: "signaturePreview", payload: { spell: "finisher", scene: "s1", caster: "valeros", targets: ["ogre"], options: { kind: "unbalancing", hit: "criticalSuccess" } }, senderId: "u1" }], "sent to the others with the finisher picked; never a hidden token");
  assert.deepStrictEqual(preview.roll, { formula: "2d8+1d6", synchronize: false }, "the preview's dice");
  assert.deepStrictEqual(preview.strip, ["unbalancing", true, "Mireille, the Scarlet Blade"]);
  assert.deepStrictEqual([preview.names.slice(0, 2), preview.coins, preview.claims, preview.after.overlay], [["dice", "strip"], ["valeros", "ogre"], 0, false], "dice part, strip, the attack; a preview claims nothing");

  /* ---- names and portraits: the GM sees the NPC's name; a video portrait is skipped ---- */
  const gmNames = await page.evaluate(async () => {
    const res = {};
    Hooks.callAll("createChatMessage", __strike({ from: "boss", targets: ["ogre"], finisher: null }), {}, "u2");
    await __sleep(450);
    res.boss = __log().find(e => e.name === "strip");
    await __settle();
    Hooks.callAll("createChatMessage", __strike({ from: "video", targets: ["ogre"] }), {}, "u2");
    await __sleep(450);
    res.video = __log().find(e => e.name === "strip");
    await __settle();
    return res;
  });
  await page.close();
  assert.deepStrictEqual([gmNames.boss.finisher, gmNames.boss.who, gmNames.boss.portrait], [null, "Grax the Secret Boss", true], "the GM: the general finisher, the NPC's name and portrait");
  assert.deepStrictEqual([gmNames.video.who, gmNames.video.portrait], ["Moving Picture", true], "a video portrait: the token's art instead");

  /* ---- a player ---- */
  const player = await open("gm=0&system=pf2e");
  // An NPC whose name players can't see: the strip without a name, the general shout for an unnamed finisher.
  await player.evaluate(() => { Hooks.callAll("createChatMessage", __strike({ from: "boss", targets: ["ogre"], finisher: null }), {}, "u2"); });
  await player.waitForFunction(() => __at("strip") != null && performance.now() - __sig._test.lastRun.t0 - __at("strip") > 380);
  await player.screenshot({ path: `${out}/p65-player-hidden-name.png` });
  const pl = await player.evaluate(async (ID) => {
    const res = {}, before = __state();
    const go = async (m, wait = 100) => { const w = __watch(); Hooks.callAll("createChatMessage", __strike(m), {}, "u2"); await __sleep(wait); await __settle(); w.stop(); return { names: __names(), coins: w.coins.map(c => c.id), log: __log(), painters: w.maxPainters, layers: w.maxLayers, overlay: w.overlayZ != null }; };
    await __settle();
    res.boss = __log().find(e => e.name === "strip");
    // An NPC whose name players do see: the token's name, the token's art (not the actor's portrait).
    __tok("boss").document.playersCanSeeName = true; __tok("boss").document.name = "Bandit"; __tok("boss").actor.img = "icons/does-not-exist.png";
    res.named = (await go({ from: "boss" })).log.find(e => e.name === "strip");
    // Their own character.
    res.own = (await go({})).log.find(e => e.name === "strip");
    // An attacker this player can't see: no strip, no impact frame, nobody lunges, no hat; the rest on the target.
    let r = await go({ from: "unseen" });
    res.unseen = { names: r.names, coins: r.coins, confetti: r.log.some(e => e.name === "confetti") };
    // … hidden by the GM, the same.
    r = await go({ from: "hiddenGoblin" });
    res.hidden = { names: r.names, coins: r.coins };
    // Their own token while it is out of their sight (they know who rolled): the strip, but nothing of it on the canvas.
    __tok("valeros").visible = false;
    r = await go({});
    res.ownUnseen = { names: r.names, coins: r.coins, frame: r.log.find(e => e.name === "frame")?.tokens };
    __tok("valeros").visible = true;
    // A target this player can't see: the strip, nothing on the canvas.
    r = await go({ targets: ["unseen"] });
    res.noTarget = { names: r.names, coins: r.coins, layers: r.layers };
    r = await go({ finisher: "dual", targets: ["hiddenGoblin", "ezren"] });
    res.dualHidden = { names: r.names, coins: r.coins };
    // A roll this player may not see: nothing at all.
    r = await go({ secret: true, dsn: 200 }, 500);
    res.secret = { ran: __sig._test.runs.size, overlay: r.overlay, painters: r.painters, coins: r.coins };
    res.after = __idle(); res.same = JSON.stringify(__state()) === JSON.stringify(before);
    return res;
  }, ID);
  assert.deepStrictEqual([pl.boss.finisher, pl.boss.who, pl.boss.portrait], [null, null, true], "a player: no name for an NPC whose name they can't see (the token's art is what they see anyway)");
  assert.deepStrictEqual([pl.named.who, pl.named.portrait], ["Bandit", true], "a name players see: the token's name; the token's art, never the actor's portrait");
  assert.deepStrictEqual([pl.own.who, pl.own.portrait], ["Mireille, the Scarlet Blade", true], "their own character: the actor's name and portrait");
  assert.deepStrictEqual(pl.unseen, { names: ["lunge", "mark", "hit", "slash", "throw"], coins: ["ogre"], confetti: false }, "an attacker out of sight: no strip, no impact frame, no lunge, no hat");
  assert.deepStrictEqual(pl.hidden, { names: ["lunge", "mark", "hit", "slash", "throw"], coins: ["ogre"] }, "a hidden attacker: the same");
  assert.deepStrictEqual(pl.ownUnseen, { names: ["strip", "lunge", "mark", "hit", "frame", "slash", "throw"], coins: ["ogre"], frame: 1 }, "their own token out of sight: the strip; only the target in the frame");
  assert.deepStrictEqual(pl.noTarget, { names: ["strip"], coins: [], layers: 0 }, "an unseen target: nothing on the canvas");
  assert.deepStrictEqual(pl.dualHidden, { names: ["strip", "lunge", "mark", "hit", "frame", "slash", "throw", "confetti"], coins: ["valeros", "ezren"] }, "Dual with a hidden first target: the one they see");
  assert.deepStrictEqual(pl.secret, { ran: 0, overlay: false, painters: 0, coins: [] }, "a secret roll: nothing on the dice, the screen or the tokens");
  assert.deepStrictEqual([pl.after, pl.same], [{ painters: 0, flash: 0, frames: 0, holds: 0, raf: null, overlay: false, layers: 0, runs: 0 }, true]);

  // The GM's preview arrives at a player: the picked finisher, no dice.
  const got = await player.evaluate(async (MOD) => {
    __tr._test.claims.clear();
    __sig._test.onPreview({ spell: "finisher", scene: "s1", caster: "valeros", targets: ["ogre"], options: { kind: "impaling", hit: "success" } });
    await __sleep(200);
    const ran = __sig._test.runs.size;
    await __settle();
    return { ran, strip: __log().find(e => e.name === "strip")?.finisher ?? null, claims: __tr._test.claims.size };
  }, MOD);
  assert.deepStrictEqual([got.ran, got.strip, got.claims], [1, "impaling", 0], "the preview at a player: the finisher picked, nothing claimed");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 65 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
