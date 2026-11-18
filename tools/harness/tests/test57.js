const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 59: Shortcuts (F is for Flatfooted + Token Elevator): keys, who they act on, the HUD wheel, copying old keys. */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (system) => {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=${system}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };

  // ---------- PF2e ----------
  const pf2e = await (await open("pf2e")).evaluate(async () => {
    const M = "lucd20-automations";
    const sc = await import("/modules/lucd20-automations/scripts/features/shortcuts.js");
    const out = {};
    const warns = []; ui.notifications.warn = m => warns.push(m);
    const kb = (id) => window.__keybindings[`${M}.sc-${id}`];
    out.defaults = { up: kb("elevationUp")?.editable, upLarge: kb("elevationUpLarge")?.editable, reset: kb("elevationReset")?.editable, offGuard: kb("pf2e-offGuard")?.editable, visibility: kb("visibility")?.restricted };

    // The system's conditions and actions exist at `setup`.
    CONFIG.PF2E.conditionTypes = { frightened: "Frightened", blinded: "Blinded", "off-guard": "Off-Guard", friendly: "Friendly" };
    const used = [];
    class Actions extends Map {}
    const actions = new Actions();
    actions.trip = ({ actors }) => used.push(["legacy-trip", actors[0].name]);
    actions.set("trip", { name: "Trip", use: ({ actors }) => used.push(["trip", actors[0].name]), variants: { size: 0 } });
    const variants = new Map([["stabilize", { slug: "stabilize", name: "Stabilize", use: ({ actors }) => used.push(["stabilize", actors[0].name]) }],
      ["stop-bleeding", { slug: "stop-bleeding", name: "Stop Bleeding", use: ({ actors }) => used.push(["stop-bleeding", actors[0].name]) }]]);
    variants.size; // Map
    actions.administerFirstAid = () => used.push(["legacy-afa"]);
    actions.set("administer-first-aid", { name: "Administer First Aid", variants });
    actions.seek = ({ actors }) => used.push(["legacy-seek", actors[0].name]);
    game.pf2e = { actions, system: { sluggify: s => s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() } };
    Hooks.callAll("setup");
    out.registered = Object.keys(window.__keybindings).filter(k => k.startsWith(`${M}.sc-pf2e`)).map(k => k.slice(M.length + 4)).sort();

    // A scene, tokens, the hovered one.
    const updates = [];
    const conditions = [];
    const actor = (name, owner = true) => ({ name, isOwner: owner, toggleCondition: s => conditions.push([name, "toggle", s]), increaseCondition: s => conditions.push([name, "+", s]), decreaseCondition: s => conditions.push([name, "-", s]) });
    const token = (id, name, elevation, owner = true) => ({ id, name, visible: true, actor: actor(name, owner), document: { id, elevation, isOwner: owner, playersCanSeeName: true } });
    const amiri = token("a", "Amiri", 0), ezren = token("e", "Ezren", 10), ogre = token("o", "Ogre", 0, false);
    canvas.ready = true;
    canvas.scene = { grid: { distance: 5 }, updateEmbeddedDocuments: async (type, u) => { updates.push(...u); for (const x of u) [amiri, ezren, ogre].find(t => t.id === x._id).document.elevation = x.elevation; } };
    canvas.tokens = { hover: null, controlled: [], placeables: [amiri, ezren, ogre] };
    canvas.hud = { token: { rendered: false } };
    const press = (id) => kb(id).onDown({});
    const settle = () => new Promise(r => setTimeout(r, 20));

    canvas.tokens.hover = amiri;
    out.upHover = press("elevationUp"); await settle();
    out.afterUp = amiri.document.elevation;
    press("elevationUpLarge"); await settle();
    out.afterLarge = amiri.document.elevation;
    press("elevationDown"); press("elevationDown"); press("elevationDown"); press("elevationDown"); await settle();
    out.belowZero = amiri.document.elevation;
    canvas.tokens.hover = ogre;
    const before = updates.length;
    press("elevationUp"); await settle();
    out.unownedHover = { updated: updates.length - before, warn: warns.at(-1) };
    canvas.tokens.hover = null; canvas.tokens.controlled = [amiri, ezren];
    press("elevationUp"); await settle();
    out.selected = [amiri.document.elevation, ezren.document.elevation];
    press("elevationReset"); await settle();
    out.reset = [amiri.document.elevation, ezren.document.elevation];

    // Off-Guard on the hovered token; conditions; the original still on → ours stand down.
    canvas.tokens.controlled = []; canvas.tokens.hover = ezren;
    press("pf2e-offGuard"); press("pf2e-c-frightened-up"); press("pf2e-c-blinded"); await settle();
    out.conditions = conditions.splice(0);
    game.modules.set("pf2e-f-is-for-flatfooted", { active: true, title: "F is for Flatfooted" });
    out.standDown = press("pf2e-offGuard"); await settle();
    out.standDownCalls = conditions.splice(0).length;
    game.modules.delete("pf2e-f-is-for-flatfooted");

    // Actions: by the one selected token (the hovered one is ignored).
    canvas.tokens.controlled = [amiri];
    press("pf2e-a-trip"); press("pf2e-a-administer-first-aid-stop-bleeding"); press("pf2e-a-seek"); await settle();
    canvas.tokens.controlled = [amiri, ezren];
    press("pf2e-a-trip"); await settle();
    out.actions = used.splice(0);
    out.twoSelected = warns.at(-1);

    // The feature off: keys do nothing.
    await game.settings.set(M, "shortcuts_enabled", false);
    out.offReturn = press("elevationUp");
    await game.settings.set(M, "shortcuts_enabled", true);

    // The HUD's elevation box: the wheel raises the HUD's token.
    canvas.tokens.controlled = []; canvas.tokens.hover = null;
    document.body.insertAdjacentHTML("beforeend", `<div id="token-hud"><div class="attribute elevation"><input type="text" name="elevation" value="0"></div></div>`);
    canvas.hud.token = { rendered: true, object: amiri, render: () => {} };
    const input = document.querySelector("#token-hud [name='elevation']");
    input.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    input.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
    out.wheel = amiri.document.elevation;

    // Copying the old modules' keys: the stored ones, and Token Elevator's defaults while it is on.
    game.settings.register("core", "keybindings", { scope: "client", type: Object, default: {} });
    await game.settings.set("core", "keybindings", {
      "pf2e-f-is-for-flatfooted.frightened-increase": [{ key: "KeyF", modifiers: ["Shift"] }],
      "pf2e-f-is-for-flatfooted.flatfooted": [{ key: "KeyO", modifiers: [] }],
      [`${M}.sc-pf2e-c-blinded`]: [{ key: "KeyB", modifiers: [] }],
      "pf2e-f-is-for-flatfooted.blinded": [{ key: "KeyX", modifiers: [] }]
    });
    game.modules.set("token-elevator", { active: true, title: "Token Elevator" });
    const set = [];
    game.keybindings.bindings = new Map([[`${M}.sc-pf2e-offGuard`, [{ key: "KeyO", modifiers: [] }]]]);
    game.keybindings.set = async (ns, action, b) => set.push([action, b.map(x => [...x.modifiers, x.key].join("+")).join(",")]);
    out.copied = await sc.copyOriginalKeys();
    out.copiedKeys = set.sort();
    out.copiedInfo = window.__infos?.at(-1);
    game.modules.delete("token-elevator");
    out.errors = warns.filter(w => /failed/i.test(w));
    return out;
  });
  console.log(JSON.stringify(pf2e));

  assert.deepStrictEqual(pf2e.defaults.up, [{ key: "PageUp", modifiers: [] }]);
  assert.deepStrictEqual(pf2e.defaults.upLarge, [{ key: "PageUp", modifiers: ["Shift"] }]);
  assert.deepStrictEqual(pf2e.defaults.reset, []);
  assert.deepStrictEqual(pf2e.defaults.offGuard, [{ key: "KeyO", modifiers: [] }]);
  assert.strictEqual(pf2e.defaults.visibility, true, "hide / reveal is GM only");
  for (const id of ["pf2e-c-frightened", "pf2e-c-frightened-up", "pf2e-c-frightened-down", "pf2e-c-blinded", "pf2e-a-trip", "pf2e-a-seek", "pf2e-a-administer-first-aid-stabilize", "pf2e-a-administer-first-aid-stop-bleeding", "pf2e-cover", "pf2e-browser", "pf2e-alliance"])
    assert.ok(pf2e.registered.includes(id), `registered ${id}`);
  assert.ok(!pf2e.registered.includes("pf2e-c-blinded-up"), "Blinded has no value");
  assert.ok(!pf2e.registered.some(id => /friendly|c-off-guard/.test(id)), "no attitudes, no second Off-Guard");
  assert.ok(!pf2e.registered.includes("pf2e-a-administer-first-aid"), "an action with variants has one key per variant");
  assert.strictEqual(pf2e.upHover, true);
  assert.strictEqual(pf2e.afterUp, 5, "one square = 5 ft");
  assert.strictEqual(pf2e.afterLarge, 15, "Shift: two squares");
  assert.strictEqual(pf2e.belowZero, -5, "below 0 is allowed");
  assert.strictEqual(pf2e.unownedHover.updated, 0, "a hovered token you don't own stops it");
  assert.match(pf2e.unownedHover.warn, /Ogre/);
  assert.deepStrictEqual(pf2e.selected, [0, 15], "else the selected ones");
  assert.deepStrictEqual(pf2e.reset, [0, 0]);
  assert.deepStrictEqual(pf2e.conditions, [["Ezren", "toggle", "off-guard"], ["Ezren", "+", "frightened"], ["Ezren", "toggle", "blinded"]]);
  assert.strictEqual(pf2e.standDown, false, "F is for Flatfooted still on: its key answers");
  assert.strictEqual(pf2e.standDownCalls, 0);
  assert.deepStrictEqual(pf2e.actions, [["trip", "Amiri"], ["stop-bleeding", "Amiri"], ["legacy-seek", "Amiri"]], "actions by the selected token; one only");
  assert.match(pf2e.twoSelected, /only one token/);
  assert.strictEqual(pf2e.offReturn, false);
  assert.strictEqual(pf2e.wheel, 15, "wheel: +1 square, Shift +2");
  assert.deepStrictEqual(pf2e.copiedKeys, [
    ["sc-elevationDown", "Control+IntlBackslash"], ["sc-elevationDownLarge", "Control+Shift+IntlBackslash"],
    ["sc-elevationReset", "Control+Shift+Alt+IntlBackslash"], ["sc-elevationUp", "IntlBackslash"], ["sc-elevationUpLarge", "Shift+IntlBackslash"],
    ["sc-pf2e-c-frightened-up", "Shift+KeyF"]
  ], "stored keys and Token Elevator's defaults; Off-Guard already O; Blinded already changed here");
  assert.strictEqual(pf2e.copied, 6);
  assert.match(pf2e.copiedInfo, /6 keys copied/);
  assert.deepStrictEqual(pf2e.errors, []);

  // ---------- D&D 4e ----------
  const dnd = await (await open("dnd4e")).evaluate(async () => {
    const M = "lucd20-automations";
    const out = {};
    const warns = []; ui.notifications.warn = m => warns.push(m);
    CONFIG.statusEffects = [{ id: "grantingCA", name: "Grants Combat Advantage" }, { id: "prone", name: "Prone" }, { id: "dazed", name: "Dazed" }];
    Hooks.callAll("setup");
    const kb = (id) => window.__keybindings[`${M}.sc-${id}`];
    out.ca = kb("dnd4e-ca")?.editable;
    out.registered = Object.keys(window.__keybindings).filter(k => k.startsWith(`${M}.sc-`)).map(k => k.slice(M.length + 4)).sort();
    const toggled = [];
    const ogre = { id: "o", name: "Ogre", visible: true, actor: { name: "Ogre", toggleStatusEffect: id => toggled.push(id) }, document: { id: "o", isOwner: true, elevation: 0 } };
    canvas.ready = true; canvas.tokens = { hover: ogre, controlled: [], placeables: [ogre] };
    kb("dnd4e-ca").onDown({}); kb("status-prone").onDown({});
    await new Promise(r => setTimeout(r, 20));
    // Out of combat: Charge only in combat; Second Wind works.
    let sw = 0;
    canvas.tokens.hover = null; canvas.tokens.controlled = [{ ...ogre, actor: { name: "Ogre", system: { details: {} }, secondWind: async () => { sw++; } } }];
    game.combat = null;
    kb("dnd4e-basic-charge").onDown({}); kb("dnd4e-basic-secondWind").onDown({});
    await new Promise(r => setTimeout(r, 30));
    out.toggled = toggled; out.secondWind = sw; out.chargeWarn = warns.at(-1);
    return out;
  });
  console.log(JSON.stringify(dnd));
  assert.deepStrictEqual(dnd.ca, [{ key: "KeyO", modifiers: [] }]);
  for (const id of ["status-prone", "status-dazed", "dnd4e-basic-secondWind", "dnd4e-basic-actionPoint", "dnd4e-basic-charge", "dnd4e-deathSave", "elevationUp"])
    assert.ok(dnd.registered.includes(id), `4e registered ${id}`);
  assert.ok(!dnd.registered.some(id => id.startsWith("pf2e")), "no PF2e shortcuts in 4e");
  assert.deepStrictEqual(dnd.toggled, ["grantingCA", "prone"]);
  assert.strictEqual(dnd.secondWind, 1);
  assert.match(dnd.chargeWarn, /only in combat/);

  assert.deepStrictEqual(errors, []);
  console.log("PHASE 59 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
