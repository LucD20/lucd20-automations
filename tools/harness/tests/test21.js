const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 20: PF2e door locks (wall settings, card, best party member, results). */
async function setup(page) {
  await page.evaluate(async () => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    CONST.WALL_DOOR_TYPES = { NONE: 0, DOOR: 1, SECRET: 2 };
    CONST.WALL_DOOR_STATES = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
    CONFIG.PF2E = { ...(CONFIG.PF2E ?? {}), skills: { acrobatics: { label: "Acrobatics" }, arcana: { label: "Arcana" }, athletics: { label: "Athletics" }, thievery: { label: "Thievery" } } };
    const mkActor = (id, name, mods, owned, toolkit) => ({
      id, name, type: "character", hasPlayerOwner: true, get isOwner() { return game.user.isGM || owned; },
      getStatistic: slug => (slug in mods ? { mod: mods[slug], roll: async () => ({ degreeOfSuccess: 2 }) } : null),
      itemTypes: { equipment: toolkit ? [{ slug: "thieves-toolkit", name: "Thieves' Toolkit" }] : [] },
      getActiveTokens: () => [{ parent: { id: "s1" } }]
    });
    const amiri = mkActor("a1", "Amiri", { athletics: 12, thievery: 1, arcana: 0 }, false, false);
    const ezren = mkActor("a2", "Ezren", { athletics: 2, thievery: 5, arcana: 11 }, false, true);
    const merisiel = mkActor("a3", "Merisiel", { athletics: 6, thievery: 13, arcana: 1 }, true, true);
    game.actors = Object.assign([amiri, ezren, merisiel], { get: id => [amiri, ezren, merisiel].find(a => a.id === id), party: { members: [amiri, ezren, merisiel] } });
    game.user.character = merisiel;
    // PF2e actions: record the call, answer with the outcome the test sets
    window.__rolls = [];
    window.__nextOutcome = "success";
    game.pf2e = {
      Modifier: class { constructor(d) { Object.assign(this, d); } },
      actions: {
        forceOpen: o => { __rolls.push(["forceOpen", o.actors[0].name, o.difficultyClass.value, (o.modifiers ?? []).map(m => m.modifier)]); o.callback({ outcome: __nextOutcome }); },
        pickALock: o => { __rolls.push(["pickALock", o.actors[0].name, o.difficultyClass.value]); o.callback({ outcome: __nextOutcome }); }
      }
    };
    // Scene with one locked door
    const scene = { id: "s1" };
    const flags = {};
    const wall = {
      id: "w1", parent: scene, door: 1, ds: 2, flags,
      getFlag: (ns, k) => flags[ns]?.[k],
      async update(d) {
        for (const [k, v] of Object.entries(d)) {
          if (k.startsWith("flags.")) { const parts = k.split(".").slice(1); let o = flags; for (const p of parts.slice(0, -1)) o = o[p] ??= {}; o[parts.at(-1)] = v; }
          else this[k] = v;
        }
        Hooks.callAll("updateWall", this, d, {});
      }
    };
    scene.walls = { get: id => (id === "w1" ? wall : null) };
    game.scenes = { get: id => (id === "s1" ? scene : null) };
    window.__wall = wall;
    Object.assign(canvas, { ready: true, scene, tokens: { controlled: [] } });
    // DoorControl
    class DoorControl { constructor(w) { this.wall = { document: w, id: w.id }; } _onMouseDown() { return false; } }
    foundry.canvas = { containers: { DoorControl } };
    window.__door = new DoorControl(wall);
    // Chat
    const log = document.createElement("ol");
    log.id = "chat-log";
    log.style.cssText = "position:fixed;right:10px;top:10px;width:330px;background:#e8e0d0;color:#222;padding:4px;list-style:none";
    document.body.append(log);
    let n = 0;
    window.ChatMessage = {
      getSpeaker: ({ actor }) => ({ alias: actor?.name ?? "?" }),
      async create(d) {
        const m = { id: `m${++n}`, ...d, getFlag: (ns, k) => d.flags?.[ns]?.[k] };
        const li = document.createElement("li");
        li.className = "chat-message message"; li.dataset.messageId = m.id;
        li.style.cssText = "border:1px solid #999;margin:4px 0;padding:6px;border-radius:4px";
        li.innerHTML = `<header class="message-header"><strong>${d.speaker?.alias}</strong></header><div class="message-content">${d.content}</div>`;
        log.append(li);
        Hooks.callAll("renderChatMessageHTML", m, li, {});
        return m;
      }
    };
    foundry.applications.api.DialogV2.prompt = async opts => { window.__promptContent = opts.content; const form = document.createElement("form"); form.innerHTML = opts.content; window.__pick?.(form); return opts.ok.callback(null, { form }); };
    game.user.can = () => true;
    game.paused = false;
    game.settings.get = new Proxy(game.settings.get, { apply: (t, self, args) => (args[0] === "pf2e" ? false : Reflect.apply(t, self, args)) });
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done);
  await setup(page);
  const set = (k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  await set("lockedDoorAlert_enabled", true);

  // ---------- Wall settings ----------
  await page.evaluate(() => {
    const app = document.createElement("div");
    app.className = "application wall-config";
    app.style.cssText = "position:fixed;left:10px;top:10px;width:480px;background:#2a2a2a;color:#ddd;padding:8px";
    app.innerHTML = `<form><fieldset><legend>Door</legend><div class="form-group"><label>Door type</label><select name="door"><option value="1" selected>Door</option></select></div></fieldset><footer class="form-footer"><button>Save</button></footer></form>`;
    document.body.append(app);
    Hooks.callAll("renderWallConfig", { document: __wall, element: app, setPosition() {} }, app, {});
  });
  assert.ok(await page.isVisible(".lucd20-lock-config"), "Lock section in the wall settings");
  const names = await page.$$eval(".lucd20-lock-config [name]", els => els.map(e => e.name));
  assert.ok(names.includes("flags.lucd20-automations.lock.forceOpen.dc") && names.includes("flags.lucd20-automations.lock.pickALock.successes") && names.includes("flags.lucd20-automations.lock.check.skill"), "fields saved with the wall's form");
  await page.screenshot({ path: `${out}/p20-wall-config.png`, clip: { x: 0, y: 0, width: 520, height: 330 } });

  // Fill the lock (as the form would save it)
  await page.evaluate(() => {
    __wall.flags["lucd20-automations"] = { lock: {
      description: "A heavy oak door bound in iron. The lock is old but sturdy.",
      forceOpen: { enabled: true, dc: 20 },
      pickALock: { enabled: true, dc: 22, successes: 2 },
      check: { enabled: true, dc: 18, skill: "arcana", label: "Dispel the warding glyph" }
    } };
  });

  // ---------- Player click → card ----------
  await page.evaluate(() => { game.user.isGM = false; game.user.isActiveGM = false; });
  await page.evaluate(() => __door._onMouseDown({ button: 0 }));
  await page.waitForTimeout(100);
  const rows = await page.$$eval(".lucd20-lock-way", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  console.log("card rows:", rows);
  assert.ok(rows[0].includes("Force Open") && rows[0].includes("Best: Amiri +12"), "Force Open: best is Amiri");
  assert.ok(rows[1].includes("Pick a Lock") && rows[1].includes("Best: Merisiel +13") && rows[1].includes("0 / 2"), "Pick a Lock: best with a toolkit, progress");
  assert.ok(rows[2].includes("Dispel the warding glyph") && rows[2].includes("Best: Ezren +11"), "Other check");
  assert.ok(!rows.join(" ").includes("DC"), "players don't see DCs (PF2e setting off)");
  assert.ok((await page.$eval(".lucd20-lock-desc", e => e.textContent)).startsWith("A heavy oak door"), "description");
  await page.screenshot({ path: `${out}/p20-card.png`, clip: { x: 560, y: 0, width: 340, height: 300 } });

  // ---------- Results on the GM's client ----------
  await page.evaluate(() => { game.user.isGM = true; game.user.isActiveGM = true; });
  // GM tries Pick a Lock for Merisiel: success 1/2, then 2/2 → unlocked
  await page.evaluate(() => { window.__pick = form => { form.elements.actor.value = "a3"; }; });
  await page.click('.lucd20-lock-try[data-way="1"]');
  await page.waitForTimeout(100);
  assert.deepStrictEqual(await page.evaluate(() => __rolls.at(-1)), ["pickALock", "Merisiel", 22]);
  assert.strictEqual(await page.evaluate(() => __wall.flags["lucd20-automations"].lockState.picks), 1, "one success counted");
  assert.ok((await page.$$eval(".lucd20-lock-way", e => e[1].innerText)).includes("1 / 2"), "card shows progress");
  // Force Open critical failure → jammed, then the next try gets −2
  await page.evaluate(() => { window.__nextOutcome = "criticalFailure"; window.__pick = form => { form.elements.actor.value = "a1"; }; });
  await page.click('.lucd20-lock-try[data-way="0"]');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => __wall.flags["lucd20-automations"].lockState.jammed), "jammed");
  await page.evaluate(() => { window.__nextOutcome = "success"; });
  await page.click('.lucd20-lock-try[data-way="0"]');
  await page.waitForTimeout(100);
  assert.deepStrictEqual(await page.evaluate(() => __rolls.at(-1)), ["forceOpen", "Amiri", 20, [-2]], "jammed: −2");
  assert.deepStrictEqual(await page.evaluate(() => [__wall.ds, __wall.door]), [1, 2], "forced open and broken (secret)");
  const results = await page.$$eval(".lucd20-lock-result", els => els.map(e => e.textContent.trim()));
  console.log("results:", results);
  assert.ok(results.some(r => r.includes("jams")) && results.some(r => r.includes("broken")), "result lines");
  assert.ok((await page.$eval(".lucd20-lock-ways", e => e.innerText)).includes("open"), "card shows the door is open");
  await page.screenshot({ path: `${out}/p20-results.png`, clip: { x: 560, y: 0, width: 340, height: 520 } });

  // Auto-unlock off → nothing changes
  await page.evaluate(() => { __wall.ds = 2; __wall.door = 1; });
  await set("lockedDoorAlert_autoUnlock", false);
  await page.evaluate(() => Hooks.callAll("updateWall", __wall, {}, {}));
  await page.click('.lucd20-lock-try[data-way="2"]');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => __wall.ds), 2, "unlock off: still locked");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 20 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
