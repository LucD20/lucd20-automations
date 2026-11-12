const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 13: Defeat at 0 HP, Hidden Until Started. */
async function setupMocks(page) {
  await page.evaluate(() => {
    const MOD = "lucd20-automations";
    // Apply "a.b.c" / "flags.x.-=key" style updates.
    const apply = (doc, data) => {
      for (const [k, v] of Object.entries(data)) {
        if (k === "_id") continue;
        const parts = k.split("."); let o = doc;
        for (const p of parts.slice(0, -1)) o = o[p] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)]; else o[last] = v;
      }
    };
    const flagged = obj => Object.assign(obj, { flags: {}, getFlag(ns, k) { return this.flags[ns]?.[k]; } });

    window.__log = [];
    const makeToken = (id, hidden) => flagged({
      id, hidden, parent: { id: "s1" }, actorLink: false,
      async update(data) { apply(this, data); __log.push(`token ${id} ${JSON.stringify(data)}`); Hooks.callAll("updateToken", this, data, {}, "u1"); }
    });
    const makeActor = (id, hp, owned = false) => ({
      id, uuid: `Actor.${id}`, isToken: false, hasPlayerOwner: owned,
      system: { attributes: { hp: { value: hp, max: 20, temp: 0 } } },
      statuses: new Set(),
      async toggleStatusEffect(sid, { active }) { active ? this.statuses.add(sid) : this.statuses.delete(sid); __log.push(`status ${id} ${sid} ${active}`); },
      async setHP(v) { this.system.attributes.hp.value = v; Hooks.callAll("updateActor", this, { system: { attributes: { hp: { value: v } } } }, {}, "u1"); }
    });
    window.__tokens = { gob: makeToken("tGob", false), orc: makeToken("tOrc", false), amb: makeToken("tAmb", true), pc: makeToken("tPc", false) };
    window.__actors = { gob: makeActor("gob", 10), orc: makeActor("orc", 10), amb: makeActor("amb", 10), pc: makeActor("pc", 10, true) };
    game.actors = Object.values(__actors);
    const combat = {
      id: "c1", sceneId: "s1", round: 0, started: false, combatants: [],
      async updateEmbeddedDocuments(type, updates) {
        for (const u of updates) { const c = this.combatants.find(x => x.id === u._id); apply(c, u); __log.push(`combatant ${c.id} ${JSON.stringify(u)}`); }
      }
    };
    window.__combat = combat;
    game.combats = [combat];
    window.__addCombatant = (key, data = {}) => {
      const c = flagged({
        id: `c-${key}`, tokenId: __tokens[key].id, sceneId: "s1", hidden: !!data.hidden, defeated: false,
        get token() { return __tokens[key]; }, get actor() { return __actors[key]; },
        updateSource(d) { apply(this, d); },
        async update(d) { apply(this, d); __log.push(`combatant ${this.id} ${JSON.stringify(d)}`); }
      });
      Hooks.callAll("preCreateCombatant", c, data, {}, "u1");
      combat.combatants.push(c);
      Hooks.callAll("createCombatant", c, {}, "u1");
      return c;
    };
    window.__start = () => { combat.round = 1; combat.started = true; Hooks.callAll("updateCombat", combat, { round: 1, turn: 0 }, {}); };
    window.CONFIG.specialStatusEffects = { DEFEATED: "dead" };
    game.user.isActiveGM = true;
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);
  await setupMocks(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const tick = () => page.waitForTimeout(40);
  const ev = fn => page.evaluate(fn);

  // ---------- Hidden Until Started ----------
  await set("encounterVisibility_enabled", true);
  await set("defeatAutomation_enabled", true);
  await tick();
  await ev(() => { __addCombatant("gob"); __addCombatant("orc"); __addCombatant("amb"); __addCombatant("pc"); });
  let hidden = await ev(() => __combat.combatants.map(c => [c.id, c.hidden]));
  assert.deepStrictEqual(hidden, [["c-gob", false], ["c-orc", false], ["c-amb", true], ["c-pc", false]], "only hidden-token combatants hidden");

  // Start: the ambusher's token still hidden → stays hidden
  await ev(() => __start());
  await tick();
  assert.strictEqual(await ev(() => __combat.combatants[2].hidden), true, "never reveals a combatant whose token is hidden");
  // Token revealed → combatant revealed
  await ev(() => __tokens.amb.update({ hidden: false }));
  await tick();
  assert.strictEqual(await ev(() => __combat.combatants[2].hidden), false, "revealing the token reveals the combatant");

  // GM hid a combatant by hand (visible token): combat start doesn't reveal it
  await ev(() => { __combat.round = 0; __combat.started = false; __addCombatant("orc", { hidden: true }); });
  await ev(() => { __combat.combatants.at(-1).id = "c-orc2"; __start(); });
  await tick();
  assert.strictEqual(await ev(() => __combat.combatants.at(-1).hidden), true, "hand-hidden combatant stays hidden");
  await ev(() => __combat.combatants.pop());

  // ---------- Defeat at 0 HP ----------
  await ev(() => { __log.length = 0; });
  await ev(() => __actors.gob.setHP(3));
  await tick();
  assert.deepStrictEqual(await ev(() => __log), [], "damage above 0 does nothing");
  await ev(() => __actors.gob.setHP(0));
  await tick();
  let gob = await ev(() => ({ defeated: __combat.combatants[0].defeated, hidden: __tokens.gob.hidden, status: [...__actors.gob.statuses] }));
  assert.deepStrictEqual(gob, { defeated: true, hidden: true, status: ["dead"] }, "NPC at 0: defeated, status, token hidden");
  // further damage at 0: nothing new
  const n = await ev(() => __log.length);
  await ev(() => __actors.gob.setHP(-2));
  await tick();
  assert.strictEqual(await ev(() => __log.length), n, "no repeat while down");

  // PCs never touched
  await ev(() => __actors.pc.setHP(0));
  await tick();
  assert.deepStrictEqual(await ev(() => [__combat.combatants[3].defeated, __tokens.pc.hidden, __actors.pc.statuses.size]), [false, false, 0], "PC untouched");

  // healed → undone, token shown (we hid it)
  await ev(() => __actors.gob.setHP(5));
  await tick();
  gob = await ev(() => ({ defeated: __combat.combatants[0].defeated, hidden: __tokens.gob.hidden, status: [...__actors.gob.statuses], flag: __combat.combatants[0].getFlag("lucd20-automations", "defeatedAtZero") }));
  assert.deepStrictEqual(gob, { defeated: false, hidden: false, status: [], flag: undefined }, "healed: undone");

  // token the GM hid already (still hidden after heal); combatant the GM defeated by hand stays defeated
  await ev(() => { __tokens.orc.hidden = true; __combat.combatants[1].defeated = true; });
  await ev(() => __actors.orc.setHP(0));
  await tick();
  await ev(() => __actors.orc.setHP(8));
  await tick();
  assert.deepStrictEqual(await ev(() => [__combat.combatants[1].defeated, __tokens.orc.hidden]), [true, true], "only undoes what it did");

  // hideToken off
  await set("defeatAutomation_hideToken", false);
  await tick();
  await ev(() => __actors.amb.setHP(0));
  await tick();
  assert.deepStrictEqual(await ev(() => [__combat.combatants[2].defeated, __tokens.amb.hidden]), [true, false], "hide token off");
  // undoOnHeal off
  await set("defeatAutomation_undoOnHeal", false);
  await tick();
  await ev(() => __actors.amb.setHP(4));
  await tick();
  assert.strictEqual(await ev(() => __combat.combatants[2].defeated), true, "undo off: stays defeated");

  // switched off → nothing
  await set("defeatAutomation_enabled", false);
  await tick();
  await ev(() => { __log.length = 0; });
  await ev(() => __actors.gob.setHP(0));
  await tick();
  assert.deepStrictEqual(await ev(() => __log), [], "off: nothing happens");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 13 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
