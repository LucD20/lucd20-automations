const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 12: planned catalog entries + Scenes & Sound, Turn Announcer new rounds, Lock Combat Toggle. */
async function setupMocks(page) {
  await page.evaluate(() => {
    const chat = document.createElement("section");
    chat.id = "chat";
    chat.style.cssText = "position:absolute;right:20px;top:20px;width:320px;height:560px;overflow:auto;border:1px solid #666;background:#222;color:#ddd";
    chat.innerHTML = `<ol class="chat-log" style="margin:0;padding:4px;list-style:none"></ol>`;
    document.body.append(chat);
    const log = chat.querySelector(".chat-log");
    let n = 0;
    class Msg {
      constructor(data) { this.id = `m${++n}`; Object.assign(this, structuredClone(data)); }
      getFlag(ns, k) { return this.flags?.[ns]?.[k]; }
    }
    window.ChatMessage = {
      async create(data) {
        const m = new Msg(data); game.messages.set(m.id, m);
        const li = document.createElement("li");
        li.className = "chat-message message"; li.dataset.messageId = m.id;
        li.style.cssText = "border:1px solid #555;margin:4px 0;padding:4px;border-radius:4px";
        li.innerHTML = `<header class="message-header">${m.speaker?.alias}</header><div class="message-content">${m.content}</div>`;
        Hooks.callAll("renderChatMessageHTML", m, li, {});
        log.append(li);
        return m;
      }
    };
    game.messages = new Map();
    game.users = Object.assign([{ id: "u1", name: "Gamemaster", isGM: true }, { id: "p1", name: "Alice", isGM: false }], { activeGM: null });
    const c = (id, name, owners = []) => ({
      id, name, img: `icons/${id}.png`, hidden: false, isDefeated: false,
      token: { hidden: false, texture: { src: `icons/${id}.webp`, scaleX: 1, scaleY: 1 }, playersCanSeeName: true },
      actor: { img: "", hasPlayerOwner: owners.length > 0, testUserPermission: u => owners.includes(u.id), get isOwner() { return true; } }
    });
    window.__combat = {
      id: "c1", round: 0, turn: null, started: false, previous: { round: 0, turn: null },
      turns: [c("valeros", "Valeros", ["p1"]), c("goblin", "Goblin")],
      get combatant() { return this.turn === null ? null : this.turns[this.turn]; }
    };
    window.__go = (round, turn) => {
      const changed = {};
      if (round !== __combat.round) changed.round = round;
      if (turn !== __combat.turn) changed.turn = turn;
      __combat.previous = { round: __combat.round, turn: __combat.turn };
      __combat.round = round; __combat.turn = turn; __combat.started = round > 0;
      Hooks.callAll("updateCombat", __combat, changed, {});
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  // ---------- Settings window: Scenes & Sound + planned entries ----------
  const tabs = await page.$$eval(".lucd20-hub-tab", els => els.map(e => e.dataset.category));
  console.log("Tabs:", tabs.join(", "));
  assert.ok(tabs.includes("scenes"), "Scenes & Sound category shown");
  await page.click('.lucd20-hub-tab[data-category="scenes"]');
  await page.waitForTimeout(150);
  const scenes = await page.$$eval('.lucd20-hub-category[data-category="scenes"] .lucd20-feature', els => els.map(e => [e.dataset.feature ?? e.querySelector("h3,h4,.lucd20-feature-name")?.textContent.trim(), e.classList.contains("planned")]));
  console.log("Scenes:", scenes);
  assert.strictEqual(scenes.length, 3);
  assert.deepStrictEqual(scenes.map(s => s[1]), [false, false, true], "Hidden Track Names still planned");
  await page.screenshot({ path: `${out}/p12-hub-scenes.png` });
  await page.click('.lucd20-hub-tab[data-category="combat"]');
  await page.waitForTimeout(150);
  const combat = await page.$$eval('.lucd20-hub-category[data-category="combat"] .lucd20-feature', els => els.map(e => [e.innerText.split("\n")[0].trim(), e.classList.contains("planned")]));
  console.log("Combat:", combat);
  const lock = combat.find(c => c[0].includes("Lock Combat Toggle"));
  assert.ok(lock && !lock[1], "Lock Combat Toggle is built");
  assert.ok(combat.every(c => !c[1]), "every combat feature is built");
  await page.screenshot({ path: `${out}/p12-hub-combat.png` });
  await page.evaluate(() => { document.querySelector(".lucd20-hub").style.display = "none"; document.getElementById("core-config").style.display = "none"; });

  // ---------- Turn Announcer: new rounds ----------
  await setupMocks(page);
  await set("turnAnnouncer_enabled", true);
  await page.waitForTimeout(50);
  const chat = () => page.$$eval("#chat .chat-message", els => els.map(e => e.classList.contains("lucd20-round-message") ? `[${e.innerText.trim()}]` : e.querySelector(".lucd20-turn-name")?.innerText.trim()));
  await page.evaluate(() => __go(1, 0));  // start: Round 1 divider, Valeros
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(1, 1));  // Goblin
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(2, 0));  // Round 2
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(1, 1));  // GM steps back to round 1: no divider
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(2, 0));  // forward again: no second "Round 2"
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(2, 1));
  await page.waitForTimeout(30);
  await page.evaluate(() => __go(3, 0));
  await page.waitForTimeout(80);
  let lines = await chat();
  console.log("Chat:", lines);
  const ROUND = s => `[${s.toUpperCase()}]`; // divider is uppercase via CSS; innerText follows text-transform
  assert.deepStrictEqual(lines, [ROUND("Round 1"), "Valeros's turn", "Goblin's turn", ROUND("Round 2"), "Valeros's turn", "Goblin's turn", "Valeros's turn", "Goblin's turn", ROUND("Round 3"), "Valeros's turn"]);
  const header = await page.$eval("#chat .lucd20-round-message .message-header", e => getComputedStyle(e).display);
  assert.strictEqual(header, "none", "divider has no message header");
  await page.screenshot({ path: `${out}/p12-round-divider.png`, clip: { x: 650, y: 10, width: 350, height: 590 } });

  // option off → no divider
  await set("turnAnnouncer_announceRounds", false);
  await page.waitForTimeout(50);
  const before = (await chat()).length;
  await page.evaluate(() => __go(4, 0));
  await page.waitForTimeout(60);
  lines = await chat();
  assert.deepStrictEqual(lines.slice(before), ["Valeros's turn"], "no divider when the option is off");

  // ---------- Lock Combat Toggle ----------
  await page.evaluate(() => {
    const hud = document.createElement("div");
    hud.id = "token-hud"; hud.className = "placeable-hud";
    hud.innerHTML = `<div class="col right"><button type="button" class="control-icon" data-action="combat"><i class="fa-solid fa-swords"></i></button></div>`;
    document.body.append(hud);
    window.__toggles = 0;
    // Foundry's own handler (delegated on the app element)
    hud.addEventListener("click", e => { if (e.target.closest('[data-action="combat"]')) __toggles++; });
    window.__hudToken = { inCombat: true };
    canvas.hud = { token: { get object() { return __hudToken; } } };
    window.__infos = [];
  });
  const click = (shift = false) => page.evaluate(shift => {
    document.querySelector('#token-hud [data-action="combat"] i').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: shift }));
  }, shift);

  await click();
  assert.strictEqual(await page.evaluate(() => __toggles), 1, "feature off: Foundry removes as usual");
  await set("hudCombatLock_enabled", true);
  await page.waitForTimeout(50);
  await click();
  assert.strictEqual(await page.evaluate(() => __toggles), 1, "in combat: click blocked");
  const info = await page.evaluate(() => __infos.at(-1));
  assert.ok(info?.includes("combat tracker") && info.includes("Shift"), `GM notice: ${info}`);
  await click(true);
  assert.strictEqual(await page.evaluate(() => __toggles), 2, "GM Shift+click removes anyway");
  await page.evaluate(() => { __hudToken.inCombat = false; });
  await click();
  assert.strictEqual(await page.evaluate(() => __toggles), 3, "not in combat: adding works");
  // player: Shift doesn't override
  await page.evaluate(() => { __hudToken.inCombat = true; game.user.isGM = false; });
  await click(true);
  assert.strictEqual(await page.evaluate(() => __toggles), 3, "player Shift+click still blocked");
  assert.ok(!(await page.evaluate(() => __infos.at(-1))).includes("Shift"), "player notice has no Shift hint");
  await page.evaluate(() => { game.user.isGM = true; });
  // switched off → listener removed, no reload
  await set("hudCombatLock_enabled", false);
  await page.waitForTimeout(50);
  await click();
  assert.strictEqual(await page.evaluate(() => __toggles), 4, "switched off without reload");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 12 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
