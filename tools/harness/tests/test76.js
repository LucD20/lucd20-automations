const { chromium } = require("playwright");
const assert = require("assert");

/** v0.87.2: the module's chat tools behind one "Automations" button (a menu), so Clear Chat stays visible. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 120) => new Promise(res => setTimeout(res, ms));
    const out = {};
    // Foundry's chat control row: Export and Clear Chat.
    const row = document.createElement("div");
    row.id = "chat-controls-test";
    Object.assign(row.style, { position: "fixed", right: "10px", bottom: "10px", display: "flex", gap: "4px" });
    row.innerHTML = `<button type="button" data-action="export"><i class="fa-solid fa-floppy-disk"></i></button><button type="button" data-action="flush"><i class="fa-solid fa-trash"></i></button>`;
    document.body.append(row);
    for (const id of ["combatCards", "chatPins", "damageLog", "encounterReport"]) await game.settings.set(M, `${id}_enabled`, true);
    await settle(300);
    out.buttons = [...row.querySelectorAll("[data-lucd20-control]")].map(b => b.dataset.lucd20Control);
    out.order = [...row.children].map(b => b.dataset.lucd20Control ?? b.dataset.action);
    out.tooltip = row.querySelector("[data-lucd20-control]")?.dataset.tooltip;
    row.querySelector("[data-lucd20-control]").click();
    await settle();
    const menu = document.querySelector(".lucd20-chat-menu");
    out.items = [...(menu?.querySelectorAll("ul button span") ?? [])].map(s => s.textContent);
    out.settings = menu?.querySelector("footer button span")?.textContent;
    // Choosing an item runs it and closes the menu.
    [...menu.querySelectorAll("ul button")].find(b => b.textContent.includes("Party Deck")).click();
    await settle(200);
    out.deckOpen = !!foundry.applications.instances.get("lucd20-party-deck");
    out.menuClosed = !document.querySelector(".lucd20-chat-menu");
    // Escape and a click outside close it too.
    row.querySelector("[data-lucd20-control]").click();
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    out.escClosed = !document.querySelector(".lucd20-chat-menu");
    row.querySelector("[data-lucd20-control]").click();
    await settle();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await settle();
    out.outsideClosed = !document.querySelector(".lucd20-chat-menu");
    // V14's chat right-click menu: entries come from ChatLog#_getEntryContextOptions (no hook); Pin is added
    // there (registered at init), shown only while Chat Pins is on and the message isn't pinned.
    const msg = { id: "m1", getFlag: () => false };
    game.messages = { get: id => (id === "m1" ? msg : null) };
    const li = document.createElement("li");
    li.dataset.messageId = "m1";
    const entries = new foundry.applications.sidebar.tabs.ChatLog()._getEntryContextOptions();
    out.v14Entries = entries.map(e => e.label);
    const pin = entries.find(e => e.label === "LUCD20.ChatPins.Pin");
    out.pinVisible = pin?.visible(li);
    out.pinHasOnClick = typeof pin?.onClick === "function";
    // Every tool off: no button at all.
    for (const id of ["combatCards", "chatPins", "damageLog", "encounterReport", "heroStart", "pf2eMultiCheck"]) await game.settings.set(M, `${id}_enabled`, false);
    await settle(400);
    out.noneLeft = row.querySelectorAll("[data-lucd20-control]").length;
    out.pinVisibleOff = new foundry.applications.sidebar.tabs.ChatLog()._getEntryContextOptions().find(e => e.label === "LUCD20.ChatPins.Pin")?.visible(li);
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.buttons, ["lucd20-automations"], "one button");
  assert.deepStrictEqual(r.order, ["lucd20-automations", "export", "flush"], "before Export; Clear Chat untouched");
  assert.strictEqual(r.tooltip, "Automations");
  assert.ok(r.items.includes("Party Deck") && r.items.length >= 3, `the tools listed: ${r.items}`);
  assert.strictEqual(r.settings, "LucD20 Automations settings");
  assert.ok(r.deckOpen && r.menuClosed, "an item runs and the menu closes");
  assert.ok(r.escClosed && r.outsideClosed, "Escape / a click outside close it");
  assert.strictEqual(r.noneLeft, 0, "no tools, no button");
  assert.ok(r.v14Entries.includes("CHAT.Delete") && r.v14Entries.includes("LUCD20.ChatPins.Pin") && r.v14Entries.includes("LUCD20.ChatPins.Unpin"), `V14 entries: ${r.v14Entries}`);
  assert.ok(r.pinVisible === true && r.pinHasOnClick, "Pin shown (V14: visible / onClick)");
  assert.strictEqual(r.pinVisibleOff, false, "Chat Pins off: Pin hidden");
  console.log("PHASE 76 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
