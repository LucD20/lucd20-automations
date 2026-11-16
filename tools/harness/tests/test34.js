const { chromium } = require("playwright");
const assert = require("assert");
const fs = require("fs");
const out = __dirname;
const M = "lucd20-automations";

/** Phase 34: Setting Presets (capture, the server folder, viewing differences, applying, export without secrets). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });

  // A world as Foundry keeps it: Setting documents (JSON text), the browser's client store, modules, a server folder.
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const docs = [];
    const doc = (key, value, user = null) => { const d = { key, user, _source: { value: JSON.stringify(value) }, async update(change) { this._source.value = change.value; window.__docWrites.push([this.key, change.value]); } }; docs.push(d); return d; };
    window.__docWrites = [];
    window.__world = docs;
    const client = { data: {}, get length() { return Object.keys(this.data).length; }, key(i) { return Object.keys(this.data)[i]; }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
    window.__client = client;
    game.settings.storage = new Map([["world", docs], ["client", client]]);
    window.getDocumentClass = () => ({ create: async data => { doc(data.key, JSON.parse(data.value)); window.__docWrites.push([data.key, data.value, "created"]); } });
    game.settings.register("core", "moduleConfiguration", { scope: "world", config: false, type: Object, default: {} });
    game.settings.register("pf2e", "automation.rulesBasedVision", { name: "Rules-based vision", scope: "world", config: true, type: Boolean, default: true });
    const originalSet = game.settings.set;
    game.settings.set = async function (ns, key, value) { const full = `${ns}.${key}`; const d = docs.find(x => x.key === full && !x.user) ?? doc(full, value); d._source.value = JSON.stringify(value); return originalSet.call(this, ns, key, value); };
    const mod = (id, title, active) => [id, { id, title, active, version: "1.0" }];
    game.modules = new Map([mod("lucd20-automations", "LucD20 Automations", true), mod("dice-so-nice", "Dice So Nice!", true), mod("other", "Other Module", true), mod("sleepy", "Sleepy Module", false)]);
    game.user.id = "u1";
    game.world = { title: "First World" };
    game.version = "14.368";
    game.system.version = "8.7.0";
    // Stored values.
    doc("core.time", 12345);
    doc("core.moduleConfiguration", { "lucd20-automations": true, "dice-so-nice": true, other: true });
    doc("other.worldThing", true);
    doc("pf2e.automation.rulesBasedVision", false);
    doc("pf2e.worldSchemaVersion", 0.94);
    doc("dice-so-nice.maxDiceNumber", 30);
    doc("dice-so-nice.apiKey", "sk-very-secret");
    doc("lucd20-automations.lootPile_stashId", "abc123");
    doc("sleepy.volume", 7); // its module is not active: no registered setting
    doc("other.userThing", "mine", "u1");
    doc("other.userThing", "theirs", "u2");
    client.setItem("core.fontSize", "7");
    client.setItem("dice-so-nice.settings", JSON.stringify({ scale: 70 }));
    client.setItem("core.keybindings", JSON.stringify({ "core.pause": [{ key: "KeyP" }] }));
    client.setItem("some-other-site.junk", "1");
    game.settings.register("other", "userThing", { name: "OTHER.Mode", scope: "user", config: true, type: String, default: "" });
    // The server's folder.
    window.__files = {};
    const picker = { async createDirectory() {}, async browse(source, dir) { return { files: Object.keys(window.__files).map(n => `${dir}/${n}`) }; },
      async upload(source, dir, file) { if (window.__refuseUpload) throw new Error("no"); window.__files[file.name] = await file.text(); return { path: `${dir}/${file.name}` }; } };
    foundry.applications.apps = { FilePicker: { implementation: picker } };
    const realFetch = window.fetch;
    window.fetch = async (url, ...rest) => { const name = String(url).split("?")[0].split("/").pop(); return String(url).startsWith("lucd20-presets/") ? { json: async () => JSON.parse(window.__files[name]) } : realFetch(url, ...rest); };
    foundry.applications.api.DialogV2.confirm = async opts => { window.__confirm = opts.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); return window.__confirmAnswer ?? true; };
    window.__reloads = 0;
    foundry.utils.debouncedReload = () => { window.__reloads++; };
    window.__emits = [];
    game.socket.emit = name => window.__emits.push(name);
    // The Settings sidebar.
    const side = document.createElement("section"); side.id = "settings";
    side.innerHTML = '<section class="settings"><button type="button" data-app="configure">Configure Settings</button><button type="button" data-app="modules">Manage Modules</button></section>';
    Object.assign(side.style, { position: "fixed", right: "0", top: "0", width: "240px", background: "#222", padding: "8px" });
    document.body.append(side);
    ui.settings = { element: side };
  });
  await page.waitForSelector("#settings .lucd20-presets-open");
  assert.strictEqual(await page.$eval("#settings", e => [...e.querySelectorAll("button")].map(b => b.textContent.trim()).join(" | ")), "Configure Settings | Setting Presets | Manage Modules", "the button sits next to Configure Settings");

  // ---- Save: everything in this world and this browser, as a file on the server ----
  await page.click("#settings .lucd20-presets-open");
  const W = ".lucd20-presets-window";
  await page.waitForSelector(`${W} .lp-new`);
  await page.evaluate(w => Object.assign(document.querySelector(w).style, { left: "10px", top: "10px" }), W);
  assert.strictEqual(await page.$eval(`${W} .lucd20-loot-empty .title`, e => e.textContent), "No presets yet.");
  await page.fill(`${W} input[name="name"]`, "My PF2e setup");
  await page.click(`${W} [data-save]`);
  await page.waitForSelector(`${W} .lp-preset`);
  const saved = await page.evaluate(() => { const [name] = Object.keys(__files); return { name, data: JSON.parse(__files[name]) }; });
  assert.strictEqual(await page.evaluate(() => Object.keys(__files).length), 1, "one click, one preset");
  assert.ok(/^my-pf2e-setup-[a-z0-9]{4}\.json$/.test(saved.name), saved.name);
  assert.deepStrictEqual([saved.data.format, saved.data.name, saved.data.system.id, saved.data.worldTitle, saved.data.foundry], ["lucd20-setting-preset", "My PF2e setup", "pf2e", "First World", "14.368"]);
  assert.deepStrictEqual(saved.data.modules.map(m => m.id), ["dice-so-nice", "lucd20-automations", "other"], "the active modules, not the inactive one");
  assert.deepStrictEqual(saved.data.world, { "core.time": 12345, "other.worldThing": true, "pf2e.automation.rulesBasedVision": false, "pf2e.worldSchemaVersion": 0.94, "dice-so-nice.maxDiceNumber": 30,
    "dice-so-nice.apiKey": "sk-very-secret", "lucd20-automations.lootPile_stashId": "abc123", "sleepy.volume": 7 }, "every world setting, registered or not; the module list is kept apart");
  assert.deepStrictEqual(saved.data.user, { "other.userThing": "mine" }, "my per-user settings only");
  assert.deepStrictEqual(saved.data.client, { "core.fontSize": 7, "dice-so-nice.settings": { scale: 70 }, "core.keybindings": { "core.pause": [{ key: "KeyP" }] } }, "this browser's settings; other sites' keys are left out");
  assert.ok((await page.$eval(`${W} .lp-preset .sub`, e => e.textContent)).startsWith("Pathfinder Second Edition · 12 settings · 3 modules"));
  await page.screenshot({ path: `${out}/p34-list.png` });

  // ---- Another world: fewer modules active, other values ----
  await page.evaluate(() => {
    game.world.title = "Second World";
    const set = (key, value) => { __world.find(d => d.key === key && !d.user)._source.value = JSON.stringify(value); };
    set("other.worldThing", false);
    set("pf2e.automation.rulesBasedVision", true);
    set("dice-so-nice.maxDiceNumber", 10);
    set("core.time", 99);
    __world.splice(__world.findIndex(d => d.key === "sleepy.volume"), 1);
    __world.find(d => d.user === "u1")._source.value = JSON.stringify("changed");
    __client.setItem("core.fontSize", "5");
    game.modules.get("other").active = false;
    game.modules.get("sleepy").active = true;
    game.modules.delete("dice-so-nice");
    game.settings.settings.delete("other.worldThing"); // "other" is not running: its settings are not registered
    game.settings.settings.get("core.moduleConfiguration"); game.settings.set("core", "moduleConfiguration", { "lucd20-automations": true, sleepy: true });
    __docWrites.length = 0; __sets.length = 0;
  });
  await page.click(`${W} [data-action="view"]`);
  await page.waitForSelector(`${W} .lp-group`);
  const view = await page.evaluate(w => ({
    groups: [...document.querySelectorAll(`${w} .lp-group[data-namespace]`)].map(g => `${g.querySelector("summary strong").textContent} [${g.querySelector(".count").textContent}]${g.open ? " open" : ""}`),
    rows: Object.fromEntries([...document.querySelectorAll(`${w} .lp-row`)].map(r => [r.querySelector("[data-row]").dataset.row, `${r.querySelector(".name").textContent}=${r.querySelector(".lp-value").textContent} ${r.lastElementChild.textContent}${r.querySelector("[data-row]").checked ? " ✓" : ""}`])),
    modules: [...document.querySelectorAll(`${w} .lp-mod`)].map(m => m.textContent.replace(/\s+/g, " ").trim()),
    label: document.querySelector(`${w} [data-apply-label]`).textContent
  }), W);
  console.log(JSON.stringify(view, null, 1));
  assert.deepStrictEqual(view.groups, ["Foundry (core) [3 settings, 1 different] open", "Pathfinder Second Edition [2 settings, 1 different] open", "Dice So Nice! [3 settings, 2 different] open",
    "LucD20 Automations [1 settings, 0 different]", "Other Module [2 settings, 2 different] open", "Sleepy Module [1 settings, 1 different] open"], "grouped by module, core and the system first");
  assert.strictEqual(view.rows["world|pf2e.automation.rulesBasedVision"], "Rules-based vision=false different ✓", "a loaded module's setting shows its real name; a difference is ticked");
  assert.strictEqual(view.rows["world|dice-so-nice.maxDiceNumber"], "maxDiceNumber=30 different ✓", "a module that is not loaded: the raw key");
  assert.strictEqual(view.rows["world|core.time"], "time=12345 not applied", "the world clock belongs to its world");
  assert.strictEqual(view.rows["world|pf2e.worldSchemaVersion"], "worldSchemaVersion=0.94 not applied", "migration marks are never applied");
  assert.strictEqual(view.rows["world|lucd20-automations.lootPile_stashId"], "lootPile_stashId=abc123 not applied");
  assert.strictEqual(view.rows["client|core.fontSize"], "Font Size=7 different ✓");
  assert.strictEqual(view.rows["client|core.keybindings"], `keybindings={"core.pause":[{"key":"KeyP"}]} same`);
  assert.strictEqual(view.rows["user|other.userThing"], "Other mode=mine different ✓");
  assert.strictEqual(view.rows["world|sleepy.volume"], "volume=7 different ✓");
  assert.deepStrictEqual(view.modules, ["Dice So Nice!not installed", "LucD20 Automationsactive", "Other Modulewill be switched on"]);
  assert.strictEqual(view.label, "Apply 7 settings");
  await page.screenshot({ path: `${out}/p34-view.png` });
  // Search and "only differences".
  await page.fill(`${W} [data-search-box]`, "vision");
  assert.deepStrictEqual(await page.$$eval(`${W} .lp-row:not([hidden]) .name`, e => e.map(x => x.textContent)), ["Rules-based vision"]);
  await page.fill(`${W} [data-search-box]`, "");
  await page.check(`${W} [data-only-differs]`);
  assert.strictEqual(await page.$$eval(`${W} .lp-row:not([hidden])`, e => e.length), 7);
  await page.uncheck(`${W} [data-only-differs]`);
  // Untick one setting; a group's box unticks its rows.
  await page.uncheck(`${W} [data-row="client|core.fontSize"]`);
  await page.evaluate(w => document.querySelector(`${w} .lp-group[data-namespace="sleepy"] [data-group]`).click(), W);
  assert.strictEqual(await page.$eval(`${W} [data-apply-label]`, e => e.textContent), "Apply 5 settings");

  // ---- Apply ----
  await page.evaluate(() => { window.__confirmAnswer = false; });
  await page.click(`${W} [data-action="apply"]`);
  await page.waitForFunction(() => window.__confirm);
  const applied = await page.evaluate(() => ({ confirm: __confirm, sets: __sets.map(([k, v]) => [k, v]), docWrites: __docWrites, font: __client.getItem("core.fontSize"), dsn: __client.getItem("dice-so-nice.settings"),
    world: Object.fromEntries(__world.filter(d => !d.user).map(d => [d.key, JSON.parse(d._source.value)])), reloads: __reloads }));
  console.log(JSON.stringify(applied, null, 1));
  assert.strictEqual(applied.confirm, "5 settings applied. Modules: 1 switched on, 0 switched off. Not installed, skipped: Dice So Nice!. Reload now for everyone? Module changes and many settings need it.");
  assert.deepStrictEqual(applied.world["pf2e.automation.rulesBasedVision"], false, "a registered world setting, through Foundry's own set");
  assert.ok(applied.sets.some(([k, v]) => k === "pf2e.automation.rulesBasedVision" && v === false) && applied.sets.some(([k, v]) => k === "other.userThing" && v === "mine"));
  assert.deepStrictEqual(applied.docWrites, [["other.worldThing", "true"], ["dice-so-nice.maxDiceNumber", "30"]], "settings of modules that are not running are written as stored values, ready for when they start");
  assert.deepStrictEqual([applied.world["core.time"], applied.world["lucd20-automations.lootPile_stashId"], applied.world["sleepy.volume"]], [99, "abc123", undefined], "world data untouched; the unticked group not applied");
  assert.deepStrictEqual(applied.world["core.moduleConfiguration"], { "lucd20-automations": true, sleepy: true, other: true }, "the preset's modules are switched on; the others stay");
  assert.deepStrictEqual([applied.font, applied.dsn, applied.reloads], ["5", JSON.stringify({ scale: 70 }), 0], "the unticked client setting stays; no reload when declined");
  // Also switch off modules that are not in the preset (never this module), then reload.
  await page.waitForSelector(`${W} [data-switch-off]`);
  await page.evaluate(() => { game.modules.get("other").active = false; window.__confirmAnswer = true; window.__confirm = null; });
  await page.check(`${W} [data-switch-off]`);
  await page.click(`${W} [data-action="all"][data-mode="none"]`);
  await page.click(`${W} [data-action="apply"]`);
  await page.waitForFunction(() => window.__reloads === 1);
  assert.deepStrictEqual(await page.evaluate(() => [JSON.parse(__world.find(d => d.key === "core.moduleConfiguration")._source.value), __emits, __confirm.split(". ").slice(0, 2).join(". ")]),
    [{ "lucd20-automations": true, sleepy: false, other: true }, ["reload"], "0 settings applied. Modules: 1 switched on, 1 switched off"]);

  // ---- Update, export (without secrets by default), import, delete ----
  await page.click(`${W} [data-action="back"]`);
  await page.waitForSelector(`${W} .lp-preset`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(`${W} [data-action="export"]`)]);
  assert.strictEqual(dl.suggestedFilename(), "setting-preset-my-pf2e-setup.json");
  const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  assert.ok(!("dice-so-nice.apiKey" in exported.world) && "dice-so-nice.maxDiceNumber" in exported.world && "core.keybindings" in exported.client && !("where" in exported), "the API key is left out; keybindings are not a secret");
  await page.uncheck(`${W} [data-export-secrets]`);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click(`${W} [data-action="export"]`)]);
  assert.strictEqual(JSON.parse(fs.readFileSync(await dl2.path(), "utf8")).world["dice-so-nice.apiKey"], "sk-very-secret", "unless asked");
  await page.click(`${W} [data-action="update"]`);
  await page.waitForFunction(() => Object.values(__files).some(t => JSON.parse(t).worldTitle === "Second World"));
  assert.strictEqual(await page.evaluate(() => Object.keys(__files).length), 1, "updating keeps the same file");
  await page.setInputFiles(`${W} [data-import-file]`, { name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...exported, name: "Imported one" })) });
  await page.waitForFunction(w => document.querySelectorAll(`${w} .lp-preset`).length === 2, W);
  assert.deepStrictEqual(await page.$$eval(`${W} .lp-preset strong`, e => e.map(x => x.textContent)), ["Imported one", "My PF2e setup"]);
  await page.setInputFiles(`${W} [data-import-file]`, { name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{\"hello\":1}") });
  await page.waitForTimeout(200);
  assert.strictEqual(await page.$$eval(`${W} .lp-preset`, e => e.length), 2, "a file that is not a preset is refused");
  await page.click(`${W} .lp-preset:first-child [data-action="remove"]`);
  await page.waitForFunction(w => document.querySelectorAll(`${w} .lp-preset`).length === 1, W);
  assert.strictEqual(await page.evaluate(() => Object.values(__files).filter(t => JSON.parse(t).deleted).length), 1, "Foundry cannot delete files: the file is left as a marker and not listed");
  // A server that refuses uploads: the preset is kept in this world, and says so.
  await page.evaluate(() => { window.__refuseUpload = true; window.__infos = []; ui.notifications.warn = m => window.__infos.push("WARN " + m); });
  await page.fill(`${W} input[name="name"]`, "Local one");
  await page.click(`${W} [data-save]`);
  await page.waitForFunction(w => document.querySelectorAll(`${w} .lp-preset`).length === 2, W);
  assert.ok((await page.$eval(`${W} .lp-preset:first-child .sub`, e => e.textContent)).includes("in this world only"));
  assert.ok((await page.evaluate(() => __infos.at(-1))).startsWith("WARN The server did not accept the file"));

  // ---- Off without a reload; nothing for players ----
  await page.evaluate(() => game.settings.set("lucd20-automations", "settingPresets_enabled", false));
  await page.waitForTimeout(150);
  assert.deepStrictEqual(await page.evaluate(() => [document.querySelectorAll(".lucd20-presets-open").length, document.querySelectorAll(".lucd20-presets-window").length]), [0, 0]);
  const p2 = await browser.newPage();
  await p2.goto("http://localhost:8765/index.html?gm=0&system=pf2e");
  await p2.waitForFunction(() => window.__done, null, { timeout: 15000 });
  await p2.evaluate(() => { const side = document.createElement("section"); side.id = "settings"; side.innerHTML = '<button data-app="configure"></button>'; document.body.append(side); });
  await p2.waitForTimeout(200);
  assert.strictEqual(await p2.$$eval(".lucd20-presets-open", e => e.length), 0, "players get no button");

  assert.deepStrictEqual(errors, ["NOTIFY That file is not a setting preset."], "the only error shown is the refused import");
  console.log("PHASE 34 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
