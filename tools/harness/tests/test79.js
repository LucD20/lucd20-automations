const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const MOD = "/modules/lucd20-automations/scripts";
const ID = "lucd20-automations";

/** v0.90.0: Signature Spells — Such a Disgrace! (who it is for, the player's pick, what everyone else gets). */

async function setup(page) {
  await page.evaluate(async (MOD) => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 900, height: 500, background: 0x4a4f45, antialias: true });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const grid = new PIXI.Graphics().lineStyle(1, 0x3c4038, 1);
    for (let x = 0; x <= 900; x += 100) grid.moveTo(x, 0).lineTo(x, 500);
    for (let y = 0; y <= 500; y += 100) grid.moveTo(0, y).lineTo(900, y);
    app.stage.addChild(grid);
    const primary = app.stage.addChild(new PIXI.Container());
    const interfaceLayer = app.stage.addChild(new PIXI.Container());
    const art = { valeros: await PIXI.Assets.load("icons/valeros.webp"), goblin: await PIXI.Assets.load("icons/goblin.webp"), ezren: await PIXI.Assets.load("icons/ezren.webp") };
    const placeables = [], docs = new Map();
    const mk = (id, x, y, { texture = art.goblin, visible = true, hidden = false, disposition = 1, playersCanSeeName = true } = {}) => {
      const actor = { uuid: `Actor.${id}`, name: id, system: { attributes: { hp: { value: 50, max: 50, temp: 0 } } }, testUserPermission: () => false, getActiveTokens: () => [doc] };
      const doc = { id, name: id, uuid: `Scene.s1.Token.${id}`, x, y, width: 1, height: 1, elevation: 0, hidden, sort: 0, disposition, playersCanSeeName, actor, parent: { id: "s1" } };
      const t = { id, name: id, x, y, w: 100, h: 100, visible, renderable: true, document: doc, actor };
      const mesh = new PIXI.Sprite(texture);
      mesh.anchor.set(0.5); mesh.width = 100; mesh.height = 100; mesh.position.set(x + 50, y + 50);
      t.mesh = primary.addChild(mesh);
      placeables.push(t); docs.set(doc.uuid, doc);
      return t;
    };
    mk("dandy", 100, 200, { texture: art.ezren });
    mk("valeros", 500, 200, { texture: art.valeros });
    mk("merisiel", 400, 300, { texture: art.valeros, playersCanSeeName: false });
    mk("faraway", 800, 200, { texture: art.valeros });   // 35 feet from the dandy
    mk("foe", 300, 100, { disposition: -1 });
    mk("unseen", 300, 300, { visible: false });
    Object.assign(canvas, { ready: true, app, primary, interface: interfaceLayer, stage: app.stage, scene: { id: "s1" }, grid: { size: 100 },
      dimensions: { size: 100, distance: 5, sceneRect: { x: 0, y: 0, width: 900, height: 500 } },
      tokens: { placeables, controlled: [], get: id => placeables.find(t => t.id === id) } });
    window.fromUuidSync = uuid => docs.get(uuid) ?? null;
    window.__emits = []; game.socket.emit = (name, data) => window.__emits.push(data);
    window.__tok = id => placeables.find(t => t.id === id);
    window.__sleep = ms => new Promise(r => setTimeout(r, ms));
    game.user.targets = new Set();
    game.messages = { contents: [] };
    Hooks.callAll("canvasReady");

    const fxm = await import(`${MOD}/features/signature-spells/effects.js`);
    const sig = await import(`${MOD}/features/signature-spells/signature-spells.js`);
    window.__fx = fxm; window.__sig = sig;
    /** A PF2e saving throw in the chat log. */
    window.__save = (token, { outcome = "failure", stat = "will", ago = 5000, mental = false, visible = true, reroll = false, viaOption = false } = {}) => {
      const m = { id: "s" + Math.random().toString(36).slice(2), timestamp: Date.now() - ago, visible: true, isContentVisible: visible, speaker: { token, scene: "s1" },
        flags: { pf2e: { context: { type: "saving-throw", outcome, isReroll: reroll, domains: viaOption ? ["saving-throw"] : [stat, "saving-throw"],
          options: [...(viaOption ? [`check:statistic:${stat}`] : []), ...(mental ? ["item:trait:mental"] : [])] } } } };
      game.messages.contents.push(m);
      return m;
    };
    /** The feat's card, posted by `author`. */
    window.__card = ({ author = "u1", slug = "such-a-disgrace", name = "Such a Disgrace!", whisper = [], context = null } = {}) => {
      const m = { id: "c" + Math.random().toString(36).slice(2), timestamp: Date.now(), visible: true, isContentVisible: true, speaker: { token: "dandy", scene: "s1" },
        author: { id: author }, whisper, item: { slug, name, type: "feat" }, flags: { pf2e: { origin: { type: "feat" }, ...(context ? { context } : {}) } } };
      game.messages.contents.push(m);
      return m;
    };
    window.__clear = () => { game.messages.contents.length = 0; window.__emits.length = 0; window.__infos = []; game.user.targets = new Set(); };
    window.__log = () => (sig._test.lastRun?.log ?? []).map(e => ({ ...e }));
    window.__idle = () => ({ frames: fxm.effectsState.frames.size, holds: fxm.effectsState.holds, raf: fxm.effectsState.raf, painters: fxm.effectsState.painters.length,
      overlay: !!document.getElementById("lucd20-signature-overlay"), runs: sig._test.runs.size });
    window.__settle = async () => { for (let i = 0; i < 400 && (sig._test.runs.size || fxm.effectsState.raf != null); i++) await __sleep(25); };
    /** Use the feat and wait for it to end: who it played on, what was sent. */
    window.__use = async (card) => {
      const before = sig._test.lastRun;
      window.__emits.length = 0;
      Hooks.callAll("createChatMessage", card, {}, card.author.id);
      await __sleep(80);
      const run = sig._test.lastRun !== before ? sig._test.lastRun : null;
      const res = { played: run ? __log().find(e => e.name === "disgrace") ?? null : null, sent: window.__emits.filter(e => e.type === "signatureUse").map(e => e.payload) };
      for (const r of [...sig._test.runs]) r.dead = true;   // the animation itself is watched once, below
      fxm.clearEffects();
      await __settle();
      return res;
    };
  }, MOD);
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

  const page = await open("system=pf2e");

  /* ---- who it could be for ---- */
  const who = await page.evaluate(async (MOD) => {
    const pf2e = await import(`${MOD}/systems/pf2e/signature-spells.js`);
    const reg = await import(`${MOD}/features/signature-spells/registry.js`);
    const { getFeature } = await import(`${MOD}/core/registry.js`);
    const ids = card => (pf2e.read(card).candidates ?? []).map(u => u.split(".").pop());
    const res = {};
    const f = getFeature("signatureSpells");
    res.setting = f.settings.find(s => s.key === "suchADisgrace")?.default;
    res.texts = [game.i18n.localize("LUCD20.Feature.signatureSpells.Setting.suchADisgrace.Name"), game.i18n.localize("LUCD20.SignatureSpells.SuchADisgrace.Shout")];
    __clear(); __save("valeros");
    const card = __card();
    const info = pf2e.read(card);
    res.info = [info.slug, info.roll, info.caster, info.scene, info.finisher];
    res.sig = reg.signatureFor(info, card)?.id;
    res.one = ids(card);
    __clear(); __save("valeros", { outcome: "success" }); __save("merisiel", { stat: "fortitude" }); __save("foe"); __save("faraway"); __save("dandy");
    res.none = ids(__card());
    __clear(); __save("valeros", { viaOption: true, outcome: "criticalFailure" }); __save("merisiel", { visible: false });
    res.option = ids(__card());
    __clear(); __save("valeros", { ago: 60000 }); __save("valeros", { ago: 4000, reroll: true, outcome: "success" }); __save("merisiel", { ago: 10 * 60000 });
    res.answered = ids(__card());
    __clear(); __save("valeros", { ago: 9000 }); __save("merisiel", { ago: 3000 });
    res.two = ids(__card());
    __clear(); __save("valeros"); __save("merisiel", { mental: true });
    res.mental = ids(__card());
    __clear(); __save("valeros");
    res.byName = ids(__card({ slug: null }));
    res.selfEffect = ids(__card({ context: { type: "self-effect" } }));
    res.other = pf2e.read(__card({ slug: "tut-tut", name: "Tut-Tut" })).candidates ?? null;
    res.otherSig = reg.signatureFor(pf2e.read(__card({ slug: "tut-tut", name: "Tut-Tut" })), {})?.id ?? null;
    return res;
  }, MOD);
  assert.strictEqual(who.setting, true, "its GM switch, on");
  assert.deepStrictEqual(who.texts, ["Such a Disgrace!", "Such a disgrace!"]);
  assert.deepStrictEqual(who.info, ["such-a-disgrace", "card", "dandy", "s1", null], "the feat's card is read");
  assert.strictEqual(who.sig, "suchADisgrace");
  assert.deepStrictEqual(who.one, ["valeros"], "the ally whose Will save failed");
  assert.deepStrictEqual(who.none, [], "not a success, another save, an enemy, an ally beyond 30 feet, the dandy");
  assert.deepStrictEqual(who.option, ["valeros"], "Will by the roll option; a save this user can't see is left out");
  assert.deepStrictEqual(who.answered, [], "a rerolled save has been answered; an old one doesn't count");
  assert.deepStrictEqual(who.two, ["merisiel", "valeros"], "two: the latest first");
  assert.deepStrictEqual(who.mental, ["merisiel"], "known to be mental: only that one");
  assert.deepStrictEqual([who.byName, who.selfEffect], [["valeros"], ["valeros"]], "a card without a slug goes by its name; a self-effect's card counts");
  assert.deepStrictEqual([who.other, who.otherSig], [null, null], "another feat's card starts nothing");

  /* ---- using it ---- */
  const use = await page.evaluate(async () => {
    const res = {};
    __clear(); __save("valeros");
    res.one = await __use(__card());
    res.notMine = await __use(__card({ author: "u2" }));
    // Two allies: the player picks.
    __clear(); __save("valeros", { ago: 9000 }); __save("merisiel", { ago: 3000 });
    window.__dialogMode = "ally1";
    res.picked = await __use(__card());
    res.dialog = window.__dialogContent;
    window.__dialogMode = undefined; window.__dialogPrep = null;
    const wait = foundry.applications.api.DialogV2.wait;
    foundry.applications.api.DialogV2.wait = async opts => { window.__buttons = opts.buttons.map(b => b.label); return null; };
    res.closed = await __use(__card());
    res.buttons = window.__buttons;
    foundry.applications.api.DialogV2.wait = wait; window.__dialogMode = "lock";
    // Nobody's save in chat: the token this user targets; none: a note.
    __clear(); game.user.targets = new Set([__tok("merisiel")]);
    res.target = await __use(__card());
    __clear();
    res.nobody = await __use(__card());
    res.note = (window.__infos ?? []).length;
    // An ally this user can't see is never offered or played.
    __clear(); __save("unseen");
    __tok("unseen").document.disposition = 1;
    res.unseen = await __use(__card());
    // Whispered: said with the message.
    __clear(); __save("valeros");
    res.whisper = await __use(__card({ whisper: ["u1", "gm"] }));
    return res;
  });
  assert.deepStrictEqual(use.one.played && [use.one.played.ally, use.one.played.dandy], ["valeros", "dandy"], "one candidate: it plays on that ally");
  assert.deepStrictEqual(use.one.sent, [{ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["valeros"] }], "and everyone else is told");
  assert.deepStrictEqual(use.notMine, { played: null, sent: [] }, "another user's card: their client says on whom");
  assert.strictEqual(use.picked.played?.ally, "valeros", "two candidates: the one picked in the window");
  assert.ok(/Who is the disgrace/.test(use.dialog), "the window asks");
  assert.deepStrictEqual(use.buttons, ["merisiel", "valeros"], "a button per ally (their own party's names)");
  assert.deepStrictEqual(use.closed, { played: null, sent: [] }, "the window closed: nothing plays, nothing is sent");
  assert.strictEqual(use.target.played?.ally, "merisiel", "no failed save found: the token this user targets");
  assert.deepStrictEqual([use.nobody, use.note], [{ played: null, sent: [] }, 1], "nobody: a note, nothing else");
  assert.deepStrictEqual(use.unseen, { played: null, sent: [] }, "an ally out of this user's sight");
  assert.deepStrictEqual(use.whisper.sent[0].to, ["u1", "gm"], "a whispered card: only for those");

  /* ---- what the others get, and the animation ---- */
  const others = await page.evaluate(async (ID) => {
    const res = {}, t = __sig._test, last = () => t.lastRun;
    const tell = async payload => { const before = last(); t.onUse(payload); t.onUse(payload); await __sleep(60); const ran = last() !== before && __log().some(e => e.name === "disgrace"); for (const r of [...t.runs]) r.dead = true; __fx.clearEffects(); await __settle(); return ran; };
    res.told = await tell({ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["valeros"] });
    res.notForMe = await tell({ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["valeros"], to: ["gm"] });
    res.otherScene = await tell({ spell: "suchADisgrace", scene: "s2", caster: "dandy", targets: ["valeros"] });
    res.unseen = await tell({ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["unseen"] });
    await game.settings.set(ID, "signatureSpells_suchADisgrace", false);
    res.switchedOff = await tell({ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["valeros"] });
    __clear(); __save("valeros");
    res.offUse = await __use(__card());
    await game.settings.set(ID, "signatureSpells_suchADisgrace", true);
    // "Show them to me" off for the one who uses it: the others still get it.
    await game.settings.set(ID, "signatureSpells_show", false);
    res.hiddenForMe = await __use(__card());
    await game.settings.set(ID, "signatureSpells_show", true);
    return res;
  }, ID);
  assert.deepStrictEqual([others.told, others.notForMe, others.otherScene, others.unseen, others.switchedOff], [true, false, false, false, false], "told by the socket; not a whisper to others, another scene, an unseen ally, the GM's switch off");
  assert.deepStrictEqual(others.offUse, { played: null, sent: [] }, "switched off by the GM: nothing");
  assert.deepStrictEqual([others.hiddenForMe.played, others.hiddenForMe.sent.length], [null, 1], "off for me only: sent, not played here");

  /* ---- started by other code (a rules automation that knows who failed the save) ---- */
  const api = await page.evaluate(async () => {
    const res = {}, t = __sig._test;
    const call = async (...args) => { __emits.length = 0; const before = t.lastRun; const ok = __sig.useSignature(...args); await __sleep(60);
      const again = __sig.useSignature(...args), runs = t.runs.size;
      const out = { ok, again, runs, played: t.lastRun !== before ? __log().find(e => e.name === "disgrace")?.ally ?? null : null, sent: __emits.filter(e => e.type === "signatureUse").map(e => e.payload) };
      for (const r of [...t.runs]) r.dead = true; __fx.clearEffects(); await __settle(); return out; };
    res.docs = await call("suchADisgrace", { caster: __tok("dandy").document, targets: ["Scene.s1.Token.valeros"] });
    res.whisper = await call("suchADisgrace", { caster: "dandy", targets: ["valeros"], to: ["gm"] });
    res.nobody = await call("suchADisgrace", { caster: "dandy", targets: ["nope"] });
    res.unknown = await call("nope", { targets: ["valeros"] });
    return res;
  });
  assert.deepStrictEqual([api.docs.ok, api.docs.played, api.docs.sent], [true, "valeros", [{ spell: "suchADisgrace", scene: "s1", caster: "dandy", targets: ["valeros"] }]], "useSignature: by document or uuid, played here and sent");
  assert.deepStrictEqual([api.docs.again, api.docs.runs, api.docs.sent.length], [false, 1, 1], "the same one twice while it plays: once");
  assert.deepStrictEqual([api.whisper.ok, api.whisper.played, api.whisper.sent[0].to], [true, null, ["gm"]], "only for some users: not played for the others");
  assert.deepStrictEqual([api.nobody.ok, api.unknown.ok, api.nobody.sent.length], [false, false, 0], "no token, or no such signature: nothing");

  // The whole thing once, with pictures.
  await page.evaluate(() => { __clear(); __save("valeros"); Hooks.callAll("createChatMessage", __card(), {}, "u1"); });
  const sinceStart = ms => page.waitForFunction(ms => __sig._test.lastRun && performance.now() - __sig._test.lastRun.t0 > ms, ms);
  const pixel = (x, y) => page.evaluate(([x, y]) => { const el = document.getElementById("lucd20-signature-overlay"); return el ? [...el.getContext("2d").getImageData(x, y, 1, 1).data] : null; }, [x, y]);
  await sinceStart(1340);
  await page.screenshot({ path: `${out}/p79-wag.png` });
  const mid = { corner: await pixel(20, 480), ally: await pixel(550, 250), overlay: await page.evaluate(() => getComputedStyle(document.getElementById("lucd20-signature-overlay")).pointerEvents) };
  await sinceStart(2420);
  await page.screenshot({ path: `${out}/p79-shape-up.png` });
  const end = await page.evaluate(async () => { await __settle(); return { log: __log().map(e => [e.name, e.t]), idle: __idle() }; });
  assert.ok(mid.corner[3] > 150 && mid.corner[0] < 30, `the window is dark away from the ally (${mid.corner})`);
  assert.ok(mid.ally[3] < 120, `and lit on the ally (${mid.ally})`);
  assert.strictEqual(mid.overlay, "none", "the overlay takes no clicks");
  const at = name => end.log.find(e => e[0] === name)?.[1];
  assert.ok(at("shapeUp") >= 2150 && at("shapeUp") < 2600, `the ally pulls themselves together at 2.2 s (${at("shapeUp")})`);
  assert.deepStrictEqual(end.idle, { frames: 0, holds: 0, raf: null, painters: 0, overlay: false, runs: 0 }, "nothing is left");

  // Less motion: short, no dark.
  await page.evaluate(ID => game.settings.set(ID, "tokenReactions_lessMotion", true), ID);
  await page.evaluate(() => { __clear(); __save("valeros"); Hooks.callAll("createChatMessage", __card(), {}, "u1"); });
  await sinceStart(700);
  await page.screenshot({ path: `${out}/p79-less.png` });
  const lessMid = await pixel(20, 480);
  const less = await page.evaluate(async () => { const t0 = __sig._test.lastRun.t0; await __settle(); return { took: performance.now() - t0, less: __log().find(e => e.name === "disgrace")?.less, idle: __idle() }; });
  assert.ok(lessMid[3] === 0, `Less motion: the window is not darkened (${lessMid})`);
  assert.ok(less.less === true && less.took < 2300, `Less motion: short (${Math.round(less.took)})`);
  assert.strictEqual(less.idle.overlay, false);

  // The GM's preview list has it.
  const gm = await open("gm=1&system=pf2e");
  const panel = await gm.evaluate(async (MOD) => { const { getFeature } = await import(`${MOD}/core/registry.js`); const f = getFeature("signatureSpells"); return f.def.renderPanel(f); }, MOD);
  assert.ok(/<option value="suchADisgrace">Such a Disgrace!<\/option>/.test(panel), "in the GM's preview list");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 79 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
