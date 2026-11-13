const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 23: Token Tooltip (display, who sees what, PF2e preset, expressions). */
async function setup(page, { gm }) {
  await page.evaluate(async gm => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    CONST.TOKEN_DISPOSITIONS = { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
    CONST.GRID_DIAGONALS = { EQUIDISTANT: 0, EXACT: 1, APPROXIMATE: 2, RECTILINEAR: 3, ALTERNATING_1: 4, ALTERNATING_2: 5, ILLEGAL: 6 };
    const app = new PIXI.Application({ width: 900, height: 500, background: 0x3a3f36 });
    document.body.prepend(app.view);
    app.view.style.cssText = "position:fixed;left:0;top:0";
    const mkActor = (type, owned, system) => ({ type, system, testUserPermission: () => owned, get isOwner() { return gm || owned; } });
    const mkToken = (id, x, y, actor, disposition, elevation = 0) => {
      const t = new PIXI.Container();
      t.id = id; t.actor = actor; t.visible = true;
      t.document = { id, x, y, width: 1, height: 1, elevation, disposition };
      t.position.set(x, y);
      t.addChild(new PIXI.Graphics().beginFill(0xbbbbbb).drawRect(0, 0, 100, 100).endFill());
      app.stage.addChild(t);
      return t;
    };
    const valeros = mkToken("val", 100, 100, mkActor("character", !gm, {
      attributes: { hp: { value: 62, max: 80, temp: 0 }, ac: { value: 22 } },
      saves: { fortitude: { value: 11 }, reflex: { value: 8 }, will: { value: 10 } },
      skills: { athletics: { value: 12 } }, perception: { value: 9 },
      resources: { heroPoints: { value: 1, max: 3 } },
      movement: { speeds: { land: { value: 25 }, climb: { value: 15 } } }
    }), 1);
    const goblin = mkToken("gob", 500, 100, mkActor("npc", false, {
      attributes: { hp: { value: 4, max: 20, temp: 5 }, ac: { value: 16 } },
      saves: { fortitude: { value: 5 }, reflex: { value: 7 }, will: { value: 3 } },
      skills: { athletics: { value: 6 }, stealth: { value: 9 } }, perception: { value: 4 },
      movement: { speeds: { land: { value: 25 }, fly: { value: 30 } } }
    }), -1, 10);
    Object.assign(canvas, { ready: true, app, stage: app.stage, dimensions: { size: 100, distance: 5 }, grid: { diagonals: 4 },
      tokens: { controlled: [valeros], placeables: [valeros, goblin] } });
    window.__t = { valeros, goblin };
  }, gm);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}&system=pf2e`);
    await page.waitForFunction(() => window.__done);
    return page;
  };
  const cells = page => page.$$eval("#lucd20-token-tooltip .tt-cell", els => els.map(e => [e.querySelector("i").className.replace(/ fa-fw|fa-solid /g, "").trim(), e.innerText.trim()]));

  // ---------- GM ----------
  let page = await open("gm=1");
  await setup(page, { gm: true });
  await page.evaluate(() => game.settings.set("lucd20-automations", "tokenTooltip_enabled", true));
  await page.evaluate(() => Hooks.callAll("hoverToken", __t.goblin, true));
  await page.waitForTimeout(50);
  let c = await cells(page);
  console.log("GM on goblin:", JSON.stringify(c));
  const map = Object.fromEntries(c);
  assert.strictEqual(map["fa-heart"], "4 (5)", "HP with temp");
  assert.strictEqual(map["fa-shield-halved"], "16");
  assert.strictEqual(map["fa-chess-rook"], "15", "Fort DC");
  assert.strictEqual(map["fa-eye"], "14", "Perception DC (NPC)");
  assert.strictEqual(map["fa-eye-slash"], "19", "Stealth DC");
  assert.strictEqual(map["fa-feather-pointed"], "30", "fly speed shown");
  assert.ok(!("fa-worm" in map), "no burrow speed → row hidden");
  assert.ok(!("fa-star" in map), "hero points only on characters");
  assert.strictEqual(map["fa-ruler"], "~25", "distance from Valeros: 20 ft across + 10 ft up (one diagonal)");
  assert.ok(c.length > 5 && await page.$eval("#lucd20-token-tooltip .tt-grid", e => getComputedStyle(e).gridTemplateRows.split(" ").length) === Math.ceil(c.length / 2), "two columns");
  const box = await page.$eval("#lucd20-token-tooltip", e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
  assert.deepStrictEqual(box, [608, 100], "right of the token, top aligned");
  await page.screenshot({ path: `${out}/p23-gm.png`, clip: { x: 480, y: 80, width: 400, height: 260 } });
  // Pan: follows
  await page.evaluate(() => { canvas.stage.position.set(-100, 0); canvas.app.renderer.render(canvas.stage); Hooks.callAll("canvasPan", canvas, {}); });
  assert.strictEqual(await page.$eval("#lucd20-token-tooltip", e => Math.round(e.getBoundingClientRect().left)), 508, "follows the pan");
  // Dragging on the map hides it, and it doesn't come back until the button is released
  await page.evaluate(() => { const v = canvas.app.view; v.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); Hooks.callAll("hoverToken", __t.goblin, true); });
  assert.ok(!(await page.isVisible("#lucd20-token-tooltip")), "hidden while dragging");
  await page.evaluate(() => { document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); Hooks.callAll("hoverToken", __t.goblin, true); });
  assert.ok(await page.isVisible("#lucd20-token-tooltip"), "back after the drag");
  // Hover out → hidden
  await page.evaluate(() => Hooks.callAll("hoverToken", __t.goblin, false));
  assert.ok(!(await page.isVisible("#lucd20-token-tooltip")), "hidden on hover out");

  // Old Token Tooltip Alt expressions, pasted as they were
  const results = await page.evaluate(async () => {
    const { evaluate } = await import("/modules/lucd20-automations/scripts/features/token-tooltip/expressions.js");
    const v = __t.valeros;
    return [
      evaluate("{\nhp=<attributes.hp.value>;\nhpm=<attributes.hp.max>;\nhpt=<attributes.hp.temp>;\nhpt=compareText(typeOf(hpt), \"null\") == 0 ? 0 : hpt;\nhp == 0 ? \"Ø\" : hpt == 0 ? hp : concat(string(hp), \" (\",string(hpt),\")\")\n}", v),
      evaluate("{<saves.fortitude.value>+10}", v),
      evaluate("{\n\tmove=<movement.speeds.burrow.value>;\n\tmove=compareText(typeOf(move), \"undefined\") == 0 ? \"\" : concat(string(move))\n}", v),
      evaluate("{\n\tmove=<movement.speeds.climb.value>;\n\tmove=compareText(typeOf(move), \"undefined\") == 0 ? \"\" : concat(string(move))\n}", v),
      evaluate("P: {<saves.will.value>}", v),
      evaluate("resources.heroPoints", v),
      evaluate("return data.attributes.hp.value * 2", v),
      evaluate("{@attributes.ac.value + 1}", v),
      evaluate("{nope.nothing}", v),
      typeof window.hp
    ];
  });
  console.log("expressions:", results);
  assert.deepStrictEqual(results, ["62", "21", undefined, "15", "P: 10", "1/3", "124", "23", undefined, "undefined"], "old expressions work; empty → hidden; no globals leaked");

  // ---------- Player (owns Valeros) ----------
  page = await open("gm=0");
  await setup(page, { gm: false });
  await page.evaluate(() => game.settings.set("lucd20-automations", "tokenTooltip_enabled", true));
  await page.evaluate(() => Hooks.callAll("hoverToken", __t.goblin, true));
  c = await cells(page);
  console.log("player on goblin:", JSON.stringify(c));
  assert.deepStrictEqual(c, [["fa-heart", "Critical"], ["fa-ruler", "~25"]], "player: HP status + distance only");
  await page.screenshot({ path: `${out}/p23-player-npc.png`, clip: { x: 480, y: 80, width: 300, height: 120 } });
  await page.evaluate(() => { Hooks.callAll("hoverToken", __t.goblin, false); canvas.tokens.controlled = []; Hooks.callAll("hoverToken", __t.valeros, true); });
  c = await cells(page);
  console.log("player on own PC:", JSON.stringify(c));
  const own = Object.fromEntries(c);
  assert.strictEqual(own["fa-heart"], "62");
  assert.strictEqual(own["fa-star"], "1/3", "hero points");
  assert.ok(!("fa-chess-rook" in own), "GM-only rows hidden");
  assert.ok(!("fa-ruler" in own), "no distance to itself / no reference token");
  // Hidden token for players: nothing
  await page.evaluate(() => { __t.goblin.visible = false; Hooks.callAll("hoverToken", __t.goblin, true); });
  assert.ok(!(await page.isVisible("#lucd20-token-tooltip")), "no tooltip on a token you can't see");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 23 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
