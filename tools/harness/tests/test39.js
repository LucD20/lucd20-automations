const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 39: the D&D 4e HUD (band across the bottom; Foundry's players list and hotbar moved). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1615, height: 991 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && (errors.push(m.text()), process.env.DBG && console.log("ERR", m.text())));
  await page.goto("http://localhost:8765/index.html?gm=1&system=dnd4e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  await page.evaluate(() => { for (const w of document.querySelectorAll(".application, #lucd20-settings-hub, [id^='lucd20-hub']")) w.remove(); });

  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    foundry.utils.mergeObject ??= (a, b) => ({ ...a, ...b, used: { ...a.used, ...(b.used ?? {}) } });
    game.user.targets ??= new Set();
    const settle = (ms = 150) => new Promise(res => setTimeout(res, ms));
    const data = await import("/modules/lucd20-automations/scripts/systems/dnd4e/hud/hud-data.mjs");
    const out = {};
    // Names as the owner's sheets have them.
    out.names = ["Ranger 01-Twin Strike", "Ranger-Hunter's Quarry", "Elf Power-Elven Accuracy", "Half-Orc Power-Furious Assault",
      "Warlock Pact Boon 01-Fate of the Void", "Bard-Majestic Word", "Warlock-Warlock's Curse", "Ranged Basic Attack Heavy Thrown", "Wolf-Pack Tactics", "Precisão Élfica"].map(data.cleanName);
    out.ranges = [{ rangeType: "weapon", weaponType: "meleeRanged" }, { rangeType: "range", rangePower: "10" }, { rangeType: "closeBurst", area: "5" },
      { rangeType: "areaBurst", area: "1", rangePower: "10" }, { rangeType: "personal" }].map(data.rangeInfo).map(x => `${x.icon}:${x.text}`);
    out.tabs = ["standard", "reaction", "interrupt", "opportunity", "none", "free"].map(data.tabFor);
    // keyWords as the owner's world has them: not always a list (v0.43.1).
    out.keywords = [{ keyWords: ["Martial", "Weapon", ""] }, { keyWords: "Arcane, Fire" }, { keyWords: new Set(["Primal"]) }, { keyWords: { fire: true, cold: false } }, { keyWords: null, keywordsCustom: "Charm" }, {}].map(data.keywordsOf);

    // ---- Foundry's own elements the HUD moves ----
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ui-left" style="position:fixed;left:0;top:0;bottom:0;width:200px"><div id="players" style="position:absolute;bottom:8px;left:8px;width:180px;padding:6px;background:#222;color:#ddd">Lucas [GM]</div></div>
      <div id="ui-bottom" style="position:fixed;left:400px;bottom:6px"><div id="hotbar"><ol id="action-bar">${Array.from({ length: 10 }, (_, i) => `<li class="slot">${(i + 1) % 10}</li>`).join("")}</ol></div></div>
      <div id="sidebar" style="position:fixed;right:0;top:0;bottom:0;width:32px;background:#111"></div>`);

    // ---- the ranger, from the owner's sheet ----
    const power = (id, name, sys, bonus = null) => ({ id, name, type: "power", system: { prepared: true, uses: { value: null, max: "" }, attack: { isAttack: false }, keyWords: [], ...sys },
      getAttackBonus: async () => bonus, sheet: { render() { out.itemSheet = name; } } });
    // A power with broken data: skipped, the HUD still draws (v0.43.1).
    const odd = power("px", "Odd Power", { actionType: "standard", useType: "atwill" });
    Object.defineProperty(odd.system, "trigger", { get() { throw new Error("broken data"); } });
    const items = [
      power("p1", "Ranger 01-Twin Strike", { actionType: "standard", useType: "atwill", powerType: "class", rangeType: "weapon", weaponType: "meleeRanged", attack: { isAttack: true, def: "ac" } }, 6),
      power("p2", "Ranger 01-Nimble Strike", { actionType: "standard", useType: "atwill", powerType: "class", rangeType: "weapon", weaponType: "ranged", attack: { isAttack: true, def: "ac" } }, 6),
      power("p3", "Ranger 01-Split the Tree", { actionType: "standard", useType: "daily", powerType: "class", rangeType: "weapon", weaponType: "ranged", uses: { value: 1, max: "1", per: "day" }, attack: { isAttack: true, def: "ac" } }, 6),
      power("p4", "Ranged Basic Attack", { actionType: "standard", useType: "atwill", powerType: "inherent", rangeType: "weapon", weaponType: "ranged", attack: { isAttack: true, def: "ac" } }, 6),
      power("p5", "Melee Basic Attack", { actionType: "standard", useType: "atwill", powerType: "inherent", rangeType: "weapon", weaponType: "melee", attack: { isAttack: true, def: "ac" } }, 3),
      power("p6", "Ranger-Hunter's Quarry", { actionType: "minor", useType: "atwill", powerType: "class", rangeType: "special" }),
      power("p7", "Elf Power-Elven Accuracy", { actionType: "free", useType: "encounter", powerType: "race", rangeType: "personal", uses: { value: 0, max: "1", per: "enc" } }),
      power("p8", "Ranger 01-Fox's Cunning", { actionType: "reaction", useType: "encounter", powerType: "class", rangeType: "weapon", weaponType: "meleeRanged", uses: { value: 1, max: "1", per: "enc" }, trigger: "An enemy makes a melee attack against you" }),
      odd,
      power("p9", "Bard-Majestic Word", { actionType: "minor", useType: "encounter", powerType: "class", rangeType: "closeBurst", area: "5", uses: { value: 1, max: "2", per: "enc" } }),
      { id: "w1", name: "Longbow", type: "weapon", system: {} }
    ];
    const calls = [];
    const actor = {
      id: "aeg", name: "Aegustarion Eng", type: "Player Character", isOwner: true, img: "icons/svg/mystery-man.svg",
      system: {
        attributes: { hp: { value: 21, max: 26 }, temphp: { value: 0 }, init: { value: 4 } },
        details: { level: 1, race: "Elf", class: "Ranger", surges: { value: 9, max: 9 }, surgeValue: 6, secondWind: false, deathsavefail: 1, deathsaves: 3, bloodied: 13 },
        actionpoints: { value: 1, encounteruse: false }, movement: { walk: { value: 7 } },
        defences: { ac: { value: 17 }, fort: { value: 13 }, ref: { value: 15 }, wil: { value: 12 } }
      },
      items: Object.assign(items, { get(id) { return this.find(i => i.id === id); } }),
      appliedEffects: [
        { name: "Slowed", statuses: new Set(["slowed"]), isTemporary: true, changes: [] },
        { name: "Hunter's Quarry: Gnoll", statuses: new Set(), isTemporary: true, changes: [] },
        { name: "Shield of Faith", statuses: new Set(), isTemporary: true, changes: [{ key: "system.defences.ac.value", type: "add", value: "2" }] }
      ],
      usePower: async item => calls.push(`use:${item.name}`),
      sheet: { render() { calls.push("sheet"); } },
      rollDeathSave: async () => calls.push("death"),
      actionPoint: async () => calls.push("ap"),
      secondWind: async () => calls.push("sw")
    };
    let flag = { used: { standard: 1, move: 0, minor: 0, immediate: 0, opportunity: 0 }, extra: 0 };
    const combatant = { id: "c1", name: "Aegustarion", actor, isOwner: true, getFlag: () => flag, setFlag: async (ns, k, v) => { flag = v; } };
    game.combat = { started: true, combatant: { id: "c1" }, getCombatantsByActor: a => (a === actor ? [combatant] : []) };
    combatant.combat = game.combat;
    Object.assign(canvas, { ready: true, grid: { size: 100, type: 1 }, tokens: { placeables: [], controlled: [{ actor }] } });
    const hudMod = await import("/modules/lucd20-automations/scripts/systems/dnd4e/hud/hud.mjs");
    Hooks.callAll("controlToken"); await settle();
    const root = () => document.getElementById("lucd20-hud4e");
    const txt = el => el?.textContent.replace(/\s+/g, " ").trim();
    // The usage columns that have something: [label, [names]].
    const rows = () => [...root().querySelectorAll(".h4-col")].map(col => [txt(col.querySelector(":scope > b")), [...col.querySelectorAll(".h4-pw")].map(p => txt(p.querySelector(".h4-h")))]).filter(c => c[1].length);

    out.mounted = [!!root(), root().classList.contains("dark"), root().querySelector(".h4-hot #hotbar") !== null, root().querySelector(".h4-players #players") !== null];
    out.plate = [...root().querySelector(".h4-plate").children].map(txt).join(" ");
    out.hp = txt(root().querySelector(".h4-hp"));
    // Q159: conditions as icons on the portrait; a click lists them with their durations.
    out.conds = [...root().querySelectorAll(".h4-por .h4-cicon")].map(i => i.classList.contains("bad"));
    out.condLine = !!root().querySelector(".h4-conds");
    root().querySelector(".h4-cicon").click();
    out.condList = [...root().querySelectorAll(".h4-conditions .h4-crow")].map(r => [txt(r.querySelector("span")), r.classList.contains("bad")]);
    root().querySelector('[data-h4="cond-close"]').click();
    out.condClosed = !root().querySelector(".h4-conditions");
    out.passive = txt(root().querySelectorAll(".h4-stats .h4-ln")[3]);
    out.defs = [...root().querySelectorAll(".h4-defs div")].map(d => `${txt(d)}${d.className ? `(${d.className})` : ""}`);
    out.standard = rows();
    const twin = root().querySelector('[data-power="p1"]');
    out.twin = [txt(twin.querySelector(".h4-k")), twin.querySelectorAll(".h4-k i").length];
    const rba = root().querySelector('[data-power="p4"] .h4-h');
    out.fit = [parseFloat(rba.style.fontSize || "12") <= 12, rba.scrollWidth <= rba.clientWidth + 1];
    out.dock = [...root().querySelectorAll(".h4-tiles > span")].map(s => s.className);
    out.width = Math.round(root().getBoundingClientRect().width);
    out.hotTop = Math.round(root().querySelector(".h4-hot").getBoundingClientRect().top);
    window.__shot = "dark";

    // Clicks: use a power, open it, switch tab, a pip, AP.
    twin.click(); await settle(30);
    twin.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    root().querySelector('[data-pip="move"]').click(); await settle(30);
    out.pip = flag.used.move;
    root().querySelector('[data-h4="ap"]').click(); await settle(30);
    root().querySelector('[data-tab="minor"]').click();
    out.minor = rows();
    out.pips = [...root().querySelectorAll('[data-power="p9"] .h4-uses i')].map(i => i.className || "empty");
    root().querySelector('[data-tab="free"]').click();
    out.freeUsed = root().querySelector('[data-power="p7"]').classList.contains("used");
    root().querySelector('[data-tab="triggered"]').click();
    out.triggered = rows();
    out.tooltips = root().querySelectorAll("[data-tooltip]").length;
    out.columns = [...root().querySelectorAll(".h4-col > b")].map(txt);
    root().querySelector('[data-tab="standard"]').click();

    // Dying: death saves in place of surges.
    actor.system.attributes.hp.value = -3;
    Hooks.callAll("updateActor", actor, {}); await settle();
    out.dying = [txt(root().querySelector(".h4-hp")), txt(root().querySelector(".h4-death")), root().querySelectorAll(".h4-death i.x").length];
    root().querySelector('[data-h4="death"]').click(); await settle(30);
    actor.system.attributes.hp.value = 21;
    root().querySelector('[data-h4="sheet"]').click();
    out.calls = calls.slice();

    // Out of combat: no basic actions, no dock.
    game.combat.started = false;
    Hooks.callAll("updateCombat", game.combat, {}); await settle();
    out.noCombat = [txt(root().querySelector(".h4-dock")), rows().find(r => r[0] === "Basic")?.[1]];
    game.combat.started = true;
    Hooks.callAll("updateCombat", game.combat, {}); await settle();

    // ---- Monsters (Q155–Q158) ----
    window.ChatMessage ??= { getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
    window.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = window.__d6; return this; }
      async toMessage(d, o) { window.__rechargeMsg = [d.flavor, o?.rollMode]; return { id: "rm1" }; } };
    const npower = (id, name, sys) => ({ id, name, type: "power", system: { prepared: true, uses: { value: null, max: "" }, attack: { isAttack: false }, keyWords: [], powerType: "inherent", ...sys },
      getAttackBonus: async () => 8, update: async d => { window.__itemUpdate = [name, d]; } });
    const nitems = [
      npower("n1", "Claw", { actionType: "standard", useType: "atwill", rangeType: "melee", rangePower: "2", attack: { isAttack: true, isBasic: true, def: "ac" } }),
      npower("n2", "Rending Pounce", { actionType: "standard", useType: "recharge", rechargeRoll: "5", rangeType: "closeBlast", area: "3", uses: { value: 0, max: "1" }, preparedMaxUses: 1, attack: { isAttack: true, def: "ac" } }),
      npower("n3", "Bloodied Howl", { actionType: "standard", useType: "recharge", rechargeRoll: "", rechargeCondition: "when first bloodied", rangeType: "closeBurst", area: "2", uses: { value: 1, max: "1" }, attack: { isAttack: true, def: "wil" } }),
      npower("n4", "Savage Retort", { actionType: "reaction", useType: "atwill", rangeType: "melee", rangePower: "1", attack: { isAttack: true, def: "ac" } }),
      npower("n5", "Stench of the Mire", { actionType: "none", useType: "atwill", rangeType: "", effect: { detail: "<p>Enemies in the aura take <b>−2</b> to saving throws.</p>" } })
    ];
    const stalker = { id: "stk", name: "Marsh Stalker", type: "NPC", isOwner: true, img: "icons/svg/mystery-man.svg", appliedEffects: [],
      system: { attributes: { hp: { value: 85, max: 104 }, temphp: { value: 0 }, init: { value: 5 } }, actionpoints: { value: 1 }, movement: { walk: { value: 7 } },
        details: { level: 3, exp: 300, saves: { value: 2 }, bloodied: 52, role: { primary: "brute", secondary: "elite", leader: true } }, skills: { prc: { total: 8 } },
        resistances: { poison: { value: 5 }, fire: { value: -5 }, cold: { value: 0 } }, defences: { ac: { value: 17 }, fort: { value: 16 }, ref: { value: 15 }, wil: { value: 13 } } },
      items: Object.assign(nitems, { get(id) { return this.find(i => i.id === id); } }), sheet: { render() {} } };
    const whelp = { id: "wh", name: "Stalker Whelp", type: "NPC", isOwner: true, img: "", appliedEffects: [], items: Object.assign([], { get() {} }),
      system: { attributes: { hp: { value: 1, max: 1 }, init: { value: 5 } }, movement: { walk: { value: 7 } }, details: { level: 2, saves: { value: 0 }, role: { primary: "skirmisher", secondary: "minion" } }, defences: { ac: { value: 16 } } } };
    const tok = (id, a) => ({ id, name: a.name, actor: a, document: { texture: { src: "" } } });
    canvas.tokens.controlled = [tok("t-stk", stalker)];
    Hooks.callAll("controlToken"); await settle();
    out.npcPlate = [root().querySelector(".h4-plate").className, txt(root().querySelector(".h4-role"))];
    out.npcRes = [...root().querySelectorAll(".h4-res span")].map(s => `${s.className}:${txt(s)}`);
    out.npcLines = [...root().querySelectorAll(".h4-stats .h4-ln")].map(txt);
    out.npcTabs = [...root().querySelectorAll(".h4-tabs button")].map(b => b.dataset.tab);
    out.npcCols = rows();
    out.rechargeShown = [txt(root().querySelector('[data-power="n2"] .h4-roll')), root().querySelectorAll('[data-power="n2"] .fa-dice-five, [data-power="n2"] .fa-dice-six').length, txt(root().querySelector('[data-power="n3"] .h4-rc.cond'))];
    window.__d6 = 4; root().querySelector('[data-recharge="n2"]').click(); await settle(50);
    out.rechargeFail = [window.__rechargeMsg, window.__itemUpdate ?? null];
    window.__d6 = 5; root().querySelector('[data-recharge="n2"]').click(); await settle(50);
    out.rechargeOk = [window.__rechargeMsg, window.__itemUpdate];
    root().querySelector('[data-tab="traits"]').click();
    out.traits = [...root().querySelectorAll(".h4-trait")].map(t => txt(t));
    root().querySelector('[data-tab="triggered"]').click();
    out.npcTriggered = rows();
    // Several selected: a card each; a click shows that one; "‹ 3" goes back to the cards.
    canvas.tokens.controlled = [tok("t-stk", stalker), tok("t-wh", whelp), { id: "t-aeg", name: "Aegustarion", actor, document: { texture: { src: "" } } }];
    Hooks.callAll("controlToken"); await settle();
    out.cards = [...root().querySelectorAll("[data-focus]")].map(c => [c.dataset.focus, txt(c.querySelector(".h4-pc-name small")), !!c.querySelector(".h4-mtag")]);
    root().querySelector('[data-focus="t-stk"]').click(); await settle();
    out.focused = [txt(root().querySelector(".h4-plate .fit")), txt(root().querySelector(".h4-back"))];
    root().querySelector('[data-h4="back"]').click(); await settle();
    out.backToCards = root().querySelectorAll("[data-focus]").length;
    // A player never gets a monster's HUD.
    game.user.isGM = false;
    canvas.tokens.controlled = [tok("t-stk", stalker)];
    game.user.character = null;
    Hooks.callAll("controlToken"); await settle();
    out.playerNpc = !!root().querySelector(".h4-stats");
    game.user.isGM = true;
    canvas.tokens.controlled = [{ actor }];
    Hooks.callAll("controlToken"); await settle();

    // Light theme.
    await game.settings.set(M, "dnd4eHud_theme", "light"); await settle();
    out.light = root().classList.contains("light");
    return out;
  });
  await page.screenshot({ path: __dirname + "/test39-light.png" });

  const r2 = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 150) => new Promise(res => setTimeout(res, ms));
    const root = () => document.getElementById("lucd20-hud4e");
    const out = {};
    await game.settings.set(M, "dnd4eHud_theme", "dark"); await settle();
    return out;
  });
  await page.screenshot({ path: __dirname + "/test39-dark.png" });

  // Window sizes (v0.43.6): the owner's 1920 wide, a 1366 laptop, 1024 (Foundry's minimum) with the sidebar
  // collapsed and open, and the owner's 958 px window. The layout, and nothing spilling out of its place.
  const sizes = {};
  for (const [label, w, side] of [["w1920", 1920, 48], ["w1366", 1366, 48], ["w1280", 1280, 48], ["w1024", 1024, 48], ["w1024open", 1024, 348], ["w958", 958, 110]]) {
    await page.setViewportSize({ width: w, height: 800 });
    sizes[label] = await page.evaluate(async side => {
      document.getElementById("sidebar").style.width = `${side}px`;
      window.dispatchEvent(new Event("resize"));
      await new Promise(res => setTimeout(res, 120));
      const root = document.getElementById("lucd20-hud4e");
      const main = root.querySelector(".h4-main"), cols = root.querySelector(".h4-cols");
      const box = el => el.getBoundingClientRect();
      const names = [...root.querySelectorAll(".h4-pw .h4-h")];
      const hot = box(root.querySelector("#hotbar")), powers = box(root.querySelector(".h4-powers"));
      return { size: root.dataset.size, width: Math.round(box(root).width), fits: main.scrollWidth <= main.clientWidth + 1,
        powersWidth: Math.round(powers.width), colWidth: Math.round(box(cols.firstElementChild).width),
        smallestName: Math.min(...names.map(n => parseFloat(n.style.fontSize || "12"))),
        hotbarClear: hot.right <= window.innerWidth - side + 1 && (hot.bottom <= powers.top + 1 || hot.left >= powers.right - 1) };
    }, side);
    await page.screenshot({ path: `${__dirname}/test39-${label}.png`, clip: { x: 0, y: 560, width: w, height: 240 } });
  }
  await page.setViewportSize({ width: 1615, height: 991 });
  await page.evaluate(() => { document.getElementById("sidebar").style.width = "32px"; window.dispatchEvent(new Event("resize")); });

  const r3 = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 150) => new Promise(res => setTimeout(res, ms));
    const root = () => document.getElementById("lucd20-hud4e");
    const out = {};
    const txt = el => el?.textContent.replace(/\s+/g, " ").trim();
    // Nothing selected: the party (characters with a player owner this user may observe), hotbar in place.
    const pc = (id, name, observe = true) => ({ id, name, type: "Player Character", hasPlayerOwner: true, img: "icons/svg/mystery-man.svg",
      testUserPermission: () => observe, getActiveTokens: () => [{ isOwner: true, control: () => { window.__controlled = id; } }], sheet: { render() { window.__sheet = id; } },
      system: { attributes: { hp: { value: 18, max: 30 } }, details: { class: "Warlock", level: 1, surges: { value: 10 } }, actionpoints: { value: 1 }, movement: { walk: { value: 6 } },
        defences: { ac: { value: 14 }, fort: { value: 14 }, ref: { value: 13 }, wil: { value: 13 } } } });
    const party = [pc("peb", "Pebraxeon"), pc("lin", "Linkedin", false), { id: "wolf", name: "Wolf", type: "NPC", hasPlayerOwner: false }, pc("gro", "Grontar")];
    game.actors = Object.assign(party, { contents: party, get(id) { return party.find(a => a.id === id); } });
    canvas.tokens.controlled = [];
    Hooks.callAll("controlToken"); await settle();
    out.partyGM = [...root().querySelectorAll(".h4-pc .h4-pc-name b")].map(txt);
    out.card = txt(root().querySelector('[data-party="peb"]'));
    root().querySelector('[data-party="gro"]').click();
    root().querySelector('[data-party="peb"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    out.partyClicks = [window.__controlled, window.__sheet];
    game.user.isGM = false;
    Hooks.callAll("controlToken"); await settle();
    out.partyPlayer = [...root().querySelectorAll(".h4-pc .h4-pc-name b")].map(txt);
    game.user.isGM = true;
    const box = root().getBoundingClientRect();
    out.empty = [root().classList.contains("empty"), !!root().querySelector(".h4-hot #hotbar"), Math.round(box.height), Math.round(box.width) > 1000];
    out.hotTop = Math.round(root().querySelector(".h4-hot").getBoundingClientRect().top);
    // The hotbar option off: back where Foundry had it.
    await game.settings.set(M, "dnd4eHud_hotbar", false); await settle();
    out.hotbarBack = document.getElementById("hotbar").parentElement.id;
    await game.settings.set(M, "dnd4eHud_hotbar", true); await settle();
    // The HUD off: both back, the HUD gone.
    await game.settings.set(M, "dnd4eHud_enabled", false); await settle();
    out.off = [!!root(), document.getElementById("hotbar").parentElement.id, document.getElementById("players").parentElement.id];
    return out;
  });

  console.log(JSON.stringify({ ...r, ...r3, sizes }, null, 1));
  assert.deepStrictEqual(Object.values(sizes).map(x => x.size), ["full", "full", "compact", "narrow", "tiny", "narrow"], "a layout per width");
  for (const [label, x] of Object.entries(sizes)) {
    assert.ok(x.fits, `${label}: nothing spills out of the band`);
    assert.ok(x.hotbarClear, `${label}: the hotbar is clear of the powers and the sidebar`);
    assert.ok(x.colWidth >= 150, `${label}: a usage group is at least 150 px wide (${x.colWidth})`);
    assert.ok(x.smallestName >= 9, `${label}: names stay readable (${x.smallestName}px)`);
  }
  assert.deepStrictEqual(r.names, ["Twin Strike", "Hunter's Quarry", "Elven Accuracy", "Furious Assault", "Fate of the Void", "Majestic Word", "Warlock's Curse", "Ranged Basic Attack Heavy Thrown", "Wolf-Pack Tactics", "Precisão Élfica"], "names lose the compendium prefix, and only that");
  assert.deepStrictEqual(r.ranges, ["meleeRanged:W", "ranged:10", "close:burst 5", "area:burst 1 in 10", "personal:"]);
  assert.deepStrictEqual(r.keywords, ["Martial, Weapon", "Arcane, Fire", "Primal", "fire", "Charm", ""], "keywords from any shape");
  assert.deepStrictEqual(r.tabs, ["standard", "triggered", "triggered", "triggered", "free", "free"]);
  assert.deepStrictEqual(r.mounted, [true, true, true, true], "mounted, dark, hotbar and players list moved in");
  assert.strictEqual(r.plate, "Aegustarion Eng Elf Ranger 1");
  assert.strictEqual(r.hp, "21 / 26");
  assert.deepStrictEqual([r.conds, r.condLine], [[true, false, false], false], "conditions as icons on the portrait, harmful ones framed; no text line");
  assert.deepStrictEqual(r.condList, [["Slowed", true], ["Hunter's Quarry: Gnoll", false], ["Shield of Faith", false]], "a click lists them");
  assert.strictEqual(r.condClosed, true);
  assert.strictEqual(r.passive, "Speed 7Init +4 Passive /", "speed, initiative and passives on their own line");
  assert.deepStrictEqual(r.defs, ["17AC(up)", "13Fort", "15Ref", "12Will"], "a defence raised by an effect is marked");
  assert.deepStrictEqual(r.standard, [["At-Will", ["Nimble Strike", "Twin Strike"]], ["Daily", ["Split the Tree"]],
    ["Basic", ["Melee Basic Attack", "Ranged Basic Attack", "Charge", "Total Defense", "Second Wind", "Aid Another", "Ready"]]], "Standard tab in usage rows; basic actions in combat");
  assert.deepStrictEqual(r.twin, ["/ W+6 vs AC", 2], "range icons and the sheet's attack bonus");
  assert.deepStrictEqual(r.fit, [true, true], "a long name fits its line");
  assert.deepStrictEqual(r.dock, ["spent", "on", "on", "off", "off"], "the dock: standard spent, immediate/opportunity not on own turn");
  assert.ok(r.width >= 1000 && r.width <= 1480, `width ${r.width}`);
  assert.strictEqual(r.pip, 1, "a dock tile toggles its action");
  assert.deepStrictEqual(r.minor, [["At-Will", ["Hunter's Quarry"]], ["Encounter", ["Majestic Word"]]]);
  assert.deepStrictEqual(r.pips, ["full", "empty"], "uses left as pips");
  assert.strictEqual(r.freeUsed, true, "a power with no uses left is greyed");
  assert.deepStrictEqual(r.triggered, [["Encounter", ["Fox's Cunning"]]]);
  assert.strictEqual(r.tooltips, 0, "no hover tooltips in the HUD (owner, v0.43.3)");
  assert.deepStrictEqual(r.columns, ["At-Will", "Encounter", "Daily", "Basic"], "the four usage columns are always there");
  assert.deepStrictEqual(r.dying, ["-3 / 26 · Dying", "Death saves", 1], "at 0 HP: dying, death saves with one failure");
  assert.deepStrictEqual(r.calls, ["use:Ranger 01-Twin Strike", "ap", "death", "sheet"], "click uses (usePower), AP, death save, sheet");
  assert.strictEqual(r.itemSheet, "Ranger 01-Twin Strike", "right click opens the power");
  assert.deepStrictEqual(r.noCombat, ["Actions are tracked in combat.", ["Melee Basic Attack", "Ranged Basic Attack"]], "out of combat: no dock, no basic actions");
  assert.strictEqual(r.light, true);
  assert.deepStrictEqual(r.npcPlate, ["h4-plate role-brute elite", "Level 3 Elite Brute (Leader) · 300 XP"], "monster plate in the role's colour, elite edge; role line");
  assert.deepStrictEqual(r.npcRes, ["res:Resist 5 poison", "vul:Vulnerable 5 fire"], "resist and vulnerable");
  assert.deepStrictEqual(r.npcLines, ["HP 85 / 104", "Saves +2AP 1 Spend", "Speed 7Init +5 Perception +8"]);
  assert.deepStrictEqual(r.npcTabs, ["standard", "move", "minor", "triggered", "traits"]);
  assert.deepStrictEqual(r.npcCols, [["Recharge", ["Bloodied Howlwhen first bloodied", "Rending Pounce"]], ["Basic", ["Claw"]]], "columns At-Will, Recharge, Basic (basic = the basic-attack flag)");
  assert.deepStrictEqual(r.rechargeShown, ["Roll", 2, "when first bloodied"], "a used recharge power: Roll with its dice 5-6; a condition recharge shows the condition");
  assert.deepStrictEqual(r.rechargeFail, [["Rending Pounce does not recharge.", "gmroll"], null], "a 4: no recharge, GM-only roll");
  assert.deepStrictEqual(r.rechargeOk, [["Rending Pounce recharges.", "gmroll"], ["Rending Pounce", { "system.uses.value": 1 }]], "a 5: the uses refill");
  assert.deepStrictEqual(r.traits, ["Stench of the MireEnemies in the aura take −2 to saving throws."], "traits with their text");
  assert.deepStrictEqual(r.npcTriggered, [["At-Will", ["Savage Retort"]]]);
  assert.deepStrictEqual(r.cards, [["t-stk", "L3 Elite Brute", false], ["t-wh", "L2 Minion Skirmisher", true], ["t-aeg", "Ranger 1", false]], "several selected: a card each, minions marked");
  assert.deepStrictEqual(r.focused, ["Marsh Stalker", "‹ 3"], "a card shows that one, with a way back");
  assert.strictEqual(r.backToCards, 3);
  assert.strictEqual(r.playerNpc, false, "a player never gets a monster's HUD");
  assert.deepStrictEqual(r3.empty, [true, true, 168, true], "nothing selected: the band keeps its size and place, hotbar stays");
  assert.strictEqual(r3.hotTop, r.hotTop, "the macro area does not move between selected and not");
  assert.deepStrictEqual(r3.partyGM, ["Grontar", "Linkedin", "Pebraxeon"], "the party: player characters, not NPCs");
  assert.strictEqual(r3.card, "PebraxeonWarlock 1 AC14Fort14Ref13Will13 Surges 10AP 1Speed 6 18 / 30");
  assert.deepStrictEqual(r3.partyClicks, ["gro", "peb"], "click selects the token, right click opens the sheet");
  assert.deepStrictEqual(r3.partyPlayer, ["Grontar", "Pebraxeon"], "a player sees only characters they may observe");
  assert.strictEqual(r3.hotbarBack, "ui-bottom", "hotbar option off: back in Foundry's place");
  assert.deepStrictEqual(r3.off, [false, "ui-bottom", "ui-left"], "HUD off: gone, both back");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 39 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
