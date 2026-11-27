const { chromium } = require("playwright");
const assert = require("assert");

/** v0.92.0: rule 33 Albatross Curse (PLAN §29 N3); Battle Medicine's wear-off line in chat (N4). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 60) => new Promise(res => setTimeout(res, ms));
    const alb = await import(`/modules/${M}/scripts/systems/pf2e/albatross-curse.js`);
    const bm = await import(`/modules/${M}/scripts/systems/pf2e/battle-medicine.js`);
    const out = {};
    for (const f of ["pf2eAlbatrossCurse", "pf2eBattleMedicine"]) await game.settings.set(M, `${f}_enabled`, true);
    await settle();
    const registry = {};
    window.fromUuidSync = u => registry[u] ?? null;
    window.fromUuid = async u => { const id = u.split(".").at(-1); return { toObject: () => ({ type: "effect", name: `fx-${id}`, _stats: { compendiumSource: u }, system: {} }) }; };
    game.users = Object.assign([{ id: game.user.id, isGM: true, active: true, targets: new Set() }, { id: "p1", isGM: false, active: true, targets: new Set() }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    const mkMsg = d => { const m = { id: `m${++mid}`, flags: {}, whisper: [], ...d,
      getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async update(u) { for (const [k, v] of Object.entries(u)) { if (k.startsWith("flags.")) foundry.utils.setProperty(this, k, v); else this[k] = v; } } }; game.messages.push(m); return m; };
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => mkMsg(d) };
    const mkActor = (id, name, extra = {}) => {
      const a = { id, name, uuid: `Actor.${id}`, items: [], itemTypes: { effect: [] }, conds: new Map(), hasPlayerOwner: false, isOwner: true, testUserPermission: () => false,
        createEmbeddedDocuments: async (t, docs) => { for (const d of docs) a.itemTypes.effect.push({ ...d, id: `e${a.itemTypes.effect.length + 1}`, slug: null }); },
        deleteEmbeddedDocuments: async (t, ids) => { a.itemTypes.effect = a.itemTypes.effect.filter(e => !ids.includes(e.id)); },
        increaseCondition: async (s, o) => a.conds.set(s, o?.value ?? 1), decreaseCondition: async s => a.conds.delete(s), ...extra };
      registry[a.uuid] = a; return a;
    };
    const saves = [];
    const ogreA = mkActor("ogre", "Ogre", { saves: { will: { roll: async o => saves.push([o.dc?.value, o.extraRollOptions]) } } });
    const kyraA = mkActor("kyra", "Kyra", { hasPlayerOwner: true });
    const tOgre = { id: "ogre", uuid: "Scene.s.Token.ogre", name: "Ogre", actor: ogreA, hidden: false, playersCanSeeName: true };
    registry[tOgre.uuid] = tOgre;
    ogreA.getActiveTokens = () => [tOgre];
    const spell = { type: "spell", slug: "albatross-curse", name: "Albatross Curse", img: "alb.webp", spellcasting: { statistic: { dc: { value: 22 } } } };

    // Kyra casts it on the ogre: PF2e's spell effect on it (the caster as origin), a card to the GM (an NPC).
    game.users.get("p1").targets = new Set([{ document: tOgre }]);
    Hooks.callAll("createChatMessage", mkMsg({ item: spell, actor: kyraA, author: { id: "p1" }, flags: { pf2e: { casting: {} } } })); await settle();
    const card = game.messages.find(m => m.flags[M]?.albatross);
    out.cast = [ogreA.itemTypes.effect.map(e => e._stats.compendiumSource.split(".").at(-1)).join(","), ogreA.itemTypes.effect[0]?.system?.context?.origin?.actor, card?.whisper, card?.flags[M].albatross.dc, card?.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()];
    // Cast again: no second effect.
    Hooks.callAll("createChatMessage", mkMsg({ item: spell, actor: kyraA, author: { id: "p1" }, flags: { pf2e: { casting: {} } } })); await settle();
    out.once = ogreA.itemTypes.effect.length;

    // The GM clicks "Strike the albatross": the curse goes; the ogre's Will save vs DC 22, tagged.
    const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", card, host);
    host.querySelector("[data-lucd20-alb]").click(); await settle(80);
    out.struck = [ogreA.itemTypes.effect.length, card.flags[M].albatross.done, saves.at(-1)];
    // The save fails: PF2e's Failure effect (roll twice on the next Will save).
    const will = (outcome, opts = []) => mkMsg({ actor: ogreA, token: tOgre, flags: { pf2e: { context: { type: "saving-throw", outcome, domains: ["will", "saving-throw"], options: opts } } } });
    Hooks.callAll("createChatMessage", will("failure", ["lucd20-albatross"])); await settle(80);
    out.failure = [ogreA.itemTypes.effect.map(e => e._stats.compendiumSource.split(".").at(-1)).join(","), game.messages.at(-1).content.replace(/<[^>]+>/g, "").trim()];
    // Its next Will save: the effect goes.
    Hooks.callAll("createChatMessage", will("success")); await settle(80);
    out.gone = [ogreA.itemTypes.effect.length, game.messages.at(-1).content.replace(/<[^>]+>/g, "").trim()];
    // A success instead: stupefied 1, removed at the start of its next turn.
    alb._test.saving.set(ogreA.uuid, { caster: kyraA.uuid });
    Hooks.callAll("createChatMessage", will("success", ["lucd20-albatross"])); await settle(80);
    out.stupefied = ogreA.conds.get("stupefied");
    await alb._test.onTurnStart({ actor: ogreA });
    out.stupefiedGone = ogreA.conds.has("stupefied");

    // Battle Medicine: world time passes the end of Kyra's immunity to Ezren: a line for everyone.
    game.time ??= { worldTime: 1000 };
    const t0 = game.time.worldTime;
    const pat = mkActor("pat", "Valeros", { hasPlayerOwner: true, getActiveTokens: () => [{ name: "Valeros", hidden: false }] });
    pat.flags = { [M]: { immunities: [{ kind: "battleMedicine", by: "Actor.ezren", name: "Ezren", at: t0, until: t0 + 3600 }, { kind: "combatAssessment", by: "x", name: "X", until: t0 + 3600 }] } };
    pat.getFlag = (ns, k) => pat.flags[ns]?.[k];
    const gob = mkActor("gob", "Goblin", { getActiveTokens: () => [{ name: "Goblin", hidden: true }] });
    gob.flags = { [M]: { immunities: [{ kind: "battleMedicine", by: "Actor.ezren", name: "Ezren", until: t0 + 1800 }] } };
    gob.getFlag = (ns, k) => gob.flags[ns]?.[k];
    out.wornOff = bm.wornOff([pat, gob], t0, t0 + 3600).map(x => `${x.actor.name}:${x.entry.kind}`);
    game.actors = Object.assign([pat, gob], { contents: [pat, gob] });
    const n = game.messages.length;
    Hooks.callAll("updateWorldTime", t0 + 4000, 4000); await settle(120);
    out.lines = game.messages.slice(n).map(m => [m.content.replace(/<[^>]+>/g, "").trim(), m.whisper.length]);
    // Time that doesn't pass the end: nothing.
    const n2 = game.messages.length;
    Hooks.callAll("updateWorldTime", t0 + 5000, 1000); await settle(80);
    out.quiet = game.messages.length - n2;
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.strictEqual(r.cast[0], "b8BZHeuz5jH8E2SG", "PF2e's spell effect on the target");
  assert.strictEqual(r.cast[1], "Actor.kyra", "the caster as its origin");
  assert.strictEqual(r.cast[2].length, 1, "an NPC's card: the GM");
  assert.strictEqual(r.cast[3], 22, "the spell DC");
  assert.ok(r.cast[4].includes("Strike the albatross") && r.cast[4].includes("DC 22"), r.cast[4]);
  assert.strictEqual(r.once, 1, "no second effect");
  assert.deepStrictEqual(r.struck, [0, true, [22, ["lucd20-albatross"]]], "the curse goes; the Will save");
  assert.ok(r.failure[0] === "Y8OGpgAEgISpTwYd" && r.failure[1].includes("roll twice"), `failure ${r.failure}`);
  assert.ok(r.gone[0] === 0 && r.gone[1].includes("disappears"), `next save ${r.gone}`);
  assert.strictEqual(r.stupefied, 1);
  assert.strictEqual(r.stupefiedGone, false, "stupefied ends at its next turn");
  assert.deepStrictEqual(r.wornOff, ["Valeros:battleMedicine", "Goblin:battleMedicine"]);
  assert.deepStrictEqual(r.lines, [["Valeros can receive Ezren's Battle Medicine again.", 0], ["Goblin can receive Ezren's Battle Medicine again.", 1]], "everyone; a hidden creature: the GM only");
  assert.strictEqual(r.quiet, 0);
  console.log("PHASE 83 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
