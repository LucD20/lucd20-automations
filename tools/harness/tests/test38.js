const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 38: PF2e rule 5, Temporal Distortion. */
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
    const mod = await import("/modules/lucd20-automations/scripts/systems/pf2e/rules.js");
    const T = mod._test;
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    const flagged = o => Object.assign(o, { getFlag(ns, k) { return foundry.utils.getProperty(this.flags, `${ns}.${k}`); }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; },
      async update(d) { for (const [k, v] of Object.entries(d)) foundry.utils.setProperty(this, k, v); } });
    // --- users: the GM (u1), the caster's player Pat (p1), another player (p2) ---
    const users = [{ id: "u1", name: "GM", isGM: true, active: true }, { id: "p1", name: "Pat", isGM: false, active: true, character: { id: "kyra" } }, { id: "p2", name: "Sam", isGM: false, active: true }];
    game.users = Object.assign(users, { get(id) { return this.find(u => u.id === id); }, activeGM: users[0] });
    // --- actors ---
    let n = 0;
    const actor = (id, name, owners = []) => {
      const a = { id, name, uuid: `Actor.${id}`, effects: [], testUserPermission: (u, level) => u.isGM || owners.includes(u.id),
        get itemTypes() { return { effect: this.effects, condition: [] }; },
        async createEmbeddedDocuments(type, list) { for (const d of list) this.effects.push(flagged({ id: `e${++n}`, ...foundry.utils.deepClone(d) })); },
        async deleteEmbeddedDocuments(type, ids) { this.effects = this.effects.filter(e => !ids.includes(e.id)); } };
      registry[a.uuid] = a;
      return a;
    };
    const kyra = actor("kyra", "Kyra", ["p1"]);
    const ogre = actor("ogre", "Ogre");
    registry["Actor.kyra.Item.td"] = { img: "td.webp", level: 1 };
    game.actors = Object.assign([kyra, ogre], { get(id) { return this.find(a => a.id === id); } });
    game.packs = { get: id => id === "pf2e.conditionitems" ? { getIndex: async () => [{ _id: "cl", name: "Clumsy" }, { _id: "en", name: "Enfeebled" }, { _id: "st", name: "Stupefied" }] } : null };
    game.time = { worldTime: 1000 };
    game.combat = { combatants: [{ actor: kyra, initiative: 17 }, { actor: ogre, initiative: 9 }] };
    // --- chat ---
    let m = 0;
    game.messages = Object.assign([], { get(id) { return this.find(x => x.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    window.ChatMessage = { create: async d => { const msg = flagged({ id: `c${++m}`, author: { id: game.user.id }, flags: {}, whisper: [], ...foundry.utils.deepClone(d) }); game.messages.push(msg); return msg; },
      getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
    const opts = ["item:slug:temporal-distortion", "item:defense:will"];
    const save = (id, outcome, extra = {}) => flagged({ id, author: { id: "u1" }, whisper: [], blind: false, speaker: {}, actor: ogre, token: { uuid: "Scene.s.Token.ogre", name: "Ogre", playersCanSeeName: true, hidden: false }, timestamp: Date.now(), rolls: [{}],
      flags: { pf2e: { context: { type: "saving-throw", actor: "ogre", outcome, options: opts }, origin: { actor: "Actor.kyra", uuid: "Actor.kyra.Item.td", castRank: 2 } } }, ...extra });
    window.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = window.__d4; return this; }
      async toMessage(data, o) { window.__rollMode = o?.rollMode; return ChatMessage.create({ ...data, rolls: [{ total: this.total }] }); } };
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    const text = c => c.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const cards = () => game.messages.filter(x => x.flags[M]?.temporalDistortion);
    const lines = () => game.messages.filter(x => x.content?.includes("lucd20-rule-note"));
    const clickCard = async card => { const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host); Hooks.callAll("renderChatMessageHTML", card, host); host.querySelector("[data-lucd20-td]")?.click(); await settle(); await settle(); };
    const out = {};

    // Waits for Dice So Nice on the save before the card.
    let release;
    game.modules.get = id => id === "dice-so-nice" ? { active: true } : undefined;
    game.dice3d = { waitFor3DAnimationByMessageID: () => new Promise(res => { release = res; }) };
    const s1 = save("s1", "failure"); game.messages.push(s1);
    Hooks.callAll("createChatMessage", s1); await settle();
    out.beforeDice = cards().length;
    release(); await settle();
    game.dice3d = null;
    const card1 = cards()[0];
    out.card = [text(card1), card1.whisper, card1.flags[M].temporalDistortion.user];
    // A d4 of 2: Enfeebled 1 for 4 rounds, from Kyra's turn.
    window.__d4 = 2;
    await clickCard(card1);
    const e1 = ogre.effects[0];
    out.effect = [ogre.effects.length, e1.name, e1.system.rules[0], e1.system.duration, e1.system.start.initiative, e1.system.context.origin.actor, e1.system.tokenIcon.show];
    out.result = [text(lines().at(-1)), lines().at(-1).whisper ?? "public", window.__rollMode, text(card1)];
    out.twice = await T.tdClaim({ cardId: card1.id }, "u1").then(() => "claimed", e => e.message);

    // Critical success: nothing.
    const s2 = save("s2", "criticalSuccess"); game.messages.push(s2); Hooks.callAll("createChatMessage", s2); await settle();
    out.critSuccess = cards().length;
    // Another spell's save: nothing.
    const other = save("s3", "failure"); other.flags.pf2e.context.options = ["item:slug:fear"]; other.flags.pf2e.origin = { actor: "Actor.kyra", rollOptions: [] };
    game.messages.push(other); Hooks.callAll("createChatMessage", other); await settle();
    out.otherSpell = cards().length;

    // Critical failure, a secret save, and a 4: the roller chooses; value 3 for 2 rounds; it replaces the first effect.
    const s4 = save("s4", "criticalFailure", { whisper: ["u1"] }); game.messages.push(s4); Hooks.callAll("createChatMessage", s4); await settle();
    const card2 = cards().at(-1);
    out.secretCard = card2.whisper;
    out.wrongPlayer = await T.tdClaim({ cardId: card2.id }, "p2").then(() => "claimed", e => e.message);
    // Pat rolls on their own client (here: the GM's handlers called as from Pat).
    out.patClaim = await T.tdClaim({ cardId: card2.id }, "p1");
    const roll = flagged({ id: "r4", author: { id: "p1" }, rolls: [{ total: 4 }], flags: { [M]: { temporalDistortionRoll: card2.id } } }); game.messages.push(roll);
    out.noChoice = await T.tdApply({ cardId: card2.id, rollId: "r4", choice: null }, "p1").then(() => "applied", e => e.message);
    await T.tdApply({ cardId: card2.id, rollId: "r4", choice: "stupefied" }, "p1");
    out.crit = [ogre.effects.length, ogre.effects[0].name, ogre.effects[0].system.rules[0].alterations[0].value, ogre.effects[0].system.rules[0].uuid, ogre.effects[0].system.duration.value];
    out.secretLines = lines().slice(-2).map(l => [text(l), l.whisper]);

    // The roll window on a 4 for the one who clicks.
    const s5 = save("s5", "success"); game.messages.push(s5); Hooks.callAll("createChatMessage", s5); await settle();
    window.__d4 = 4; window.__dialogMode = "clumsy";
    await clickCard(cards().at(-1));
    window.__dialogMode = "lock";
    out.chosen = [ogre.effects[0].name, ogre.effects[0].system.duration.value, text(lines().at(-1))];

    // A reroll of the save replaces a card nobody has rolled yet.
    const s6 = save("s6", "failure"); game.messages.push(s6); Hooks.callAll("createChatMessage", s6); await settle();
    const s7 = save("s7", "success"); game.messages.push(s7); Hooks.callAll("createChatMessage", s7); await settle();
    out.reroll = [text(cards().at(-2)), cards().at(-2).flags[M].temporalDistortion.done, !!cards().at(-1).flags[M].temporalDistortion.done];

    // Pat not connected: the GM rolls. A hidden name stays hidden.
    users[1].active = false;
    const s8 = save("s8", "failure"); s8.token.playersCanSeeName = false; game.messages.push(s8); Hooks.callAll("createChatMessage", s8); await settle();
    out.gmRolls = [text(cards().at(-1)), cards().at(-1).flags[M].temporalDistortion.user];
    users[1].active = true;

    // Start of a turn: an expired effect goes.
    ogre.effects[0].isExpired = true;
    await T.removeExpired({ combat: { combatants: [{ actor: kyra }, { actor: ogre }] } });
    out.expired = ogre.effects.length;

    // Off without a reload.
    await game.settings.set(M, "pf2eTemporalDistortion_enabled", false);
    const before = cards().length;
    const s9 = save("s9", "failure"); game.messages.push(s9); Hooks.callAll("createChatMessage", s9); await settle();
    out.off = cards().length - before;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.strictEqual(r.beforeDice, 0, "waits for Dice So Nice on the save");
  assert.deepStrictEqual(r.card, ["Temporal Distortion on Ogre: Pat rolls the d4. 1 Clumsy · 2 Enfeebled · 3 Stupefied · 4 you choose Roll d4", [], "p1"], "the card for the caster's player, public for a public save");
  assert.deepStrictEqual(r.effect, [1, "Temporal Distortion (Enfeebled 1)", { key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.en", alterations: [{ mode: "override", property: "badge-value", value: 1 }] },
    { value: 4, unit: "rounds", expiry: "turn-start", sustained: false }, 17, "Actor.kyra", false], "failure: Enfeebled 1 for 4 rounds from the caster's turn");
  assert.deepStrictEqual(r.result, ["Ogre is Enfeebled 1 for 4 rounds (d4: 2).", [], "publicroll", "Temporal Distortion on Ogre: Pat rolls the d4. 1 Clumsy · 2 Enfeebled · 3 Stupefied · 4 you choose Rolled: 2."], "the line and the card after the roll");
  assert.strictEqual(r.twice, "That d4 was already rolled.");
  assert.deepStrictEqual([r.critSuccess, r.otherSpell], [1, 1], "nothing on a critical success or for another spell");
  assert.deepStrictEqual(r.secretCard, ["p1", "u1"], "a secret save: the card to the player and the GMs only");
  assert.deepStrictEqual([r.wrongPlayer, r.patClaim, r.noChoice], ["Pat rolls this d4.", true, "That Temporal Distortion can no longer be resolved."]);
  assert.deepStrictEqual(r.crit, [1, "Temporal Distortion (Stupefied 3)", 3, "Compendium.pf2e.conditionitems.Item.st", 2], "critical failure: value 3 for 2 rounds; the earlier effect replaced");
  assert.deepStrictEqual(r.secretLines, [["Ogre is Stupefied 3 for 2 rounds (d4: 4, chosen).", ["u1"]], ["Ogre is Stupefied (d4: 4, chosen).", ["p1"]]], "secret: the value to the GMs only");
  assert.deepStrictEqual(r.chosen, ["Temporal Distortion (Clumsy 1)", 1, "Ogre is Clumsy 1 for 1 round (d4: 4, chosen)."], "a 4: the window's choice; success 1 round");
  assert.deepStrictEqual(r.reroll, ["Temporal Distortion on Ogre: Pat rolls the d4. 1 Clumsy · 2 Enfeebled · 3 Stupefied · 4 you choose Replaced by a new save.", true, false]);
  assert.deepStrictEqual(r.gmRolls, ["Temporal Distortion on the target: the GM rolls the d4. 1 Clumsy · 2 Enfeebled · 3 Stupefied · 4 you choose Roll d4", null]);
  assert.strictEqual(r.expired, 0, "an expired effect is removed");
  assert.strictEqual(r.off, 0, "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 38 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
