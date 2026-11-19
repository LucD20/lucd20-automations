const { chromium } = require("playwright");
const assert = require("assert");

/** Multiple Checks (PLAN §24): collect checks, post one card with GM-only DCs and "DC n lower". */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(`${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
  page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.goto("http://localhost:8765/index.html?gm=1&system=pf2e");
  await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 60) => new Promise(res => setTimeout(res, ms));
    const out = {};
    CONFIG.PF2E.skills = { athletics: { label: "Athletics" }, stealth: { label: "Stealth" }, arcana: { label: "Arcana" } };
    CONFIG.PF2E.saves = { reflex: "Reflex" };
    const posted = [];
    window.ChatMessage = { getSpeaker: d => d ?? {}, create: async d => { posted.push(d); return d; } };
    const mc = await import(`/modules/${M}/scripts/systems/pf2e/multi-check.js`);
    await game.settings.set(M, "pf2eMultiCheck_enabled", true);
    await settle();

    // Codes: single, multi-type with adjustments, actions.
    const parsed = mc.parseChecks({ text: "@Check[athletics|dc:20] or @Check[type:stealth|dc:18|traits:secret] and @Check[reflex,will|dc:22|adjustment:0,-2] [[/act seek dc=19]] [[/act recall-knowledge statistic=arcana dc=25]]" });
    out.parsed = parsed.map(c => `${c.kind}:${c.type}${c.skill ? "/" + c.skill : ""}:${c.dc}:${c.label}`);

    // Selected journal HTML with PF2e's inline links.
    const html = `<p>A <a class="inline-check" data-pf2-check="athletics" data-pf2-dc="20"><span class="label">DC 20 Athletics</span></a> or
      <a data-pf2-action="seek" data-pf2-dc="17"><span class="label">Seek</span></a> check.</p>`;
    out.fromHtml = mc.parseChecks({ html }).map(c => `${c.kind}:${c.type}:${c.dc}:${c.label}`);

    // The card: hardest = reference, DCs GM-only.
    const card = mc.cardHTML({ title: "The cracked wall", checks: mc.parseChecks({ text: "@Check[athletics|dc:20] @Check[stealth|dc:18] @Check[arcana|dc:20]" }) });
    const div = document.createElement("div"); div.innerHTML = card;
    out.card = {
      links: [...div.querySelectorAll("[data-pf2-check]")].map(a => `${a.dataset.pf2Check}:${a.dataset.pf2Dc}:${a.dataset.pf2ShowDc}`),
      gmOnly: [...div.querySelectorAll('[data-visibility="gm"]')].map(s => s.textContent),
      diffs: [...div.querySelectorAll("li")].map(li => li.querySelector(".lucd20-mc-diff")?.textContent ?? ""),
      title: div.querySelector(".lucd20-mc-title")?.textContent
    };

    // Shift-click on a repost icon inside a check group: collected, PF2e's own listener doesn't fire.
    let pf2eReposted = 0;
    document.addEventListener("click", ev => { if (ev.target.closest("i[data-pf2-repost]")) pf2eReposted++; });
    const journal = document.createElement("div");
    journal.innerHTML = `<div data-pf2-checkgroup><a class="inline-check" data-pf2-check="athletics" data-pf2-dc="20"><span class="label">DC 20 Athletics</span><i data-pf2-repost></i></a><br>
      <a class="inline-check" data-pf2-check="stealth" data-pf2-dc="16"><span class="label">DC 16 Stealth</span><i data-pf2-repost></i></a></div>
      <a class="inline-check" data-pf2-check="arcana" data-pf2-dc="25" id="lone"><span class="label">DC 25 Arcana</span><i data-pf2-repost></i></a>`;
    document.body.append(journal);
    journal.querySelector("i[data-pf2-repost]").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settle(150);
    out.plainClick = (() => { journal.querySelector("#lone i").dispatchEvent(new MouseEvent("click", { bubbles: true })); return pf2eReposted; })();
    journal.querySelector("#lone i").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settle(150);
    out.pf2eRepostedAfter = pf2eReposted;
    const app = foundry.applications.instances.get("lucd20-multi-check")?.element;
    out.windowRows = [...(app?.querySelectorAll(".lucd20-mc-row") ?? [])].map(li => `${li.querySelector(".name").textContent.trim()}|${li.querySelector("input.dc").value}|${li.querySelector(".diff").textContent}`);

    // Add by hand (a Lore), then send.
    app.querySelector("select.type").value = "lore";
    app.querySelector("select.type").dispatchEvent(new Event("change"));
    app.querySelector("input.lore").value = "Sailing";
    app.querySelector("input.new-dc").value = "21";
    app.querySelector('[data-action="add"]').click();
    await settle(150);
    out.afterAdd = [...app.querySelectorAll(".lucd20-mc-row .name")].map(n => n.textContent.trim());
    app.querySelector('[data-action="send"]').click();
    await settle(150);
    out.posted = posted.length;
    const p = document.createElement("div"); p.innerHTML = posted[0]?.content ?? "";
    out.postedChecks = [...p.querySelectorAll("[data-pf2-check]")].map(a => a.dataset.pf2Check);
    // Reveal DCs: the GM's button edits the message; every DC shown, the button gone.
    const msgEl = document.createElement("div");
    msgEl.dataset.messageId = "m1";
    const msg = { id: "m1", content: posted[0].content, async update(d) { Object.assign(this, d); } };
    game.messages = Object.assign([msg], { get(id) { return this.find(m => m.id === id); } });
    msgEl.innerHTML = msg.content;
    document.body.append(msgEl);
    out.revealButton = !!msgEl.querySelector('[data-lucd20-mc-reveal][data-visibility="gm"]');
    msgEl.querySelector("[data-lucd20-mc-reveal]").click();
    await settle(100);
    const after = document.createElement("div"); after.innerHTML = msg.content;
    out.revealed = { gmOnly: after.querySelectorAll('[data-visibility="gm"]').length, dcs: [...after.querySelectorAll(".lucd20-mc-dc")].map(s => s.textContent),
      showDc: [...after.querySelectorAll("[data-pf2-show-dc]")].map(a => a.dataset.pf2ShowDc), button: !!after.querySelector("[data-lucd20-mc-reveal]") };
    out.chatControl = !!document.querySelector('[data-lucd20-control="multiCheck"]') || "no chat controls in harness";
    return out;
  });
  await page.screenshot({ path: __dirname + "/test68.png" });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(errors, [], "page errors");
  assert.deepStrictEqual(r.parsed, ["check:athletics:20:Athletics", "check:stealth:18:Stealth", "check:reflex:22:Reflex", "check:will:20:Will",
    "action:seek:19:Seek", "action:recall-knowledge/arcana:25:Recall Knowledge (Arcana)"]);
  assert.deepStrictEqual(r.fromHtml, ["check:athletics:20:Athletics", "action:seek:17:Seek"]);
  assert.deepStrictEqual(r.card.links, ["athletics:20:gm", "stealth:18:gm", "arcana:20:gm"]);
  assert.deepStrictEqual(r.card.gmOnly.slice(0, 3), ["DC 20", "DC 18", "DC 20"], "every DC is GM-only");
  assert.deepStrictEqual(r.card.diffs, ["", "(DC 2 lower)", ""], "relative to the hardest DC");
  assert.strictEqual(r.card.title, "The cracked wall");
  assert.strictEqual(r.plainClick, 1, "a plain click still reaches PF2e's repost");
  assert.strictEqual(r.pf2eRepostedAfter, 1, "Shift-clicks never reach PF2e's repost");
  assert.deepStrictEqual(r.windowRows, ["Athletics|20|DC 5 lower", "Stealth|16|DC 9 lower", "Arcana|25|"], "group collected + the lone check");
  assert.deepStrictEqual(r.afterAdd, ["Athletics", "Stealth", "Arcana", "Sailing Lore"]);
  assert.strictEqual(r.posted, 1);
  assert.deepStrictEqual(r.postedChecks, ["athletics", "stealth", "arcana", "sailing-lore"]);
  assert.ok(r.revealButton, "a GM-only Reveal DCs button");
  assert.deepStrictEqual(r.revealed, { gmOnly: 0, dcs: ["DC 20", "DC 16", "DC 25", "DC 21"], showDc: ["all", "all", "all", "all"], button: false }, "revealed for everyone");
  console.log("PHASE 68 CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
