const { chromium } = require("playwright");
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/test12.js", "utf8");
const setup = eval(`(${src.slice(src.indexOf("async function setup"), src.indexOf("(async () => {"))})`);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 2 });
  p.on("pageerror", e => console.log("ERR", e.message));
  await p.goto("http://localhost:8765/index.html?gm=1&system=pf2e"); await p.waitForFunction(() => window.__done);
  await setup(p);
  await p.evaluate(() => { document.querySelector("canvas").style.display = "none"; });
  await p.evaluate(() => game.settings.set("lucd20-automations", "hazardDetection_enabled", true));
  await p.evaluate(() => game.settings.set("lucd20-automations", "searchAutomation_enabled", true));
  await p.evaluate(() => {
    const mk = (nat, mod, deg) => ({ formula: `1d20 + ${mod}`, total: nat + mod, degreeOfSuccess: deg, dice: [{ faces: 20, results: [{ result: nat, active: true }] }] });
    __A.ezren.system.exploration = ["srch"]; __A.ezren.name = "Droven";
    __results.amiri = mk(16, 5, 2); __results.ezren = mk(10, 3, 2);
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { __door.open = true; __move("amiri", 800, 500); });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const box = document.createElement("div"); box.style.cssText = "position:absolute;left:20px;top:20px;width:300px;padding:8px;background:#e8e4dc;color:#191813;border-radius:6px;font-family:sans-serif;font-size:13px";
    box.innerHTML = `<div class="chat-message"><div style="font-weight:bold;margin-bottom:4px">Search <span style="font-weight:normal;opacity:.6">To: Gamemaster</span></div>${__log.chat.at(-1).content}</div>`;
    document.body.append(box);
  });
  await p.screenshot({ path: __dirname + "/p13-card.png", clip: { x: 10, y: 10, width: 330, height: 260 } });
  await b.close();
})();
