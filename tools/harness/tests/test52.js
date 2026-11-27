const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 53: Damage Estimate (PF2e and D&D 4e). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async system => {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(`http://localhost:8765/index.html?gm=1&system=${system}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };
  const p2 = await open("pf2e");
  const r = await p2.evaluate(async () => {
    const M = "lucd20-automations";
    const de = await import("/modules/lucd20-automations/scripts/features/damage-estimate.js");
    await import("/modules/lucd20-automations/scripts/systems/pf2e/damage-estimate.js");
    const e = f => { const x = de.estimate(f); return x && [x.min, x.avg, x.max]; };
    const out = {};
    out.math = [e("2d6 + 4"), e("2 × (1d8 + 4)"), e("(2)d8[fire] + 1d6kh"), e("d4 - 1"), e("1d6 + @x"), e("10 / 2")];
    const dialog = buttonHTML => { const root = document.createElement("div"); root.innerHTML = `<form><button type="submit">${buttonHTML}</button></form>`; Hooks.callAll("renderDamageModifierDialog", {}, root); return root.querySelector(".lucd20-de-line")?.textContent ?? null; };
    out.strike = dialog(`<span class="slashing damage instance color">2d8 + 4</span> + <span class="fire damage instance color">1d6 <i class="fa-fire icon"></i></span>`);
    out.persistent = dialog(`<span class="slashing damage instance color">1d4 - 3</span> + <span class="fire damage instance color">1d6 <i class="fa-duotone fa-hourglass icon"></i></span>`);
    // v0.90.1 (owner: "2d6 piercing + 2d6 bleed shows 4–24"): bleed apart, also when inside the instance.
    out.bleedOwn = dialog(`<span class="piercing damage instance color">2d6</span> + <span class="bleed damage instance color persistent">2d6</span>`);
    out.bleedInside = dialog(`<span class="piercing damage instance color">2d6 + <span class="bleed">2d6 <i class="fa-solid fa-hourglass-half"></i></span></span>`);
    out.bleedTooltip = dialog(`<span class="piercing damage instance color">2d6</span> + <span class="damage instance color" data-tooltip="Persistent Bleed">2d6</span>`);
    out.crit = dialog(`<span class="piercing damage instance color">2 × (1d8 + 4)</span>`);
    await game.settings.set(M, "damageEstimate_show", "average");
    out.average = dialog(`<span class="slashing damage instance color">2d6 + 4</span>`);
    await game.settings.set(M, "damageEstimate_show", "range");
    out.range = dialog(`<span class="slashing damage instance color">2d6 + 4</span>`);
    await game.settings.set(M, "damageEstimate_enabled", false);
    out.off = dialog(`<span class="slashing damage instance color">2d6 + 4</span>`);
    return out;
  });
  const p4 = await open("dnd4e");
  const r4 = await p4.evaluate(async () => {
    await import("/modules/lucd20-automations/scripts/systems/dnd4e/damage-estimate.mjs");
    const root = document.createElement("div");
    root.innerHTML = `<form><input name="bonus" value=""><div class="dialog-buttons"><button>Normal</button><button>Crit</button></div></form>`;
    document.body.append(root);
    const app = { rollConfig: { parts: ["1d10 + @mod"], partsCrit: ["14 + 1d6", "@bonus"], data: { mod: 4 } }, dialogData: { formula: "@damage + @bonus" }, buttons: [{ action: "normal" }] };
    Hooks.callAll("renderRollDialog", app, root);
    const out = { first: root.querySelector(".lucd20-de-line")?.textContent, place: root.querySelector(".lucd20-de-line")?.nextElementSibling?.className };
    const input = root.querySelector("input[name='bonus']"); input.value = "2"; input.dispatchEvent(new Event("input"));
    out.bonus = root.querySelector(".lucd20-de-line")?.textContent;
    const other = document.createElement("div"); other.innerHTML = `<div class="dialog-buttons"></div>`;
    Hooks.callAll("renderRollDialog", { rollConfig: {}, dialogData: { isD20Roll: true, formula: "1d20" } }, other);
    out.notDamage = !!other.querySelector(".lucd20-de-line");
    return out;
  });
  console.log(JSON.stringify(r), JSON.stringify(r4));
  assert.deepStrictEqual(r.math, [[6, 11, 16], [10, 17, 24], [3, 12.5, 22], [0, 1.5, 3], null, [5, 5, 5]], "the estimator");
  assert.strictEqual(r.strike, "Average 16.5 (7–26)", "the instances summed");
  for (const k of ["bleedOwn", "bleedInside", "bleedTooltip"]) assert.strictEqual(r[k], "Average 7 (2–12)Persistent: Average 7 (2–12)", `${k}: bleed is persistent, not in the range (${r[k]})`);
  assert.strictEqual(r.persistent, "Average 1 (1–1)Persistent: Average 3.5 (1–6)", "persistent apart; at least 1 damage");
  assert.strictEqual(r.crit, "Average 17 (10–24)", "the doubled critical");
  assert.deepStrictEqual([r.average, r.range, r.off], ["Average 11", "6–16", null], "the user's choice; off");
  assert.deepStrictEqual(r4, { first: "Average 9.5 (5–14)Crit: Average 17.5 (15–20)", place: "dialog-buttons", bonus: "Average 11.5 (7–16)Crit: Average 19.5 (17–22)", notDamage: false }, "4e: normal and crit, above the buttons; the Bonus field followed");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 53 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
