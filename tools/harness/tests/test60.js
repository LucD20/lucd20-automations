const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 62: Creature Scale — an NPC sheet's numbers coloured by GM Core's creature-building tables. */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const run = async (gm) => {
    const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?gm=${gm ? 1 : 0}&system=pf2e`);
    await page.waitForFunction(() => window.__done);
    const result = await page.evaluate(async () => {
      document.querySelector(".lucd20-hub").style.display = "none";
      document.getElementById("core-config").style.display = "none";
      // A level-5 NPC sheet with the elements PF2e's NPC sheet has (the original module's selectors).
      const root = document.createElement("form");
      root.className = "npc-sheet";
      root.style.cssText = "position:absolute;left:10px;top:10px;width:720px;padding:10px;background:#e8e1d1;color:#222;font:14px sans-serif";
      const input = (prop, v) => `<label>${prop.split(".").at(-2)} <input type="text" data-property="${prop}" value="${v}" style="width:46px"></label> `;
      root.innerHTML = `
        <header><div class="adjustments"><a class="elite">Elite</a> <a class="weak">Weak</a></div></header>
        <div>${input("system.attributes.ac.value", 22)}${input("system.attributes.hp.max", 60)}${input("system.perception.mod", 17)}
          ${input("system.saves.fortitude.value", 14)}${input("system.saves.reflex.value", 7)}${input("system.saves.will.value", 12)}</div>
        <div>${["str", "dex", "con", "int", "wis", "cha"].map((a, i) => input(`system.abilities.${a}.mod`, [5, 2, 4, -1, 0, 6][i])).join("")}</div>
        <div class="skills section-container"><div class="list">
          <div class="skill-entry" data-statistic="athletics"><a>Athletics +13</a></div>
          <div class="skill-entry" data-statistic="diplomacy"><a>Diplomacy +11</a></div></div></div>
        <ul><li data-weakness="fire">Weakness fire 6</li><li data-resistance="physical">Resistance physical 5</li><li data-resistance="cold">Resistance cold 4</li></ul>
        <ol class="strikes-list">
          <li class="item action" data-action-index="0">Jaws <button data-action="strike-attack" data-variant-index="0">+15</button><button data-action="strike-attack" data-variant-index="1">+10</button> <button data-action="strike-damage">2d6+6</button></li>
          <li class="item action" data-action-index="1">Spit <button data-action="strike-attack" data-variant-index="0">+13</button> <button data-action="strike-damage">2d6+6 + 1d6 persistent</button></li>
        </ol>
        <div class="tab spells"><ol><li class="spellcasting-entry" data-item-id="sc1"><div class="spellAttack"><label>Attack +14</label></div><div class="spellDC"><label>DC 22</label></div></li>
          <li class="spellcasting-entry" data-item-id="rit"><div class="spellAttack"><label>Rituals</label></div></li></ol></div>`;
      document.body.append(root);
      const actor = {
        type: "npc", name: "Cave Drake", level: 5, attributes: { adjustment: null },
        _source: { system: { attributes: { ac: { value: 22 }, hp: { max: 60 } }, perception: { mod: 17 }, saves: { fortitude: { value: 14 }, reflex: { value: 7 }, will: { value: 12 } },
          abilities: { str: { mod: 5 }, dex: { mod: 2 }, con: { mod: 4 }, int: { mod: -1 }, wis: { mod: 0 }, cha: { mod: 6 } } } },
        skills: { athletics: { base: 13 }, diplomacy: { base: 11 } },
        system: { attributes: { weaknesses: [{ type: "fire", value: 6 }], resistances: [{ type: "physical", value: 5 }, { type: "cold", value: 4 }] },
          actions: [{ item: { system: { bonus: { value: 15 }, damageRolls: { a: { damage: "2d6+6", category: null } } } } },
            { item: { system: { bonus: { value: 13 }, damageRolls: { a: { damage: "2d6+6" }, b: { damage: "1d6", category: "persistent" } } } } }] },
        spellcasting: new Map([["sc1", { system: { spelldc: { value: 14, dc: 22 } } }], ["rit", { system: {} }]])
      };
      const renders = [];
      const sheet = { actor, options: { classes: ["pf2e", "actor", "npc"] }, render: () => renders.push(1) };
      ui.windows = { 1: sheet };
      Hooks.callAll("renderActorSheetPF2e", sheet, [root]);
      await new Promise(r => setTimeout(r, 150));
      const scale = (sel) => root.querySelector(sel)?.dataset.lucd20Scale ?? null;
      const prop = (p) => scale(`input[data-property="${p}"]`);
      const out = {
        main: ["system.attributes.ac.value", "system.attributes.hp.max", "system.perception.mod", "system.saves.fortitude.value", "system.saves.reflex.value", "system.saves.will.value"].map(prop),
        abilities: ["str", "dex", "con", "int", "wis", "cha"].map(a => prop(`system.abilities.${a}.mod`)),
        skills: [scale('[data-statistic="athletics"] a'), scale('[data-statistic="diplomacy"] a')],
        iwr: [scale('li[data-weakness="fire"]'), scale('li[data-resistance="physical"]'), scale('li[data-resistance="cold"]')],
        strikes: [scale('[data-action-index="0"] button[data-variant-index="0"]'), scale('[data-action-index="0"] button[data-action="strike-damage"]'),
          scale('[data-action-index="1"] button[data-action="strike-damage"]'), scale('[data-action-index="0"] button[data-variant-index="1"]')],
        spells: [scale(".spellAttack label"), scale(".spellDC label")],
        marked: root.querySelectorAll(".lucd20-cs").length,
        tooltip: root.querySelector('input[data-property="system.attributes.ac.value"]').dataset.tooltipHtml ?? "",
        tooltipHp: root.querySelector('input[data-property="system.attributes.hp.max"]').dataset.tooltipHtml ?? "",
        switch: root.querySelector(".lucd20-cs-switch") && { active: root.querySelector(".lucd20-cs-switch").classList.contains("active"), beforeElite: root.querySelector(".lucd20-cs-switch").nextElementSibling?.classList.contains("elite") }
      };
      const { _test } = await import("/modules/lucd20-automations/scripts/systems/pf2e/creature-scale.js");
      out.avg = ["2d6+6", "1d8+4", "3d6", "2d4+1d6+2", "(1d6+2)*2", "1d6+@actor.level", "alert('x')"].map(f => _test.averageOf(f));
      window.__root = root; window.__sheet = sheet; window.__renders = renders;
      return out;
    });
    await page.screenshot({ path: `${out}/p62-scale-${gm ? "gm" : "player"}.png` });
    // The switch: off → marks gone; Elite → none.
    const after = await page.evaluate(async () => {
      const root = window.__root, sheet = window.__sheet;
      root.querySelector(".lucd20-cs-switch")?.click();
      await new Promise(r => setTimeout(r, 20));
      const rerendered = window.__renders.length;
      Hooks.callAll("renderActorSheetPF2e", sheet, [root]);
      const off = { marked: root.querySelectorAll(".lucd20-cs").length, active: root.querySelector(".lucd20-cs-switch")?.classList.contains("active") };
      await game.settings.set("lucd20-automations", "pf2eCreatureScale_show", true);
      sheet.actor.attributes.adjustment = "elite";
      Hooks.callAll("renderActorSheetPF2e", sheet, [root]);
      const elite = { marked: root.querySelectorAll(".lucd20-cs").length, tip: root.querySelector(".lucd20-cs-switch")?.dataset.tooltip ?? null };
      return { rerendered, off, elite };
    });
    return { ...result, after };
  };

  const gm = await run(true);
  console.log(JSON.stringify(gm));
  assert.deepStrictEqual(gm.main, ["High", "Low", "Extreme", "High", "Terrible", "Moderate"]);
  assert.deepStrictEqual(gm.abilities, ["High", "Low", "Moderate", "Terrible", "Terrible", "Extreme"]);
  assert.deepStrictEqual(gm.skills, ["High", "Moderate"], "a tie goes to the middle (11: Low 10 / Moderate 12)");
  assert.deepStrictEqual(gm.iwr, ["Moderate", "Extreme", "Low"], "physical resistance counts double");
  assert.deepStrictEqual(gm.strikes, ["High", "Moderate", "Extreme", null], "persistent ×1.5; MAP buttons left alone");
  assert.deepStrictEqual(gm.spells, ["High", "High"], "rituals skipped");
  assert.strictEqual(gm.marked, 23, "6 main + 6 attributes + 2 skills + 3 IWR + 2 Strikes × 2 + 2 spellcasting");
  assert.match(gm.tooltip, /\+?22 AC is exactly High/);
  assert.match(gm.tooltip, /Level 4.*Level 5.*Level 6/s, "three table rows");
  assert.match(gm.tooltipHp, /60 HP is Low \(1 above 59\)/);
  assert.match(gm.tooltipHp, /53/, "HP rows shown as the book's ranges");
  assert.deepStrictEqual(gm.switch, { active: true, beforeElite: true });
  assert.deepStrictEqual(gm.avg.slice(0, 5), [13, 8.5, 10.5, 10.5, 11]);
  assert.ok(gm.avg.slice(5).every(Number.isNaN), "anything but dice and arithmetic is skipped");
  assert.ok(gm.after.rerendered >= 1, "the switch re-draws open NPC sheets");
  assert.deepStrictEqual(gm.after.off, { marked: 0, active: false });
  assert.strictEqual(gm.after.elite.marked, 0, "Elite / Weak left alone");
  assert.match(gm.after.elite.tip, /Elite and Weak/);

  const player = await run(false);
  assert.strictEqual(player.marked, 0, "players see nothing");
  assert.strictEqual(player.switch, null);
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 62 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
