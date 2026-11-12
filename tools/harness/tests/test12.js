const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

async function setup(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const app = new PIXI.Application({ width: 1400, height: 700, background: 0x2b2f2b });
    document.body.append(app.view);
    app.view.style.cssText = "position:absolute;left:0;top:0";
    const iface = new PIXI.Container(), controls = new PIXI.Container();
    const grid = new PIXI.Graphics(); grid.lineStyle(1, 0x444444);
    for (let x = 0; x <= 1400; x += 100) grid.moveTo(x, 0).lineTo(x, 700);
    for (let y = 0; y <= 700; y += 100) grid.moveTo(0, y).lineTo(1400, y);
    const wallG = new PIXI.Graphics();
    app.stage.addChild(grid, wallG, iface, controls);
    window.__door = { open: false };
    const drawWall = () => { wallG.clear().lineStyle(6, 0xffcc00).moveTo(900, 0).lineTo(900, 500).lineStyle(6, __door.open ? 0x44aa44 : 0xcc3333).moveTo(900, 500).lineTo(900, 600).lineStyle(6, 0xffcc00).moveTo(900, 600).lineTo(900, 700); };
    drawWall(); window.__drawWall = drawWall;
    // wall at x=900 with a door between y=300..400
    const crosses = (a, b) => {
      if ((a.x - 900) * (b.x - 900) >= 0) return false;
      const y = a.y + ((b.y - a.y) * (900 - a.x)) / (b.x - a.x);
      return !(__door.open && y >= 500 && y <= 600);
    };
    CONFIG.Canvas.polygonBackends.sight = {
      testCollision: (a, b) => crosses(a, b),
      create: (o, { radius }) => ({ points: Array.from({ length: 48 }, (_, i) => { const t = (i / 24) * Math.PI; return [o.x + radius * Math.cos(t), o.y + radius * Math.sin(t)]; }).flat() })
    };
    window.__log = { pause: [], pan: [], text: [], chat: [], rolls: [] };
    game.users = Object.assign([{ id: "u1", name: "Gamemaster", isGM: true }, { id: "p1", name: "Alice", isGM: false }], { activeGM: null, get(id) { return this.find(u => u.id === id); } });
    game.paused = false;
    game.togglePause = (p) => { game.paused = p; __log.pause.push(p); };
    window.ChatMessage = { create: async d => { __log.chat.push(d); return d; } };
    foundry.utils.hasProperty = (o, p) => p.split(".").reduce((x, k) => (x && k in x ? x[k] : undefined), o) !== undefined;
    window.CONST.REGION_VISIBILITY = { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
    window.CONST.TEXT_ANCHOR_POINTS = { CENTER: 0, BOTTOM: 1, TOP: 2 };

    const registry = {};
    window.fromUuidSync = uuid => registry[uuid];
    const coll = arr => { arr.get = function (id) { return this.find(x => x.id === id); }; return arr; };
    const mkFlags = doc => {
      doc.flags ??= {};
      doc.getFlag = (ns, k) => doc.flags?.[ns]?.[k];
      // Like Foundry: plain objects merge into what is stored; arrays and null replace.
      const merge = (target, key, value) => {
        const isObj = v => v && typeof v === "object" && !Array.isArray(v);
        if (isObj(value) && isObj(target[key])) { for (const [k, v] of Object.entries(value)) merge(target[key], k, v); }
        else target[key] = isObj(value) ? structuredClone(value) : value;
      };
      doc.update = async changes => {
        for (const [k, v] of Object.entries(changes)) {
          const parts = k.split("."); let o = doc;
          for (const p of parts.slice(0, -1)) o = o[p] ??= {};
          merge(o, parts.at(-1), v);
        }
        Hooks.callAll(`update${doc.documentName}`, doc, foundry.utils.expandObject ? foundry.utils.expandObject(changes) : changes, {}, game.user.id);
      };
    };
    foundry.utils.expandObject = o => { const out = {}; for (const [k, v] of Object.entries(o)) foundry.utils.setProperty(out, k, v); return out; };
    const scene = { id: "s1", tokens: coll([]), regions: coll([]),
      async createEmbeddedDocuments(type, data) {
        if (type !== "Region") return;
        for (const d of data) {
          const r = { ...structuredClone(d), id: "r" + (this.regions.length + 1), documentName: "Region", parent: this };
          r.uuid = `Scene.s1.Region.${r.id}`; mkFlags(r); r.delete = async () => { this.regions.splice(this.regions.indexOf(r), 1); Hooks.callAll("deleteRegion", r); };
          registry[r.uuid] = r; this.regions.push(r); Hooks.callAll("createRegion", r);
        }
      } };
    game.scenes = [scene];

    const actor = (id, name, opts = {}) => {
      const a = { id, name, uuid: `Actor.${id}`, type: opts.type ?? "character", hasPlayerOwner: opts.type !== "hazard",
        items: coll([{ id: "srch", slug: "search" }, { id: "scout", slug: "scout" }]),
        system: { exploration: opts.exploration ?? [], attributes: opts.stealth ? { stealth: opts.stealth } : {} },
        perception: { rank: opts.rank ?? 1, roll: async args => { const result = __results[id] ?? { total: 25, degreeOfSuccess: 2 }; __log.rolls.push({ who: name, args }); return result; } } };
      a.getActiveTokens = () => scene.tokens.filter(t => t.actor === a).map(t => t.object);
      return a;
    };
    window.__results = {};
    const A = {
      amiri: actor("amiri", "Amiri", { exploration: ["srch"], rank: 2 }),
      ezren: actor("ezren", "Ezren", { exploration: ["scout"], rank: 3 }),
      trap: actor("trap", "Poisoned Dart Gallery", { type: "hazard", stealth: { dc: 20, details: "(expert) a careful search reveals holes" } }),
      pit: actor("pit", "Hidden Pit", { type: "hazard", stealth: { dc: 18, details: "" } })
    };
    window.__A = A;
    game.actors = coll(Object.values(A));
    game.actors.party = { members: [A.amiri, A.ezren] };
    const colors = { amiri: 0x3366cc, ezren: 0x9955cc, trap: 0xaa3333, pit: 0x886644 };
    const token = (id, a, x, y, opts = {}) => {
      const t = { id, uuid: `Scene.s1.Token.${id}`, documentName: "Token", name: a.name, actor: a, parent: scene, x, y, width: 1, height: 1, hidden: !!opts.hidden, actorLink: true };
      mkFlags(t);
      const g = new PIXI.Graphics(); g.beginFill(colors[a.id], t.hidden ? 0.35 : 1).drawRoundedRect(8, 8, 84, 84, 12).endFill();
      const label = new PIXI.Text(a.name.split(" ")[0], { fontSize: 13, fill: 0xffffff }); label.position.set(12, 10); g.addChild(label);
      g.position.set(x, y); app.stage.addChildAt(g, 2);
      t.object = { document: t, get center() { return { x: t.x + 50, y: t.y + 50 }; } };
      const orig = t.update;
      t.update = async c => { await orig(c); g.position.set(t.x, t.y); g.alpha = t.hidden ? 0.35 : 1; };
      registry[t.uuid] = t; scene.tokens.push(t);
      return t;
    };
    window.__T = {
      amiri: token("tA", A.amiri, 100, 500),
      ezren: token("tE", A.ezren, 100, 300),
      trap: token("tTrap", A.trap, 1000, 500, { hidden: true }),
      pit: token("tPit", A.pit, 300, 0, { hidden: true })
    };
    window.canvas = { ready: true, app, scene, stage: app.stage, interface: Object.assign(iface, { createScrollingText: (p, t) => __log.text.push([Math.round(p.x), Math.round(p.y), t]) }),
      controls, dimensions: { size: 100, distance: 5, distancePixels: 20, width: 1400, height: 700 },
      animatePan: o => __log.pan.push(o), tokens: { placeables: [] } };
    window.canvas.canvasCoordinatesFromClient = p => ({ x: p.x, y: p.y });
    ui.controls = { render() {} };
    window.__move = (key, x, y) => __T[key].update({ x, y });
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done);
  await setup(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const flags = key => page.evaluate(k => __T[k].flags["lucd20-automations"]?.hazardSearch ?? null, key);
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...__log, chat: __log.chat.map(c => c.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()), whisper: __log.chat.map(c => c.whisper) })));
  const reset = () => page.evaluate(() => { for (const k of Object.keys(__log)) __log[k].length = 0; game.paused = false; });

  await set("hazardDetection_defaultRange", 15);
  await set("searchAutomation_enabled", true);
  await set("hazardDetection_enabled", true);
  await page.waitForTimeout(400);

  // tools in the Token controls
  const tools = await page.evaluate(() => { const c = { tokens: { tools: {} } }; Hooks.callAll("getSceneControlButtons", c); return Object.keys(c.tokens.tools); });
  assert.deepStrictEqual(tools, ["lucd20SearchSpot", "lucd20SearchManager"]);
  // hazard areas drawn for the GM (auto-enabled, 50 ft)
  assert.ok(await page.evaluate(() => canvas.interface.children.some(c => c.children?.length >= 2)), "hazard areas drawn");
  await page.screenshot({ path: `${out}/p13-areas.png`, clip: { x: 0, y: 0, width: 1400, height: 700 } });

  // ===== Hazard behind a closed door: no roll; opening the door triggers it =====
  await page.evaluate(() => __move("amiri", 800, 500));   // 7.5 ft from the trap's edge, wall in between
  await page.waitForTimeout(300);
  assert.strictEqual((await log()).rolls.length, 0, "wall blocks the area");
  await page.evaluate(() => { __door.open = true; __drawWall(); Hooks.callAll("updateWall", {}, { ds: 1 }); });
  await page.waitForTimeout(600);
  let L = await log();
  console.log("door rolls:", L.rolls.map(r => r.who), "chat:", L.chat);
  assert.deepStrictEqual(L.rolls.map(r => r.who), ["Amiri"], "Searching characters with the rank roll; Ezren isn't Searching");
  const args = L.rolls[0].args;
  assert.deepStrictEqual([args.dc.value, args.action, args.traits[0], args.skipDialog, args.createMessage], [20, "search", "secret", true, false], "no separate roll message");
  assert.ok(args.extraRollOptions.includes("action:search"));
  assert.deepStrictEqual(L.pause, [true], "paused");
  assert.ok(L.pan.length === 1, "camera panned");
  assert.deepStrictEqual(L.text, [[850, 550, "Found something..."]], "text over the finder");
  assert.strictEqual(L.chat.length, 1, "one card for rolls and result");
  assert.ok(L.chat[0].includes("Poisoned Dart Gallery") && /Amiri .*25 Success \+5/.test(L.chat[0]) && L.chat[0].includes("Found by Amiri") && L.chat[0].includes("a door opened"), "GM card: " + L.chat[0]);
  assert.deepStrictEqual(L.whisper[0], ["u1"], "card is whispered to the GM");
  assert.strictEqual(await page.evaluate(() => __T.trap.hidden), false, "hazard revealed");
  assert.strictEqual((await flags("trap")).found, true);

  // ===== Failure is remembered: one failed roll per character per spot =====
  await reset();
  await page.evaluate(() => { __results.amiri = { total: 9, degreeOfSuccess: 1 }; });
  await page.evaluate(() => __move("amiri", 300, 150));  // next to the pit (no minimum proficiency)
  await page.waitForTimeout(400);
  L = await log();
  assert.deepStrictEqual(L.rolls.map(r => r.who), ["Amiri"]);
  assert.deepStrictEqual((await flags("pit")).failed, ["amiri"]);
  assert.deepStrictEqual(L.pause, [], "no pause on a miss");
  assert.ok(/Amiri .*9 Failure -9/.test(L.chat[0]) && L.chat[0].includes("Not found."), "GM card on a miss: " + L.chat[0]);
  await reset();
  await page.evaluate(() => __move("amiri", 350, 150));
  await page.waitForTimeout(400);
  assert.strictEqual((await log()).rolls.length, 0, "no second roll after a failure");

  // ===== Non-Searching option (hazards without a minimum proficiency) =====
  await reset();
  await page.evaluate(() => { __results.ezren = { total: 22, degreeOfSuccess: 2 }; });
  await page.evaluate(() => __move("ezren", 400, 250));
  await page.waitForTimeout(400);
  assert.strictEqual((await log()).rolls.length, 0, "option off: non-Searching Ezren doesn't trigger");
  await set("hazardDetection_nonSearching", true);
  await page.waitForTimeout(150);
  await page.evaluate(() => __move("ezren", 420, 200));
  await page.waitForTimeout(500);
  L = await log();
  assert.deepStrictEqual(L.rolls.map(r => r.who), ["Ezren"], "option on: Ezren rolls (Amiri already failed)");
  assert.strictEqual((await flags("pit")).found, true);
  await set("hazardDetection_nonSearching", false);

  // ===== Search spot: draw it with the tool, fill the form =====
  await reset();
  await page.evaluate(() => { const c = { tokens: { tools: {} } }; Hooks.callAll("getSceneControlButtons", c); c.tokens.tools.lucd20SearchSpot.onChange(); });
  await page.mouse.move(310, 610); await page.mouse.down(); await page.mouse.move(480, 680); await page.mouse.up();
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible(".lucd20-search-config"), "form opens right away");
  await page.evaluate(() => Object.assign(document.querySelector(".lucd20-search-config").style, { left: "820px", top: "60px" }));
  await page.fill('.lucd20-search-config [name="label"]', "Secret door");
  await page.fill('.lucd20-search-config [name="dc"]', "18");
  await page.selectOption('.lucd20-search-config [name="minRank"]', "1");
  await page.fill('.lucd20-search-config [name="note"]', "The bookcase swings open onto the vault.");
  await page.screenshot({ path: `${out}/p13-spot-form.png`, clip: { x: 800, y: 40, width: 420, height: 420 } });
  await page.click('.lucd20-search-config [data-action="save"]');
  await page.waitForTimeout(200);
  const region = await page.evaluate(() => { const r = canvas.scene.regions[0]; return { name: r.name, shape: r.shapes[0], vis: r.visibility, flags: r.flags["lucd20-automations"].searchSpot }; });
  console.log("region:", JSON.stringify(region));
  assert.strictEqual(region.name, "Search: Secret door");
  assert.deepStrictEqual([region.shape.x, region.shape.y, region.shape.width, region.shape.height], [300, 600, 200, 100], "snapped to the grid");
  assert.strictEqual(region.vis, 1, "GM-only region");
  assert.deepStrictEqual([region.flags.dc, region.flags.minRank, region.flags.found], [18, 1, false]);
  // Amiri walks through it (passing counts, even if the move ends outside)
  await page.evaluate(() => { __results.amiri = { total: 21, degreeOfSuccess: 2 }; __move("amiri", 100, 650); });
  await page.waitForTimeout(150);
  await reset();
  await page.evaluate(() => __move("amiri", 700, 650));
  await page.waitForTimeout(500);
  L = await log();
  assert.deepStrictEqual(L.rolls.map(r => r.who), ["Amiri"]);
  assert.ok(L.chat[0].includes("The bookcase swings open onto the vault."), "GM note on a find");
  assert.deepStrictEqual(L.text, [[750, 700, "Found something..."]]);

  // ===== Any part of the token counts: centre outside, edge inside =====
  await page.evaluate(() => __move("amiri", 100, 300));
  await page.waitForTimeout(300);
  await page.evaluate(() => { const r = canvas.scene.regions[0]; r.flags["lucd20-automations"].searchSpot.found = false; r.flags["lucd20-automations"].searchSpot.failed = []; });
  await reset();
  await page.evaluate(() => __move("amiri", 350, 520)); // token 350–450 × 520–620: overlaps the spot (y ≥ 600) by 20px; centre (400,570) is outside
  await page.waitForTimeout(400);
  assert.deepStrictEqual((await log()).rolls.map(r => r.who), ["Amiri"], "edge overlap triggers");

  // ===== Manager: Theater of Mind roll, reset, reset all =====
  await reset();
  await page.evaluate(() => { const c = { tokens: { tools: {} } }; Hooks.callAll("getSceneControlButtons", c); c.tokens.tools.lucd20SearchManager.onChange(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => Object.assign(document.querySelector(".lucd20-search-manager").style, { left: "820px", top: "60px" }));
  const rows = await page.$$eval(".lucd20-search-row", els => els.map(e => e.querySelector(".name").textContent + " | " + e.querySelector(".pill").textContent.trim()));
  console.log("manager:", rows);
  assert.strictEqual(rows.length, 3);
  assert.ok(rows.every(r => r.endsWith("Found")));
  await page.screenshot({ path: `${out}/p13-manager.png`, clip: { x: 800, y: 40, width: 480, height: 540 } });
  await page.click('.lucd20-search-row:has-text("Secret door") [data-action="reset"]');
  await page.waitForTimeout(200);
  // Theater of Mind: nobody moves, the GM rolls now; Amiri has no token on this scene
  await page.evaluate(() => { const t = __T.amiri; canvas.scene.tokens.splice(canvas.scene.tokens.indexOf(t), 1); });
  await page.click('.lucd20-search-row:has-text("Secret door") [data-action="roll"]');
  await page.waitForTimeout(500);
  L = await log();
  assert.deepStrictEqual(L.rolls.map(r => r.who), ["Amiri"]);
  assert.ok(L.chat[0].includes("rolled by the GM") && L.chat[0].includes("Found something..."), "no token → text goes in the card");
  assert.deepStrictEqual(L.text, []);
  await page.click('.lucd20-search-manager [data-action="resetAll"]');
  await page.waitForTimeout(300);
  const after = await page.$$eval(".lucd20-search-row .pill", els => els.map(e => e.textContent.trim()));
  assert.ok(after.every(p => p === "Hidden"), "everything hidden again after Reset all");

  // ===== Hazard settings from its token menu =====
  await page.evaluate(() => {
    const el = document.createElement("div"); el.innerHTML = `<div class="col left"></div><div class="col right"></div>`; document.body.append(el);
    window.__hud = { object: __T.trap.object, element: el }; Hooks.callAll("renderTokenHUD", __hud, el);
  });
  assert.ok(await page.evaluate(() => !!__hud.element.querySelector(".col.left .lucd20-hazard-search")));
  await page.evaluate(() => __hud.element.querySelector(".lucd20-hazard-search").click());
  await page.waitForTimeout(200);
  const form = await page.evaluate(() => { const f = document.querySelector(".lucd20-search-config form").elements; return { enabled: f.enabled.checked, range: f.range.value, dc: f.dc.value, minRank: f.minRank.value }; });
  assert.deepStrictEqual(form, { enabled: true, range: "15", dc: "20", minRank: "2" }, "prefilled: auto-on, default range, Stealth DC, (expert)");
  await page.fill('.lucd20-search-config [name="range"]', "0");
  await page.click('.lucd20-search-config [data-action="save"]');
  await page.waitForTimeout(200);
  assert.strictEqual((await flags("trap")).range, 0, "0 = unlimited");

  // "Already rolled" list in the hazard window, with remove
  await page.evaluate(() => { const el = document.createElement("div"); el.innerHTML = `<div class="col left"></div>`; document.body.append(el);
    Hooks.callAll("renderTokenHUD", { object: __T.pit.object, element: el }, el); el.querySelector(".lucd20-hazard-search").click(); });
  await page.waitForTimeout(250);
  // (Reset all cleared the pit; roll it again: Amiri misses, Ezren finds)
  await page.evaluate(() => document.querySelector(".lucd20-search-config [data-action='cancel']").click());
  await page.evaluate(async () => { __results.amiri = { total: 7, degreeOfSuccess: 0 }; __A.ezren.system.exploration = ["srch"]; __results.ezren = { total: 22, degreeOfSuccess: 2 }; });
  await page.evaluate(() => { const c = { tokens: { tools: {} } }; Hooks.callAll("getSceneControlButtons", c); c.tokens.tools.lucd20SearchManager.onChange(); });
  await page.waitForTimeout(200);
  await page.click('.lucd20-search-row:has-text("Hidden Pit") [data-action="roll"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const el = document.createElement("div"); el.innerHTML = `<div class="col left"></div>`; document.body.append(el);
    Hooks.callAll("renderTokenHUD", { object: __T.pit.object, element: el }, el); el.querySelector(".lucd20-hazard-search").click(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => Object.assign(document.querySelector(".lucd20-search-config").style, { left: "820px", top: "60px" }));
  const rolled = await page.$$eval(".lucd20-search-rolled", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  console.log("already rolled:", rolled);
  assert.deepStrictEqual(rolled, ["Amiri Missed · 7", "Ezren Found · 22"]);
  await page.screenshot({ path: `${out}/p13-rolled.png`, clip: { x: 800, y: 40, width: 420, height: 560 } });
  await page.click('.lucd20-search-rolled[data-actor="ezren"] [data-action="forget"]');
  await page.waitForTimeout(250);
  let pit = await flags("pit");
  assert.deepStrictEqual([Object.keys(pit.rolls), pit.found], [["amiri"], false], "removing the only finder: not found any more");
  await page.click('.lucd20-search-rolled[data-actor="amiri"] [data-action="forget"]');
  await page.waitForTimeout(250);
  pit = await flags("pit");
  assert.deepStrictEqual([pit.failed, Object.keys(pit.rolls)], [[], []], "Amiri can search again");
  // saving the form afterwards keeps the removals
  await page.click('.lucd20-search-config [data-action="save"]');
  await page.waitForTimeout(250);
  pit = await flags("pit");
  assert.deepStrictEqual([pit.failed, Object.keys(pit.rolls)], [[], []], "form save doesn't bring old rolls back");

  // Ctrl+H hides/shows the hazard areas
  const areaCount = () => page.evaluate(() => canvas.interface.children.reduce((n, c) => n + (c.children?.length ?? 0), 0));
  assert.ok(await areaCount() > 0);
  assert.ok(await page.evaluate(() => __keybindings["lucd20-automations.toggleHazardAreas"].onDown()));
  await page.waitForTimeout(300);
  assert.strictEqual(await areaCount(), 0, "Ctrl+H hides them");
  await page.evaluate(() => __keybindings["lucd20-automations.toggleHazardAreas"].onDown());
  await page.waitForTimeout(300);
  assert.ok(await areaCount() > 0, "and shows them again");

  // rank too low: hazard needs master
  await reset();
  await page.evaluate(() => __T.trap.update({ "flags.lucd20-automations.hazardSearch": { ...__T.trap.flags["lucd20-automations"].hazardSearch, minRank: 3, found: false, failed: [] } }));
  await page.evaluate(() => { canvas.scene.tokens.push(__T.amiri); __move("amiri", 800, 500); });
  await page.waitForTimeout(500);
  L = await log();
  const trapRolls = L.rolls.filter(r => r.args.label?.includes("Poisoned"));
  console.log("trap rolls (needs master):", trapRolls.map(r => r.who));
  assert.ok(!trapRolls.some(r => r.who === "Amiri"), "expert Amiri can't roll for a master hazard");
  assert.ok(trapRolls.some(r => r.who === "Ezren"), "master Ezren (now Searching) can");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 11 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
