const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 21: Riding. */
async function setup(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    Hooks.call = function (n, ...a) { for (const h of this._h[n] ?? []) if (h.f(...a) === false) return false; return true; };
    game.socket.emit = () => {};
    const apply = (doc, data) => {
      for (const [k, v] of Object.entries(data)) {
        const parts = k.split("."); let o = doc;
        for (const p of parts.slice(0, -1)) o = o[p] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else if (v && typeof v === "object" && !Array.isArray(v)) o[last] = structuredClone(v);
        else o[last] = v;
      }
    };
    const scene = { id: "s1", grid: { size: 100 }, dimensions: { width: 1000, height: 1000, sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } } };
    const tokens = new Map();
    scene.tokens = Object.assign(tokens, { [Symbol.iterator]: () => tokens.values() });
    window.__moves = [];
    const mk = (id, name, x, y, w, owners) => {
      const doc = {
        id, name, x, y, width: w, height: w, elevation: 0, sort: 1, parent: scene, flags: {},
        texture: { scaleX: 1, scaleY: 1 },
        getFlag(ns, k) { return this.flags[ns]?.[k]; },
        async setFlag(ns, k, v) { return this.update({ [`flags.${ns}.${k}`]: v }); },
        testUserPermission: u => u.isGM || owners.includes(u.id),
        get isOwner() { return game.user.isGM || owners.includes(game.user.id); },
        async update(data, options = {}) {
          const changes = {};
          for (const k of Object.keys(data)) changes[k.split(".")[0]] = true;
          apply(this, data);
          if ("x" in data || "y" in data) __moves.push([id, this.x, this.y, !!options.lucd20Riding]);
          Hooks.callAll("updateToken", this, changes, options, game.user.id);
        }
      };
      tokens.set(id, doc);
      return doc;
    };
    window.__horse = mk("horse", "Horse", 400, 400, 2, []);
    window.__valeros = mk("val", "Valeros", 100, 400, 1, ["u1", "p1"]);
    window.__ezren = mk("ez", "Ezren", 700, 700, 1, ["u1", "p1"]);
    __ezren.texture = { scaleX: 2, scaleY: 2 }; // iconic art at Scale 2
    window.__wall = mk("rock", "Rock", 600, 400, 1, []); // occupies the square right of the horse
    game.scenes = { get: id => (id === "s1" ? scene : null) };
    Object.assign(canvas, { ready: true, scene, grid: { size: 100 }, dimensions: { size: 100, width: 1000, height: 1000, sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } }, tokens: { controlled: [], get: () => null }, interface: { createScrollingText() {} } });
    game.users = Object.assign([{ id: "u1", isGM: true }, { id: "p1", isGM: false }], { get(id) { return this.find(u => u.id === id); } });
    game.user.targets = new Set();
    window.__select = (...docs) => { canvas.tokens.controlled = docs.map(d => ({ document: d })); };
    window.__target = doc => { game.user.targets = new Set([{ document: doc }]); };
    window.__pressM = () => window.__keybindings["lucd20-automations.ridingToggle"].onDown();
    window.__warns = [];
    ui.notifications.warn = m => __warns.push(m);
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);
  await setup(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const tick = () => page.waitForTimeout(60);
  await set("riding_enabled", true);
  await tick();

  // Not rideable yet
  await page.evaluate(() => { __select(__valeros); __target(__horse); __pressM(); });
  await tick();
  assert.ok((await page.evaluate(() => __warns.at(-1))).includes("Rideable"), "needs a Rideable target");

  // GM marks the horse Rideable via the Token HUD
  await page.evaluate(() => {
    const hud = document.createElement("div"); hud.id = "token-hud";
    hud.innerHTML = '<div class="col left"></div><div class="col right"></div>';
    document.body.append(hud);
    canvas.hud = { token: { document: __horse, element: hud } };
  });
  await tick();
  assert.ok(await page.isVisible("#token-hud .col.right .lucd20-rideable"), "horse button drawn without the render hook");
  // Foundry re-draws the HUD → the button comes back
  await page.evaluate(() => { document.querySelector("#token-hud").innerHTML = '<div class="col left"></div><div class="col right"></div>'; });
  await tick();
  assert.strictEqual(await page.$$eval("#token-hud .lucd20-rideable", e => e.length), 1, "button back after a re-draw");
  await page.click("#token-hud .lucd20-rideable");
  await tick();
  assert.ok(await page.evaluate(() => __horse.flags["lucd20-automations"].rideable), "HUD toggle marks it Rideable");
  assert.ok(await page.evaluate(() => document.querySelector("#token-hud .lucd20-rideable").classList.contains("active")), "button shows it's on");

  // Player too far (Valeros is 2 squares left of the horse's edge)
  await page.evaluate(() => { game.user.isGM = false; game.user.id = "p1"; game.users.find(u => u.id === "p1"); });
  // executeAsGM runs locally only on the active GM; emulate the GM answering with the player as sender
  await page.evaluate(async () => {
    const socket = await import("/modules/lucd20-automations/scripts/core/socket.js");
    window.__asPlayer = async (type, payload) => { game.user.isGM = true; game.user.isActiveGM = true; try { return await CONFIG.queries["lucd20-automations.gm"]({ type, payload, senderId: "p1" }); } finally { game.user.isGM = false; game.user.isActiveGM = false; } };
  });
  let err = await page.evaluate(() => __asPlayer("riding.mount", { sceneId: "s1", riderIds: ["val"], mountId: "horse" }).then(() => null, e => e.message));
  assert.ok(err?.includes("too far"), `player: too far (${err})`);
  // Move next to it, then mount
  await page.evaluate(() => { __valeros.x = 300; });
  const n = await page.evaluate(() => __asPlayer("riding.mount", { sceneId: "s1", riderIds: ["val"], mountId: "horse" }));
  assert.strictEqual(n, 1);
  let v = await page.evaluate(() => ({ x: __valeros.x, y: __valeros.y, s: __valeros.texture.scaleX, sort: __valeros.sort, r: __valeros.flags["lucd20-automations"].riding }));
  console.log("mounted:", v);
  // Horse 2×2 at (400,400): rider centre at 400+60, 400+60 → top-left 410,410
  assert.deepStrictEqual([v.x, v.y, v.s, v.sort, v.r.corner], [410, 410, 0.5, 2, 0], "top-left corner, half scale, above the mount");

  // Rider can't move on its own (player client)
  const moved = await page.evaluate(() => Hooks.call("preMoveToken", __valeros, {}, {}));
  assert.strictEqual(moved, false, "rider blocked");

  // GM mounts Ezren too, any distance → next corner
  await page.evaluate(() => { game.user.isGM = true; game.user.isActiveGM = true; game.user.id = "u1"; __select(__ezren); __target(__horse); __pressM(); });
  await tick();
  v = await page.evaluate(() => [__ezren.x, __ezren.y, __ezren.flags["lucd20-automations"].riding.corner]);
  assert.deepStrictEqual(v, [490, 410, 1], "second rider: top-right corner");
  assert.deepStrictEqual(await page.evaluate(() => [__ezren.texture.scaleX, __ezren.flags["lucd20-automations"].riding.scaleX]), [1.5, 2], "scale 2 → 1.5 (0.5 taken off), 2 kept to restore");

  // Mount moves → riders follow
  await page.evaluate(() => __horse.update({ x: 200, y: 200 }));
  await tick();
  v = await page.evaluate(() => [[__valeros.x, __valeros.y], [__ezren.x, __ezren.y]]);
  assert.deepStrictEqual(v, [[210, 210], [290, 210]], "riders follow the mount");

  // Dismount Valeros with M → closest free square, scale back, flags cleared
  await page.evaluate(() => { __select(__valeros); __pressM(); });
  await tick();
  v = await page.evaluate(() => ({ x: __valeros.x, y: __valeros.y, s: __valeros.texture.scaleX, riding: __valeros.flags["lucd20-automations"]?.riding }));
  console.log("dismounted:", v);
  assert.strictEqual(v.s, 1, "scale restored");
  assert.strictEqual(v.riding, undefined, "flags cleared");
  const onHorse = v.x >= 200 && v.x < 400 && v.y >= 200 && v.y < 400;
  assert.ok(!onHorse, "not on the horse");
  assert.ok(Math.abs(v.x - 250) <= 200 && Math.abs(v.y - 250) <= 200, "next to the horse");

  // GM drags a rider → it gets off (no snap back)
  await page.evaluate(() => __ezren.update({ x: 800, y: 800 }));
  await tick();
  assert.deepStrictEqual(await page.evaluate(() => [__ezren.x, __ezren.texture.scaleX, !!__ezren.flags["lucd20-automations"]?.riding]), [800, 2, false], "dragged off: dismounted in place, scale 2 back");

  // Turning Rideable off dismounts riders
  await page.evaluate(() => { __select(__valeros); __target(__horse); __pressM(); });
  await tick();
  await page.click("#token-hud .lucd20-rideable");
  await tick();
  assert.deepStrictEqual(await page.evaluate(() => [!!__valeros.flags["lucd20-automations"]?.riding, __horse.flags["lucd20-automations"].rideable]), [false, false], "not Rideable: riders get off");

  // Feature off: M does nothing
  await set("riding_enabled", false);
  assert.strictEqual(await page.evaluate(() => __pressM()), false, "off: key does nothing");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 21 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
