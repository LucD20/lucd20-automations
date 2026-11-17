const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 49: PF2e sustained spells. */
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
    for (const f of ["pf2eFlatCheck", "pf2eReactions", "pf2eFrightened", "pf2eSickened", "pf2eTemporalDistortion", "pf2eRoaringHeart", "pf2eDemoralizingCharge"]) await game.settings.set(M, `${f}_enabled`, false);
    const sus = await import("/modules/lucd20-automations/scripts/systems/pf2e/sustain.js");
    const out = {};
    out.limits = ["1 minute", "sustained up to 1 minute", "10 minutes", "3 rounds", "until the end of your next turn", ""].map(sus._test.limitRounds);
    const registry = {};
    window.fromUuidSync = u => registry[u];
    let mid = 0, eid = 0;
    game.users = Object.assign([{ id: "u1", isGM: true, active: true }, { id: "p1", isGM: false, active: true }], { get(id) { return this.find(u => u.id === id); } });
    game.messages = Object.assign([], { get(id) { return this.find(m => m.id === id); } });
    const mkMsg = d => ({ id: `m${++mid}`, flags: {}, whisper: [], ...d, getFlag(ns, k) { return this.flags[ns]?.[k]; },
      async update(u) { for (const [k, v] of Object.entries(u)) foundry.utils.setProperty(this, k, v); }, async delete() { game.messages.splice(game.messages.indexOf(this), 1); } });
    window.ChatMessage = { getSpeaker: () => ({}), create: async d => { const m = mkMsg(d); game.messages.push(m); Hooks.callAll("createChatMessage", m); return m; } };
    const ezren = { id: "ez", name: "Ezren", hasPlayerOwner: true, testUserPermission: u => u.id === "p1", effects: [],
      get itemTypes() { return { effect: this.effects }; },
      async createEmbeddedDocuments(t, list) { for (const d of list) { const e = { id: `e${++eid}`, uuid: `Actor.ez.Item.e${eid}`, parent: this, ...d,
        getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { this.flags[ns][k] = v; }, async delete() { ezren.effects = ezren.effects.filter(x => x !== this); delete registry[this.uuid]; } };
        registry[e.uuid] = e; this.effects.push(e); } } };
    const tokenDoc = { id: "t", name: "Ezren", hidden: false, actor: ezren };
    ezren.getActiveTokens = () => [{ document: tokenDoc }];
    const c = { id: "c-ez", actor: ezren, token: tokenDoc }, other = { id: "c-o", actor: { name: "Ogre", effects: [], itemTypes: { effect: [] } } };
    game.combat = { id: "cb", started: true, round: 1, turn: 0, combatant: c, combatants: Object.assign([c, other], { get: id => [c, other].find(x => x.id === id) }) };
    const spell = (name, duration, sustained = true) => ({ type: "spell", name, slug: name.toLowerCase(), img: `${name}.webp`, uuid: `Item.${name}`, rank: 2, system: { duration: { value: duration, sustained }, description: { value: "" } } });
    const cast = (s, casting = true) => ChatMessage.create({ actor: ezren, item: s, flags: { pf2e: casting ? { casting: { id: "x" }, origin: { castRank: 3 } } : {} } });
    const turn = (round, t, who) => { Object.assign(game.combat, { round, turn: t, combatant: who }); Hooks.callAll("updateCombat", game.combat, { turn: t, round }, {}, "u1"); };
    const cards = () => game.messages.filter(m => m.flags[M]?.sustainCard);
    const txt = h => (h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const click = async (m, value, n = 0) => { const host = document.createElement("div"); host.innerHTML = m.content; document.body.append(host); Hooks.callAll("renderChatMessageHTML", m, host); host.querySelectorAll(`[data-lucd20-sus="${value}"]`)[n].click(); await settle(100); host.remove(); };
    turn(1, 0, c); await settle();
    // Cast: one effect per cast; posted or not sustained: nothing.
    await cast(spell("Laughing Fit", "1 minute")); await cast(spell("Laughing Fit", "1 minute")); await cast(spell("Fireball", "", false)); await cast(spell("Figment", "1 minute"), false); await settle();
    out.effects = ezren.effects.map(e => [e.name, e.system.duration.value, e.system.level.value, e.flags[M].sustain.ends, e.flags[M].sustain.sustained]);
    // The turn it was cast ends: no question.
    turn(1, 1, other); await settle(120); out.noAsk = cards().length;
    // Next turn: the reminder, two lines; Sustain one, End the other.
    turn(2, 0, c); await settle(120);
    out.remind = [cards().length, txt(cards()[0]?.content), cards()[0]?.whisper];
    await click(cards()[0], "sustain", 0);
    out.afterSustain = [txt(cards()[0]?.content), ezren.effects.map(e => e.flags[M].sustain.sustained)];
    await click(cards()[0], "end", 0);
    out.afterEnd = [cards().length, ezren.effects.length, txt(game.messages.at(-1).content)];
    // Cast again; next turn not sustained: asked at the turn's end; No ends it; Yes keeps it.
    await cast(spell("Figment", "1 minute")); await settle();
    turn(2, 1, other); await settle(120); turn(3, 0, c); await settle(120);
    out.reminders = cards().length;
    turn(3, 1, other); await settle(120);
    out.ask = [cards().length, txt(cards().at(-1)?.content)];
    await click(cards().at(-1), "yes", 1);
    out.yes = [cards().length, ezren.effects.length];
    turn(4, 0, c); await settle(120); turn(4, 1, other); await settle(120);
    await click(cards().at(-1), "no", 0);
    out.no = [cards().length, ezren.effects.map(e => e.name), txt(game.messages.at(-1).content)];
    // The Sustain action from the sheet: the only one waiting.
    turn(5, 0, c); await settle(120);
    await ChatMessage.create({ actor: ezren, item: { type: "action", slug: "sustain" }, flags: {} }); await settle();
    out.action = [cards().length, ezren.effects[0].flags[M].sustain.sustained];
    // The limit: ends at the start of a turn.
    ezren.effects[0].flags[M].sustain.ends = 6;
    turn(5, 1, other); await settle(120); turn(6, 0, c); await settle(120);
    out.expired = [ezren.effects.length, txt(game.messages.filter(m => !m.flags[M]?.sustainCard).at(-1).content)];
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.limits, [10, 10, 100, 3, null, null], "limits in rounds");
  assert.deepStrictEqual(r.effects, [["Sustaining: Laughing Fit", 10, 3, 11, true], ["Sustaining: Laughing Fit", 10, 3, 11, true]], "one effect per cast, the limit, the cast rank; not posted or unsustained spells");
  assert.strictEqual(r.noAsk, 0, "the turn it was cast needs no Sustain");
  assert.deepStrictEqual(r.remind, [1, "Laughing Fit Sustain End Laughing Fit Sustain End", ["p1", "u1"]], "the reminder: one line per spell, to the player and the GM");
  assert.deepStrictEqual(r.afterSustain, ["Laughing Fit Sustain End", [true, false]], "Sustain: its line goes");
  assert.deepStrictEqual(r.afterEnd, [0, 1, "Laughing Fit ended."], "End: the effect and the card go, a line says so");
  assert.strictEqual(r.reminders, 1, "the next reminder (the sustained one was not asked about)");
  assert.deepStrictEqual(r.ask, [1, "Was Laughing Fit sustained? Yes No Was Figment sustained? Yes No"], "not sustained by the turn's end: asked; the reminder goes");
  assert.deepStrictEqual(r.yes, [1, 2], "Yes keeps it");
  assert.deepStrictEqual(r.no, [1, ["Sustaining: Figment"], "Laughing Fit ended (not sustained)."], "No ends it");
  assert.deepStrictEqual(r.action, [0, true], "the Sustain action sustains the only one waiting");
  assert.deepStrictEqual(r.expired, [0, "Figment ended (its duration ran out)."], "the limit ends it");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 49 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
