const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 19: Door Icon Size, Secret Door Highlight, Locked Door Alert. */
async function setup(page) {
  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    CONST.WALL_DOOR_TYPES = { NONE: 0, DOOR: 1, SECRET: 2 };
    CONST.WALL_DOOR_STATES = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
    // Foundry V13-like DoorControl (40 px icon, positioned at the wall midpoint - 20)
    class DoorControl extends PIXI.Container {
      constructor(wall) { super(); this.wall = wall; }
      async draw() {
        this.bg ??= this.addChild(new PIXI.Graphics());
        this.bg.clear().beginFill(0x000000, 1).drawRoundedRect(-2, -2, 44, 44, 5).endFill();
        this.bg.alpha = 0.5;
        this.icon ??= this.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
        this.icon.width = this.icon.height = 40;
        this.icon.tint = this.wall.document.ds === 2 ? 0xff6666 : 0xffffff;
        this.border ??= this.addChild(new PIXI.Graphics());
        this.border.clear().lineStyle(1, 0xff5500, 0.8).drawRoundedRect(-2, -2, 44, 44, 5);
        this.border.visible = false;
        this.hitArea = new PIXI.Rectangle(-2, -2, 44, 44);
        this.reposition();
        return this;
      }
      reposition() { this.position.set(...this.wall.midpoint.map(p => p - 20)); }
      _onMouseDown(event) { window.__coreClicks = (window.__coreClicks ?? 0) + 1; return false; }
    }
    foundry.canvas = { containers: { DoorControl } };
    const app = new PIXI.Application({ width: 600, height: 300, background: 0x3a3f36 });
    document.body.append(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const gridLines = new PIXI.Graphics().lineStyle(1, 0x555555, 1);
    for (let x = 0; x <= 600; x += 150) gridLines.moveTo(x, 0).lineTo(x, 300);
    for (let y = 0; y <= 300; y += 150) gridLines.moveTo(0, y).lineTo(600, y);
    app.stage.addChild(gridLines);
    const doors = app.stage.addChild(new PIXI.Container());
    const scene = { id: "s1", grid: { size: 150 } };
    const mkWall = (id, mid, door, ds) => {
      const wall = { id, scene, midpoint: mid, document: { id, door, ds, parent: scene, async update(d) { Object.assign(this, d); window.__wallUpdates = (window.__wallUpdates ?? []).concat([[id, d]]); } } };
      const c = new DoorControl(wall);
      wall.doorControl = c;
      doors.addChild(c);
      return wall;
    };
    window.__walls = [mkWall("w1", [150, 150], 1, 0), mkWall("w2", [300, 150], 2, 0), mkWall("w3", [450, 150], 1, 2)];
    for (const w of __walls) await w.doorControl.draw();
    Object.assign(canvas, { ready: true, scene, grid: { size: 150 }, controls: { doors }, walls: { get: id => __walls.find(w => w.id === id) }, tokens: { controlled: [] } });
    window.__app = app;
    // Chat
    window.__messages = [];
    window.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor?.name ?? "?" }), create: async d => { __messages.push(d); return d; } };
    game.user.can = () => true;
    game.paused = false;
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 700, height: 360 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await setup(page);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const geo = page => page.evaluate(() => __walls.map(w => { const c = w.doorControl; const b = c.getBounds(); return { scale: +c.scale.x.toFixed(3), cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2), w: Math.round(c.icon.getBounds().width) }; }));

  // ---------- GM ----------
  let page = await open("gm=1");
  assert.ok(await page.evaluate(() => game.settings.get("lucd20-automations", "doorIconSize_enabled")), "door size on by default");
  // It started before the mock class existed: switch off and on (no reload needed)
  await set(page, "doorIconSize_enabled", false);
  await set(page, "doorIconSize_enabled", true);
  let g = await geo(page);
  console.log("scaled:", g);
  assert.strictEqual(g[0].w, 90, "150 px grid × 1.5 × 0.4 = 90 px icon");
  assert.deepStrictEqual([g[0].cx, g[0].cy], [150, 150], "centred on the door");
  // A re-draw keeps the size
  await page.evaluate(() => __walls[0].doorControl.draw());
  assert.strictEqual((await geo(page))[0].w, 90, "re-draw keeps the size");
  await set(page, "doorIconSize_factor", 1);
  assert.strictEqual((await geo(page))[0].w, 60, "factor change applies at once");
  await set(page, "doorIconSize_factor", 1.5);

  // Secret door highlight
  await set(page, "secretDoorHighlight_enabled", true);
  await page.waitForTimeout(150);
  const marks = await page.evaluate(() => __walls.map(w => !!w.doorControl.lucd20SecretMark));
  assert.deepStrictEqual(marks, [false, true, false], "only the secret door is marked");
  await page.evaluate(() => __walls[1].doorControl.draw());
  assert.ok(await page.evaluate(() => !!__walls[1].doorControl.lucd20SecretMark), "mark survives a re-draw");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/p19-doors.png`, clip: { x: 0, y: 0, width: 600, height: 300 } });
  // Door turned into a normal door → mark removed
  await page.evaluate(() => { __walls[1].document.door = 1; Hooks.callAll("updateWall", __walls[1].document, { door: 1 }, {}); });
  assert.ok(await page.evaluate(() => !__walls[1].doorControl.lucd20SecretMark), "mark removed when no longer secret");
  await page.evaluate(() => { __walls[1].document.door = 2; Hooks.callAll("updateWall", __walls[1].document, { door: 2 }, {}); });
  // Ask before opening: GM click on the closed secret door → confirm → opened
  await page.evaluate(() => { window.__coreClicks = 0; __walls[1].doorControl._onMouseDown({ button: 0, stopPropagation() {} }); });
  await page.waitForTimeout(50);
  assert.deepStrictEqual(await page.evaluate(() => [__coreClicks, __wallUpdates]), [0, [["w2", { ds: 1 }]]], "confirmed, then opened by us");
  await page.evaluate(() => { foundry.applications.api.DialogV2.confirm = async () => false; __walls[1].document.ds = 0; __wallUpdates = []; __walls[1].doorControl._onMouseDown({ button: 0, stopPropagation() {} }); });
  await page.waitForTimeout(50);
  assert.deepStrictEqual(await page.evaluate(() => [__walls[1].document.ds, __wallUpdates.length]), [0, 0], "cancelled: stays closed");
  // Normal doors are not asked
  await page.evaluate(() => __walls[0].doorControl._onMouseDown({ button: 0 }));
  assert.strictEqual(await page.evaluate(() => __coreClicks), 1, "normal door: Foundry handles it");
  await set(page, "secretDoorHighlight_confirmOpen", false);
  await page.evaluate(() => __walls[1].doorControl._onMouseDown({ button: 0 }));
  assert.strictEqual(await page.evaluate(() => __coreClicks), 2, "option off: no question");
  await set(page, "secretDoorHighlight_enabled", false);
  assert.ok(await page.evaluate(() => !__walls[1].doorControl.lucd20SecretMark), "off without reload");
  await set(page, "doorIconSize_enabled", false);
  g = await geo(page);
  assert.deepStrictEqual([g[0].w, g[0].scale], [40, 1], "icon size back to Foundry's");

  // GM clicking a locked door: no message
  await set(page, "lockedDoorAlert_enabled", true);
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 0 }));
  assert.strictEqual(await page.evaluate(() => __messages.length), 0, "GM gets no alert");

  // ---------- Player ----------
  page = await open("gm=0");
  await set(page, "lockedDoorAlert_enabled", false);
  await set(page, "lockedDoorAlert_enabled", true);
  await page.evaluate(() => { canvas.tokens.controlled = [{ actor: { name: "Valeros", isOwner: true }, document: { name: "Valeros" } }]; });
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 0 }));
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 0 }));  // spam
  await page.evaluate(() => __walls[0].doorControl._onMouseDown({ button: 0 }));  // closed, not locked
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 2 }));  // right click
  await page.waitForTimeout(50);
  const msgs = await page.evaluate(() => __messages.map(m => m.content));
  console.log("messages:", msgs);
  assert.strictEqual(msgs.length, 1, "one message, cooldown stops the spam");
  assert.ok(msgs[0].includes("Valeros") && msgs[0].includes("locked"));
  assert.strictEqual(await page.evaluate(() => __coreClicks), 4, "Foundry's own handling still runs");
  assert.ok(!(await page.evaluate(() => __messages[0].flags["lucd20-automations"].lockCard)), "no lock card outside PF2e");
  assert.deepStrictEqual(await page.evaluate(() => __messages[0].flags["lucd20-automations"].lockedDoor), { wallId: "w3", sceneId: "s1" });
  // After the cooldown, a new message
  await page.evaluate(() => { const t = Date.now; Date.now = () => t() + 10_500; });
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 0 }));
  assert.strictEqual(await page.evaluate(() => __messages.length), 2, "again after 10 s");
  // Paused: nothing
  await page.evaluate(() => { game.paused = true; const t = Date.now; Date.now = () => t() + 20_000; });
  await page.evaluate(() => __walls[2].doorControl._onMouseDown({ button: 0 }));
  assert.strictEqual(await page.evaluate(() => __messages.length), 2, "no message while paused");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 19 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
