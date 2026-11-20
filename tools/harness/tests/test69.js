const { chromium } = require("playwright");
const assert = require("assert");

/** Rules 23–24 (v0.81.1): Battle Medicine (macro, feat card, Medic Dedication, the GM's editor) and the flanking overlay (timed, flank squares, drag). */
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
    const mkActor = (id, name, { feats = [], ally = "party", type = "character", medicine = 2 } = {}) => ({
      id, name, type, uuid: `Actor.${id}`, flags: {}, visible: true, ally,
      items: feats.map(slug => ({ type: "feat", slug, name: slug })), skills: { medicine: { rank: medicine } },
      getFlag(ns, k) { return this.flags[ns]?.[k]; }, async setFlag(ns, k, v) { (this.flags[ns] ??= {})[k] = v; },
      isAllyOf(o) { return o.ally === this.ally; }, getActiveTokens() { return []; } });
    const kyra = mkActor("kyra", "Kyra", { feats: ["battle-medicine", "medic-dedication"] });
    const amiri = mkActor("amiri", "Amiri");
    const valeros = mkActor("valeros", "Valeros", { feats: ["robust-health"] });
    const ezren = mkActor("ezren", "Ezren");
    const ogre = mkActor("ogre", "Ogre", { ally: "enemy", type: "npc" });
    game.actors = { contents: [kyra, amiri, valeros, ezren, ogre], get(id) { return this.contents.find(a => a.id === id); }, getName(n) { return this.contents.find(a => a.name === n); } };
    window.fromUuid = async u => game.actors.contents.find(a => a.uuid === u) ?? null;
    window.fromUuidSync = u => (u === "Actor.kyra.Item.bm" ? { slug: "battle-medicine", name: "Battle Medicine" } : game.actors.contents.find(a => a.uuid === u) ?? null);
    const tokens = { "t-amiri": { actor: amiri }, "t-valeros": { actor: valeros }, "t-ezren": { actor: ezren } };
    game.scenes = { get: () => ({ tokens: { get: id => tokens[id] } }) };
    const bm = await import(`/modules/${M}/scripts/systems/pf2e/battle-medicine.js`);
    const fl = await import(`/modules/${M}/scripts/systems/pf2e/flanking.js`);
    const ov = await import(`/modules/${M}/scripts/systems/pf2e/tactical-overlay.js`);
    for (const f of ["pf2eBattleMedicine", "pf2eFlanking", "pf2eCover"]) await game.settings.set(M, `${f}_enabled`, true);
    await settle();

    // 1. The macro's healing message (Battle Medicine on Amiri); its Treat Wounds message doesn't count.
    const macroMsg = (target, text, extra = {}) => ({ actor: kyra, speaker: { scene: "s1" }, flavor: text, flags: { treat_wounds_battle_medicine: { id: target, healerId: "kyra", dos: 2, ...extra } } });
    Hooks.callAll("createChatMessage", macroMsg("t-amiri", "<strong>Healing Roll: Battle Medicine</strong> (Success)"));
    Hooks.callAll("createChatMessage", macroMsg("t-ezren", "<strong>Healing Roll: Treat Wounds</strong> (Success)"));
    await settle();
    out.amiri = bm.hudLines(amiri);
    out.ezrenTW = bm.hudLines(ezren);
    // The same use reported again (its check message) within 30 s: counted once, Medic untouched.
    const check = { actor: kyra, speaker: {}, flavor: "Battle Medicine", content: "", flags: { pf2e: { context: { type: "skill-check", domains: ["medicine"], options: [], target: { actor: amiri.uuid } } } } };
    Hooks.callAll("createChatMessage", check);
    await settle();
    out.kyraAfterDouble = bm.hudLines(kyra);
    // 2. The feat's own card with our target flag (Valeros: Robust Health → 1 hour).
    Hooks.callAll("createChatMessage", { actor: kyra, speaker: {}, flavor: "", content: "", flags: { pf2e: { origin: { uuid: "Actor.kyra.Item.bm", type: "feat" } }, [M]: { bmTarget: valeros.uuid } } });
    await settle();
    out.valeros = bm.hudLines(valeros);
    // 3. Medic Dedication: Amiri treated again later (a minute of real time faked) while immune → spends it.
    const entries = amiri.flags[M].immunities; entries[0].real -= 60000;
    Hooks.callAll("createChatMessage", macroMsg("t-amiri", "Healing Roll: Battle Medicine"));
    await settle();
    out.kyraMedic = bm.hudLines(kyra).filter(l => l.startsWith("Medic"));
    out.medicReady = bm.medicReady(kyra);
    // The Workbench's "Medic dedication used" effect on a medic counts too.
    const medic2 = mkActor("medic2", "Seelah", { feats: ["medic-dedication"], medicine: 3 });
    game.actors.contents.push(medic2);
    Hooks.callAll("createItem", { type: "effect", name: "Medic dedication used", actor: medic2, system: {} });
    await settle();
    out.seelah = bm.hudLines(medic2);

    // HUD: GM click opens the editor; remove, add (6 h), reset Medic.
    const hud = document.createElement("div");
    hud.id = "token-hud";
    hud.innerHTML = `<div class="col left"><button class="control-icon lucd20-rideable"></button></div>`;
    document.body.append(hud);
    canvas.hud = { token: { element: hud, document: { id: "t-kyra", name: "Kyra", actor: kyra } } };
    Hooks.callAll("renderTokenHUD");
    await settle(150);
    const btn = hud.querySelector(".lucd20-battle-medicine");
    out.hud = { afterHorse: btn?.previousElementSibling?.classList.contains("lucd20-rideable"), tooltip: btn?.dataset.tooltipHtml };
    btn.click();
    await settle(150);
    const ed = foundry.applications.instances.get("lucd20-battle-medicine-editor")?.element;
    out.editorRows = [...(ed?.querySelectorAll(".lucd20-bm-row span") ?? [])].map(s => s.textContent);
    ed.querySelector('[data-action="removeTreated"][data-by="Actor.valeros"]').click();
    await settle(150);
    out.valerosAfterRemove = bm.hudLines(valeros);
    ed.querySelector('[data-action="resetMedic"]').click();
    await settle(150);
    out.medicAfterReset = bm.medicReady(kyra);
    // Add: Ezren treated by Kyra, 6 hours left (the editor is for the open token: switch to Ezren).
    bm.BattleMedicineEditor.open(ezren, "Ezren");
    await settle(150);
    const ed2 = foundry.applications.instances.get("lucd20-battle-medicine-editor").element;
    ed2.querySelector("select.healer").value = "Actor.kyra";
    ed2.querySelector("input.hours").value = "6";
    ed2.querySelector('[data-action="add"]').click();
    await settle(150);
    out.ezrenAdded = bm.hudLines(ezren);

    // Flanking: the ogre (1 square) at 3,3; Amiri at 4,3; Kyra selected at 1,1 (not adjacent).
    canvas.ready = true;
    canvas.grid = { size: 100, isSquare: true, distance: 5 };
    canvas.scene = { grid: { distance: 5 } };
    canvas.controls = new PIXI.Container();
    const mkTok = (id, actor, gx, gy) => ({
      id, actor, document: { x: gx * 100, y: gy * 100, width: 1, height: 1, hidden: false }, visible: true, isOwner: actor.ally === "party", controlled: false, isPreview: false,
      get center() { return { x: this.document.x + 50, y: this.document.y + 50 }; },
      get bounds() { return { left: this.document.x, top: this.document.y, right: this.document.x + 100, bottom: this.document.y + 100 }; },
      canFlank(target, ctx = {}) {
        if (this.actor.isAllyOf(target.actor)) return false;
        const b = target.bounds, c = this.center;
        const dx = Math.max(b.left - c.x, 0, c.x - b.right), dy = Math.max(b.top - c.y, 0, c.y - b.bottom);
        return Math.max(dx, dy) <= (ctx.reach ? 1e9 : 100); } });
    kyra.getReach = () => 5;
    const ogreT = mkTok("t-ogre", ogre, 3, 3), kyraT = mkTok("t-kyra", kyra, 1, 1), amiriT = mkTok("t-amiri", amiri, 4, 3);
    canvas.tokens = { placeables: [ogreT, kyraT, amiriT], controlled: [kyraT], preview: { children: [] } };
    kyraT.controlled = true;
    out.squares = fl.flankSquares(kyraT, ogreT).map(s => `${s.x / 100},${s.y / 100}`);
    game.user.targets = new Set([ogreT]);
    await game.settings.set(M, "pf2eCover_previewSeconds", 0.4);
    ov.show();
    await settle(120);
    out.shownChildren = canvas.controls.children.find(c => c.name?.includes("flanking"))?.children.length ?? 0;
    await settle(500);
    out.afterTimeout = canvas.controls.children.find(c => c.name?.includes("flanking"))?.children.length ?? 0;
    // Dragging: the squares stay, the square under the preview gets the shield.
    const preview = mkTok("t-kyra", kyra, 2, 3);
    preview.isPreview = true;
    canvas.tokens.preview.children = [preview];
    Hooks.callAll("refreshToken", preview);
    await settle(150);
    out.dragChildren = canvas.controls.children.find(c => c.name?.includes("flanking"))?.children.length ?? 0;
    preview.document.x = 100; preview.document.y = 100;
    Hooks.callAll("refreshToken", preview);
    await settle(150);
    out.dragOffSquare = canvas.controls.children.find(c => c.name?.includes("flanking"))?.children.length ?? 0;
    // Moved next to the ogre opposite Amiri: flanking now (line + shield on the target).
    canvas.tokens.preview.children = [];
    kyraT.document.x = 200; kyraT.document.y = 300;
    out.allies = fl.flankingAllies(kyraT, ogreT).map(t => t.id);
    out.coverShowing = ov.isShowing();
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.amiri, ["Treated by Kyra: again in 24 h"], "the macro's Battle Medicine message");
  assert.deepStrictEqual(r.ezrenTW, [], "the macro's Treat Wounds message doesn't count");
  assert.deepStrictEqual(r.kyraAfterDouble, ["Treated Amiri (24 h)", "Medic Dedication: ready (may treat someone already immune)"], "same use twice: once, Medic untouched");
  assert.deepStrictEqual(r.valeros, ["Treated by Kyra: again in 1 h"], "feat card; Robust Health → 1 hour");
  assert.deepStrictEqual(r.kyraMedic, ["Medic Dedication: used, ready again in 24 h"], "treating someone immune spends Medic Dedication");
  assert.strictEqual(r.medicReady, false);
  assert.deepStrictEqual(r.seelah, ["Medic Dedication: used, ready again in 1 h"], "the Workbench effect; master: 1 hour");
  assert.ok(r.hud.afterHorse);
  assert.ok(r.hud.tooltip.includes("Click to edit"), "the GM's tooltip says click to edit");
  assert.deepStrictEqual(r.editorRows, ["Treated Amiri (24 h)", "Treated Valeros (1 h)"]);
  assert.deepStrictEqual(r.valerosAfterRemove, [], "removed in the editor");
  assert.strictEqual(r.medicAfterReset, true, "Medic Dedication made ready again");
  assert.deepStrictEqual(r.ezrenAdded, ["Treated by Kyra: again in 6 h"], "added by hand");
  assert.deepStrictEqual(r.squares, ["2,3"], "the square opposite Amiri, within 5 ft of the ogre (diagonals enter top and leave right: not opposite)");
  assert.ok(r.shownChildren >= 1, "shown on show()");
  assert.strictEqual(r.afterTimeout, 0, "gone after the set seconds");
  assert.strictEqual(r.dragChildren, 2, "while dragging: the squares and the shield on the square under the token");
  assert.strictEqual(r.dragOffSquare, 1, "off a flank square: the squares only");
  assert.deepStrictEqual(r.allies, ["t-amiri"]);
  console.log("PHASE 69 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
