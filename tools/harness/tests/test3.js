const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1");
  await page.waitForFunction(() => window.__done);

  // Build an older-style (PF2e-like) window and a newer-style (4e-like) window.
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="v1" class="app window-app" style="position:absolute;left:20px;top:20px;width:620px;border:1px solid #666">
        <header class="window-header flexrow" style="display:flex;gap:6px;padding:6px;align-items:center">
          <h4 class="window-title" style="flex:1;margin:0">Valeros (PF2e sheet)</h4>
          <a class="header-button control configure-sheet"><i class="fas fa-cog"></i>Sheet</a>
          <a class="header-button control configure-token"><i class="fas fa-user-circle"></i>Prototype Token</a>
          <a class="header-button control close"><i class="fas fa-times"></i>Close</a>
        </header>
      </div>
      <div id="v2" class="application sheet" style="position:absolute;left:20px;top:120px;width:620px;border:1px solid #666">
        <header class="window-header" style="display:flex;gap:6px;padding:6px;align-items:center">
          <h1 class="window-title" style="flex:1;margin:0;font-size:14px">Bob (4e sheet)</h1>
          <button type="button" class="header-control icon fa-solid fa-ellipsis-vertical" data-action="toggleControls"></button>
          <button type="button" class="header-control icon fa-solid fa-xmark" data-action="close"></button>
        </header>
        <menu class="controls-dropdown"></menu>
      </div>`;
    document.body.append(wrap);

    window.__calls = [];
    const baseControls = () => [
      { action: "configureSheet", icon: "fa-solid fa-gear", label: "Configure Sheet" },
      { action: "configureOwnership", icon: "fa-solid fa-user-lock", label: "Configure Ownership", visible: true },
      { action: "configurePrototypeToken", icon: "fa-solid fa-circle-user", label: "Prototype Token" },
      { action: "showArtwork", icon: "fa-solid fa-image", label: "View Character Artwork" }
    ];
    Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
      controls.push({ action: "dsnSettings", icon: "fa-solid fa-dice-d20", label: "3D Dice Settings", onClick: () => __calls.push("dsn") });
    });
    window.__v2 = {
      rendered: true,
      element: document.getElementById("v2"),
      options: { actions: {
        configureOwnership() { __calls.push("ownership:" + (this === __v2)); },
        configurePrototypeToken: { handler() { __calls.push("prototype"); } }
      } },
      *_headerControlButtons() {
        const controls = baseControls();
        Hooks.callAll("getHeaderControlsApplicationV2", this, controls);
        for (const c of controls) if (c.visible !== false) yield c;
      }
    };
    // what Foundry would render into the ⋮ menu
    window.__renderDropdown = () => {
      const menu = __v2.element.querySelector("menu");
      menu.innerHTML = [...__v2._headerControlButtons()].map(c => `<li><button data-action="${c.action}"><i class="${c.icon}"></i><span class="control-label">${c.label}</span></button></li>`).join("");
    };
    window.__v1 = { element: document.getElementById("v1"), document: { name: "Valeros" } };
  });

  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const render = () => page.evaluate(() => {
    __renderDropdown();
    Hooks.callAll("renderApplication", __v1, __v1.element);
    Hooks.callAll("renderApplicationV2", __v2, __v2.element);
  });

  // ----- Clean Title Bars -----
  await set("cleanTitleBars_enabled", true);
  await page.waitForTimeout(50);
  const v1Text = await page.$$eval("#v1 a.header-button", els => els.map(e => [e.textContent.trim(), e.dataset.tooltip]));
  console.log("V1 buttons after clean:", JSON.stringify(v1Text));
  assert.deepStrictEqual(v1Text, [["", "Sheet"], ["", "Prototype Token"], ["", "Close"]]);
  assert.strictEqual(await page.textContent("#v1 .window-title"), "Valeros (PF2e sheet)", "title kept");
  await page.screenshot({ path: `${out}/p3-v1-clean.png`, clip: { x: 0, y: 0, width: 680, height: 80 } });

  // switching off restores labels
  await set("cleanTitleBars_enabled", false);
  await page.waitForTimeout(50);
  assert.deepStrictEqual(await page.$$eval("#v1 a.header-button", els => els.map(e => e.textContent.trim())), ["Sheet", "Prototype Token", "Close"]);
  assert.strictEqual(await page.$$eval("#v1 [data-tooltip]", e => e.length), 0);
  await set("cleanTitleBars_enabled", true);
  await page.waitForTimeout(50);

  // ----- Header Buttons -----
  await set("headerButtons_extras", "3D Dice Settings");
  await set("headerButtons_enabled", true);
  await page.waitForTimeout(100);
  await render();
  const promoted = await page.$$eval("#v2 .window-header [data-lucd20-promoted]", els => els.map(e => e.dataset.tooltip));
  console.log("V2 promoted:", promoted.join(", "));
  assert.deepStrictEqual(promoted, ["Configure Ownership", "Prototype Token", "3D Dice Settings"]);
  // icon is its own element (styling modules can't replace the glyph)
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("#v2 [data-lucd20-promoted]")].every(b => b.querySelector("i.fa-fw") && !/\bfa-/.test(b.className))));
  // placed before the ⋮ button
  assert.strictEqual(await page.evaluate(() => document.querySelector('#v2 [data-action="toggleControls"]').previousElementSibling.dataset.tooltip), "3D Dice Settings");
  // hidden in the ⋮ menu (still there for Foundry), ⋮ button still visible
  const dropdown = await page.$$eval("#v2 menu [data-action]", els => els.filter(e => !e.closest(".lucd20-promoted-hidden")).map(e => e.dataset.action));
  assert.deepStrictEqual(dropdown, ["configureSheet", "showArtwork"]);
  assert.strictEqual(await page.$$eval("#v2 menu [data-action]", e => e.length), 5, "Foundry's list untouched");
  assert.ok(await page.isVisible('#v2 [data-action="toggleControls"]'));
  // Foundry rebuilding the menu re-hides promoted items
  await page.evaluate(() => __renderDropdown());
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval("#v2 menu .lucd20-promoted-hidden", e => e.length), 3);
  // clicking runs the original controls
  await page.click('#v2 [data-lucd20-promoted="configureOwnership"]');
  await page.click('#v2 [data-lucd20-promoted="configurePrototypeToken"]');
  await page.click('#v2 [data-lucd20-promoted="dsnSettings"]');
  assert.deepStrictEqual(await page.evaluate(() => __calls), ["ownership:true", "prototype", "dsn"]);
  // re-render doesn't duplicate
  await render();
  assert.strictEqual(await page.$$eval("#v2 [data-lucd20-promoted]", e => e.length), 3);
  await page.screenshot({ path: `${out}/p3-v2-promoted.png`, clip: { x: 0, y: 100, width: 680, height: 80 } });

  // option off → button gone
  await set("headerButtons_ownership", false);
  await page.waitForTimeout(150);
  await render();
  assert.deepStrictEqual(await page.$$eval("#v2 [data-lucd20-promoted]", els => els.map(e => e.dataset.tooltip)), ["Prototype Token", "3D Dice Settings"]);
  assert.ok((await page.$$eval("#v2 menu [data-action]", els => els.filter(e => !e.closest(".lucd20-promoted-hidden")).map(e => e.dataset.action))).includes("configureOwnership"));

  // older-style sheet gets Configure Ownership (GM only)
  await set("headerButtons_ownership", true);
  await page.waitForTimeout(150);
  const buttons = await page.evaluate(() => {
    const b = [{ label: "Sheet", class: "configure-sheet" }, { label: "Close", class: "close" }];
    Hooks.callAll("getDocumentSheetHeaderButtons", __v1, b);
    return b.map(x => x.label);
  });
  assert.deepStrictEqual(buttons, ["Configure Ownership", "Sheet", "Close"]);
  const already = await page.evaluate(() => {
    const b = [{ label: "Ownership", class: "configure-ownership" }];
    Hooks.callAll("getDocumentSheetHeaderButtons", __v1, b);
    return b.length;
  });
  assert.strictEqual(already, 1, "no duplicate if the sheet already has it");

  // feature off → promoted removed
  await set("headerButtons_enabled", false);
  await page.waitForTimeout(50);
  assert.strictEqual(await page.$$eval("#v2 [data-lucd20-promoted]", e => e.length), 0);
  assert.strictEqual(await page.$$eval(".lucd20-promoted-hidden", e => e.length), 0, "menu restored");

  await browser.close();
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
  console.log("PHASE 3 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
