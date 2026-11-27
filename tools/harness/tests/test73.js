const { chromium } = require("playwright");
const assert = require("assert");

/** v0.85.0: Combat Cards (dealt at the end of a recorded fight, foil the first time) and the Party Deck. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 80) => new Promise(res => setTimeout(res, ms));
    const out = {};
    const er = await import(`/modules/${M}/scripts/features/encounter-report.js`);
    const cc = await import(`/modules/${M}/scripts/features/combat-cards/combat-cards.js`);

    // Actors with flags saved as Foundry does (dotted paths; "-=" deletes).
    const mkActor = (id, name, hp, extra = {}) => {
      const a = { id, name, uuid: `Actor.${id}`, img: `icons/${extra.img ?? "goblin.webp"}`, type: "character", flags: {}, isOwner: true,
        system: { attributes: { hp: { value: hp, max: hp, temp: 0 } }, details: { level: { value: extra.level ?? 5 } } }, ...extra };
      a.getFlag = (ns, k) => a.flags[ns]?.[k];
      a.update = async change => {
        for (const [path, v] of Object.entries(change)) {
          const parts = path.split(".");
          let at = a;
          for (const part of parts.slice(0, -1)) at = (at[part] ??= {});
          const last = parts.at(-1);
          if (last.startsWith("-=")) delete at[last.slice(2)];
          else at[last] = JSON.parse(JSON.stringify(v));
        }
        Hooks.callAll("updateActor", a, foundry.utils.expandObject ? foundry.utils.expandObject(change) : change);
      };
      return a;
    };
    const madz = mkActor("madz", "Madzoog", 60, { hasPlayerOwner: true, img: "valeros.webp" });
    const schm = mkActor("schm", "Schmekcho", 70, { hasPlayerOwner: true, img: "ezren.webp" });
    const ogre = mkActor("ogre", "Ogre", 50, { type: "npc", level: 8 });
    const all = [madz, schm, ogre];
    game.actors = Object.assign([...all], { get: id => all.find(a => a.id === id), contents: all });
    window.fromUuidSync = uuid => all.find(a => a.uuid === uuid) ?? null;
    window.ChatMessage = { getSpeaker: () => ({}), getWhisperRecipients: () => [], getSpeakerActor: () => null, create: async d => d };
    await game.settings.set(M, "encounterReport_enabled", true);
    await game.settings.set(M, "combatCards_enabled", true);
    await game.settings.set(M, "combatCards_reportDelay", 0);
    await settle();

    const fight = async (id) => {
      ogre.system.attributes.hp.value = 50;
      schm.system.attributes.hp.value = 70;
      const flags = {};
      const combat = {
        id, started: false, active: true, round: 0, scene: { name: "Cave" }, flags,
        combatants: [{ actor: madz, token: { name: "Madzoog", disposition: 1 } }, { actor: schm, token: { name: "Schmekcho", disposition: 1 } }, { actor: ogre, token: { name: "Ogre", disposition: -1 } }],
        get combatant() { return this.combatants[0]; },
        getFlag(ns, k) { return flags[ns]?.[k]; }, async setFlag(ns, k, v) { (flags[ns] ??= {})[k] = JSON.parse(JSON.stringify(v)); }
      };
      game.combat = combat;
      game.combats = Object.assign([combat], { get: x => (x === id ? combat : null) });
      for (const a of all) Hooks.callAll("updateActor", a, {}); // seed the HP cache
      combat.round = 1; combat.started = true;
      Hooks.callAll("updateCombat", combat, { round: 1 });
      await settle(80);
      // Madzoog hits the ogre twice (40 of its 50 HP), Schmekcho finishes it; the ogre hits Schmekcho.
      for (const [src, tgt, hp] of [[madz, ogre, 30], [madz, ogre, 10], [ogre, schm, 45], [schm, ogre, 0]]) {
        await er.noteSource(tgt.uuid, src.uuid, "damage");
        tgt.system.attributes.hp.value = hp;
        Hooks.callAll("updateActor", tgt, {});
        await settle(20);
      }
      // A public natural 20 by Madzoog, a secret one (never counted).
      Hooks.callAll("createChatMessage", { actor: madz, whisper: [], rolls: [{ dice: [{ faces: 20, results: [{ result: 20, active: true }] }] }] });
      Hooks.callAll("createChatMessage", { actor: madz, blind: true, whisper: ["gm"], rolls: [{ dice: [{ faces: 20, results: [{ result: 20, active: true }] }] }] });
      await settle(2400);
      out.recordedNat20 = (flags[M]?.encounterReport?.events ?? []).filter(e => e.kind === "nat20").length;
      Hooks.callAll("deleteCombat", combat);
      await settle(400);
    };

    // Fight 1: the cards on screen; foil (first time); saved on the actors.
    await fight("c1");
    const ov = document.getElementById("lucd20-combat-cards");
    out.overlay = !!ov;
    out.title = ov?.querySelector(".lcc-title")?.textContent;
    out.cards1 = [...(ov?.querySelectorAll(".lcc-card") ?? [])].map(c => `${c.querySelector(".lcc-who").textContent}:${c.dataset.card}:${c.classList.contains("is-foil") ? "foil" : "plain"}`);
    out.statText = ov?.querySelector(".lcc-card .lcc-stat")?.textContent.replace(/\s+/g, " ").trim();
    out.reportOpened = !!foundry.applications.instances.get("lucd20-encounter-report");
    out.saved1 = Object.keys(madz.flags[M]?.cards ?? {}).concat(Object.keys(schm.flags[M]?.cards ?? {}));
    // v0.90.1: a click on the background doesn't close it; "Loot the fallen" waits (the gate) until Close.
    const gate = await import(`/modules/${M}/scripts/core/overlay-gate.js`);
    let gateOpen = false; gate.waitForGate().then(() => { gateOpen = true; });
    ov?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle(80);
    out.backdropKept = !!document.getElementById("lucd20-combat-cards") && !gateOpen;
    ov?.querySelector(".lcc-close")?.click();
    await settle(40);
    out.closed = !document.getElementById("lucd20-combat-cards");
    out.gateAfterClose = gateOpen;

    // Fight 2, the same: the same cards again, now plain (earned before).
    await fight("c2");
    const ov2 = document.getElementById("lucd20-combat-cards");
    out.cards2 = [...(ov2?.querySelectorAll(".lcc-card") ?? [])].map(c => `${c.dataset.card}:${c.classList.contains("is-foil") ? "foil" : "plain"}`);
    out.copies = Object.values(madz.flags[M].cards).map(l => l.map(c => (c.foil ? "F" : "p")).join("")).join(",");
    ov2?.remove();

    // The Party Deck window: stacks, counts, the mystery cards, the history on a click.
    await cc.PartyDeckWindow.open();
    await settle(100);
    let deck = foundry.applications.instances.get("lucd20-party-deck").element;
    out.found = deck.querySelector(".lpd-found")?.textContent;
    out.stacks = [...deck.querySelectorAll(".lpd-stack:not(.is-unknown)")].map(s => `${s.dataset.card}${s.querySelector(".lpd-count")?.textContent ?? ""}`);
    out.unknown = deck.querySelectorAll(".lpd-stack.is-unknown").length;
    out.unknownText = deck.querySelector(".lpd-stack.is-unknown")?.textContent.replace(/\s+/g, " ").trim();
    deck.querySelector(".lpd-stack:not(.is-unknown)").click();
    await settle(120);
    deck = foundry.applications.instances.get("lucd20-party-deck").element;
    out.history = deck.querySelectorAll(".lpd-side li").length;
    out.foilMarks = deck.querySelectorAll(".lpd-side .lpd-foilmark").length;
    out.gmButtons = !!deck.querySelector(".lpd-grant") && !!deck.querySelector(".lpd-remove");
    // Hide the undiscovered.
    deck.querySelector(".lpd-unknown").click();
    await settle(120);
    out.unknownHidden = foundry.applications.instances.get("lucd20-party-deck").element.querySelectorAll(".lpd-stack.is-unknown").length;

    // PF2e's party sheet: a Deck tab next to its own.
    const sheet = document.createElement("form");
    sheet.innerHTML = `<nav class="sub-nav"><a data-tab="overview" data-group="primary" class="active">Overview</a><a data-tab="inventory" data-group="primary">Inventory</a></nav>
      <section class="container"><div class="tab active" data-tab="overview" data-group="primary">O</div><div class="tab" data-tab="inventory" data-group="primary">I</div></section>`;
    document.body.append(sheet);
    Hooks.callAll("renderPartySheetPF2e", { actor: { type: "party" } }, [sheet]);
    const link = sheet.querySelector('nav [data-tab="lucd20-deck"]');
    out.tabLink = !!link && link.dataset.group === "primary";
    link?.click();
    out.tabActive = sheet.querySelector('.tab[data-tab="lucd20-deck"]')?.classList.contains("active") && !sheet.querySelector('.tab[data-tab="overview"]').classList.contains("active");
    out.tabStacks = sheet.querySelectorAll(".lucd20-deck-tab .lpd-stack:not(.is-unknown)").length;
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.ok(r.overlay, "the cards fill the screen at the end of the fight");
  assert.strictEqual(r.title, "Victory", "the ogre went down");
  assert.strictEqual(r.cards1.length, 2, "one card per player character");
  assert.ok(r.cards1.every(c => c.endsWith(":foil")), "first time: foil");
  assert.ok(r.cards1.includes("Madzoog:unstoppableForce:foil"), `Madzoog dealt 40 of the ogre's 50 HP (One-Hero Army needs 3 PCs): ${r.cards1}`);
  assert.ok(r.cards1.includes("Schmekcho:giantSlayer:foil"), `the final blow on a level 8 ogre (party level 5): ${r.cards1}`);
  assert.ok(r.reportOpened, "the report opens after the delay (0 here)");
  assert.strictEqual(r.saved1.length, 2, "saved on each actor");
  assert.ok(r.closed, "Close removes the cards");
  assert.ok(r.backdropKept, "v0.90.1: a click outside the cards doesn't close them; the gate holds");
  assert.ok(r.gateAfterClose, "after Close, the gate opens (Loot the fallen may show)");
  assert.strictEqual(r.recordedNat20, 1, "a public natural 20 counts; a secret one never does");
  assert.ok(r.cards2.every(c => c.endsWith(":plain")), `earned before: no foil ${r.cards2}`);
  assert.strictEqual(r.copies, "Fp", "one foil copy, then a plain one");
  assert.strictEqual(r.found, "2 / 55 discovered");
  assert.deepStrictEqual(r.stacks.map(s => s.replace(/^\w+/, "")).sort(), ["×2", "×2"], "two stacks of two");
  assert.strictEqual(r.unknown, 53, "the 53 others face down");
  assert.strictEqual(r.unknownText, "???Common", "mystery: rarity only");
  assert.strictEqual(r.history, 2, "the stack's history");
  assert.strictEqual(r.foilMarks, 1, "the first copy marked foil");
  assert.ok(r.gmButtons, "GM: grant and remove");
  assert.strictEqual(r.unknownHidden, 0, "undiscovered hidden on request");
  assert.ok(r.tabLink && r.tabActive && r.tabStacks === 2, "the party sheet's Deck tab");
  assert.strictEqual(r.statText, "80%of the enemies' HP");
  console.log("PHASE 73 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
