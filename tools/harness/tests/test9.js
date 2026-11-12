const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;
const M = "lucd20-automations";

async function setup(page, userId) {
  await page.evaluate(userId => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const dir = document.createElement("section");
    dir.id = "actors";
    dir.style.cssText = "position:absolute;right:20px;top:20px;width:280px;height:300px;border:1px solid #666;display:flex;flex-direction:column;justify-content:space-between";
    dir.innerHTML = `<ol class="directory-list"><li>Amiri</li><li>Boar</li></ol><footer class="directory-footer"></footer>`;
    document.body.append(dir);
    ui.actors = { element: dir };
    game.user.id = userId;
    game.users = Object.assign([
      { id: "u1", name: "Gamemaster", isGM: true, color: { css: "#e0a030" } },
      { id: "p1", name: "Alice", isGM: false, color: { css: "#3a8fd6" } },
      { id: "p2", name: "Bruno", isGM: false, color: { css: "#4caf50" } }
    ], { get(id) { return this.find(u => u.id === id); } });
    window.__roll = (userId, dice, opts = {}) => {
      const author = game.users.get(userId);
      const rolls = [{ dice: dice.map(([faces, results]) => ({ faces, results: results.map(r => typeof r === "number" ? { result: r, active: true } : r) })) }];
      Hooks.callAll("createChatMessage", { id: Math.random().toString(36), author, rolls, whisper: opts.whisper ?? [], blind: !!opts.blind,
        flags: opts.pf2e ? { pf2e: { context: opts.pf2e } } : {} });
    };
  }, userId);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (q, userId, preset) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    const p = preset ? `&preset=${encodeURIComponent(JSON.stringify(preset))}` : "";
    await page.goto(`http://localhost:8765/index.html?${q}${p}`);
    await page.waitForFunction(() => window.__done);
    await setup(page, userId);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const data = page => page.evaluate(() => game.settings.get("lucd20-automations", "diceStats_data"));

  // ================= GM =================
  let page = await open("gm=1", "u1");
  await page.evaluate(() => { window.__confirms = 0; foundry.applications.api.DialogV2.confirm = async () => { window.__confirms++; return true; }; });
  await set(page, "diceStats_enabled", true);
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => __confirms), 1, "asks to start a new session when the GM joins");
  assert.strictEqual(await page.$$eval("#actors .directory-footer .lucd20-dice-stats-open", e => e.length), 1, "button at the bottom of the Actors tab");

  await page.evaluate(() => {
    // Alice: PF2e attacks and saves with outcomes, fortune roll (2d20kh), damage dice
    __roll("p1", [[20, [17]]], { pf2e: { type: "attack-roll", outcome: "success" } });
    __roll("p1", [[20, [20]]], { pf2e: { type: "attack-roll", outcome: "criticalSuccess" } });
    __roll("p1", [[20, [3]]], { pf2e: { type: "attack-roll", outcome: "failure" } });
    __roll("p1", [[20, [{ result: 4, active: false, discarded: true }, { result: 15, active: true }]]], { pf2e: { type: "saving-throw", outcome: "success" } });
    __roll("p1", [[20, [1]]], { pf2e: { type: "saving-throw", outcome: "criticalFailure" } });
    __roll("p1", [[8, [6]], [6, [2, 5]]], { pf2e: { type: "damage-roll" } });
    __roll("p1", [[20, [11]]], { pf2e: { type: "skill-check" } }); // no DC → no outcome
    // Alice blind Perception (secret check): GM-only
    __roll("p1", [[20, [19]]], { blind: true, pf2e: { type: "perception-check", outcome: "success" } });
    // Bruno
    for (const r of [8, 12, 20, 9, 14, 6]) __roll("p2", [[20, [r]]], { pf2e: { type: "attack-roll", outcome: r >= 12 ? "success" : "failure" } });
    __roll("p2", [[12, [7]]]);
    // GM: public and secret
    __roll("u1", [[20, [10]]], { pf2e: { type: "saving-throw", outcome: "failure" } });
    __roll("u1", [[20, [2]]], { whisper: ["u1"], pf2e: { type: "skill-check" } });
  });
  await page.waitForTimeout(1300);
  let d = await data(page);
  const alice = d.users.p1.session;
  assert.strictEqual(alice.public.dice[20].n, 6, "Alice public d20s (fortune counts the kept die only)");
  assert.strictEqual(alice.public.dice[20].dist[4], undefined, "discarded die not counted");
  assert.strictEqual(alice.hidden.dice[20].n, 1, "blind roll in GM-only pool");
  assert.deepStrictEqual(alice.public.checks.attack.outcomes, { success: 1, criticalSuccess: 1, failure: 1 });
  assert.strictEqual(alice.public.checks.attack.nat20, 1);
  assert.strictEqual(alice.public.checks.save.nat1, 1);
  assert.strictEqual(alice.public.dice[6].n, 2);
  assert.strictEqual(d.users.u1.session.hidden.rolls, 1, "GM whisper hidden");
  assert.deepStrictEqual(d.users.p1.allTime, d.users.p1.session);

  await page.click(".lucd20-dice-stats-open");
  await page.waitForTimeout(250);
  const summary = await page.$$eval(".ds-summary tbody tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
  console.log("GM summary:", summary);
  assert.deepStrictEqual(summary, ["Alice 8 12.3 1 1", "Bruno 7 11.5 1 0", "Gamemaster 2 6.0 0 0"]);
  await page.screenshot({ path: `${out}/p9-gm.png` });
  // hide blind/secret rolls
  await page.click('[data-action="hidden"]');
  await page.waitForTimeout(150);
  const summary2 = await page.$$eval(".ds-summary tbody tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
  assert.deepStrictEqual(summary2, ["Alice 7 11.2 1 1", "Bruno 7 11.5 1 0", "Gamemaster 1 10.0 0 0"]);
  await page.click('[data-action="hidden"]');

  // New session: clears session, keeps all time
  await page.click('[data-action="newSession"]');
  await page.waitForTimeout(300);
  d = await data(page);
  assert.strictEqual(d.users.p1.session.public.rolls, 0);
  assert.strictEqual(d.users.p1.allTime.public.rolls, 7);
  assert.ok(await page.isVisible("text=No rolls recorded yet."));
  await page.click('[data-action="period"][data-period="allTime"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.$$eval(".ds-card", e => e.length), 3);
  const saved = await data(page);

  // ================= Player =================
  page = await open("gm=0", "p2", { [`${M}.diceStats_enabled`]: true, [`${M}.diceStats_data`]: saved });
  await page.evaluate(() => Hooks.callAll("renderActorDirectory", ui.actors, ui.actors.element));
  await page.evaluate(() => Hooks.callAll("renderActorDirectory", ui.actors, ui.actors.element));
  assert.strictEqual(await page.$$eval(".lucd20-dice-stats-open", e => e.length), 1, "added once");
  await page.waitForTimeout(150);
  await page.click(".lucd20-dice-stats-open");
  await page.waitForTimeout(200);
  await page.click('[data-action="period"][data-period="allTime"]');
  await page.waitForTimeout(150);
  const psummary = await page.$$eval(".ds-summary tbody tr", trs => trs.map(t => t.innerText.replace(/\s+/g, " ").trim()));
  console.log("Player summary:", psummary);
  assert.deepStrictEqual(psummary, ["Alice 7 11.2 1 1", "Bruno 7 11.5 1 0", "Gamemaster 1 10.0 0 0"], "players never see blind/secret rolls");
  assert.strictEqual(await page.$$eval('[data-action="hidden"], [data-action="newSession"]', e => e.length), 0);
  await page.screenshot({ path: `${out}/p9-player.png` });

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 8 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
