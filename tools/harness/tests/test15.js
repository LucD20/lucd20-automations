const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 14: Combat Tracker Window; Loot Pile free-spot placement helper. */
async function setupMocks(page) {
  await page.evaluate(() => {
    const sidebar = document.createElement("aside");
    sidebar.id = "sidebar";
    sidebar.style.cssText = "position:fixed;right:0;top:0;width:300px;height:100%;background:#333";
    document.body.append(sidebar);
    window.__opens = 0;
    class Popout {
      constructor() { this.rendered = false; this.element = null; }
      render() {
        if (!this.element) {
          this.element = document.createElement("div");
          this.element.className = "combat-popout";
          this.element.style.cssText = "position:fixed;left:100px;top:100px;width:280px;background:#555;border:1px solid #aaa;color:#fff";
          document.body.append(this.element);
        }
        this.element.innerHTML = __rows.map(r => `<div style="height:40px">${r}</div>`).join("");
        this.rendered = true;
        Hooks.callAll("renderEncounterTracker", this, this.element, {});
        return this;
      }
      setPosition({ left, top }) { this.element.style.left = `${left}px`; this.element.style.top = `${top}px`; }
      async close() { this.element.remove(); this.element = null; this.rendered = false; }
    }
    window.__rows = ["Valeros", "Goblin"];
    ui.combat = { popout: null, async renderPopout() { __opens++; this.popout ??= new Popout(); return this.popout.render(); } };
    canvas.scene = { id: "s1" };
    window.__mkCombat = (id, combatants = []) => ({ id, scene: canvas.scene, combatants });
    game.combats = [];
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await page.evaluate(() => { document.querySelector(".lucd20-hub").style.display = "none"; document.getElementById("core-config").style.display = "none"; });
    await setupMocks(page);
    return page;
  };
  const rect = page => page.$eval(".combat-popout", e => { const r = e.getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), top: Math.round(r.top) }; });

  // ---------- GM ----------
  let page = await open("gm=1");
  assert.ok(await page.evaluate(() => game.settings.get("lucd20-automations", "combatTrackerWindow_enabled")), "on by default");
  await page.evaluate(() => { const c = __mkCombat("c1"); game.combats.push(c); Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(300);
  let r = await rect(page);
  console.log("GM pop-out:", r);
  assert.strictEqual(r.right, 900 - 8, "against the sidebar's left edge");
  assert.strictEqual(r.bottom, 800 - 8, "at the bottom");
  // More rows → grows upward, stays anchored
  await page.evaluate(() => { __rows.push("Ezren", "Boss", "Orc"); ui.combat.popout.render(); });
  await page.waitForTimeout(100);
  r = await rect(page);
  assert.strictEqual(r.bottom, 792, "stays anchored to the bottom");
  await page.screenshot({ path: `${out}/p14-popout.png` });
  // Moved by hand → left alone
  await page.evaluate(() => ui.combat.popout.setPosition({ left: 50, top: 60 }));
  await page.evaluate(() => { __rows.push("Kobold"); ui.combat.popout.render(); });
  await page.waitForTimeout(100);
  r = await rect(page);
  assert.deepStrictEqual([r.left, r.top], [50, 60], "moved by hand: not re-anchored");
  // Delete → closes (we opened it)
  await page.evaluate(() => { const c = game.combats.pop(); Hooks.callAll("deleteCombat", c, {}, "u1"); });
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval(".combat-popout", e => e.length), 0, "closed on combat end");
  // Already open by the user → not ours → not closed
  await page.evaluate(() => ui.combat.renderPopout());
  await page.evaluate(() => { const c = __mkCombat("c2"); game.combats.push(c); Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const c = game.combats.pop(); Hooks.callAll("deleteCombat", c, {}, "u1"); });
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval(".combat-popout", e => e.length), 1, "user's own pop-out stays open");
  await page.evaluate(() => ui.combat.popout.close());
  // Other scene → nothing
  const before = await page.evaluate(() => __opens);
  await page.evaluate(() => { const c = { id: "c3", scene: { id: "s2" }, combatants: [] }; Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(50);
  assert.strictEqual(await page.evaluate(() => __opens), before, "combat on another scene: no pop-out");
  // closeOnEnd off
  await page.evaluate(() => game.settings.set("lucd20-automations", "combatTrackerWindow_closeOnEnd", false));
  await page.evaluate(() => { const c = __mkCombat("c4"); game.combats.push(c); Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const c = game.combats.pop(); Hooks.callAll("deleteCombat", c, {}, "u1"); });
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval(".combat-popout", e => e.length), 1, "close on end off: stays");

  // ---------- Placement helper (Loot Pile) ----------
  const spot = await page.evaluate(async () => {
    const { findFreeSpot } = await import("/modules/lucd20-automations/scripts/core/placement.js");
    const scene = { id: "s9", grid: { size: 100 }, dimensions: { width: 1000, height: 1000 },
      tokens: [{ x: 400, y: 400, width: 1, height: 1 }, { x: 500, y: 400, width: 1, height: 1 }, { x: 400, y: 500, width: 2, height: 1 }] };
    return [findFreeSpot({ x: 450, y: 450 }, 100, 100, { scene }), findFreeSpot({ x: 150, y: 150 }, 100, 100, { scene })];
  });
  console.log("free spots:", spot);
  assert.ok(![[400, 400], [500, 400], [400, 500], [500, 500]].some(([x, y]) => x === spot[0].x && y === spot[0].y), "not on a token");
  assert.ok(Math.max(Math.abs(spot[0].x - 400), Math.abs(spot[0].y - 400)) <= 100, "next to the centre");
  assert.deepStrictEqual(spot[1], { x: 100, y: 100 }, "free centre is used as is");

  // ---------- Player: only once a combatant is visible ----------
  page = await open("gm=0");
  await page.evaluate(() => { const c = __mkCombat("c1", [{ hidden: true, visible: false }]); game.combats.push(c); Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => __opens), 0, "only hidden combatants: no pop-out for players");
  await page.evaluate(() => { const c = game.combats[0]; const cb = { hidden: false, visible: true, parent: c }; c.combatants.push(cb); Hooks.callAll("createCombatant", cb, {}, "u1"); });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => __opens), 1, "pops out when a combatant becomes visible");
  await page.evaluate(() => ui.combat.popout.close());
  await page.evaluate(() => { const c = game.combats[0]; const cb = { visible: true, parent: c }; Hooks.callAll("updateCombatant", cb, {}, {}, "u1"); });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => __opens), 1, "closed by hand: not re-opened");
  // switched off
  await page.evaluate(() => game.settings.set("lucd20-automations", "combatTrackerWindow_enabled", false));
  await page.evaluate(() => { const c = __mkCombat("c5", [{ visible: true }]); Hooks.callAll("createCombat", c, {}, "u1"); });
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => __opens), 1, "off: nothing");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 14 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
