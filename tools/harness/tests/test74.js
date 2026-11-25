const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 75: Door Icon Size centering (top-left & centered anchors, grid change), Reliable Music & Audio, Chat Log Trim. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });

  // 1. Door Icon Size: centered on both top-left and 0.5-anchored DoorControls, scales on grid change
  const doors = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 40) => new Promise(r => setTimeout(r, ms));
    CONST.WALL_DOOR_TYPES = { NONE: 0, DOOR: 1, SECRET: 2 };
    CONST.WALL_DOOR_STATES = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
    class DoorControl extends PIXI.Container {
      constructor(wall, centered = false, baseSize = 40) {
        super(); this.wall = wall; this._centered = centered; this._base = baseSize;
      }
      draw() {
        this.icon ??= this.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
        this.icon.width = this.icon.height = this._base;
        if (this._centered) this.icon.anchor.set(0.5);
        this.reposition();
        return this;
      }
      reposition() {
        const [mx, my] = this.wall.midpoint;
        this.position.set(this._centered ? mx : mx - this._base / 2, this._centered ? my : my - this._base / 2);
      }
      _onMouseDown() {}
    }
    foundry.canvas = { containers: { DoorControl } };
    const app = new PIXI.Application({ width: 500, height: 300 });
    document.body.append(app.view);
    const layer = app.stage.addChild(new PIXI.Container());
    const scene = { id: "s1", grid: { size: 100 } };
    const mk = (id, mid, centered, base) => {
      const wall = { id, scene, midpoint: mid, document: { id, door: 2, ds: 0 } };
      const c = new DoorControl(wall, centered, base);
      wall.doorControl = c;
      layer.addChild(c);
      c.draw();
      return wall;
    };
    const wTop = mk("w1", [120, 140], false, 40);
    const wCtr = mk("w2", [280, 160], true, 48);
    Object.assign(canvas, { ready: true, scene, grid: scene.grid, controls: { doors: layer }, walls: { get: id => [wTop, wCtr].find(w => w.id === id) } });

    await game.settings.set(M, "doorIconSize_enabled", false);
    await game.settings.set(M, "doorIconSize_enabled", true);
    await game.settings.set(M, "secretDoorHighlight_enabled", true);
    await settle();
    const box = c => { const b = c.icon.getBounds(); return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2), w: Math.round(b.width) }; };
    const before = { top: box(wTop.doorControl), ctr: box(wCtr.doorControl) };

    // Grid changes to 200 px → icon scales up to 200 * 0.4 * 1.5 = 120 px and stays centered
    scene.grid.size = 200;
    Hooks.callAll("updateScene", scene, { grid: { size: 200 } });
    await settle();
    const after = { top: box(wTop.doorControl), ctr: box(wCtr.doorControl) };
    app.destroy(true);
    return { before, after };
  });
  assert.deepStrictEqual(doors.before.top, { cx: 120, cy: 140, w: 60 }, "top-left anchor centered at 100px grid");
  assert.deepStrictEqual(doors.before.ctr, { cx: 280, cy: 160, w: 60 }, "center anchor (48px base) centered at 100px grid");
  assert.deepStrictEqual(doors.after.top, { cx: 120, cy: 140, w: 120 }, "top-left anchor resizes on grid change");
  assert.deepStrictEqual(doors.after.ctr, { cx: 280, cy: 160, w: 120 }, "center anchor resizes on grid change");

  // 2. Reliable Music & Audio
  const audio = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 40) => new Promise(r => setTimeout(r, ms));
    let resumed = 0, plays = 0, synced = 0;
    class MockSound {
      static MAX_BUFFER_DURATION = 600;
      static STATES = { NONE: 0, LOADING: 1, LOADED: 2, PLAYING: 3, FAILED: -1 };
      constructor(src) { this.src = src; this._state = 0; this.failed = false; this.context = { state: "suspended", resume: async () => { resumed++; this.context.state = "running"; } }; }
      async load() { this._state = 2; return this; }
      async play() {
        plays++;
        if (plays === 1) { this.failed = true; throw new Error("decode failed"); }
        this._state = 3;
        return this;
      }
    }
    foundry.audio = { Sound: MockSound };
    const buffers = new Map([["music.ogg", {}]]);
    const sounds = new Map([["music.ogg", { deref: () => ({ failed: true, playing: false }) }]]);
    game.audio = { music: { state: "suspended", resume: async () => { resumed++; } }, interface: null, buffers, sounds };
    const pl = { playing: true, sounds: [{ playing: true, sound: new MockSound("music.ogg"), sync: async () => { synced++; } }] };
    game.playlists = [pl];

    const sidebar = document.createElement("section");
    sidebar.id = "playlists";
    sidebar.innerHTML = `<header class="directory-header"><div class="action-buttons"></div></header>`;
    document.body.append(sidebar);

    await game.settings.set(M, "audioReliability_enabled", false);
    const restoredThreshold = MockSound.MAX_BUFFER_DURATION;
    await game.settings.set(M, "audioReliability_enabled", true);
    await settle();
    const activeThreshold = MockSound.MAX_BUFFER_DURATION;

    // Failed first play clears cache, resumes context, and retries cleanly
    const s = new MockSound("music.ogg");
    await s.play();
    const retryState = { plays, resumed, cacheCleared: !buffers.has("music.ogg"), state: s._state };

    // Reset button in Playlists sidebar restarts active tracks
    const btn = document.querySelector("#playlists .lucd20-audio-reset");
    const hasBtn = !!btn;
    btn?.click();
    await settle();

    await game.settings.set(M, "audioReliability_enabled", false);
    await settle();
    const cleaned = { threshold: MockSound.MAX_BUFFER_DURATION, btnGone: !document.querySelector("#playlists .lucd20-audio-reset") };
    sidebar.remove();
    return { restoredThreshold, activeThreshold, retryState, hasBtn, synced, cleaned };
  });
  assert.strictEqual(audio.restoredThreshold, 600, "restores Foundry default 600s when disabled");
  assert.strictEqual(audio.activeThreshold, 20, "lowers MAX_BUFFER_DURATION to 20s when enabled");
  assert.deepStrictEqual(audio.retryState, { plays: 2, resumed: 1, cacheCleared: true, state: 3 }, "resumes context, evicts stale buffer, retries failed play once");
  assert.strictEqual(audio.hasBtn, true, "Reset audio button added to Playlists");
  assert.strictEqual(audio.synced, 1, "Reset audio restarts playing playlist track");
  assert.deepStrictEqual(audio.cleaned, { threshold: 600, btnGone: true }, "disabling restores threshold and removes button");

  // 3. Chat Log Trim
  const chat = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
    const log = document.createElement("ol");
    log.className = "chat-log";
    log.style.cssText = "height:300px;overflow-y:auto;margin:0;padding:0;list-style:none";
    document.body.append(log);

    const msgs = new Map();
    const makeLi = id => { const li = document.createElement("li"); li.className = "chat-message"; li.dataset.messageId = id; li.textContent = id; return li; };
    for (let i = 1; i <= 100; i++) {
      const id = `m${i}`;
      msgs.set(id, { id, visible: true, renderHTML: async () => makeLi(id) });
      log.append(makeLi(id));
    }
    log.scrollTop = log.scrollHeight;
    game.messages = msgs;

    await game.settings.set(M, "chatTrim_maxMessages", 30);
    await game.settings.set(M, "chatTrim_enabled", true);
    await settle();
    const trimmed = {
      domCount: log.querySelectorAll("li.chat-message").length,
      firstId: log.querySelector("li.chat-message")?.dataset.messageId,
      lastId: [...log.querySelectorAll("li.chat-message")].at(-1)?.dataset.messageId,
      storeSize: game.messages.size,
      banner: log.querySelector(".lucd20-chat-older-btn")?.textContent,
      cssClass: document.documentElement.classList.contains("lucd20-chat-trim-active")
    };

    // Click "Show older" loads a batch of 40 (30 -> 70 visible, 30 hidden)
    log.querySelector(".lucd20-chat-older-btn").click();
    await settle();
    const expanded = {
      domCount: log.querySelectorAll("li.chat-message").length,
      firstId: log.querySelector("li.chat-message")?.dataset.messageId,
      banner: log.querySelector(".lucd20-chat-older-btn")?.textContent
    };

    await game.settings.set(M, "chatTrim_enabled", false);
    await settle();
    const off = {
      cssClass: document.documentElement.classList.contains("lucd20-chat-trim-active"),
      bannerGone: !log.querySelector(".lucd20-chat-older")
    };
    log.remove();
    return { trimmed, expanded, off };
  });
  assert.deepStrictEqual(chat.trimmed, {
    domCount: 30, firstId: "m71", lastId: "m100", storeSize: 100,
    banner: "Show older messages (70 hidden)", cssClass: true
  }, "trims DOM to 30 newest while preserving all 100 in game.messages");
  assert.deepStrictEqual(chat.expanded, {
    domCount: 70, firstId: "m31", banner: "Show older messages (30 hidden)"
  }, "Show older loads previous 40 messages in order");
  assert.deepStrictEqual(chat.off, { cssClass: false, bannerGone: true }, "disabling removes class and banner");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 75 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
