const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Shared mocks: chat log, ChatMessage, combat. */
async function setupMocks(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const chat = document.createElement("section");
    chat.id = "chat";
    chat.style.cssText = "position:absolute;right:20px;top:20px;width:320px;height:560px;display:flex;flex-direction:column;border:1px solid #666";
    chat.innerHTML = `<ol class="chat-log" style="flex:1;overflow:auto;margin:0;padding:4px;list-style:none"></ol>
      <div class="control-buttons" style="display:flex;gap:4px;justify-content:flex-end;padding:4px">
        <button type="button" class="ui-control icon fa-solid fa-floppy-disk" data-action="export" data-tooltip="CHAT.Export"></button>
        <button type="button" class="ui-control icon fa-solid fa-trash" data-action="flush"></button>
      </div>`;
    document.body.append(chat);
    const log = chat.querySelector(".chat-log");

    const setPath = (obj, path, value) => {
      const parts = path.split("."); let o = obj;
      for (const p of parts.slice(0, -1)) o = o[p] ??= {};
      const last = parts.at(-1);
      if (value && typeof value === "object" && !Array.isArray(value)) o[last] = { ...(o[last] ?? {}), ...value };
      else o[last] = value;
    };
    class Msg {
      constructor(id, data) { this.id = id; this.content = data.content; this.flags = structuredClone(data.flags ?? {}); this.speaker = data.speaker; }
      getFlag(ns, k) { return this.flags[ns]?.[k]; }
      async update(data) {
        for (const [k, v] of Object.entries(data)) if (k !== "_id") setPath(this, k, v);
        Hooks.callAll("updateChatMessage", this, data);
        await this._rerender();
      }
      async delete() { return ChatMessage.deleteDocuments([this.id]); }
      async renderHTML() {
        const li = document.createElement("li");
        li.className = "chat-message message"; li.dataset.messageId = this.id;
        li.style.cssText = "border:1px solid #555;margin:4px 0;padding:4px;border-radius:4px";
        li.innerHTML = `<header class="message-header"><span class="message-sender">${this.speaker?.alias ?? "GM"}</span> <span class="message-metadata">now</span></header><div class="message-content">${this.content}</div>`;
        Hooks.callAll("renderChatMessageHTML", this, li, {});
        return li;
      }
      async _rerender() {
        const old = log.querySelector(`[data-message-id="${this.id}"]`);
        const el = await this.renderHTML();
        old ? old.replaceWith(el) : log.append(el);
      }
    }
    class Messages extends Map {
      filter(fn) { return [...this.values()].filter(fn); }
      some(fn) { return [...this.values()].some(fn); }
      async flush() { window.__coreFlush = true; await ChatMessage.deleteDocuments([...this.keys()]); }
    }
    let n = 0;
    window.ChatMessage = {
      async create(data) { const m = new Msg(`m${++n}`, data); game.messages.set(m.id, m); await m._rerender(); Hooks.callAll("createChatMessage", m); return m; },
      async deleteDocuments(ids, options) { if (options?.deleteAll) ids = [...game.messages.keys()]; for (const id of ids) { game.messages.delete(id); log.querySelector(`[data-message-id="${id}"]`)?.remove(); Hooks.callAll("deleteChatMessage", { id }); } },
      async updateDocuments(updates) { for (const u of updates) await game.messages.get(u._id).update(u); }
    };
    game.messages = new Messages();
    ui.chat = { element: chat };
    chat.querySelector('[data-action="flush"]').addEventListener("click", () => game.messages.flush());
    window.__renderChatLog = () => Hooks.callAll("renderChatLog", ui.chat, chat, {});
    window.__dialogMode = undefined;

    // users & combat
    game.users = Object.assign([
      { id: "u1", name: "Gamemaster", isGM: true },
      { id: "p1", name: "Alice", isGM: false },
      { id: "p2", name: "Bruno", isGM: false }
    ], { activeGM: null });
    const me = game.user.id;
    const actor = (owners, img) => ({
      img, hasPlayerOwner: owners.length > 0,
      testUserPermission: u => owners.includes(u.id),
      get isOwner() { return game.user.isGM || owners.includes(me); }
    });
    const c = (id, name, opts = {}) => ({
      id, name, img: `icons/${id}.png`, hidden: !!opts.hidden, isDefeated: !!opts.defeated,
      token: { hidden: !!opts.hidden, texture: { src: opts.src ?? `icons/${id}.webp`, scaleX: opts.art ?? 1, scaleY: opts.art ?? 1 }, playersCanSeeName: opts.nameHidden ? false : true },
      actor: actor(opts.owners ?? [], `icons/${id}-actor.png`)
    });
    window.__combat = {
      id: "c1", round: 1, turn: 0, started: true,
      turns: [
        Object.assign(c("valeros", "Valeros", { owners: ["p1"] }), {}),
        c("goblin", "Goblin Warrior", { art: 2 }),
        c("ghost", "Hidden Ghost", { hidden: true }),
        c("dead", "Dead Orc", { defeated: true }),
        c("ezren", "Ezren", { owners: ["p2", "u1"] }),
        c("boss", "Secret Boss", { nameHidden: true, src: "icons/boss.webm" })
      ],
      get combatant() { return this.turns[this.turn]; }
    };
    window.__setTurn = (turn, round = __combat.round) => {
      const changed = { turn }; if (round !== __combat.round) changed.round = round;
      __combat.turn = turn; __combat.round = round;
      Hooks.callAll("updateCombat", __combat, changed, {});
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await setupMocks(page);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);

  // ================= GM: Chat Pins =================
  let page = await open("gm=1");
  await page.evaluate(async () => {
    for (const t of ["Hello table", "The door is trapped (DC 22)", "Rolled 14 to hit", "Loot: 30 gp, potion"]) await ChatMessage.create({ content: t, speaker: { alias: "GM" } });
  });
  await set(page, "chatPins_enabled", true);
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval(".lucd20-pins-button", e => e.length), 1, "pin button present without a chat re-render");
  // Foundry re-draws the control buttons → pin button comes back
  await page.evaluate(() => { const box = document.querySelector("#chat .control-buttons"); box.innerHTML = box.innerHTML.replace(/<button[^>]*lucd20[^>]*>.*?<\/button>/g, ""); });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval(".lucd20-pins-button", e => e.length), 1, "pin button re-added after re-draw");
  // controls moved elsewhere (another sidebar tab open)
  await page.evaluate(() => { const holder = document.createElement("div"); holder.id = "moved"; document.body.append(holder); const box = document.querySelector("#chat .control-buttons"); holder.append(box.cloneNode(true)); box.remove(); document.querySelector("#moved .lucd20-pins-button")?.remove(); });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.$$eval("#moved .lucd20-pins-button", e => e.length), 1, "pin button follows moved controls");
  await page.evaluate(() => { const box = document.querySelector("#moved .control-buttons"); document.getElementById("chat").append(box); box.querySelector('[data-action="flush"]').addEventListener("click", () => game.messages.flush()); });
  await page.waitForTimeout(100);

  // pin button placed right before Export
  const before = await page.evaluate(() => document.querySelector('#chat [data-action="export"]').previousElementSibling);
  assert.ok(await page.evaluate(() => document.querySelector('#chat [data-action="export"]').previousElementSibling.classList.contains("lucd20-pins-button")));
  assert.ok(await page.evaluate(() => document.querySelector(".lucd20-pins-button").className.includes("fa-thumbtack") && !document.querySelector(".lucd20-pins-button").className.includes("floppy")));
  // re-render doesn't duplicate
  await page.evaluate(() => __renderChatLog());
  assert.strictEqual(await page.$$eval(".lucd20-pins-button", e => e.length), 1);

  // context menu options
  const ctx = await page.evaluate(() => {
    const options = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, options);
    const li = document.querySelector('[data-message-id="m2"]');
    return options.map(o => [o.name, o.condition(li)]);
  });
  assert.deepStrictEqual(ctx, [["LUCD20.ChatPins.Pin", true], ["LUCD20.ChatPins.Unpin", false]]);
  await page.evaluate(async () => {
    const options = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, options);
    await options[0].callback(document.querySelector('[data-message-id="m2"]'));
    await new Promise(r => setTimeout(r, 5));
    const opts2 = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, opts2);
    await opts2[0].callback(document.querySelector('[data-message-id="m4"]'));
  });
  assert.ok(await page.isVisible('[data-message-id="m2"].lucd20-pinned.lucd20-pin-gold'));
  assert.ok(await page.isVisible('[data-message-id="m2"] .lucd20-pin-icon'));
  await page.screenshot({ path: `${out}/p4-chat-pinned.png`, clip: { x: 640, y: 10, width: 360, height: 590 } });

  // pins window lists newest first
  await page.click(".lucd20-pins-button");
  await page.waitForTimeout(100);
  await page.evaluate(() => { const w = document.querySelector(".lucd20-pins"); w.style.width = "360px"; w.style.height = "560px"; w.style.left = "260px"; });
  await page.waitForTimeout(200);
  const listed = await page.$$eval(".lucd20-pins .lucd20-pin-entry", els => els.map(e => e.querySelector(".message-content")?.textContent));
  assert.deepStrictEqual(listed, ["Loot: 30 gp, potion", "The door is trapped (DC 22)"]);

  // Clear Chat keeps pins (archived: hidden from log, still in window)
  await page.click('#chat [data-action="flush"]');
  await page.waitForTimeout(200);
  assert.ok(!(await page.evaluate(() => window.__coreFlush)), "core flush not used when pins exist");
  assert.ok((await page.evaluate(() => __dialogContent)).includes("2 pinned message(s) will be kept"));
  assert.deepStrictEqual(await page.evaluate(() => [...game.messages.keys()]), ["m2", "m4"]);
  assert.strictEqual(await page.$$eval("#chat .chat-message", els => els.filter(e => getComputedStyle(e).display !== "none").length), 0, "archived hidden from log");
  const archivedListed = await page.$$eval(".lucd20-pins .lucd20-pin-entry.archived", e => e.length);
  assert.strictEqual(archivedListed, 2);
  assert.ok(await page.isVisible(".lucd20-pins .lucd20-pin-message .message-content"), "archived visible in window");
  await page.screenshot({ path: `${out}/p4-pins-window.png` });

  // unpin archived → deleted
  await page.$eval('.lucd20-pins .lucd20-pin-entry[data-message-id="m4"] [data-action="unpin"]', el => el.click());
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await page.evaluate(() => [...game.messages.keys()]), ["m2"]);
  // unpin normal (not archived) message → stays in chat
  await page.evaluate(async () => { await ChatMessage.create({ content: "fresh", speaker: { alias: "GM" } }); });
  await page.evaluate(async () => { const m = game.messages.get("m5"); await m.update({ "flags.lucd20-automations": { pinned: true, pinnedAt: Date.now(), archived: false } }); });
  await page.evaluate(async () => { const o = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, o); await o[1].callback(document.querySelector('[data-message-id="m5"]')); });
  await page.waitForTimeout(50);
  assert.ok(await page.evaluate(() => game.messages.has("m5") && !game.messages.get("m5").getFlag("lucd20-automations", "pinned")));
  assert.ok(!(await page.evaluate(() => document.querySelector('[data-message-id="m5"]').classList.contains("lucd20-pinned"))));

  // no pins → core flush
  await page.evaluate(async () => { const o = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, o); });
  await page.evaluate(() => ChatMessage.deleteDocuments(["m2"]));
  await page.click('#chat [data-action="flush"]');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => window.__coreFlush), "core flush used without pins");

  // blue color
  await page.evaluate(async () => { const m = await ChatMessage.create({ content: "blue test", speaker: { alias: "GM" } }); });
  await set(page, "chatPins_color", "blue");
  await page.waitForTimeout(100);
  await page.evaluate(async () => { const o = []; Hooks.callAll("getChatMessageContextOptions", ui.chat, o); await o[0].callback(document.querySelector('[data-message-id="m6"]')); });
  assert.ok(await page.isVisible('[data-message-id="m6"].lucd20-pin-blue'));

  // feature off → button removed, flush restored
  await set(page, "chatPins_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval(".lucd20-pins-button", e => e.length), 0);
  assert.ok(!(await page.isVisible(".lucd20-pinned")));

  // ================= GM: Turn Announcer =================
  await set(page, "turnAnnouncer_enabled", true);
  await page.waitForTimeout(50);
  const cards = () => page.$$eval("#chat .lucd20-turn-card", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  await page.evaluate(() => { for (const id of [...game.messages.keys()]) document.querySelector(`[data-message-id="${id}"]`)?.remove(); game.messages.clear(); });
  await page.evaluate(() => __setTurn(0));       // Valeros
  await page.evaluate(() => __setTurn(1));       // Goblin
  await page.evaluate(() => __setTurn(2));       // hidden ghost → skip
  await page.evaluate(() => __setTurn(3));       // defeated → skip
  await page.evaluate(() => __setTurn(4));       // Ezren (owned by p2 + GM → only player listed)
  await page.evaluate(() => __setTurn(5));       // boss, name hidden, video token → actor img
  await page.evaluate(() => __setTurn(5));       // duplicate update → no second card
  await page.evaluate(() => __setTurn(0, 2));    // round 2
  await page.waitForTimeout(100);
  const c1 = await cards();
  console.log("Cards:", c1);
  assert.deepStrictEqual(c1, [
    "Round 1 Alice Valeros's turn", "Round 1 Goblin Warrior's turn", "Round 1 Bruno Ezren's turn", "Round 1 Unknown creature's turn", "Round 2 Alice Valeros's turn"
  ]);
  const bossImg = await page.$$eval("#chat .lucd20-turn-portrait img", els => els.map(e => e.getAttribute("src")));
  assert.strictEqual(bossImg[3], "icons/boss-actor.png", "video token falls back to actor image");
  const zoom = await page.$$eval("#chat .lucd20-turn-portrait", els => els.map(e => [e.classList.contains("zoomed"), getComputedStyle(e).overflow, getComputedStyle(e.querySelector("img")).maskImage !== "none"]));
  assert.deepStrictEqual(zoom[1], [true, "visible", true], "scale 2 art spills out with faded edges");
  assert.deepStrictEqual(zoom[0], [false, "visible", false]);
  await page.screenshot({ path: `${out}/p4-turn-cards.png`, clip: { x: 640, y: 10, width: 360, height: 590 } });

  // options: no NPCs, no player name, no round
  await set(page, "turnAnnouncer_announceNpcs", false);
  await set(page, "turnAnnouncer_showPlayerName", false);
  await set(page, "turnAnnouncer_showRound", false);
  await page.waitForTimeout(100);
  await page.evaluate(() => __setTurn(1, 2));
  await page.evaluate(() => __setTurn(4, 2));
  await page.waitForTimeout(100);
  assert.deepStrictEqual((await cards()).slice(5), ["Ezren's turn"]);
  // GM gets no heads-up
  assert.ok(!(await page.evaluate(() => (window.__infos ?? []).some(m => m.includes("up next")))));

  // ================= Player: heads-up =================
  page = await open("gm=0");
  await page.evaluate(() => { game.user.id = "p1"; });
  await setupMocks(page);
  await set(page, "turnAnnouncer_enabled", true);
  await page.waitForTimeout(50);
  // Ezren (p2) acts, next is boss → nothing; boss acts, next (wraps) is Valeros (p1) → heads-up
  await page.evaluate(() => __setTurn(4));
  await page.evaluate(() => __setTurn(5));
  await page.evaluate(() => __setTurn(5));
  // Goblin acts: next skips hidden ghost + dead orc → Ezren (not mine) → nothing
  await page.evaluate(() => __setTurn(1));
  const infos = await page.evaluate(() => window.__infos ?? []);
  console.log("Player notifications:", infos);
  assert.deepStrictEqual(infos, ["You're up next: Valeros"]);
  assert.strictEqual(await page.$$eval("#chat .lucd20-turn-card", e => e.length), 0, "players never post cards");
  // per-player option off
  await set(page, "turnAnnouncer_headsUp", false);
  await page.waitForTimeout(100);
  await page.evaluate(() => __setTurn(5, 3));
  assert.strictEqual((await page.evaluate(() => window.__infos)).length, 1);

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 4 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
