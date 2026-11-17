const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 58: 4e grab riders (the Ravenous Wolf's Bite) and New Player Tips (Ranger). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const run = async (lang) => {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=dnd4e${lang ? `&lang=${lang}` : ""}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page.evaluate(async () => {
      const M = "lucd20-automations";
      const parse = await import("/modules/lucd20-automations/scripts/systems/dnd4e/movement/parse.mjs");
      const tips = await import("/modules/lucd20-automations/scripts/systems/dnd4e/hud/tips.mjs");
      const out = {};
      const power = hit => ({ system: { hit: { detail: hit } } });
      out.grab = [
        "1d6 + 4 damage, and the target is grabbed (escape DC 12).",
        "2d6 + 3 damage, and the wolf grabs the target.",
        "Dano 1d6 + 4 e o alvo fica agarrado (CD 12 para escapar).",
        "2d6 + 3 damage, or 3d6 + 3 against a grabbed target.",
        "1d6 + 4 damage, and the target is knocked prone."
      ].map(t => !!parse.grabRiderFor(power(t)));
      // Tips: a ranger on its turn.
      const quarry = { id: "hq", name: "Hunter's Quarry", system: { identifier: "ranger-hunters-quarry" } };
      const ranger = { id: "rg", uuid: "Actor.rg", name: "Pebraxeon", items: [quarry], system: { attributes: { hp: { value: 20 } } }, testUserPermission: () => true };
      const wolf = { id: "wf", uuid: "Actor.wf", effects: [] };
      canvas.tokens = { placeables: [{ name: "Ravenous Wolf", actor: wolf, document: { parent: null } }] };
      game.combat = { id: "c", started: true, round: 1, turn: 0, combatant: { actor: ranger } };
      out.noPrey = tips.tipFor(ranger);
      wolf.effects = [{ flags: { [M]: { kind: "quarry", source: "Actor.rg" } } }];
      out.prey = tips.tipFor(ranger)?.text;
      game.combat.combatant = { actor: { id: "other" } };
      out.notMyTurn = tips.tipFor(ranger);
      game.combat.combatant = { actor: ranger }; ranger.system.attributes.hp.value = 0;
      out.down = tips.tipFor(ranger);
      ranger.system.attributes.hp.value = 20;
      await game.settings.set(M, "dnd4eTips_ranger", false);
      out.off = tips.tipFor(ranger);
      await game.settings.set(M, "dnd4eTips_ranger", true);
      // The ping at the turn start: on the prey, for the GM (this user).
      const pings = [];
      canvas.scene = { id: "s" }; canvas.tokens.placeables[0].document.parent = canvas.scene; canvas.tokens.placeables[0].center = { x: 150, y: 250 };
      canvas.controls = { drawPing: (p) => pings.push(p) };
      tips.onTurnStart(game.combat);
      out.ping = pings;
      // --- v0.66.0: more tips ---
      canvas.grid = { size: 100 };
      const pow = (id, name, extra = {}) => ({ id, name, type: "power", system: { uses: { max: extra.max ?? 0, value: extra.value ?? 0 } } });
      const tok = (actor, i, j, disposition, extra = {}) => ({ name: actor.name, actor, document: { x: i * 100, y: j * 100, width: 1, height: 1, disposition, hidden: false, parent: canvas.scene, id: actor.id }, visible: true, id: actor.id, center: { x: i * 100 + 50, y: j * 100 + 50 } });
      const npc = (id, name, level, extra = {}) => ({ id, uuid: `Actor.${id}`, name, effects: [], items: [], system: { details: { level, role: { secondary: extra.minion ? "minion" : "standard" } }, attributes: { hp: { value: extra.hp ?? 30, max: extra.minion ? 1 : 30 } } } });
      const pc = (id, name, items, level = 3) => ({ id, uuid: `Actor.${id}`, name, items, effects: [], system: { details: { level }, attributes: { hp: { value: 30, max: 30 } } }, testUserPermission: () => true });
      const text = (a) => tips.tipsFor(a).map(t => t.key);
      // Ranger: an adjacent enemy → Nimble Strike; none → Twin Strike.
      const ranger2 = pc("r2", "Ranger", [quarry, pow("ns", "Nimble Strike"), pow("ts", "Twin Strike")]);
      const ogre = npc("og", "Ogre", 4), goblin = npc("gb", "Goblin", 1, { minion: true });
      canvas.tokens = { placeables: [tok(ranger2, 0, 0, 1), tok(ogre, 1, 0, -1)], get: id => canvas.tokens.placeables.find(t => t.id === id) };
      game.combat.combatant = { actor: ranger2 };
      out.rangerAdj = text(ranger2);
      canvas.tokens.placeables[1].document.x = 500;
      out.rangerFar = text(ranger2);
      // Warlock.
      const curse = { id: "wc", name: "Warlock's Curse", type: "feat", system: { identifier: "warlock-warlocks-curse" } };
      const warlock = pc("wl", "Warlock", [curse]);
      game.combat.combatant = { actor: warlock };
      canvas.tokens.placeables = [tok(warlock, 0, 0, 1), tok(ogre, 3, 0, -1)];
      out.warlock = tips.tipsFor(warlock).map(t => t.text);
      ogre.effects = [{ flags: { [M]: { kind: "curse", source: "Actor.wl" } } }];
      out.cursed = tips.tipsFor(warlock).map(t => t.text);
      ogre.effects = [];
      // Barbarian: two adjacent → Great Cleave; one within 3, none adjacent → Pressing Strike; else Charge or Pressing Strike.
      const fa = pow("fa", "Furious Assault", { max: 1, value: 1 }), sc = pow("sc", "Swift Charge");
      const barb = pc("bb", "Barbarian", [pow("gc", "Great Cleave"), { ...pow("ps", "Pressing Strike"), system: { identifier: "barbarian-01-pressing-strike", uses: {} } }, fa, sc]);
      game.combat.combatant = { actor: barb };
      const ogre2 = npc("o2", "Ogre 2", 4);
      canvas.tokens.placeables = [tok(barb, 0, 0, 1), tok(ogre, 1, 0, -1), tok(ogre2, 0, 1, -1)];
      out.cleave = text(barb);
      canvas.tokens.placeables = [tok(barb, 0, 0, 1), tok(ogre, 3, 0, -1)];
      out.pressing = text(barb);
      canvas.tokens.placeables = [tok(barb, 0, 0, 1), tok(ogre, 8, 0, -1)];
      out.charge = tips.tipsFor(barb).map(t => [t.key, t.blink?.basics]);
      // After a hit: Furious Assault (not against a minion); after the damage roll it goes.
      window.ChatMessage = { getSpeaker: () => ({}) };
      game.actors = Object.assign([barb, ranger2, warlock], { get(id) { return this.find(a => a.id === id); } });
      const speakerOf = a => ({ actor: a.id });
      tips.onAttack({}, { targetHit: [{ name: "Goblin", actor: goblin }], targetMissed: [] }, speakerOf(barb));
      out.minionHit = text(barb).includes("evt-furious");
      tips.onAttack({}, { targetHit: [{ name: "Ogre", actor: ogre }], targetMissed: [] }, speakerOf(barb));
      out.hit = tips.tipsFor(barb)[0]?.text;
      fa.system.uses.value = 0;
      tips.onAttack({}, { targetHit: [{ name: "Ogre", actor: ogre }], targetMissed: [] }, speakerOf(barb));
      out.spent = text(barb).includes("evt-furious");
      fa.system.uses.value = 1;
      tips.onAttack({}, { targetHit: [{ name: "Ogre", actor: ogre }], targetMissed: [] }, speakerOf(barb));
      tips.onDamage({ actor: barb });
      out.afterDamage = text(barb).includes("evt-furious");
      // An enemy dropped during the barbarian's turn: Swift Charge.
      tips.onHitPoints(ogre2, { system: { attributes: { hp: { value: 0 } } } });
      out.swift = tips.tipsFor(barb)[0]?.text;
      // Elf: a miss → Elven Accuracy.
      const elf = pc("el", "Elf", [pow("ea", "Elven Accuracy", { max: 1, value: 1 })]);
      game.actors = Object.assign([barb, ranger2, warlock, elf], { get(id) { return this.find(a => a.id === id); } });
      game.combat.combatant = { actor: elf };
      tips.onAttack({}, { targetHit: [], targetMissed: [{ name: "Ogre", actor: ogre }] }, speakerOf(elf));
      out.elf = tips.tipsFor(elf)[0]?.text;
      // Fox's Cunning: an attack message against the ranger, then the damage.
      const fox = pow("fc", "Fox's Cunning", { max: 1, value: 1 });
      ranger2.items.push(fox);
      canvas.tokens.placeables = [tok(ranger2, 0, 0, 1), tok(ogre, 1, 0, -1)];
      game.actors = Object.assign([barb, ranger2, warlock, elf, ogre], { get(id) { return this.find(a => a.id === id); } });
      tips.onAttackMessage({ speaker: { actor: "og" } }, [{ entry: { targetID: "r2" } }]);
      out.fox = tips.tipsFor(ranger2).map(t => t.key);
      tips.onDamageMessage({ rolls: [{ options: { hitTypeDamage: "normal" } }] });
      out.foxGone = tips.tipsFor(ranger2).map(t => t.key).includes("evt-fox");
      // --- v0.67.0: the owner's bard (Elf Bard 1, Virtue of Valor): names and ids from the uploaded sheet ---
      const bp = (id, name, identifier, extra = {}) => ({ id, name, type: extra.type ?? "power", system: { identifier, uses: { max: extra.max ?? "", value: extra.value ?? null } } });
      const bard = pc("bd", "Linkedin Eng", [
        bp("ea-feat", "Elven Accuracy", "elven-accuracy", { type: "feature" }), bp("ea", "Precisão Élfica", "precisao-elfica", { max: "1", value: 1 }),
        bp("mw", "Bard-Majestic Word", "bard-majestic-word", { max: "2", value: 1 }), bp("vm", "Bard 01-Vicious Mockery", "bard-01-vicious-mockery"),
        bp("mm", "Bard 01-Misdirected Mark", "bard-01-misdirected-mark"), bp("bl", "Bard 01-Blunder", "bard-01-blunder", { max: "1", value: 1 }),
        bp("ss", "Bard 01-Stirring Shout", "bard-01-stirring-shout", { max: "1", value: 1 })
      ], 1);
      game.actors = Object.assign([bard, ogre], { get(id) { return this.find(a => a.id === id); } });
      game.combat.combatant = { actor: bard };
      const ally = pc("al", "Barbarian", [], 1); ally.system.attributes.hp = { value: 10, max: 30 };
      const keys = () => tips.tipsFor(bard).map(t => t.key);
      // A bloodied ally 3 squares away, a foe next to it (Blunder: an ally within 2 of a foe within 5).
      canvas.tokens.placeables = [tok(bard, 0, 0, 1), tok(ally, 3, 0, 1), tok(ogre, 4, 0, -1)];
      out.bard1 = tips.tipsFor(bard).map(t => [t.key, t.blink?.powers]);
      // Blunder used up: the foe is next to an ally → Misdirected Mark.
      bard.items.find(i => i.id === "bl").system.uses.value = 0;
      out.bard2 = keys();
      // No ally near the foe: Vicious Mockery; a tough foe (level 3+, the bard is 1): Stirring Shout too.
      canvas.tokens.placeables = [tok(bard, 0, 0, 1), tok(ally, 0, 9, 1), tok(ogre, 6, 0, -1)];
      out.bard3 = keys();
      // Elven Accuracy: the power, not the feature of the same name.
      tips.onAttack({}, { targetHit: [], targetMissed: [{ name: "Ogre", actor: ogre }] }, { actor: "bd" });
      out.bardElf = tips.tipsFor(bard)[0]?.blink?.powers;
      return out;
    });
  };
  const en = await run();
  const pt = await run("pt-BR");
  console.log(JSON.stringify(en), JSON.stringify({ noPrey: pt.noPrey?.text, prey: pt.prey }));
  assert.deepStrictEqual(en.grab, [true, true, true, false, false], "grabbed on a hit (English, Portuguese); not 'against a grabbed target', not prone");
  assert.deepStrictEqual(en.noPrey, { key: "ranger-noPrey", text: "You don't have a prey. You can use Hunter's Quarry, as a minor action, to assign one.", blink: { tab: "minor", powers: ["hq"], basics: [] } }, "no prey: the reminder, Hunter's Quarry blinking");
  assert.strictEqual(en.prey, "Ravenous Wolf is your prey.");
  assert.deepStrictEqual([en.notMyTurn, en.down, en.off], [null, null, null], "not on another's turn, not when down, not when switched off");
  assert.deepStrictEqual(en.ping, [{ x: 150, y: 250 }], "the prey pinged at the turn start");
  assert.strictEqual(pt.noPrey?.text, "Você não possui uma presa. Você pode usar Hunter's Quarry, como uma ação mínima, para marcar uma presa.");
  assert.strictEqual(pt.prey, "Ravenous Wolf é a sua presa.");
  assert.deepStrictEqual(en.rangerAdj, ["ranger-noPrey", "ranger-nimble"], "an adjacent enemy: Nimble Strike");
  assert.deepStrictEqual(en.rangerFar, ["ranger-noPrey", "ranger-twin"], "none adjacent: Twin Strike");
  assert.deepStrictEqual(en.warlock, ["You haven't cursed anyone. Warlock's Curse: as a minor action, curse the nearest enemy you can see."]);
  assert.deepStrictEqual(en.cursed, ["Ogre is cursed."]);
  assert.deepStrictEqual([en.cleave, en.pressing], [["barb-cleave"], ["barb-pressing"]], "two adjacent: Great Cleave; one within 3: Pressing Strike");
  assert.deepStrictEqual(en.charge, [["barb-charge", ["charge"]]], "otherwise: charge (the Charge button blinks) or Pressing Strike");
  assert.strictEqual(en.minionHit, false, "not against a minion");
  assert.strictEqual(en.hit, "You hit Ogre: Furious Assault (free action) adds damage; tick it in the damage window.");
  assert.strictEqual(en.spent, false, "not when used up");
  assert.strictEqual(en.afterDamage, false, "gone after the damage roll");
  assert.strictEqual(en.swift, "Ogre 2 dropped: Swift Charge lets you charge another enemy.");
  assert.strictEqual(en.elf, "You missed Ogre: Elven Accuracy (free action) lets you reroll the attack.");
  assert.ok(en.fox.includes("evt-fox"), "attacked: Fox's Cunning");
  assert.strictEqual(en.foxGone, false, "gone once the damage is rolled");
  assert.deepStrictEqual(en.bard1, [["bard-word", ["mw"]], ["bard-blunder", ["bl"]], ["bard-shout", ["ss"]]], "Majestic Word for the bloodied ally; Blunder; Stirring Shout on a level-4 ogre");
  assert.deepStrictEqual(en.bard2, ["bard-word", "bard-mark", "bard-shout"], "Blunder used: Misdirected Mark (the foe is next to an ally)");
  assert.deepStrictEqual(en.bard3, ["bard-mock", "bard-shout"], "no ally near: Vicious Mockery; the ally out of 5 squares: no Majestic Word");
  assert.deepStrictEqual(en.bardElf, ["ea"], "Elven Accuracy points to the power (Precisão Élfica), not the feature");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 58 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
