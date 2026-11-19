const { chromium } = require("playwright");
const assert = require("assert");

/** Rules 23–24: Battle Medicine on the Token HUD, and the flanking overlay (with the drag preview). */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    const out = {};
    game.time = { worldTime: 100000 };
    // Actors with flags.
    const mkActor = (id, name, { feats = [], ally = "party" } = {}) => {
      const a = { id, name, uuid: `Actor.${id}`, flags: {}, visible: true, ally,
        items: feats.map(slug => ({ type: "feat", slug, name: slug })),
        getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; },
        isAllyOf(o) { return o.ally === this.ally; }, getActiveTokens() { return []; } };
      return a;
    };
    const kyra = mkActor("kyra", "Kyra", { feats: ["battle-medicine"] });
    const amiri = mkActor("amiri", "Amiri");
    const valeros = mkActor("valeros", "Valeros");
    const ogre = mkActor("ogre", "Ogre", { ally: "enemy" });
    game.actors = { contents: [kyra, amiri, valeros, ogre], get(id) { return this.contents.find(a => a.id === id); } };
    window.fromUuid = async u => game.actors.contents.find(a => a.uuid === u) ?? null;
    window.fromUuidSync = u => game.actors.contents.find(a => a.uuid === u) ?? null;
    const bm = await import(`/modules/${M}/scripts/systems/pf2e/battle-medicine.js`);
    const fl = await import(`/modules/${M}/scripts/systems/pf2e/flanking.js`);
    for (const f of ["pf2eBattleMedicine", "pf2eFlanking"]) await game.settings.set(M, `${f}_enabled`, true);
    await settle();

    // A Battle Medicine check by Kyra on Amiri; a plain Medicine check (Treat Wounds) does nothing.
    const msg = (opts, target = amiri, flavor = "") => ({ actor: kyra, speaker: {}, flavor, content: "", flags: { pf2e: { context: { type: "skill-check", domains: ["medicine", "skill-check"], options: opts, target: target ? { actor: target.uuid } : null } } }, getFlag() { return null; } });
    Hooks.callAll("createChatMessage", msg(["action:treat-wounds"], valeros));
    Hooks.callAll("createChatMessage", msg(["origin:item:slug:battle-medicine"]));
    Hooks.callAll("createChatMessage", msg([], valeros, "<h4>Battle Medicine</h4>"));
    await settle();
    out.amiri = bm.hudLines(amiri);
    out.valeros = bm.hudLines(valeros);
    out.kyra = bm.hudLines(kyra);
    out.readNoTarget = bm.readUse(msg(["origin:item:slug:battle-medicine"], null));
    game.time.worldTime += 86400 + 1;
    out.afterDay = bm.hudLines(amiri);
    game.time.worldTime -= 86400 + 1;

    // The Token HUD button, after Riding's horse.
    const hud = document.createElement("div");
    hud.id = "token-hud";
    hud.innerHTML = `<div class="col left"><button class="control-icon lucd20-rideable"></button></div><div class="col right"></div>`;
    document.body.append(hud);
    canvas.hud = { token: { element: hud, document: { id: "t-amiri", actor: amiri } } };
    Hooks.callAll("renderTokenHUD");
    await settle(150);
    const btn = hud.querySelector(".lucd20-battle-medicine");
    out.hud = { button: !!btn, afterHorse: btn?.previousElementSibling?.classList.contains("lucd20-rideable"), tooltip: btn?.dataset.tooltipHtml, active: btn?.classList.contains("active") };
    canvas.hud.token.document = { id: "t-ogre", actor: ogre };
    Hooks.callAll("renderTokenHUD");
    await settle(150);
    out.hudOgre = !!hud.querySelector(".lucd20-battle-medicine");

    // Flanking: a 3×3 target between two allies; grid 100.
    canvas.ready = true;
    canvas.grid = { size: 100 };
    canvas.controls = new PIXI.Container();
    const mkTok = (id, actor, x, y, w = 1) => {
      const t = { id, actor, document: { x, y, hidden: false }, visible: true, isOwner: actor.ally === "party", controlled: false, isPreview: false,
        get center() { return { x: this.document.x + w * 50, y: this.document.y + w * 50 }; },
        get bounds() { return { left: this.document.x, top: this.document.y, right: this.document.x + w * 100, bottom: this.document.y + w * 100 }; },
        canFlank(target) { // adjacent (5 ft reach) and enemies
          if (this.actor.isAllyOf(target.actor)) return false;
          const b = target.bounds, c = this.center;
          const dx = Math.max(b.left - c.x, 0, c.x - b.right), dy = Math.max(b.top - c.y, 0, c.y - b.bottom);
          return Math.max(dx, dy) <= 100; } };
      return t;
    };
    const ogreT = mkTok("t-ogre", ogre, 300, 300);
    const kyraT = mkTok("t-kyra", kyra, 200, 300);
    const amiriT = mkTok("t-amiri", amiri, 400, 300);
    const valT = mkTok("t-val", valeros, 300, 200);
    canvas.tokens = { placeables: [ogreT, kyraT, amiriT, valT], controlled: [kyraT], preview: { children: [] } };
    kyraT.controlled = true;
    out.allies = fl.flankingAllies(kyraT, ogreT).map(t => t.id);
    out.valAllies = fl.flankingAllies(valT, ogreT).map(t => t.id);
    game.user.targets = new Set([ogreT]);
    fl.draw();
    out.drawn = canvas.controls.children[0]?.children?.length ?? 0;
    // Dragging Kyra to above the ogre: flanks with nobody across; to below: flanks with Valeros.
    const preview = mkTok("t-kyra", kyra, 300, 400);
    preview.isPreview = true;
    canvas.tokens.preview.children = [preview];
    out.dragBelow = fl.flankingAllies(preview, ogreT).map(t => t.id);
    preview.document.x = 300; preview.document.y = 200;
    out.dragOnValeros = fl.flankingAllies(preview, ogreT).map(t => t.id);
    preview.document.x = 200; preview.document.y = 200;
    out.dragCorner = fl.flankingAllies(preview, ogreT).map(t => t.id);
    preview.document.x = 300; preview.document.y = 400;
    fl.draw();
    out.drawnDrag = canvas.controls.children[0]?.children?.length ?? 0;
    // A hidden ally doesn't count for this user.
    valT.visible = false;
    out.hiddenAlly = fl.flankingAllies(preview, ogreT).map(t => t.id);
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.amiri, ["Treated by Kyra: again in 24 h"]);
  assert.deepStrictEqual(r.valeros, ["Treated by Kyra: again in 24 h"], "named in the card counts; Treat Wounds doesn't");
  assert.deepStrictEqual(r.kyra, ["Treated Amiri (24 h)", "Treated Valeros (24 h)"]);
  assert.strictEqual(r.readNoTarget, null, "no target: nothing recorded");
  assert.deepStrictEqual(r.afterDay, [], "gone after a day");
  assert.ok(r.hud.button && r.hud.afterHorse && r.hud.active, "HUD button after Riding's horse");
  assert.strictEqual(r.hud.tooltip, "Treated by Kyra: again in 24 h");
  assert.strictEqual(r.hudOgre, false, "no button for a creature with nothing to show");
  assert.deepStrictEqual(r.allies, ["t-amiri"], "Kyra and Amiri on opposite sides");
  assert.deepStrictEqual(r.valAllies, [], "Valeros has no one across");
  assert.strictEqual(r.drawn, 2, "a line and the broken shield");
  assert.deepStrictEqual(r.dragBelow, ["t-val"], "dragging below the ogre: flanks with Valeros");
  assert.deepStrictEqual(r.dragOnValeros, [], "nobody across");
  assert.deepStrictEqual(r.dragCorner, [], "a corner with no ally at the opposite corner");
  assert.strictEqual(r.drawnDrag, 2, "drawn for the drag preview");
  assert.deepStrictEqual(r.hiddenAlly, [], "allies the user can't see don't count");
  console.log("PHASE 69 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
