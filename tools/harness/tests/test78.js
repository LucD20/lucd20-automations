const { chromium } = require("playwright");
const assert = require("assert");

/** v0.89.0: PF2e rules 26–30: Cringe, Set-Up Strike, Such a Disgrace!, Orc Ferocity, Orc Superstition. */
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
    const out = {};
    const imm = await import(`/modules/${M}/scripts/systems/pf2e/immunity.js`);
    const ofMod = await import(`/modules/${M}/scripts/systems/pf2e/orc-ferocity.js`);
    const osMod = await import(`/modules/${M}/scripts/systems/pf2e/orc-superstition.js`);
    const susMod = await import(`/modules/${M}/scripts/systems/pf2e/set-up-strike.js`);
    for (const f of ["pf2eCringe", "pf2eSetUpStrike", "pf2eSuchADisgrace", "pf2eOrcFerocity", "pf2eOrcSuperstition"]) await game.settings.set(M, `${f}_enabled`, true);
    await game.settings.set(M, "pf2eReactions_enabled", false);
    await settle(100);

    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    game.time = { worldTime: 1000 };
    let mid = 0;
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    Object.defineProperty(game.messages, "contents", { get() { return [...this]; } });
    const mkMsg = d => ({ id: `m${++mid}`, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; }, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); },
      async delete() { game.messages.splice(game.messages.indexOf(this), 1); this.deleted = true; } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; } };
    const txt = h => { const d = document.createElement("div"); d.innerHTML = (h ?? "").replace(/<[^>]+>/g, " "); return d.textContent.replace(/\s+/g, " ").trim(); };
    const click = async (m, sel) => { const h = document.createElement("div"); h.innerHTML = m.content; document.body.append(h); Hooks.callAll("renderChatMessageHTML", m, h); h.querySelector(sel).click(); await settle(120); h.remove(); };
    const conds = {};
    const actor = (id, name, { feats = [], owner = null, level = 5, hp = 30 } = {}) => {
      const items = feats.map((f, i) => ({ id: `${id}-f${i}`, type: "feat", img: "f.webp", sheet: { render() {} }, ...f, async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); } }));
      const a = { id, name, uuid: `Actor.${id}`, level, hasPlayerOwner: !!owner, isOwner: true, items, flags: {}, statuses: new Set(),
        system: { attributes: { hp: { value: hp, max: hp } }, details: { level: { value: level } } },
        testUserPermission: u => u.id === owner, hasCondition: s => (conds[id]?.[s] ?? 0) > 0,
        async increaseCondition(s) { (conds[id] ??= {})[s] = (conds[id][s] ?? 0) + 1; }, async decreaseCondition(s) { (conds[id] ??= {})[s] = 0; },
        toggled: [], async toggleRollOption(domain, option, itemId, value) { this.toggled.push([domain, option, value]); },
        getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; } };
      a.items.get = id2 => a.items.find(i => i.id === id2);
      a.itemTypes = { feat: a.items };
      for (const i of items) i.actor = a;
      return a;
    };
    const scene = { id: "s", grid: { distance: 5 } };
    const tok = (id, a, col, row, disposition) => { const d = { id, uuid: `Scene.s.Token.${id}`, name: a.name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, disposition, hidden: false, parent: scene }; registry[d.uuid] = d; registry[a.uuid] = a; return { id, document: d }; };
    const kobA = actor("kob", "Kobby", { owner: "p1", level: 4, feats: [{ name: "Cringe", slug: "cringe" }] });
    const ogreA = actor("ogre", "Ogre", { level: 6 });
    const cmdA = actor("cmd", "Brannoc", { owner: "p1", feats: [{ name: "Set-Up Strike", slug: "set-up-strike" }] });
    const allyA = actor("ally", "Amiri", { owner: "p1" });
    const dandyA = actor("dandy", "Lord Fop", { owner: "p1", feats: [{ name: "Such a Disgrace!", slug: "such-a-disgrace" }] });
    const orcA = actor("orc", "Grok", { owner: "p1", hp: 20, feats: [{ name: "Orc Ferocity", slug: "orc-ferocity", system: { frequency: { max: 1, per: "day", value: 1 } } }, { name: "Orc Superstition", slug: "orc-superstition" }] });
    const tKob = tok("kob", kobA, 2, 2, 1), tOgre = tok("ogre", ogreA, 3, 2, -1), tCmd = tok("cmd", cmdA, 2, 3, 1), tAlly = tok("ally", allyA, 4, 3, 1), tDandy = tok("dandy", dandyA, 2, 6, 1), tOrc = tok("orc", orcA, 14, 14, 1);
    Object.assign(canvas, { ready: true, scene, grid: { size: 100, distance: 5 }, tokens: { placeables: [tKob, tOgre, tCmd, tAlly, tDandy, tOrc] } });
    const post = d => { const m = mkMsg(d); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; };
    const flagged = k => game.messages.filter(m => m.flags[M]?.[k]);

    // ---------- Cringe ----------
    const crit = () => post({ token: tOgre.document, rolls: [{ total: 30, dice: [{ faces: 20, total: 15 }] }], flags: { pf2e: { context: { type: "attack-roll", outcome: "criticalSuccess", origin: { token: tOgre.document.uuid }, target: { token: tKob.document.uuid } } } } });
    crit(); await settle(120);
    const cc = flagged("cringe").at(-1);
    out.cringeCard = [flagged("cringe").length, txt(cc?.content), cc?.whisper];
    await click(cc, '[data-lucd20-cr="cringe"]');
    out.cringeAnswer = [txt(cc.content), kobA.toggled.map(t => t.join(":")), imm.immunitiesOf(ogreA, { kind: "cringe", by: kobA.uuid }).length];
    // The ogre's damage roll: the toggle goes off again.
    post({ token: tOgre.document, rolls: [], flags: { pf2e: { context: { type: "damage-roll", origin: { token: tOgre.document.uuid }, target: { token: tKob.document.uuid } } } } });
    await settle(700);
    out.cringeOff = kobA.toggled.map(t => t.join(":"));
    // Immune now: no card.
    const n1 = flagged("cringe").length; crit(); await settle(120);
    out.cringeImmune = flagged("cringe").length - n1;

    // ---------- Set-Up Strike ----------
    post({ token: tCmd.document, rolls: [{ total: 25 }], flags: { pf2e: { context: { type: "attack-roll", outcome: "success", options: ["item:melee", susMod.TAG], origin: { token: tCmd.document.uuid }, target: { token: tOgre.document.uuid } } } } });
    await settle(120);
    out.susOn = [conds.ogre?.["off-guard"] ?? 0, txt(game.messages.at(-1).content)];
    // The commander again: still off-guard (only an ally's attack spends it).
    post({ token: tCmd.document, rolls: [{ total: 20 }], flags: { pf2e: { context: { type: "attack-roll", outcome: "failure", options: ["item:melee"], origin: { token: tCmd.document.uuid }, target: { token: tOgre.document.uuid } } } } });
    await settle(120);
    out.susStill = conds.ogre?.["off-guard"];
    // An ally attacks (a miss): it goes.
    post({ token: tAlly.document, rolls: [{ total: 12 }], flags: { pf2e: { context: { type: "attack-roll", outcome: "failure", options: [], origin: { token: tAlly.document.uuid }, target: { token: tOgre.document.uuid } } } } });
    await settle(120);
    out.susGone = conds.ogre?.["off-guard"];
    // Again, then the commander's next turn: it goes.
    post({ token: tCmd.document, rolls: [{ total: 25 }], flags: { pf2e: { context: { type: "attack-roll", outcome: "criticalSuccess", options: [susMod.TAG], origin: { token: tCmd.document.uuid }, target: { token: tOgre.document.uuid } } } } });
    await settle(120);
    await susMod._test.onTurn({ combatant: { token: tCmd.document } });
    out.susTurn = conds.ogre?.["off-guard"];

    // ---------- Such a Disgrace! ----------
    // React starts the signature animation (PLAN §28): useSignature("suchADisgrace", dandy → saver). Playback is off
    // here (test 79 covers it); what is broadcast to the other clients is checked.
    await game.settings.set(M, "signatureSpells_enabled", true);
    await game.settings.set(M, "signatureSpells_suchADisgrace", true);
    await game.settings.set(M, "signatureSpells_show", false);
    await settle(150);
    const emits = []; game.socket.emit = (name, data) => emits.push(data);
    window.Roll = class { constructor(f) { this.formula = f; } async evaluate() { const mod = Number(this.formula.split("+")[1]); this.dice = [{ faces: 20, total: 15 }]; this.total = 15 + mod; return this; } };
    const save = (who, outcome, options) => post({ token: who.document, actor: who.document.actor, rolls: [{ total: 14, dice: [{ faces: 20, total: 6 }] }], flags: { pf2e: { context: { type: "saving-throw", outcome, options, dc: { value: 20 } } } } });
    save(tAlly, "failure", ["will", "mental", "saving-throw"]); await settle(150);
    const sd = flagged("disgrace").at(-1);
    out.sdCard = [flagged("disgrace").length, txt(sd?.content), sd?.whisper];
    await click(sd, '[data-lucd20-sd="react"]');
    const rr = flagged("disgrace").at(-1);
    out.sdReroll = [txt(sd.content), txt(rr.content), imm.immunitiesOf(allyA, { kind: "suchADisgrace" }).length];
    out.sdSignature = emits.filter(e => e?.type === "signatureUse").map(e => e.payload);
    await click(rr, '[data-lucd20-sd="reroll"]');
    out.sdResult = [txt(game.messages.filter(m => (m.content ?? "").includes("fa-dice-d20") && !m.flags[M]).at(-1)?.content), txt(rr.content)];
    // Not mental, a success, out of range, or immune: no card.
    const n2 = flagged("disgrace").length;
    save(tAlly, "failure", ["will"]); save(tAlly, "success", ["will", "mental"]); save(tOrc, "failure", ["will", "mental"]);
    const tCmd2 = tCmd; save(tCmd2, "failure", ["will", "mental"]); // in range, not immune: a card
    await settle(200);
    out.sdOthers = flagged("disgrace").length - n2;

    // ---------- Orc Ferocity ----------
    const change = { system: { attributes: { hp: { value: 0 } } } };
    Hooks.callAll("preUpdateActor", orcA, change, {}, "u1");
    await settle(200);
    out.of = [change.system.attributes.hp.value, conds.orc?.wounded ?? 0, orcA.items[0].system.frequency.value, txt(game.messages.at(-1).content)];
    // Used today: drops to 0 as normal.
    await settle(1600);
    const change2 = { system: { attributes: { hp: { value: 0 } } } };
    Hooks.callAll("preUpdateActor", orcA, change2, {}, "u1");
    out.ofSpent = change2.system.attributes.hp.value;

    // ---------- Orc Superstition ----------
    const Modifier = class { constructor(o) { Object.assign(this, o); } };
    game.pf2e = { ...(game.pf2e ?? {}), Modifier };
    const dlg = (options) => {
      const root = document.createElement("div");
      root.innerHTML = `<div class="window-content"><button class="roll">Roll</button></div>`;
      document.body.append(root);
      const check = { modifiers: [], push(m) { this.modifiers.push(m); }, delete(slug) { this.modifiers = this.modifiers.filter(m => m.slug !== slug); }, calculateTotal() {} };
      const app = { context: { type: "saving-throw", actor: orcA, options: new Set(options) }, check, element: root, render() {} };
      Hooks.callAll("renderCheckModifiersDialog", app, root);
      return { app, root };
    };
    const magic = dlg(["saving-throw", "will", "arcane"]);
    out.osTitle = txt(magic.root.querySelector(".lucd20-so")?.innerHTML ?? "");
    const box = magic.root.querySelector(".lucd20-so input");
    box.checked = true; box.dispatchEvent(new Event("change"));
    out.osOn = [magic.app.check.modifiers.map(m => `${m.slug}:${m.modifier}:${m.type}`), magic.app.context.options.has(osMod.TAG)];
    box.checked = false; box.dispatchEvent(new Event("change"));
    out.osOff = magic.app.check.modifiers.length;
    out.osMundane = !!dlg(["saving-throw", "fortitude"]).root.querySelector(".lucd20-so");
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.cringeCard, [1, "Cringe R Kobby Ogre critically hit you: damage −6. Cringe Skip", ["p1", "u1"]], "a crit on the kobold: its card, level 4 + 2");
  assert.deepStrictEqual(r.cringeAnswer, ["Cringe R Kobby −6 damage", ["strike-damage:cringe:true"], 1], "Cringe: PF2e's toggle on, the ogre immune");
  assert.deepStrictEqual(r.cringeOff, ["strike-damage:cringe:true", "strike-damage:cringe:false"], "after the damage roll: the toggle off");
  assert.strictEqual(r.cringeImmune, 0, "the ogre immune: no card");
  assert.deepStrictEqual(r.susOn, [1, "Ogre is off-guard against the next attack by one of Brannoc's allies (until Brannoc's next turn)."]);
  assert.strictEqual(r.susStill, 1, "the commander's own attack doesn't spend it");
  assert.strictEqual(r.susGone, 0, "an ally's attack (a miss) spends it");
  assert.strictEqual(r.susTurn, 0, "the commander's next turn ends it");
  assert.deepStrictEqual(r.sdCard, [1, "Such a Disgrace! R Lord Fop Amiri failed a Will save against a mental effect (failure). React Skip", ["p1", "u1"]]);
  assert.deepStrictEqual(r.sdReroll, ["Such a Disgrace! R Lord Fop Used", "Such a Disgrace! Amiri Lord Fop gives you a second chance: reroll the Will save, +1, keep the higher. Reroll (+1)", 1]);
  assert.deepStrictEqual(r.sdSignature, [{ spell: "suchADisgrace", scene: "s", caster: "dandy", targets: ["ally"] }], "React starts the signature: the dandy on the saver");
  assert.deepStrictEqual(r.sdResult, ["Amiri rerolls (Such a Disgrace!): 15 + 9 = 24; first roll 14; keeps 24. Now: success.", "Such a Disgrace! Amiri Kept 24"], "the reroll: +1, the higher kept, its degree");
  assert.strictEqual(r.sdOthers, 1, "not mental / a success / out of range: nothing; another ally in range: a card");
  assert.deepStrictEqual(r.of, [1, 1, 0, "Orc Ferocity: Grok stays at 1 HP (wounded +1)."], "0 HP rewritten to 1 before saving; wounded +1; the daily use spent");
  assert.strictEqual(r.ofSpent, 0, "used today: no more");
  assert.ok(/^Feats for this save 0 on Orc Superstition/.test(r.osTitle), r.osTitle);
  assert.deepStrictEqual(r.osOn, [["lucd20-orc-superstition:1:circumstance"], true], "+1 circumstance at once, the roll tagged");
  assert.strictEqual(r.osOff, 0);
  assert.ok(!r.osMundane, "not against magic: not offered");
  console.log("PHASE 78 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
