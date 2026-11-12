const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 17: Hidden Track Names. */
async function setupMocks(page) {
  await page.evaluate(() => {
    document.querySelector(".lucd20-hub").style.display = "none";
    document.getElementById("core-config").style.display = "none";
    const mkSound = (id, name, playing) => {
      const flags = {};
      return { id, name, playing, flags, getFlag: (ns, k) => flags[k], async setFlag(ns, k, v) { flags[k] = v; __draw(); } };
    };
    const playlist = { id: "p1", name: "Dungeon Ambience", sounds: new Map() };
    for (const s of [mkSound("sA", "Dripping Cave", true), mkSound("sB", "Boss Battle Theme", false)]) playlist.sounds.set(s.id, s);
    game.playlists = Object.assign([playlist], { get: id => (id === "p1" ? playlist : null) });
    const root = document.createElement("section");
    root.id = "playlists";
    root.style.cssText = "position:fixed;right:0;top:0;width:300px;background:#222;color:#ddd;padding:6px";
    document.body.append(root);
    const row = s => `<li class="sound" data-playlist-id="p1" data-sound-id="${s.id}" style="display:flex;align-items:center;gap:4px">
      <span class="sound-name" data-tooltip="${s.name}" style="flex:1">${s.name}</span><div class="sound-controls"><button class="inline-control icon fa-solid fa-play" data-action="soundPlay" aria-label="Play ${s.name}"></button></div></li>`;
    window.__draw = () => {
      root.innerHTML = `<div class="currently-playing"><h4>Currently playing</h4><ol>${[...playlist.sounds.values()].filter(s => s.playing).map(row).join("")}</ol></div>
        <ol class="directory-list"><li class="directory-item playlist" data-entry-id="p1"><h4 class="playlist-name">${playlist.name}</h4>
        <ol class="playlist-sounds">${[...playlist.sounds.values()].map(row).join("")}</ol></li></ol>`;
    };
    __draw();
    window.__foundryClicks = 0;
    root.addEventListener("click", e => { if (e.target.closest("[data-sound-id]")) __foundryClicks++; }, true);
    ui.playlists = { element: root, render() { window.__rerendered = true; __draw(); } };
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done);
    await setupMocks(page);
    return page;
  };
  const set = (page, k, v) => page.evaluate(([k, v]) => game.settings.set("lucd20-automations", k, v), [k, v]);
  const text = page => page.$eval("#playlists", e => e.innerText.replace(/\s+/g, " ").trim());
  const attrs = page => page.$$eval("#playlists [data-tooltip], #playlists [aria-label]", els => els.map(e => `${e.dataset.tooltip ?? ""}|${e.getAttribute("aria-label") ?? ""}`).join(" "));

  // ---------- Player ----------
  let page = await open("gm=0");
  await set(page, "hiddenTrackNames_enabled", true);
  await page.waitForTimeout(80);
  let t = await text(page);
  console.log("Player sees:", t);
  assert.ok(!t.includes("Dripping Cave") && !t.includes("Boss Battle"), "names hidden");
  assert.ok(t.includes("Unknown track") && t.includes("Dungeon Ambience"), "placeholder shown, playlist name visible");
  assert.ok(!(await attrs(page)).includes("Dripping") && !(await attrs(page)).includes("Boss"), "tooltips/labels scrubbed");
  assert.strictEqual(await page.$$eval(".lucd20-track-eye", e => e.length), 0, "players get no eye");
  // Foundry re-draws → still hidden
  await page.evaluate(() => __draw());
  await page.waitForTimeout(60);
  assert.ok(!(await text(page)).includes("Dripping Cave"), "hidden after a re-draw");
  await page.screenshot({ path: `${out}/p17-player.png`, clip: { x: 690, y: 0, width: 310, height: 200 } });
  // GM reveals one
  await page.evaluate(() => game.playlists.get("p1").sounds.get("sB").setFlag("lucd20-automations", "revealed", true));
  await page.waitForTimeout(60);
  t = await text(page);
  assert.ok(t.includes("Boss Battle Theme") && !t.includes("Dripping Cave"), "revealed track shows its name");
  // off → names back
  await set(page, "hiddenTrackNames_enabled", false);
  await page.waitForTimeout(60);
  assert.ok((await text(page)).includes("Dripping Cave"), "off: names back without reload");

  // ---------- GM ----------
  page = await open("gm=1");
  await set(page, "hiddenTrackNames_enabled", true);
  await page.waitForTimeout(80);
  assert.ok((await text(page)).includes("Dripping Cave"), "GM sees the names");
  assert.strictEqual(await page.$$eval(".lucd20-track-eye", e => e.length), 3, "eye on each track, both lists");
  await page.screenshot({ path: `${out}/p17-gm.png`, clip: { x: 690, y: 0, width: 310, height: 200 } });
  await page.click('.currently-playing [data-sound-id="sA"] .lucd20-track-eye');
  await page.waitForTimeout(80);
  assert.ok(await page.evaluate(() => game.playlists.get("p1").sounds.get("sA").getFlag("lucd20-automations", "revealed")), "eye reveals");
  assert.strictEqual(await page.evaluate(() => __foundryClicks), 0, "eye click doesn't reach Foundry");
  assert.deepStrictEqual(await page.$$eval('[data-sound-id="sA"] .lucd20-track-eye', e => e.map(x => x.classList.contains("fa-eye"))), [true, true], "both rows updated");
  await page.click('.playlist-sounds [data-sound-id="sA"] .lucd20-track-eye');
  await page.waitForTimeout(80);
  assert.ok(!(await page.evaluate(() => game.playlists.get("p1").sounds.get("sA").getFlag("lucd20-automations", "revealed"))), "eye hides again");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 17 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
