const { chromium } = require("playwright");
const assert = require("assert");

/** v0.84.0: Encounter Report (recording HP changes with sources, the end-of-combat card). */
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
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    const out = {};
    const er = await import(`/modules/${M}/scripts/features/encounter-report.js`);

    // 1. The report from recorded data.
    const data = {
      participants: {
        "A.kyra": { name: "Kyra", side: 1, hp: 30 }, "A.amiri": { name: "Amiri", side: 1, hp: 40 },
        "A.wolf": { name: "Wolf", side: 1, hp: 15, master: "A.kyra" },
        "A.ogre": { name: "Ogre", side: -1, hp: 60 }, "A.gob": { name: "Goblin", side: -1, hp: 20 }
      },
      events: [
        { round: 1, turn: "A.kyra", target: "A.ogre", amount: 10, kind: "damage", source: "A.kyra" },
        { round: 1, turn: "A.kyra", target: "A.ogre", amount: 8, kind: "damage", source: "A.amiri" },   // Amiri's reaction on Kyra's turn
        { round: 1, turn: "A.ogre", target: "A.kyra", amount: 12, kind: "damage", source: "A.ogre" },
        { round: 1, turn: "A.amiri", target: "A.gob", amount: 20, kind: "damage", source: "A.amiri" },
        { round: 1, turn: "A.amiri", target: "A.kyra", amount: 4, kind: "damage", source: "A.amiri" },  // splash on Kyra
        { round: 2, turn: "A.kyra", target: "A.kyra", amount: 6, kind: "heal", source: "A.kyra" },
        { round: 2, turn: "A.wolf", target: "A.ogre", amount: 8, kind: "damage", source: "A.wolf" },
        { round: 2, turn: "A.kyra", target: "A.ogre", amount: 5, kind: "damage", source: null }        // missed
      ]
    };
    const rep = er.buildReport(data);
    out.rows = rep.rows.map(x => `${x.name}|${x.damage}+${x.companions}|${x.pct}%|${x.onTurn}|${x.friendly}|${x.taken}|${x.healed}`);
    out.missed = rep.missed;

    // 2. Recording: a combat; HP changes with hints after (PF2e message) and before (4e buttons) the change.
    const mkActor = (id, name, hp) => ({ id, name, uuid: `Actor.${id}`, system: { attributes: { hp: { value: hp, max: hp, temp: 0 } } } });
    const kyra = mkActor("kyra", "Kyra", 30), ogre = mkActor("ogre", "Ogre", 60);
    // As Foundry saves an update: a JSON copy whose dotted keys become nested objects.
    const expand = v => {
      if (Array.isArray(v)) return v.map(expand);
      if (!v || typeof v !== "object") return v;
      const o = {};
      for (const [key, val] of Object.entries(v)) {
        const parts = key.split(".");
        let at = o;
        for (const part of parts.slice(0, -1)) at = (at[part] ??= {});
        at[parts.at(-1)] = expand(val);
      }
      return o;
    };
    const flags = {};
    const combat = {
      id: "c1", started: false, active: true, round: 0, scene: { name: "Cave" }, flags,
      combatants: [{ actor: kyra, token: { name: "Kyra", disposition: 1 } }, { actor: ogre, token: { name: "Ogre", disposition: -1 } }],
      get combatant() { return this.combatants[0]; },
      getFlag(ns, k) { return flags[ns]?.[k]; }, async setFlag(ns, k, v) { (flags[ns] ??= {})[k] = expand(v); }
    };
    game.combat = combat;
    game.combats = Object.assign([combat], { get: id => (id === "c1" ? combat : null) });
    game.actors = Object.assign([kyra, ogre], { get: id => [kyra, ogre].find(a => a.id === id) });
    const posted = [];
    window.ChatMessage = { getSpeaker: () => ({}), getWhisperRecipients: () => [], create: async d => { posted.push(d); return d; } };
    await game.settings.set(M, "encounterReport_enabled", true);
    await settle();
    // Foundry's order: combatStart while still round 0, then the update to round 1.
    Hooks.callAll("combatStart", combat, { round: 1, turn: 0 });
    await settle(50);
    out.startedEarly = !!flags[M]?.encounterReport;
    combat.round = 1; combat.started = true;
    Hooks.callAll("updateCombat", combat, { round: 1 });
    await settle(150);
    out.started = !!flags[M]?.encounterReport;
    // Kyra hits the ogre for 14 (PF2e: the message comes just after the HP change).
    ogre.system.attributes.hp.value = 46;
    Hooks.callAll("updateActor", ogre, {});
    await settle(50);
    Hooks.callAll("createChatMessage", { flags: { pf2e: { appliedDamage: { uuid: ogre.uuid, isHealing: false }, origin: { actor: kyra.uuid, uuid: "Actor.kyra.Item.sword", type: "weapon" } } } });
    // The ogre hits Kyra for 9 (a hint first, as the 4e buttons do).
    await er.noteSource(kyra.uuid, ogre.uuid, "damage");
    kyra.system.attributes.hp.value = 21;
    Hooks.callAll("updateActor", kyra, {});
    // The ogre's attack rolls: one hit, one miss (PF2e: the roll message's context.outcome).
    Hooks.callAll("createChatMessage", { actor: ogre, flags: { pf2e: { context: { type: "attack-roll", outcome: "success" } } } });
    Hooks.callAll("createChatMessage", { actor: ogre, flags: { pf2e: { context: { type: "attack-roll", outcome: "failure" } } } });
    // 3 damage to the ogre from nowhere (missed).
    await settle(50);
    ogre.system.attributes.hp.value = 43;
    Hooks.callAll("updateActor", ogre, {});
    await settle(2600);
    out.events = (flags[M].encounterReport.events ?? []).filter(e => e.kind !== "attack").map(e => `${e.target}<${e.source ?? "?"}:${e.amount}`);
    // The ogre goes down just before the combat ends: its save would reach a deleted combat (v0.84.6 bug).
    ogre.system.attributes.hp.value = 0;
    Hooks.callAll("updateActor", ogre, {});
    let saveAfterEnd = false;
    const realSet = combat.setFlag;
    // End of combat: the card.
    Hooks.callAll("deleteCombat", combat);
    combat.setFlag = async () => { saveAfterEnd = true; throw new Error("Cannot read properties of undefined (reading '_id')"); };
    await settle(300);
    const div = foundry.applications.instances.get("lucd20-encounter-report")?.element;
    out.card = [...(div?.querySelectorAll(".lpr-row:not(.lpr-foe)") ?? [])].map(row => ["Name", "Damage", "Percent", "OnTurn", "Friendly", "Taken", "Healed"]
      .map(k => row.querySelector(`[data-col="${k}"]`)?.querySelector("b")?.textContent ?? row.querySelector(`[data-col="${k}"]`)?.textContent.trim()).join("|"));
    out.tiles = [...(div?.querySelectorAll(".lpr-tile b") ?? [])].map(b => b.textContent);
    out.cardMissed = div?.querySelector(".lpr-missed")?.textContent.trim();
    out.noChat = posted.length === 0;
    const foe = div?.querySelector(".lpr-foe");
    out.foe = foe && ["Name", "Fate", "MaxHit", "BestTurn", "MaxTaken", "Hits"].map(k => foe.querySelector(`[data-col="${k}"]`)?.textContent.replace(/\s+/g, " ").trim()).join("|");
    out.saveAfterEnd = saveAfterEnd;
    combat.setFlag = realSet;
    // A name players can't see is never stored (the history is readable by every client).
    const f2 = {};
    const c2 = { id: "c2", started: true, active: true, round: 1, flags: f2, combatants: [{ actor: kyra, token: { name: "Kyra", disposition: 1 } }, { actor: ogre, token: { name: "Gorgut the Ogre", disposition: -1, playersCanSeeName: false } }],
      get combatant() { return this.combatants[0]; }, getFlag(ns, k) { return f2[ns]?.[k]; }, async setFlag(ns, k, v) { (f2[ns] ??= {})[k] = expand(v); } };
    game.combats = Object.assign([c2], { get: id => (id === "c2" ? c2 : null) });
    game.combat = c2;
    Hooks.callAll("updateCombat", c2, { round: 1 });
    await settle(100);
    out.hiddenName = JSON.stringify(f2[M]?.encounterReport ?? {}).includes("Gorgut") ? "leaked" : (f2[M]?.encounterReport?.participants ?? []).map(x => x.name).join(",");
    out.history = game.settings.get(M, "encounterReport_history").length;
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.rows, ["Amiri|28+0|35%|20|4|0|0", "Kyra|10+8|13%|23|0|16|6", "Wolf|8+0|10%|8|0|0|0"],
    "own damage; companions added to the master; % of 80 enemy HP; on-turn by the side; friendly fire; taken; healed");
  assert.strictEqual(r.missed, 5);
  assert.ok(!r.startedEarly && r.started, "recording starts once round 1 is applied");
  assert.deepStrictEqual(r.events, ["Actor.ogre<Actor.kyra:14", "Actor.kyra<Actor.ogre:9", "Actor.ogre<?:3"], "hint after, hint before, none");
  assert.deepStrictEqual(r.card, ["Kyra|14|23%|60|0|9|0"], "the party row (on her turn: her 14 + the unknown 3 and 43)");
  assert.deepStrictEqual(r.tiles, ["14", "9", "0", "1"], "damage dealt, taken, healed, rounds");
  assert.strictEqual(r.foe, "Ogre|Down in round 1|9Biggest hit|9Best turn|43Biggest hit taken|1/2Hits",
    "the enemy: biggest hit 9, best turn 9, biggest hit taken 43 (the unknown final blow: no name), 1 of 2 attacks hit, down in round 1");
  assert.strictEqual(r.hiddenName, "Kyra,Unknown creature", "a hidden name is never stored");
  assert.ok(!r.saveAfterEnd, "no save to a combat that has ended");
  assert.ok(r.noChat, "a window, no chat card");
  assert.strictEqual(r.cardMissed, "Missed damage: 46");
  assert.strictEqual(r.history, 1);
  console.log("PHASE 72 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
