const { chromium } = require("playwright");
const assert = require("assert");

/** v0.83.0: Party Load (PF2e party sheet; D&D 4e Party Stash). */
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const system of ["pf2e", "dnd4e"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=${system}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    out[system] = await page.evaluate(async (system) => {
      const M = "lucd20-automations";
      const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
      const r = {};
      const pl = await import(`/modules/${M}/scripts/features/party-load.js`);
      await game.settings.set(M, "partyLoad_enabled", true);
      await settle();
      if (system === "pf2e") {
        const B = (n) => ({ toLightUnits: () => Math.round(n * 10) });
        const member = (name, load, enc, max) => ({ name, inventory: { bulk: { value: B(load), encumberedAfter: enc, max } } });
        const bag = { name: "Bag of Holding (Type I)", system: { containerId: null, bulk: { ignored: 25 } }, capacity: { value: B(8) } };
        const party = { type: "party", members: [member("Amiri", 6, 9, 14), member("Kyra", 3.4, 7, 12), { name: "Familiar", inventory: { bulk: { value: B(0), encumberedAfter: Infinity, max: Infinity } } }],
          inventory: { bulk: { value: B(1) }, contents: [bag, { name: "Rope", system: { containerId: null, bulk: {} } }] } };
        game.actors = Object.assign(game.actors ?? [], { party });
        const mod = await import(`/modules/${M}/scripts/systems/pf2e/party-load.js`);
        const c = mod.compute(party);
        r.compute = { load: Math.round(c.load * 10) / 10, enc: c.encumbered, max: c.max, rows: c.rows.map(x => x.name), bags: c.bags.map(b => b.capacity) };
        r.format = [mod.formatBulk(3), mod.formatBulk(3.4), mod.formatBulk(0.4)];
        const root = document.createElement("form");
        root.innerHTML = `<div class="tab inventory"><div class="total-bulk"><span>Total Bulk 10</span></div></div>`;
        document.body.append(root);
        Hooks.callAll("renderPartySheetPF2e", { actor: party }, [root]);
        const bar = root.querySelector(".total-bulk + .lucd20-party-load");
        r.bar = { shown: !!bar, state: [...(bar?.classList ?? [])].find(x => x.startsWith("is-")), ticks: bar?.querySelectorAll(".lpl-tick").length, label: [...(bar?.querySelectorAll(".lpl-label > span") ?? [])].map(x => x.textContent.replace(/\s+/g, " ").trim()).join(" | ") };
        r.tooltip = bar?.dataset.tooltipHtml;
        // Over the encumbered tick → orange.
        party.members[0].inventory.bulk.value = B(30);
        Hooks.callAll("renderPartySheetPF2e", { actor: party }, [root]);
        r.heavy = [...root.querySelector(".lucd20-party-load").classList].find(x => x.startsWith("is-"));
        r.oneBar = root.querySelectorAll(".lucd20-party-load").length;
      } else {
        const mod = await import(`/modules/${M}/scripts/systems/dnd4e/party-stash.mjs`);
        const pc = (name, value, max, heavy) => ({ name, type: "Player Character", hasPlayerOwner: true, system: { encumbrance: { value, max, maxHeavy: heavy } } });
        const items = [
          { id: "b", type: "backpack", name: "Bag of Holding", system: { weight: 1, quantity: 1, container: null, capacity: { type: "weight", value: 200, weightless: true } } },
          { id: "g", type: "equipment", name: "Gold bars", system: { weight: 10, quantity: 3, container: "b" } },
          { id: "r", type: "equipment", name: "Rope", system: { weight: 10, quantity: 1, container: null } }
        ];
        const stash = { id: "stash", items };
        const actors = [pc("Bree", 60, 100, 200), pc("Dorn", 140, 160, 320), stash];
        game.actors = Object.assign(actors, { get: id => actors.find(a => a.id === id) });
        await game.settings.set(M, "lootPile_stashId", "stash").catch(() => {});
        try { game.settings.get(M, "lootPile_stashId"); } catch { r.noSetting = true; }
        const c = mod.partyLoad4e();
        r.compute = { load: c.load, enc: c.encumbered, max: c.max, stash: c.stash.load, bags: c.bags.map(b => b.capacity) };
        const div = document.createElement("div"); div.innerHTML = pl.partyLoadHTML();
        r.html = div.textContent.replace(/\s+/g, " ").trim();
      }
      return r;
    }, system);
    out[system].errors = errors;
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
  const p = out.pf2e, d = out.dnd4e;
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.compute, { load: 18.4, enc: 41, max: 51, rows: ["Amiri", "Kyra"], bags: [25] }, "members 9.4 + stash 1 + the bag's 8 ignored; limits 16 / 26 + 25");
  assert.deepStrictEqual(p.format, ["3", "3, 4L", "4L"]);
  assert.ok(p.bar.shown && p.bar.ticks === 2 && p.bar.state === "is-ok");
  assert.strictEqual(p.bar.label, "Party load 18, 4L / encumbered 41 | max 51");
  assert.ok(p.tooltip.includes("Amiri: 6 / 9 · max 14") && p.tooltip.includes("Bag of Holding (Type I): +25"));
  assert.strictEqual(p.heavy, "is-encumbered");
  assert.strictEqual(p.oneBar, 1, "redrawn, not doubled");
  assert.deepStrictEqual(d.errors, []);
  assert.deepStrictEqual(d.compute, { load: 241, enc: 460, max: 720, stash: 41, bags: [200] }, "PCs 200 + stash 41 (rope 10, bag 1 + its 30 inside); limits 260 / 520 + 200");
  assert.strictEqual(d.html, "Party load 241 lb / encumbered 460 lb max 720 lb", "the bar in pounds");
  console.log("PHASE 71 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
