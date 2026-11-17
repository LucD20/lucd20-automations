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
    out.conds = [...root().querySelectorAll(".h4-conds span")].map(s => [s.textContent, s.classList.contains("bad")]);
    out.defs = [...root().querySelectorAll(".h4-defs div")].map(d => `${txt(d)}${d.className ? `(${d.className})` : ""}`);
    out.standard = rows();
    const twin = root().querySelector('[data-power="p1"]');
    out.twin = [txt(twin.querySelector(".h4-k")), twin.querySelectorAll(".h4-k i").length];
    const rba = root().querySelector('[data-power="p4"] .h4-h');
    out.fit = [parseFloat(rba.style.fontSize || "12") <= 12, rba.scrollWidth <= rba.clientWidth + 1];
    out.dock = [...root().querySelectorAll(".h4-tiles span")].map(s => s.className);
    out.width = Math.round(root().getBoundingClientRect().width);
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

  const r3 = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 150) => new Promise(res => setTimeout(res, ms));
    const root = () => document.getElementById("lucd20-hud4e");
    const out = {};
    const txt = el => el?.textContent.replace(/\s+/g, " ").trim();
    // The GM with nothing selected: no character; the hotbar stays in the HUD's corner.
    canvas.tokens.controlled = [];
    Hooks.callAll("controlToken"); await settle();
    const box = root().getBoundingClientRect();
    out.empty = [root().classList.contains("empty"), !!root().querySelector(".h4-hot #hotbar"), txt(root().querySelector(".h4-main")), Math.round(box.height), Math.round(box.width) > 1000];
    // The hotbar option off: back where Foundry had it.
    await game.settings.set(M, "dnd4eHud_hotbar", false); await settle();
    out.hotbarBack = document.getElementById("hotbar").parentElement.id;
    await game.settings.set(M, "dnd4eHud_hotbar", true); await settle();
    // The HUD off: both back, the HUD gone.
    await game.settings.set(M, "dnd4eHud_enabled", false); await settle();
    out.off = [!!root(), document.getElementById("hotbar").parentElement.id, document.getElementById("players").parentElement.id];
    return out;
  });

  console.log(JSON.stringify({ ...r, ...r3 }, null, 1));
  assert.deepStrictEqual(r.names, ["Twin Strike", "Hunter's Quarry", "Elven Accuracy", "Furious Assault", "Fate of the Void", "Majestic Word", "Warlock's Curse", "Ranged Basic Attack Heavy Thrown", "Wolf-Pack Tactics", "Precisão Élfica"], "names lose the compendium prefix, and only that");
  assert.deepStrictEqual(r.ranges, ["meleeRanged:W", "ranged:10", "close:burst 5", "area:burst 1 in 10", "personal:"]);
  assert.deepStrictEqual(r.keywords, ["Martial, Weapon", "Arcane, Fire", "Primal", "fire", "Charm", ""], "keywords from any shape");
  assert.deepStrictEqual(r.tabs, ["standard", "triggered", "triggered", "triggered", "free", "free"]);
  assert.deepStrictEqual(r.mounted, [true, true, true, true], "mounted, dark, hotbar and players list moved in");
  assert.strictEqual(r.plate, "Aegustarion Eng Elf Ranger 1");
  assert.strictEqual(r.hp, "21 / 26");
  assert.deepStrictEqual(r.conds, [["Slowed", true], ["Hunter's Quarry: Gnoll", false], ["Shield of Faith", false]], "conditions; harmful ones marked");
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
  assert.deepStrictEqual(r3.empty, [true, true, "Select a character's token to see its HUD.", 190, true], "GM with nothing selected: the band keeps its size and place, hotbar stays");
  assert.strictEqual(r3.hotbarBack, "ui-bottom", "hotbar option off: back in Foundry's place");
  assert.deepStrictEqual(r3.off, [false, "ui-bottom", "ui-left"], "HUD off: gone, both back");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 39 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
