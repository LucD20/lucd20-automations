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
      return out;
    });
  };
  const en = await run();
  const pt = await run("pt-BR");
  console.log(JSON.stringify(en), JSON.stringify({ noPrey: pt.noPrey?.text, prey: pt.prey }));
  assert.deepStrictEqual(en.grab, [true, true, true, false, false], "grabbed on a hit (English, Portuguese); not 'against a grabbed target', not prone");
  assert.deepStrictEqual(en.noPrey, { key: "ranger-noPrey", text: "You don't have a prey. You can use Hunter's Quarry, as a minor action, to assign one.", blink: { tab: "minor", powers: ["hq"] } }, "no prey: the reminder, Hunter's Quarry blinking");
  assert.strictEqual(en.prey, "Ravenous Wolf is your prey.");
  assert.deepStrictEqual([en.notMyTurn, en.down, en.off], [null, null, null], "not on another's turn, not when down, not when switched off");
  assert.deepStrictEqual(en.ping, [{ x: 150, y: 250 }], "the prey pinged at the turn start");
  assert.strictEqual(pt.noPrey?.text, "Você não possui uma presa. Você pode usar Hunter's Quarry, como uma ação mínima, para marcar uma presa.");
  assert.strictEqual(pt.prey, "Ravenous Wolf é a sua presa.");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 58 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
