const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 15: Combat Movement, Paused Movement Notice (shared movement block). */
async function setupMocks(page) {
  await page.evaluate(() => {
    Hooks.call = function (n, ...a) { for (const h of this._h[n] ?? []) if (h.f(...a) === false) return false; return true; };
    window.__texts = [];
    window.__sent = [];
    game.socket.emit = (name, msg) => __sent.push(msg);
    CONST.TEXT_ANCHOR_POINTS = { TOP: 2 };
    const mkToken = (id, owned, visible = true) => {
      const doc = { id, parent: { id: "s1" }, isOwner: owned };
      const obj = { document: doc, visible, center: { x: 50, y: 50 } };
      doc.object = obj;
      return obj;
    };
    window.__tok = { valeros: mkToken("tVal", true), ezren: mkToken("tEz", true), wolf: mkToken("tWolf", true), gob: mkToken("tGob", false, false) };
    Object.assign(canvas, {
      ready: true, scene: { id: "s1" }, dimensions: { size: 100 },
      tokens: { placeables: Object.values(__tok), controlled: [], get: id => Object.values(__tok).find(t => t.document.id === id) },
      interface: { createScrollingText: (p, text) => __texts.push(text) }
    });
    const flags = {};
    const combat = {
      id: "c1", started: true, scene: canvas.scene, turn: 0,
      combatants: [{ tokenId: "tVal" }, { tokenId: "tEz" }, { tokenId: "tGob" }],
      get combatant() { return this.combatants[this.turn]; },
      getFlag: (ns, k) => flags[k],
      async setFlag(ns, k, v) { flags[k] = v; Hooks.callAll("updateCombat", this, {}, {}); __rerenderTracker(); }
    };
    window.__combat = combat;
    game.combats = [combat];
    game.combat = combat;
    // Combat tracker sidebar (V14 EncounterTracker-like DOM)
    const tracker = document.createElement("section");
    tracker.id = "combat";
    tracker.style.cssText = "position:fixed;right:0;top:0;width:300px;background:#222;color:#ddd;padding:6px";
    document.body.append(tracker);
    window.__rerenderTracker = () => {
      tracker.innerHTML = `<header class="combat-tracker-header"><div class="encounter-controls" style="display:flex;gap:4px;align-items:center">
        <button class="inline-control icon fa-solid fa-backward"></button><strong style="flex:1;text-align:center">Round 1</strong><button class="inline-control icon fa-solid fa-forward"></button></div></header>
        <ol><li>Valeros</li><li>Ezren</li></ol>`;
    };
    __rerenderTracker();
    ui.combat = { element: tracker };
    // Foundry's pause warning: called from the move handler, before preMoveToken.
    window.__warnings = [];
    ui.notifications.warn = (m, o) => { __warnings.push(m); };
    window.__tryMove = key => {
      const doc = __tok[key].document;
      if (game.paused && !game.user.isGM) { ui.notifications.warn("GAME.PausedWarning", { localize: true }); return "paused"; }
      return Hooks.call("preMoveToken", doc, {}, {}) ? "moved" : "blocked";
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await page.evaluate(() => { document.querySelector(".lucd20-hub").style.display = "none"; document.getElementById("core-config").style.display = "none"; });
    await setupMocks(page);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const tryMove = (page, k) => page.evaluate(k => __tryMove(k), k);

  // ---------- GM: control in the tracker, never blocked ----------
  let page = await open("gm=1");
  await set(page, "combatMovement_enabled", true);
  await page.waitForTimeout(80);
  assert.strictEqual(await page.$$eval("#combat .encounter-controls button.lucd20-move-mode", e => e.length), 1, "GM button in the tracker header");
  assert.strictEqual(await tryMove(page, "ezren"), "moved", "GM never blocked");
  await page.screenshot({ path: `${out}/p15-tracker-turn.png`, clip: { x: 690, y: 0, width: 310, height: 120 } });
  // Re-render keeps one control
  await page.evaluate(() => __rerenderTracker());
  await page.waitForTimeout(60);
  assert.strictEqual(await page.$$eval(".lucd20-move-mode", e => e.length), 1, "control survives a re-draw");
  // Toggle → free
  await page.click(".lucd20-move-mode");
  await page.waitForTimeout(80);
  assert.ok(await page.evaluate(() => __combat.getFlag("lucd20-automations", "freeMovement")), "toggled to free");
  assert.strictEqual(await page.$eval(".lucd20-move-mode", e => e.dataset.state), "free");
  await page.screenshot({ path: `${out}/p15-tracker-free.png`, clip: { x: 690, y: 0, width: 310, height: 120 } });
  await page.click(".lucd20-move-mode");
  await page.waitForTimeout(80);
  await set(page, "pauseNotifier_enabled", true);
  await set(page, "combatMovement_enabled", false);
  await page.waitForTimeout(60);
  assert.strictEqual(await page.$$eval(".lucd20-move-mode", e => e.length), 0, "control removed when off");

  // ---------- Player ----------
  page = await open("gm=0");
  await set(page, "combatMovement_enabled", true);
  await set(page, "pauseNotifier_enabled", true);
  await page.waitForTimeout(80);
  assert.strictEqual(await page.$$eval("#combat span.lucd20-move-mode", e => e.length), 1, "players see the mode (not a button)");
  assert.strictEqual(await tryMove(page, "valeros"), "moved", "current combatant moves");
  assert.strictEqual(await tryMove(page, "ezren"), "blocked", "not your turn: blocked");
  assert.deepStrictEqual(await page.evaluate(() => __texts), ["Not your turn"]);
  assert.strictEqual(await page.evaluate(() => __sent.at(-1)?.payload?.key), "LUCD20.CombatMovement.NotYourTurn", "broadcast to everyone");
  assert.strictEqual(await tryMove(page, "ezren"), "blocked");
  assert.strictEqual(await page.evaluate(() => __texts.length), 1, "no stacked texts on repeat");
  assert.strictEqual(await tryMove(page, "wolf"), "moved", "token not in the combat moves freely");
  // free mode
  await page.evaluate(() => __combat.setFlag("lucd20-automations", "freeMovement", true));
  assert.strictEqual(await tryMove(page, "ezren"), "moved", "free movement");
  await page.evaluate(() => __combat.setFlag("lucd20-automations", "freeMovement", false));
  // combat ended (not started) → free
  await page.evaluate(() => { __combat.started = false; });
  assert.strictEqual(await tryMove(page, "ezren"), "moved", "no started combat: free");
  await page.evaluate(() => { __combat.started = true; });

  await page.evaluate(() => { __texts.length = 0; });
  // Paused: Foundry's warning replaced with the floating text
  await page.evaluate(() => { game.paused = true; canvas.tokens.controlled = [__tok.valeros]; });
  assert.strictEqual(await tryMove(page, "valeros"), "paused");
  assert.deepStrictEqual(await page.evaluate(() => [__warnings.length, __texts]), [0, ["Game's Paused"]], "pause warning replaced");
  // not a token move (nothing controlled) → Foundry's warning stays
  await page.evaluate(() => { canvas.tokens.controlled = []; ui.notifications.warn("GAME.PausedWarning", { localize: true }); });
  assert.strictEqual(await page.evaluate(() => __warnings.length), 1, "other paused warnings untouched");
  // switched off → Foundry's warning back
  await set(page, "pauseNotifier_enabled", false);
  await page.waitForTimeout(50);
  await page.evaluate(() => { canvas.tokens.controlled = [__tok.ezren]; __texts.length = 0; });
  await page.waitForTimeout(950);
  await tryMove(page, "ezren");
  assert.deepStrictEqual(await page.evaluate(() => [__warnings.length, __texts.length]), [2, 0], "off: Foundry's warning");
  await page.evaluate(() => { game.paused = false; });
  await set(page, "combatMovement_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await tryMove(page, "ezren"), "moved", "off: no movement rule");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 15 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
