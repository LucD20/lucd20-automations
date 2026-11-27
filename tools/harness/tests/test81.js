const { chromium } = require("playwright");
const assert = require("assert");

/** v0.91.0: PF2e rule 32, Aid: the card (ally, skill, DC), the roll, the effect on the ally. */
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
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    const aid = await import(`/modules/${M}/scripts/systems/pf2e/aid.js`);
    const out = {};
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    window.fromUuid = async uuid => (uuid.includes("AHMUpMbaVkZ5A1KX") ? { toObject: () => ({ type: "effect", name: "Effect: Aid", system: { rules: [{ key: "ChoiceSet", flag: "aidBonus" }] } }) } : null);
    game.users = Object.assign([{ id: "u1", isGM: true, active: true, targets: new Set() }, { id: "p1", isGM: false, active: true, targets: new Set() }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    const mkMsg = d => { const m = { id: `m${++mid}`, author: { id: game.user.id }, flags: {}, ...d,
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; },
      async update(u) { for (const [k, v] of Object.entries(u)) { if (k.startsWith("flags.")) foundry.utils.setProperty(this, k, v); else this[k] = v; } },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); } }; game.messages.push(m); return m; };
    window.ChatMessage = { getSpeaker: ({ token }) => ({ alias: token?.name }), create: async d => mkMsg(d) };
    await game.settings.set(M, "pf2eAid_enabled", true);
    await settle();

    const rolls = [];
    const stat = (label, mod, rank) => ({ label, mod, rank, roll: async (o) => { rolls.push([label, o.dc.value, o.extraRollOptions]); } });
    const created = [];
    const actor = (id, name, extra = {}) => ({ id, name, uuid: `Actor.${id}`, hasPlayerOwner: true, isOwner: true, testUserPermission: u => u.id === "p1",
      createEmbeddedDocuments: async (t, docs) => { created.push([id, docs[0]]); }, ...extra });
    const kyraA = actor("kyra", "Kyra", { perception: stat("Perception", 6, 1), skills: { athletics: stat("Athletics", 9, 3), diplomacy: stat("Diplomacy", 4, 1) },
      system: { proficiencies: { attacks: { martial: { rank: 4 } } } } });
    const valA = actor("val", "Valeros"), merA = actor("mer", "Merisiel");
    const scene = { id: "s" };
    const token = (id, a, disposition) => { const doc = { id, uuid: `Scene.s.Token.${id}`, name: a.name, actor: a, disposition, parent: scene };
      const t = { id, name: a.name, actor: a, document: doc }; doc.object = t; registry[doc.uuid] = doc; registry[a.uuid] = a; a.getActiveTokens = () => [t]; return t; };
    const tKyra = token("kyra", kyraA, 1), tVal = token("val", valA, 1), tMer = token("mer", merA, 1), tGob = token("gob", actor("gob", "Goblin"), -1);
    Object.assign(canvas, { ready: true, scene, grid: { size: 100 }, tokens: { placeables: [tKyra, tVal, tMer, tGob] } });
    const aidItem = { name: "Aid", slug: "aid", img: "aid.webp", _stats: { compendiumSource: "Compendium.pf2e.actionspf2e.Item.HCl3pzVefiv9ZKQW" } };
    const cards = () => game.messages.filter(m => m.flags[M]?.aid);
    const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const mount = (m) => { const h = document.createElement("div"); h.innerHTML = m.content; document.body.append(h); Hooks.callAll("renderChatMessageHTML", m, h); return h; };

    out.math = [aid.degreeOf(25, 10, 15), aid.degreeOf(15, 5, 15), aid.degreeOf(14, 19, 15), aid.degreeOf(14, 20, 15), aid.degreeOf(16, 1, 15), aid.degreeOf(4, 2, 15),
      aid.bonusFor(3, 2), aid.bonusFor(3, 3), aid.bonusFor(3, 4), aid.bonusFor(2, 4), aid.bonusFor(1, 4), aid.bonusFor(0, 1)];

    // No ally targeted: the card asks which (allies only, not the goblin, not Kyra).
    Hooks.callAll("createChatMessage", mkMsg({ item: aidItem, actor: kyraA, token: tKyra.document, author: { id: "p1" } })); await settle();
    let card = cards().at(-1);
    out.ask = [cards().length, card.whisper, txt(card.content), [...card.content.matchAll(/data-lucd20-aid="([^"]+)"/g)].map(m => m[1])];
    let h = mount(card);
    h.querySelector('[data-lucd20-aid="ally:Scene.s.Token.val"]').click(); await settle(60);
    h.remove();
    // Now the skill (her best, Athletics, preselected), the DC, Roll.
    h = mount(card);
    out.chosen = [card.flags[M].aid.ally, h.querySelector("[data-lucd20-aid-skill]").value, h.querySelector("[data-lucd20-aid-dc]").value, txt(card.content)];
    h.querySelector("[data-lucd20-aid-dc]").value = "18";
    h.querySelector('[data-lucd20-aid="roll"]').click(); await settle(60);
    out.rolled = [rolls.at(-1), card.flags[M].aid.dc];
    h.remove();
    // Her Athletics check (master) critically succeeds: +3 on Valeros, via PF2e's Effect: Aid with the choice preset.
    const check = (a, type, outcome, total, die, extra = {}) => mkMsg({ actor: a, rolls: [{ total, dice: [{ faces: 20, total: die }] }],
      flags: { pf2e: { context: { type, outcome, dc: { value: 18 }, options: ["action:aid"], domains: ["athletics", "skill-check"], ...extra } } } });
    Hooks.callAll("createChatMessage", check(kyraA, "skill-check", "criticalSuccess", 30, 16)); await settle(80);
    out.effect = [created.at(-1)?.[0], created.at(-1)?.[1]?.flags?.system?.rulesSelections?.aidBonus, created.at(-1)?.[1]?.name];
    out.done = [card.flags[M].aid.done, txt(card.content), card.whisper, txt(game.messages.at(-1).content)];

    // Targeted ally: straight to the skill. A Strike instead (vs the DC, the weapon's legendary rank): crit +4.
    game.users.get("p1").targets = new Set([tMer]);
    Hooks.callAll("createChatMessage", mkMsg({ item: aidItem, actor: kyraA, token: tKyra.document, author: { id: "p1" } })); await settle();
    card = cards().at(-1);
    out.targeted = card.flags[M].aid.ally;
    Hooks.callAll("createChatMessage", mkMsg({ actor: kyraA, item: { category: "martial" }, rolls: [{ total: 26, dice: [{ faces: 20, total: 12 }] }], flags: { pf2e: { context: { type: "attack-roll", outcome: "failure", options: [] } } } })); await settle(80);
    out.strike = [created.at(-1)?.[0], created.at(-1)?.[1]?.flags?.system?.rulesSelections?.aidBonus];

    // A critical failure: −1. A failure: no effect.
    Hooks.callAll("createChatMessage", mkMsg({ item: aidItem, actor: kyraA, token: tKyra.document, author: { id: "p1" } })); await settle();
    Hooks.callAll("createChatMessage", check(kyraA, "skill-check", "criticalFailure", 5, 1, { dc: { value: 15 } })); await settle(80);
    out.critFail = created.at(-1)?.[1]?.flags?.system?.rulesSelections?.aidBonus;
    const n = created.length;
    Hooks.callAll("createChatMessage", mkMsg({ item: aidItem, actor: kyraA, token: tKyra.document, author: { id: "p1" } })); await settle();
    Hooks.callAll("createChatMessage", check(kyraA, "skill-check", "failure", 12, 8, { dc: { value: 15 } })); await settle(80);
    out.fail = [created.length - n, cards().at(-1).flags[M].aid.done, txt(game.messages.at(-1).content)];

    // Cancel deletes the card; another user can't answer it.
    Hooks.callAll("createChatMessage", mkMsg({ item: aidItem, actor: kyraA, token: tKyra.document, author: { id: "p1" } })); await settle();
    card = cards().at(-1);
    game.users.push({ id: "p2", isGM: false, active: true });
    out.stranger = await aid._test.setCard({ card: card.id, cancel: true }, "p2");
    out.cancel = [await aid._test.setCard({ card: card.id, cancel: true }, "p1"), cards().includes(card)];
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.math, [3, 2, 1, 2, 1, 0, 2, 3, 4, 1, 0, -1], "degrees and bonuses");
  assert.strictEqual(r.ask[0], 1);
  assert.deepStrictEqual(r.ask[1], ["p1", "u1"], "to the aider's player and the GM");
  assert.ok(r.ask[2].includes("Who are you helping"), r.ask[2]);
  assert.deepStrictEqual(r.ask[3], ["ally:Scene.s.Token.val", "ally:Scene.s.Token.mer", "cancel"], "allies only");
  assert.deepStrictEqual(r.chosen.slice(0, 3), ["Scene.s.Token.val", "athletics", "15"], "the best skill, DC 15");
  assert.ok(r.chosen[3].includes("Helping Valeros"), r.chosen[3]);
  assert.deepStrictEqual(r.rolled, [["Athletics", 18, ["action:aid"]], 18], "rolled against the edited DC");
  assert.deepStrictEqual(r.effect, ["val", 3, "Effect: Aid"], "master, critical: +3 on Valeros");
  assert.ok(r.done[0] && r.done[1].includes("+3") && r.done[2].length === 0, `compact ${r.done}`);
  assert.ok(r.done[3].includes("Valeros gets +3"), r.done[3]);
  assert.strictEqual(r.targeted, "Scene.s.Token.mer", "the targeted ally");
  assert.deepStrictEqual(r.strike, ["mer", 4], "a Strike counts: 26 vs DC 15, legendary weapon: +4");
  assert.strictEqual(r.critFail, -1);
  assert.ok(r.fail[0] === 0 && r.fail[1] && r.fail[2].includes("no effect"), `failure ${r.fail}`);
  assert.strictEqual(r.stranger, false);
  assert.deepStrictEqual(r.cancel, [true, false], "Cancel deletes the card");
  console.log("PHASE 81 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
