const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

async function setup(page, userId) {
  await page.evaluate(userId => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const chat = document.createElement("section");
    chat.id = "chat";
    chat.style.cssText = "position:absolute;right:20px;top:20px;width:340px;height:620px;display:flex;flex-direction:column;border:1px solid #666";
    chat.innerHTML = `<div class="chat-scroll" style="flex:1;overflow:auto"><ol class="chat-log" style="margin:0;padding:4px;list-style:none"><li class="chat-message">Hello table</li></ol></div>
      <div class="control-buttons" style="display:flex;gap:4px;justify-content:flex-end;padding:4px">
        <button type="button" class="ui-control icon fa-solid fa-floppy-disk" data-action="export"></button>
        <button type="button" class="ui-control icon fa-solid fa-trash" data-action="flush"></button>
      </div>`;
    document.body.append(chat);
    ui.chat = { element: chat };
    ui.sidebar = { activeTab: "combat", changeTab(t) { this.activeTab = t; } };
    window.canvas = { ready: false, tokens: { placeables: [] } };
    window.CONST.TOKEN_DISPLAY_MODES = { NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 };
    foundry.utils.getProperty = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
    foundry.utils.randomID = () => Math.random().toString(36).slice(2, 10);
    game.user.id = userId;
    game.users = Object.assign([{ id: "u1", name: "Gamemaster", isGM: true }, { id: "p1", name: "Alice", isGM: false }], { get(id) { return this.find(u => u.id === id); } });

    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    const mkActor = (id, name, hp, { owners = [], linked = true, tokenOpts = {}, fourE = false } = {}) => {
      const actor = {
        id, name, uuid: `Actor.${id}`, img: `icons/${id}.png`, isToken: false,
        system: { attributes: fourE ? { hp: { value: hp, max: hp }, temphp: { value: 0 } } : { hp: { value: hp, max: hp, temp: 0 } } },
        testUserPermission: (u, lvl) => owners.includes(u.id),
        prototypeToken: { displayBars: tokenOpts.displayBars ?? 0 },
        async update(data, options = {}) {
          for (const [k, v] of Object.entries(data)) { const parts = k.split("."); let o = this; for (const p of parts.slice(0, -1)) o = o[p]; o[parts.at(-1)] = v; }
          Hooks.callAll("updateActor", this, data, options, game.user.id);
        }
      };
      const token = { uuid: `Scene.s.Token.${id}`, name, actorLink: linked, hidden: !!tokenOpts.hidden, displayBars: tokenOpts.displayBars ?? 0,
        texture: { src: `icons/${id}.webp` }, actor, playersCanSeeName: tokenOpts.nameHidden ? false : undefined };
      actor.getActiveTokens = () => [token];
      registry[actor.uuid] = actor; registry[token.uuid] = token;
      return actor;
    };
    const B = 50, OWNER = 40, NONE = 0;
    window.__A = {
      amiri: mkActor("amiri", "Amiri", 40, { owners: ["p1"], tokenOpts: { displayBars: OWNER } }),
      boar: mkActor("boar", "Boar", 30, { tokenOpts: { displayBars: B, nameHidden: true } }),
      ghoul: mkActor("ghoul", "Ghoul", 20, { tokenOpts: { displayBars: NONE } }),
      skel: mkActor("skel", "Skeleton", 12, { tokenOpts: { displayBars: B, hidden: true } }),
      orc4e: mkActor("orc4e", "Orc (4e)", 25, { fourE: true, tokenOpts: { displayBars: B } })
    };
    game.actors = Object.values(__A);
    game.combat = { started: true, round: 2 };
    game.messages = Object.assign(new Map([["m1", { id: "m1" }]]), { filter(fn) { return [...this.values()].filter(fn); }, some(fn) { return [...this.values()].some(fn); }, async flush() { window.__coreFlush = true; } });
    window.ChatMessage = { async deleteDocuments(ids, o) { window.__deleted = o?.deleteAll ? "all" : ids; }, async updateDocuments() {} };
    window.__dialogMode = undefined;
  }, userId);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (q, userId, preset) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    const p = preset ? `&preset=${encodeURIComponent(JSON.stringify(preset))}` : "";
    await page.goto(`http://localhost:8765/index.html?${q}${p}`);
    await page.waitForFunction(() => window.__done);
    await setup(page, userId);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const entries = page => page.evaluate(() => game.settings.get("lucd20-automations", "damageLog_entries").entries);

  // ================= GM =================
  let page = await open("gm=1", "u1");
  await set(page, "damageLog_enabled", true);
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$$eval(".lucd20-damage-log-button", e => e.length), 1, "toggle button next to export");

  await page.evaluate(async () => {
    await __A.amiri.update({ "system.attributes.hp.value": 28 });                       // 12 damage
    await __A.amiri.update({ "system.attributes.hp.temp": 5 });                         // +5 temp
    await __A.amiri.update({ "system.attributes.hp.temp": 0, "system.attributes.hp.value": 25 }); // 5 temp + 3 = 8 damage
    await __A.amiri.update({ "system.attributes.hp.value": 33 });                       // healed 8
    await __A.amiri.update({ "system.attributes.hp.max": 45 });                         // max change
    await __A.boar.update({ "system.attributes.hp.value": 18 });
    await __A.ghoul.update({ "system.attributes.hp.value": 15 });
    await __A.skel.update({ "system.attributes.hp.value": 6 });
    await __A.orc4e.update({ "system.attributes.temphp.value": 4 });                     // 4e temp hp path
    await __A.amiri.update({ name: "Amiri" });                                           // no HP change → no entry
  });
  // PF2e "damage applied" message arrives after the change → becomes the cause of Boar's entry
  await page.evaluate(() => Hooks.callAll("createChatMessage", { id: "pf2msg", content: "<p>Boar takes <b>12</b> damage.</p><p>Resistance 5 (fire)</p><button>Undo</button>",
    flags: { pf2e: { appliedDamage: { uuid: "Actor.boar" } } } }));
  await page.waitForTimeout(500);
  let e = await entries(page);
  console.log("entries:", e.map(x => `${x.name} ${x.before.value}/${x.before.temp}/${x.before.max}→${x.after.value}/${x.after.temp}/${x.after.max}${x.cause ? " [" + x.cause + "]" : ""}`));
  assert.strictEqual(e.length, 9);
  assert.strictEqual(e[5].cause, "Boar takes 12 damage. Resistance 5 (fire)");
  assert.strictEqual(e[5].round, 2);

  // open the log window
  await page.click(".lucd20-damage-log-button");
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible(".lucd20-damage-log-window .lucd20-dl-list"));
  assert.ok(await page.isVisible(".chat-log"), "chat stays as it is");
  assert.ok(await page.evaluate(() => document.querySelector(".lucd20-damage-log-button").classList.contains("active")));
  const summaries = await page.$$eval(".lucd20-dl-entry", els => els.map(e => e.className.split(" ")[1] + ": " + e.querySelector(".lucd20-dl-summary").textContent));
  console.log("GM sees:", summaries);
  assert.deepStrictEqual(summaries.slice(0, 5), ["damage: took 12 damage", "temp: +5 temp HP", "damage: took 8 damage", "healing: healed 8", "max: max HP 40 → 45"]);
  assert.strictEqual(summaries.length, 9, "GM sees everything");
  await page.screenshot({ path: `${out}/p8-gm-log.png` });

  // undo the first damage
  await page.click('.lucd20-dl-entry:first-child [data-action="undo"]');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.evaluate(() => __A.amiri.system.attributes.hp.value), 40);
  e = await entries(page);
  assert.ok(e[0].reverted);
  assert.strictEqual(e.length, 9, "undo itself is not logged");

  // Clear Chat: without the checkbox the log stays; with it, it is cleared
  await page.evaluate(() => game.messages.flush());
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => __dialogContent)).includes("Also clear the Damage Log"));
  assert.strictEqual(await page.evaluate(() => __deleted), "all");
  assert.strictEqual((await entries(page)).length, 9, "log survives Clear Chat");
  await page.evaluate(() => { window.__dialogPrep = form => { form.querySelector('[name="lucd20ClearDamageLog"]').checked = true; }; });
  await page.evaluate(() => game.messages.flush());
  await page.waitForTimeout(200);
  assert.strictEqual((await entries(page)).length, 0, "cleared with the option");
  assert.ok(await page.isVisible("text=No HP changes yet."));

  // max entries
  await set(page, "damageLog_maxEntries", 10);
  await page.waitForTimeout(100);
  await page.evaluate(async () => { for (let i = 0; i < 15; i++) await __A.ghoul.update({ "system.attributes.hp.value": i }); });
  await page.waitForTimeout(500);
  assert.strictEqual((await entries(page)).length, 10);

  // ================= Player =================
  const preset = {
    [`${M}.damageLog_enabled`]: true,
    [`${M}.damageLog_entries`]: { entries: e.map(x => ({ ...x, reverted: false })) }
  };
  page = await open("gm=0", "p1", preset);
  await page.waitForTimeout(150);
  await page.click(".lucd20-damage-log-button");
  await page.waitForTimeout(200);
  const playerSees = await page.$$eval(".lucd20-dl-entry", els => els.map(e => e.querySelector(".lucd20-dl-name").textContent + ": " + e.querySelector(".lucd20-dl-summary").textContent));
  console.log("Player sees:", playerSees);
  // Amiri (owner, bars OWNER) ✓, Boar (bars ALWAYS, name hidden) ✓ as Unknown, Ghoul (bars NONE) ✗, Skeleton (hidden token) ✗, Orc ✓
  assert.ok(playerSees.some(s => s.startsWith("Amiri")));
  assert.ok(playerSees.includes("Unknown creature: took 12 damage"));
  assert.ok(!playerSees.some(s => s.startsWith("Ghoul") || s.startsWith("Skeleton")));
  assert.ok(playerSees.some(s => s.startsWith("Orc (4e): +4 temp HP")));
  assert.strictEqual(await page.$$eval(".lucd20-dl-cause", e => e.length), 0, "cause hidden from players by default");
  assert.strictEqual(await page.$$eval('.lucd20-damage-log-window [data-action="undo"], .lucd20-damage-log-window [data-action="clear"]', e => e.length), 0, "no undo/clear for players");
  await page.screenshot({ path: `${out}/p8-player-log.png` });
  // toggle closes it again
  await page.click(".lucd20-damage-log-button");
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$$eval(".lucd20-damage-log-window", e => e.length), 0);

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 7 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
