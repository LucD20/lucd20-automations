const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 24: Token Tooltip editor (rows, preview, data browser, types, import, save). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done);
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    CONST.TOKEN_DISPOSITIONS = { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
    game.documentTypes = { Actor: ["character", "npc", "hazard", "familiar", "vehicle", "loot", "party"] };
    CONFIG.Actor = { typeLabels: {} };
    const actor = { type: "character", system: {
      attributes: { hp: { value: 62, max: 80, temp: 0 }, ac: { value: 22 } },
      saves: { fortitude: { value: 11 }, reflex: { value: 8 }, will: { value: 10 } },
      skills: { athletics: { value: 12 } }, perception: { value: 9 },
      resources: { heroPoints: { value: 1, max: 3 } }, movement: { speeds: { land: { value: 25 } } },
      details: { level: { value: 5 } }
    }, testUserPermission: () => true, isOwner: true };
    const token = { id: "t1", name: "Valeros", visible: true, actor, document: { id: "t1", name: "Valeros", x: 0, y: 0, width: 1, height: 1, elevation: 0, disposition: 1 } };
    Object.assign(canvas, { ready: true, dimensions: { size: 100, distance: 5 }, tokens: { controlled: [token], placeables: [token] } });
    foundry.applications.api.DialogV2.prompt = async opts => { const form = document.createElement("form"); form.innerHTML = opts.content; form.elements.json.value = window.__importJSON; return opts.ok.callback(null, { form }); };
    ui.notifications.error = m => (window.__errs ??= []).push(m);
  });
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  await set("tokenTooltip_enabled", true);

  // Hub card has the Edit rows button
  await page.evaluate(() => __hub.render());
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => !!document.querySelector('[data-feature="tokenTooltip"][data-feature-action="edit"]')), "Edit rows button in the card");
  await page.evaluate(() => document.querySelector('[data-feature="tokenTooltip"][data-feature-action="edit"]').click());
  await page.waitForTimeout(150);
  assert.ok(await page.isVisible(".lucd20-tooltip-editor"), "editor opens");
  const n = await page.$$eval(".lucd20-tooltip-editor .tt-row", e => e.length);
  assert.ok(n >= 10, `PF2e preset rows (${n})`);
  const previews = await page.$$eval(".lucd20-tooltip-editor .tt-row .tt-preview", e => e.slice(0, 4).map(x => x.textContent.trim()));
  console.log("previews:", previews);
  assert.deepStrictEqual(previews.slice(0, 3), ["62", "Healthy", "22"], "live preview of each value on the selected token");
  await page.evaluate(() => { const w = document.querySelector(".lucd20-tooltip-editor"); Object.assign(w.style, { position: "fixed", left: "10px", top: "10px", width: "1090px", height: "720px", display: "flex", flexDirection: "column" }); w.querySelector(".window-content").style.cssText = "flex:1;display:flex;flex-direction:column;min-height:0"; });
  await page.screenshot({ path: `${out}/p24-editor.png` });

  // Add a row, type a value → preview updates without a re-draw
  await page.click('.lucd20-tooltip-editor [data-action="add"]');
  await page.waitForTimeout(80);
  const last = ".lucd20-tooltip-editor .tt-row:last-child";
  await page.fill(`${last} textarea[name="value"]`, "{@saves.will.value + 10}");
  assert.strictEqual(await page.$eval(`${last} .tt-preview`, e => e.textContent), "20", "preview updates while typing");
  // Data browser: search and click → inserted into the focused row's block
  await page.fill(`${last} textarea[name="value"]`, "Lvl ");
  await page.focus(`${last} textarea[name="value"]`);
  await page.fill('.lucd20-tooltip-editor input[name="search"]', "level");
  await page.waitForTimeout(50);
  const found = await page.$$eval(".lucd20-tooltip-editor .tt-pick .tt-path", e => e.map(x => x.textContent));
  assert.ok(found.includes("details.level.value"), "browser finds the path");
  await page.evaluate(() => { const t = document.querySelector(".lucd20-tooltip-editor .tt-row:last-child textarea"); t.setSelectionRange(4, 4); });
  await page.click('.lucd20-tooltip-editor .tt-pick[data-path="details.level.value"]');
  await page.waitForTimeout(80);
  assert.strictEqual(await page.$eval(`${last} textarea[name="value"]`, e => e.value), "Lvl {@details.level.value}", "inserted as a block");
  assert.strictEqual(await page.$eval(`${last} .tt-preview`, e => e.textContent), "Lvl 5");
  await page.screenshot({ path: `${out}/p24-browser.png` });
  // Types chips: turn off npc for the new row
  await page.click(`${last} .tt-type[data-type="npc"]`);
  await page.waitForTimeout(50);
  // Who
  await page.selectOption(`${last} select[name="who"]`, "owner");
  // Save → setting holds the rows and the tooltip uses them
  await page.click('.lucd20-tooltip-editor [data-action="save"]');
  await page.waitForTimeout(100);
  const saved = await page.evaluate(() => game.settings.get("lucd20-automations", "tokenTooltipConfig"));
  const mine = saved.rows.at(-1);
  console.log("saved row:", mine);
  assert.strictEqual(mine.value, "Lvl {@details.level.value}");
  assert.strictEqual(mine.who, "owner");
  assert.ok(!mine.types.includes("npc") && mine.types.includes("character"), "types: all but npc");
  assert.ok(!(await page.isVisible(".lucd20-tooltip-editor")), "closed after save");

  // Import a Token Tooltip Alt export (cut-down from the owner's PF2e one)
  await page.evaluate(() => {
    const hp = { value: "{\nhp=<attributes.hp.value>;\nhp}", icon: "fa-heart", color: "#cd1818", expression: true };
    const ac = { value: "attributes.ac.value", icon: "fa-shield-alt", color: "#74a2be" };
    const fort = { value: "{<saves.fortitude.value>+10}", icon: "fa-chess-rook", color: "#c8621e", expression: true };
    const status = { value: "{\nhp=<attributes.hp.value>;\nhpm=<attributes.hp.max>;\nhp <= 0 ? \"Ø\" : \"Healthy\"\n}", icon: "fa-heart", color: "#cd1818", expression: true };
    const dist = { value: "let distance = token.distanceTo(_token)\nreturn \"~\"+Math.ceil(distance);", icon: "fa-ruler", color: "#707070", isFunction: true };
    const lists = (pairs) => ({ items: pairs.map(([d, items]) => ({ disposition: d, items })) });
    window.__importJSON = JSON.stringify({
      gmSettings: {
        default: lists([["FRIENDLY", [hp, ac, fort, dist]], ["NEUTRAL", [hp, ac, fort, dist]], ["HOSTILE", [hp, ac, fort, dist]], ["SECRET", []]]),
        loot: lists([["FRIENDLY", []], ["NEUTRAL", []], ["HOSTILE", []]])
      },
      playerSettings: {
        default: lists([["OWNED", [hp, ac, dist]], ["FRIENDLY", [hp, ac, dist]], ["NEUTRAL", [dist]], ["HOSTILE", [dist]], ["SECRET", []]]),
        npc: lists([["OWNED", [status, dist]], ["FRIENDLY", [status, dist]], ["NEUTRAL", [status, dist]], ["HOSTILE", [status, dist]]])
      }
    });
  });
  await page.evaluate(() => document.querySelector('[data-feature="tokenTooltip"][data-feature-action="edit"]').click());
  await page.waitForTimeout(100);
  await page.click('.lucd20-tooltip-editor [data-action="import"]');
  await page.waitForTimeout(100);
  const imported = await page.evaluate(() => [...document.querySelectorAll(".lucd20-tooltip-editor .tt-row")].map(r => [r.querySelector('input[name="icon"]').value, r.querySelector('select[name="who"]').value]));
  console.log("imported:", imported);
  assert.deepStrictEqual(imported, [["fa-heart", "friendly"], ["fa-shield-alt", "friendly"], ["fa-chess-rook", "gm"], ["fa-ruler", "all"], ["fa-heart", "others"]], "TTA lists merged into rows with who");
  assert.deepStrictEqual(await page.evaluate(() => window.__errs ?? []), []);

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 24 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
