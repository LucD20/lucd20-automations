const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 18: Describe; also the round divider look and track eye placement fixes. */
async function setup(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    Hooks.call = function (n, ...a) { for (const h of this._h[n] ?? []) if (h.f(...a) === false) return false; return true; };
    window.__sent = [];
    game.socket.emit = (name, msg) => __sent.push(msg);
    // A journal page and a chat message with text
    const journal = document.createElement("article");
    journal.className = "journal-page-content";
    journal.style.cssText = "position:fixed;left:20px;top:20px;width:420px;background:#eee;color:#111;padding:10px";
    journal.innerHTML = `<p id="jtext">The door creaks open. A cold wind carries the smell of old bones and wet stone.</p>`;
    document.body.append(journal);
    const chat = document.createElement("ol");
    chat.id = "chat-log";
    chat.style.cssText = "position:fixed;right:10px;top:20px;width:300px;background:#222;color:#ddd";
    chat.innerHTML = `<li class="chat-message message" data-message-id="m1"><header class="message-header">GM</header><div class="message-content"><p id="ctext">Something moves in the dark.</p></div></li>`;
    document.body.append(chat);
    window.__select = id => { const r = document.createRange(); r.selectNodeContents(document.getElementById(id)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await setup(page);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  let page = await open("gm=1");
  await set(page, "describe_enabled", true);
  await page.waitForTimeout(50);

  // duration rule
  const durations = await page.evaluate(async () => {
    const { describeDuration } = await import("/modules/lucd20-automations/scripts/features/describe.js");
    return [describeDuration("Hi"), describeDuration("one two three four five six seven eight nine ten"), describeDuration("w ".repeat(200))];
  });
  assert.deepStrictEqual(durations, [4000, 6000, 30000], "3 s + 0.3 s/word, 4–30 s");

  // /describe in chat (V14 sends HTML) → no message, overlay + broadcast
  const posted = await page.evaluate(() => Hooks.call("chatMessage", {}, "<p>/describe The torches flicker.</p><p>Then die.</p>", {}));
  assert.strictEqual(posted, false, "no chat message posted");
  await page.waitForTimeout(700);
  assert.strictEqual(await page.$eval(".lucd20-describe-text", e => e.textContent), "The torches flicker.\nThen die.");
  assert.ok(await page.$eval(".lucd20-describe", e => e.classList.contains("visible")), "faded in");
  assert.strictEqual(await page.evaluate(() => __sent.at(-1)?.type), "describe.show", "sent to everyone");
  await page.screenshot({ path: `${out}/p18-describe.png` });
  // other chat untouched
  assert.strictEqual(await page.evaluate(() => Hooks.call("chatMessage", {}, "<p>hello</p>", {})), true);
  // GM click dismisses for everyone
  await page.click(".lucd20-describe");
  await page.waitForTimeout(700);
  assert.strictEqual(await page.$$eval(".lucd20-describe", e => e.length), 0, "dismissed");
  assert.strictEqual(await page.evaluate(() => __sent.at(-1)?.type), "describe.hide", "GM's click dismisses for everyone");

  // Right-click selected journal text → our menu
  await page.evaluate(() => __select("jtext"));
  await page.click("#jtext", { button: "right" });
  await page.waitForTimeout(50);
  assert.ok(await page.isVisible("#lucd20-describe-menu"), "menu on selected text");
  await page.screenshot({ path: `${out}/p18-menu.png`, clip: { x: 0, y: 0, width: 500, height: 160 } });
  await page.click("#lucd20-describe-menu .context-item");
  await page.waitForTimeout(100);
  assert.ok((await page.$eval(".lucd20-describe-text", e => e.textContent)).startsWith("The door creaks open."));
  await page.click(".lucd20-describe");
  await page.waitForTimeout(700);
  // no selection → no menu
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.click("#jtext", { button: "right" });
  assert.strictEqual(await page.$$eval("#lucd20-describe-menu", e => e.length), 0, "no menu without a selection");
  // chat message → Foundry's menu gets the entry instead
  await page.evaluate(() => __select("ctext"));
  await page.click("#ctext", { button: "right" });
  assert.strictEqual(await page.$$eval("#lucd20-describe-menu", e => e.length), 0, "no own menu on chat messages");
  const entry = await page.evaluate(() => { const o = []; Hooks.callAll("getChatMessageContextOptions", {}, o); const d = o.find(x => x.name === "LUCD20.Describe.Menu"); return d && d.condition(); });
  assert.strictEqual(entry, true, "entry in Foundry's chat menu while text is selected");

  // ---------- Player: sees it, own click dismisses only locally, no menu ----------
  page = await open("gm=0");
  await set(page, "describe_enabled", true);
  await page.waitForTimeout(50);
  const show = await page.evaluate(() => { const h = game.socket; return typeof h; });
  await page.evaluate(async () => {
    // deliver a broadcast the way the socket would
    const { initSocket } = await import("/modules/lucd20-automations/scripts/core/socket.js");
    let handler; game.socket.on = (n, f) => { handler = f; }; initSocket();
    handler({ type: "describe.show", payload: { id: "x1", text: "A shadow passes overhead.", duration: 4000 }, senderId: "u1" });
  });
  await page.waitForTimeout(700);
  assert.strictEqual(await page.$eval(".lucd20-describe-text", e => e.textContent), "A shadow passes overhead.", "players see it");
  await page.click(".lucd20-describe");
  await page.waitForTimeout(700);
  assert.ok(!(await page.evaluate(() => __sent.some(m => m.type === "describe.hide"))), "player's click is local only");
  assert.strictEqual(await page.evaluate(() => Hooks.call("chatMessage", {}, "<p>/describe hi</p>", {})), true, "players can't /describe");
  await page.evaluate(() => __select("jtext"));
  await page.click("#jtext", { button: "right" });
  assert.strictEqual(await page.$$eval("#lucd20-describe-menu", e => e.length), 0, "players get no menu");

  // ---------- Round divider: no header even without the hook class ----------
  await page.evaluate(() => {
    const li = document.createElement("li");
    li.className = "chat-message message";
    li.innerHTML = `<header class="message-header">Turn · 1h ago</header><div class="message-content"><div class="lucd20-round-divider"><span>Round 1</span></div></div>`;
    document.getElementById("chat-log").append(li);
  });
  assert.strictEqual(await page.$eval("#chat-log li:last-child .message-header", e => getComputedStyle(e).display), "none", "round card header hidden");
  assert.strictEqual(await page.$eval("#chat-log li:last-child", e => getComputedStyle(e).borderTopStyle), "none", "no frame");
  await page.screenshot({ path: `${out}/p18-round.png`, clip: { x: 780, y: 10, width: 320, height: 120 } });

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 18 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
