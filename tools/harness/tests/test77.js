const { chromium } = require("playwright");
const assert = require("assert");

/** v0.87.5: Chat Log Trim keeps the chat at the bottom when a new message comes (not when scrolled up). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 100) => new Promise(res => setTimeout(res, ms));
    const out = {};
    const log = document.createElement("ol");
    log.className = "chat-log";
    Object.assign(log.style, { position: "fixed", right: "0", top: "0", width: "300px", height: "400px", overflowY: "auto", margin: "0" });
    document.body.append(log);
    const msgs = [];
    const add = i => { const li = document.createElement("li"); li.dataset.messageId = `m${i}`; li.style.height = "60px"; li.textContent = `message ${i}`; log.append(li); msgs.push({ id: `m${i}`, visible: true }); };
    for (let i = 0; i < 60; i++) add(i);
    game.messages = { contents: msgs };
    log.scrollTop = log.scrollHeight;
    await game.settings.set(M, "chatTrim_maxMessages", 30);
    await game.settings.set(M, "chatTrim_enabled", true);
    await settle(300);
    log.scrollTop = log.scrollHeight;
    await settle(50);
    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= 2;
    // As Foundry does it on any client: the hook, then the card drawn and added later (PF2e cards can be slow;
    // other clients get no pre-create hook). Foundry doesn't scroll here.
    const send = async (i, delay = 600) => {
      Hooks.callAll("createChatMessage", {}, {}, "someone-else");
      await settle(delay);
      add(i);
      Hooks.callAll("renderChatMessageHTML", {}, log.lastElementChild);
      await settle(200);
    };
    await send(60);
    out.bottomAfterNew = atBottom();
    out.rendered = log.querySelectorAll("[data-message-id]").length;
    // A picture that loads later makes the message taller: still at the bottom.
    const tall = 61.5;
    Hooks.callAll("createChatMessage", {}, {}, "x");
    add(tall);
    const img = document.createElement("img");
    log.lastElementChild.append(img);
    await settle(50);
    log.lastElementChild.style.height = "260px";
    img.dispatchEvent(new Event("load"));
    await settle(80);
    out.bottomAfterImage = atBottom();
    // Scrolled up to read: a new message doesn't pull the chat down.
    log.scrollTop = 0;
    await settle(80);
    await send(61);
    out.stayedUp = log.scrollTop < 200;
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.ok(r.bottomAfterNew, "at the bottom after a new message");
  assert.ok(r.rendered <= 31, `trimmed (${r.rendered})`);
  assert.ok(r.bottomAfterImage, "a picture loading later: still at the bottom");
  assert.ok(r.stayedUp, "scrolled up: left alone");
  console.log("PHASE 77 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
