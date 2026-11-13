const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 26: D&D 4e Combat Automation merged (loads, cards, settings map, API; nothing runs in other systems). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message} ${e.stack?.split("\n").slice(1, 3).join(" ")}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };

  let page = await open("gm=1&system=dnd4e");
  const info = await page.evaluate(async () => {
    const { dnd4eSetting } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/cards.mjs");
    return {
      tabs: [...document.querySelectorAll(".lucd20-hub-tab")].map(t => t.dataset.category),
      api: Object.keys(game.modules.get("lucd20-automations").api?.dnd4e ?? {}),
      quarry: dnd4eSetting("enableQuarry"),
      cover: dnd4eSetting("enableCover"),
      preview: dnd4eSetting("coverPreview"),
      language: dnd4eSetting("gameLanguage"),
      hooks: ["dnd4e.usePower", "dnd4e.rollAttack", "renderChatMessageHTML"].map(h => (Hooks._h[h] ?? []).length)
    };
  });
  console.log(info);
  assert.ok(info.tabs.includes("dnd4e"), "D&D 4e category");
  assert.deepStrictEqual(info.api.sort(), ["applyMark", "computeCover", "drawCoverPreview", "openActionPanel", "translateExisting"], "API under api.dnd4e");
  assert.ok(info.quarry && info.cover && info.preview, "defaults on");
  assert.ok(info.hooks[0] > 0 && info.hooks[1] > 0, "4e hooks registered");
  await page.click('.lucd20-hub-tab[data-category="dnd4e"]');
  await page.waitForTimeout(150);
  const cards = await page.$$eval('.lucd20-hub-category[data-category="dnd4e"] .lucd20-feature', els => els.map(e => [e.innerText.split("\n")[0].trim(), e.classList.contains("planned")]));
  console.log(cards);
  assert.strictEqual(cards.length, 14, "14 cards (13 from the merge + Skill Challenges)");
  assert.ok(cards.every(c => !c[1]), "all built");
  await page.evaluate(() => { const f = document.querySelector("form.lucd20-hub"); f.style.height = "960px"; });
  await page.screenshot({ path: `${out}/p26-dnd4e-cards.png` });
  // Switches work without reload: card off → old keys read false; option off → that key false
  const after = await page.evaluate(async () => {
    const { dnd4eSetting } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/cards.mjs");
    await game.settings.set("lucd20-automations", "dnd4eClassFeatures_quarry", false);
    const a = [dnd4eSetting("enableQuarry"), dnd4eSetting("enableCurse")];
    await game.settings.set("lucd20-automations", "dnd4eClassFeatures_enabled", false);
    const b = [dnd4eSetting("enableCurse"), dnd4eSetting("enableCover")];
    return [a, b];
  });
  assert.deepStrictEqual(after, [[false, true], [false, true]], "option and card switches map onto the old keys");

  // ---------- Migration from the old module ----------
  const migrated = await page.evaluate(async () => {
    window.Actor ??= class Actor {}; // Foundry's class (power symbols redraw when the marks change)
    const OLD = "dnd4e-combat-automation";
    const NEW = "lucd20-automations";
    const worldDocs = [
      { key: `${OLD}.textOverrides`, value: JSON.stringify({ "Gray Wolf": { name: "Lobo Cinzento" } }) },
      { key: `${OLD}.powerLevels-overrides`, value: JSON.stringify({ "ranger-hunters-quarry": { auto: 3 } }) },
      { key: `${OLD}.enableRage`, value: "false" },
      { key: `${OLD}.coverPreview`, value: "false" } // client-scope here: must not be taken from the world
    ];
    game.settings.storage = new Map([["world", worldDocs]]);
    localStorage.setItem(`${OLD}.tokenBadges`, "false");
    localStorage.removeItem(`${NEW}.dnd4eClientMigrated`);
    const apply = (doc, data) => { for (const [k, v] of Object.entries(data)) { if (k === "_id") continue; const parts = k.split("."); let o = doc; for (const p of parts.slice(0, -1)) o = o[p] ??= {}; o[parts.at(-1)] = v; } };
    const effect = { id: "e1", flags: { [OLD]: { kind: "quarry", source: "Actor.r1" } } };
    const actor = {
      id: "a1", flags: { [OLD]: { translatedFrom: "Gray Wolf" } }, effects: [effect],
      async update(data) { apply(this, data); },
      async updateEmbeddedDocuments(type, updates) { for (const u of updates) apply(this.effects.find(e => e.id === u._id), u); }
    };
    game.actors = [actor];
    game.scenes = [];
    game.combats = [];
    game.messages = Object.assign([], { contents: [] });
    await game.settings.set(NEW, "dnd4eMigrated", false); // it ran (empty) when the page loaded
    await game.settings.set(NEW, "dnd4eClassFeatures_enabled", true);
    await game.settings.set(NEW, "dnd4eClassFeatures_rage", true);
    const { runMigration } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/migration.mjs");
    const report = await runMigration();
    const again = await runMigration();
    const { dnd4eSetting } = await import("/modules/lucd20-automations/scripts/systems/dnd4e/cards.mjs");
    return {
      report, again,
      texts: game.settings.get(NEW, "textOverrides"),
      levels: game.settings.get(NEW, "powerLevels-overrides"),
      rage: dnd4eSetting("enableRage"),
      preview: game.settings.get(NEW, "dnd4eCover_preview"),
      badges: game.settings.get(NEW, "dnd4eTokenBadges_enabled"),
      actorFlag: actor.flags[NEW]?.translatedFrom,
      effectFlag: effect.flags[NEW]?.kind
    };
  });
  console.log("migration:", migrated);
  assert.deepStrictEqual(migrated.texts, { "Gray Wolf": { name: "Lobo Cinzento" } }, "monster texts moved");
  assert.deepStrictEqual(migrated.levels, { "ranger-hunters-quarry": { auto: 3 } }, "power marks moved");
  assert.strictEqual(migrated.rage, false, "old world switch carried over");
  assert.strictEqual(migrated.preview, true, "a per-player option isn't taken from world data");
  assert.strictEqual(migrated.badges, false, "this player's old option carried over");
  assert.deepStrictEqual([migrated.actorFlag, migrated.effectFlag], ["Gray Wolf", "quarry"], "flags copied to the new scope");
  assert.strictEqual(migrated.again, null, "runs once");

  // ---------- Another system: nothing from 4e ----------
  page = await open("gm=1&system=pf2e");
  const other = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".lucd20-hub-tab")].map(t => t.dataset.category),
    api: !!game.modules.get("lucd20-automations").api?.dnd4e,
    hooks: ["dnd4e.usePower", "dnd4e.rollAttack", "preCreateChatMessage"].map(h => (Hooks._h[h] ?? []).length)
  }));
  console.log(other);
  assert.ok(!other.tabs.includes("dnd4e"), "no 4e category in PF2e");
  assert.ok(!other.api, "no 4e API in PF2e");
  assert.deepStrictEqual(other.hooks.slice(0, 2), [0, 0], "no 4e hooks in PF2e");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 26 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
