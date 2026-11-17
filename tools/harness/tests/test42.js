const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 43: PF2e rule 8, Shield Block prompts (with PF2e Toolbelt's Target Helper). */
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
    const sb = await import("/modules/lucd20-automations/scripts/systems/pf2e/shield-block.js");
    const out = {};
    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return this; } });
    const mkMsg = d => ({ id: `m${++mid}`, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); this.deleted = true; } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); return m; } };
    // Target Helper's API: the rows' targets.
    game.modules.get = id => (id === "pf2e-toolbelt" ? { active: true, api: { targetHelper: { getMessageTargets: m => m.__targets } } } : undefined);
    // Valeros: Shield Block, shield raised, the player's.
    const applied = [];
    const valeros = { id: "val", name: "Valeros", hasPlayerOwner: true, isOwner: true, items: [{ type: "feat", slug: "shield-block", name: "Shield Block" }],
      attributes: { shield: { name: "Steel Shield", raised: true, hardness: 5, hp: { value: 18, max: 20 }, broken: false, destroyed: false } },
      testUserPermission: u => u.id === "p1", applyDamage: async o => { applied.push([o.damage.total, o.shieldBlockRequest, o.outcome]); } };
    const c = { id: "cv", flags: { [M]: { reaction: { used: 0 } } }, getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } };
    const doc = { id: "tv", uuid: "Scene.s.Token.tv", name: "Valeros", actor: valeros, combatant: c };
    registry[doc.uuid] = doc;
    game.combat = { started: true, combatants: [c] }; c.combat = game.combat;
    const cards = () => game.messages.filter(m => m.flags[M]?.shieldBlock);
    const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const damage = (extra = {}) => { const m = mkMsg({ item: { name: "Bite" }, rolls: [{ total: 12, instances: [{ type: "piercing" }] }], flags: { pf2e: { context: { type: "damage-roll", options: ["origin:enemy"], outcome: "success" } } }, __targets: [doc], ...extra }); game.messages.push(m); return m; };

    const d1 = damage(); Hooks.callAll("createChatMessage", d1); await settle();
    const card = cards().at(-1);
    out.card = [cards().length, card.whisper, txt(card.content)];
    // Block: applies the damage with shield block, spends the reaction, marks Target Helper's row and the card.
    const host = document.createElement("div"); host.innerHTML = card.content; document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", card, host);
    host.querySelector('[data-lucd20-sb="block"]').click(); await settle(80);
    out.block = [applied.at(-1), { ...c.flags[M].reaction }, d1.flags["pf2e-toolbelt"]?.targetHelper?.applied?.tv?.[0], card.flags[M].shieldBlock.done, txt(card.content), card.whisper, card.speaker?.alias];
    // A second click does nothing.
    host.querySelector('[data-lucd20-sb="block"]').disabled = false; host.querySelector('[data-lucd20-sb="block"]').click(); await settle(60);
    out.once = applied.length;

    // No card: reaction spent; fire damage; shield lowered; no Shield Block.
    const n = cards().length;
    Hooks.callAll("createChatMessage", damage()); await settle();
    c.flags[M].reaction.used = 0;
    Hooks.callAll("createChatMessage", damage({ rolls: [{ total: 9, instances: [{ type: "fire" }] }] })); await settle();
    valeros.attributes.shield.raised = false; Hooks.callAll("createChatMessage", damage()); await settle(); valeros.attributes.shield.raised = true;
    valeros.items = []; Hooks.callAll("createChatMessage", damage()); await settle(); valeros.items = [{ type: "feat", slug: "shield-block", name: "Shield Block" }];
    out.none = cards().length - n;
    // A secret damage roll: the player's card leaves out the amount; the GM's has it.
    Hooks.callAll("createChatMessage", damage({ whisper: ["u1"] })); await settle();
    out.secret = cards().slice(-2).map(m => [m.whisper, txt(m.content).split(".")[0]]);
    // Secret damage, blocked from the player's copy: one compact card stays (revealed), the other copy goes.
    c.flags[M].reaction.used = 0;
    Hooks.callAll("createChatMessage", damage({ whisper: ["u1"] })); await settle();
    { const [p, g] = cards().slice(-2); const h = document.createElement("div"); h.innerHTML = p.content; document.body.append(h); Hooks.callAll("renderChatMessageHTML", p, h);
      h.querySelector('[data-lucd20-sb="block"]').click(); await settle(80);
      out.secretBlock = [[p.deleted ?? false, g.deleted ?? false].filter(Boolean).length, cards().filter(m => !m.deleted).at(-1).content.includes("lucd20-card-compact")]; }
    c.flags[M].reaction.used = 0;
    Hooks.callAll("createChatMessage", damage({ whisper: ["u1"] })); await settle();
    // Skip answers both copies.
    const pCard = cards().at(-2);
    const host2 = document.createElement("div"); host2.innerHTML = pCard.content; document.body.append(host2);
    Hooks.callAll("renderChatMessageHTML", pCard, host2);
    host2.querySelector('[data-lucd20-sb="skip"]').click(); await settle(80);
    out.skip = [cards().slice(-2).map(m => m.flags[M].shieldBlock.done), applied.length];

    await game.settings.set(M, "pf2eShieldBlock_enabled", false);
    const k = cards().length;
    Hooks.callAll("createChatMessage", damage()); await settle();
    out.off = cards().length - k;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.card, [1, ["p1", "u1"], "Shield Block Valeros is about to take 12 physical damage (Bite). Steel Shield: Hardness 5, HP 18/20. Block Skip"], "the card to the player and the GM, with the damage and the shield");
  assert.deepStrictEqual(r.block, [[12, true, "success"], { used: 1, source: "Shield Block" }, true, true, "Shield Block", [], "Valeros"], "Block: damage applied with shield block, reaction spent, Target Helper row and card marked");
  assert.strictEqual(r.once, 1, "once only");
  assert.strictEqual(r.none, 0, "no card: reaction spent, non-physical damage, shield lowered, no Shield Block");
  assert.deepStrictEqual(r.secret, [[["p1"], "Shield Block Valeros is about to take physical damage"], [["u1"], "Shield Block Valeros is about to take 12 physical damage (Bite)"]], "secret damage: no amount for the player");
  assert.deepStrictEqual(r.secretBlock, [1, true], "secret damage blocked: one copy goes, one compact card stays");
  assert.deepStrictEqual(r.skip, [[true, true], 2], "Skip answers both copies and applies nothing");
  assert.strictEqual(r.off, 0, "switched off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 43 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
