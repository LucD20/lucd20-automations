// Visual pass for the Loot Pile restyle: every mockup state in one screenshot.
const { chromium } = require("playwright");
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/test11.js", "utf8");
const setupSrc = src.slice(src.indexOf("async function setup"), src.indexOf("(async () => {"));
const setup = eval(`(${setupSrc})`);

(async () => {
  const browser = await chromium.launch();
  const shots = [];
  const page = async (userId, q) => {
    const p = await browser.newPage({ viewport: { width: 1500, height: 1250 }, deviceScaleFactor: 1 });
    p.on("pageerror", e => console.log("PAGEERR", e.message));
    await p.goto(`http://localhost:8765/index.html?${q}`);
    await p.waitForFunction(() => window.__done);
    await setup(p, userId);
    await p.evaluate(() => { document.querySelector(".lucd20-hub").style.display = "none"; document.getElementById("core-config").style.display = "none"; });
    await p.evaluate(() => game.settings.set("lucd20-automations", "lootPile_enabled", true));
    return p;
  };
  const items = [
    { name: "Healing Potion (Minor)", type: "consumable", img: "icons/potion.png", system: { quantity: 2 }, flags: { "lucd20-automations": { source: { name: "Goblin Boss", level: 1, img: "icons/boss.png", actorUuid: "A.boss" } } } },
    { name: "Ring of Climbing", type: "equipment", img: "icons/ring.png", flags: { "lucd20-automations": { source: { name: "Goblin Boss", level: 1, img: "icons/boss.png", actorUuid: "A.boss" } } } },
    { name: "Scimitar", type: "weapon", img: "icons/scimitar.png", flags: { "lucd20-automations": { source: { name: "Goblin Boss", level: 1, img: "icons/boss.png", actorUuid: "A.boss" } } } },
    { name: "Dogslicer", type: "weapon", img: "icons/dogslicer.png", flags: { "lucd20-automations": { source: { hidden: true, level: -1, actorUuid: "Actor.goblin" } } } },
    { name: "Gold Pieces", type: "treasure", img: "icons/coins.png", system: { quantity: 3 }, flags: { "lucd20-automations": { source: { hidden: true, level: -1, actorUuid: "Actor.goblin" } } } },
    { name: "Leather Armor", type: "armor", img: "icons/armor.png", flags: { "lucd20-automations": { source: { hidden: true, level: -1, actorUuid: "Actor.goblin" } } } },
    { name: "Arrows", type: "consumable", img: "icons/arrows.png", system: { quantity: 20 }, flags: { "lucd20-automations": { source: { name: "Goblin Warrior", level: -1, img: "icons/warrior.png", actorUuid: "A.w2" } } } },
    { name: "Shortbow", type: "weapon", img: "icons/bow.png", flags: { "lucd20-automations": { source: { name: "Goblin Warrior", level: -1, img: "icons/warrior.png", actorUuid: "A.w2" } } } }
  ];
  const openPile = (p, data, pos) => p.evaluate(async ([data, pos]) => {
    const pile = await Actor.create({ name: "Loot Pile", type: "loot", flags: { "lucd20-automations": { lootPile: true } } });
    pile.items.length = 0;
    await pile.createEmbeddedDocuments("Item", data);
    const app = await (await import("/modules/lucd20-automations/scripts/features/loot-pile.js")).LootPileWindow.open(pile);
    Object.assign(app.element.style, { left: pos.left + "px", top: pos.top + "px", width: pos.width + "px", height: pos.height + "px" });
    return pile.id;
  }, [data, pos]);

  // GM: 420 window, 600 window, empty 420 window
  let p = await page("u1", "gm=1&system=pf2e");
  await openPile(p, items, { left: 20, top: 20, width: 420, height: 560 });
  await openPile(p, items, { left: 460, top: 20, width: 600, height: 560 });
  await openPile(p, [], { left: 1080, top: 20, width: 400, height: 560 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + "/p12-gm.png" });
  // review + "How many?"
  await p.evaluate(() => Hooks.callAll("deleteCombat", __combat));
  await p.waitForTimeout(300);
  await p.evaluate(() => { const w = document.querySelector(".lucd20-loot-review-dialog"); Object.assign(w.style, { left: "20px", top: "600px" });
    [...w.querySelectorAll(".lucd20-loot-check")].find(l => l.textContent.includes("Leather")).querySelector("input").click(); });
  await p.evaluate(() => [...document.querySelectorAll(".lucd20-loot-window .lucd20-loot-item")].find(li => li.textContent.includes("Healing")).querySelector('[data-action="take"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => Object.assign(document.querySelector(".lucd20-loot-qty-dialog").style, { left: "480px", top: "640px" }));
  await p.screenshot({ path: __dirname + "/p12-dialogs.png", clip: { x: 0, y: 580, width: 820, height: 600 } });

  // Player with one character (chip) at 420; player without a character at 360
  p = await page("p1", "gm=0&system=pf2e");
  await openPile(p, items, { left: 20, top: 20, width: 420, height: 560 });
  await p.waitForTimeout(200);
  await p.screenshot({ path: __dirname + "/p12-player.png", clip: { x: 0, y: 0, width: 460, height: 600 } });
  p = await page("p3", "gm=0&system=pf2e");
  await openPile(p, items, { left: 20, top: 20, width: 360, height: 560 });
  await p.waitForTimeout(200);
  const take = await p.$eval('[data-action="take"]', b => ({ disabled: b.disabled, tip: b.dataset.tooltip, stash: b.nextElementSibling.textContent.trim(), aria: b.nextElementSibling.getAttribute("aria-label") }));
  console.log("no character @360:", JSON.stringify(take));
  await p.screenshot({ path: __dirname + "/p12-narrow.png", clip: { x: 0, y: 0, width: 400, height: 600 } });
  await browser.close();
})();
