const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 30: Skill Challenges — players' window, player rolls, hidden skills, group checks, routes, stages, thresholds, editor. */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message} ${e.stack?.split("\n").slice(1, 3).join(" ")}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    await page.evaluate(() => window.__hub?.close());
    return page;
  };
  const SC = "/modules/lucd20-automations/scripts/systems/dnd4e/skill-challenge.mjs";
  const ENGINE = "/modules/lucd20-automations/scripts/systems/dnd4e/skill-challenge-engine.mjs";
  const CHALLENGE = {
    level: 2, xp: 250, successes: 6, failures: 3,
    skills: [
      { skill: "arc", dc: 15, max: 3, description: "Show what you know about the stone.", note: "GM: secret note." },
      { skill: "dip", dc: 15, description: "Appeal to her interests." },
      { skill: "blu", dc: 20, hidden: true, description: "Flatter her." },
      { skill: "his", role: "secondary", dc: 17, effect: "bonus", bonus: 2 }
    ],
    routes: [{ id: "front", name: "Front door", note: "Guards watch closely.", skills: [{ skill: "dip", dc: 9 }, { skill: "stl", dc: 12, description: "Slip past." }] }, { id: "back", name: "Back door", skills: [{ skill: "arc", remove: true }] }],
    stages: [{ name: "Earn her trust", successes: 3, penalty: 2 }, { name: "Get the stone" }],
    thresholds: [{ failures: 2, text: "The guards are alert." }],
    groupChecks: [{ name: "Collapse", options: [{ skill: "ath", dc: 12 }, { skill: "acr", dc: 17 }] }],
    successText: "She hands it over.", failureText: "She ends the talk.", note: "GM overview."
  };

  const setup = (page, { gm }) => page.evaluate(async ({ SC, CHALLENGE, gm }) => {
    const ID = "lucd20-automations";
    const names = { acr: "Acrobatics", arc: "Arcana", ath: "Athletics", blu: "Bluff", dip: "Diplomacy", his: "History", stl: "Stealth" };
    CONFIG.DND4E = { skills: Object.fromEntries(Object.keys(names).map(k => [k, { label: `SK.${k}` }])) };
    const loc = game.i18n.localize;
    game.i18n.localize = k => (String(k).startsWith("SK.") ? names[k.slice(3)] : loc(k));
    window.__next = []; window.__rolled = [];
    const pc = (id, name, owners) => ({
      id, name, uuid: `Actor.${id}`, type: "Player Character", hasPlayerOwner: true, isOwner: owners.includes(gm ? "u1" : "p1"),
      system: { skills: Object.fromEntries(Object.keys(names).map((k, i) => [k, { total: i + 1 }])) },
      testUserPermission: u => owners.includes(u.id),
      async rollSkill(skill) { window.__rolled.push([name, skill]); const total = window.__next.shift(); return total === undefined ? null : { total }; }
    });
    const actors = [pc("a1", "Kira", ["p1"]), pc("a2", "Borin", ["p2"]), pc("a3", "Zed", ["p3"])];
    game.actors = Object.assign(actors, { contents: actors, get: id => actors.find(a => a.id === id) });
    const users = [{ id: "u1", name: "GM", isGM: true, active: true }, { id: "p1", name: "Alice", isGM: false, active: true }, { id: "p2", name: "Bob", isGM: false, active: false }, { id: "p3", name: "Cy", isGM: false, active: false }];
    game.users = Object.assign(users, { activeGM: users[0], get: id => users.find(u => u.id === id) });
    Object.assign(game.user, gm ? users[0] : users[1], { isActiveGM: gm });
    const page1 = { id: "pg1", name: "Claim It", uuid: "JournalEntry.j1.JournalEntryPage.pg1", flags: { [ID]: { skillChallenge: structuredClone(CHALLENGE) } },
      async update(data) { window.__updates.push(data); this.name = data.name; this.flags[ID].skillChallenge = data[`flags.${ID}.skillChallenge`]; } };
    window.__updates = [];
    const entry1 = { name: "Test Adventure", pages: [page1] };
    game.journal = [entry1]; game.packs = [];
    window.fromUuid = async uuid => [page1, ...actors].find(d => d.uuid === uuid) ?? null;
    window.__chat = []; window.ChatMessage = { create: async data => { window.__chat.push(data); return data; } };
    window.__emits = []; game.socket.emit = (name, msg) => window.__emits.push(msg);
    foundry.utils.randomID = () => Math.random().toString(36).slice(2, 12);
    const tab = document.createElement("section"); tab.id = "journal"; tab.style.cssText = "position:absolute;right:0;top:0;width:300px";
    tab.innerHTML = `<footer class="directory-footer"></footer>`; document.body.append(tab);
    window.__sc = (await import(SC))._test;
  }, { SC, CHALLENGE, gm });
  const settle = (page, ms = 150) => page.waitForTimeout(ms);
  const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const tally = page => page.evaluate(() => [...document.querySelectorAll(".lucd20-sc-runner .lucd20-sc-head .track b")].map(b => b.textContent));
  const rollRow = async (page, skill, total) => { await page.evaluate(t => window.__next.push(t), total); await click(page, `.lucd20-sc-runner .lucd20-sc-skill[data-skill="${skill}"] [data-action="roll"]`); await settle(page); };
  const published = page => page.evaluate(() => game.settings.get("lucd20-automations", "skillChallenge_public"));

  // ---------- Engine ----------
  let page = await open("gm=1&system=dnd4e");
  const engine = await page.evaluate(async ({ ENGINE, CHALLENGE }) => {
    const e = await import(ENGINE);
    const base = e.normalizeChallenge(CHALLENGE);
    const front = e.applyRun(base, { route: "front", needed: 7 });
    const back = e.applyRun(base, { route: "back" });
    const st = e.computeState(front, []);
    const view = e.publicView(front, { name: "Claim It", playerRolls: true, revealed: [] }, st);
    const stageAt = n => e.currentStage(base, { successes: n }).index;
    const listed = e.normalizeChallenge({ stages: [{ name: "A", successes: 1, skills: ["arc"], penalty: 2 }, { name: "B" }], skills: [{ skill: "arc" }, { skill: "dip" }] });
    return {
      again: JSON.stringify(e.normalizeChallenge(base)) === JSON.stringify(base),
      front: [front.successes, front.skills.find(s => s.id === "dip").dc, front.skills.find(s => s.id === "dip").description, front.skills.some(s => s.id === "stl")],
      back: back.skills.map(s => s.id),
      view, viewText: JSON.stringify(view),
      diff: [[7, 1], [10, 1], [12, 1], [15, 1], [17, 1], [19, 1], [22, 1], [15, 12]].map(([dc, lv]) => e.difficultyOf(dc, lv)),
      stages: [0, 2, 3, 5].map(stageAt),
      penalty: [e.stagePenalty(listed, { successes: 0 }, listed.skills[1]), e.stagePenalty(listed, { successes: 0 }, listed.skills[0]), e.stagePenalty(listed, { successes: 1 }, listed.skills[1])],
      mod: [e.resolveCheck(base.skills[0], st, 16, -2).outcome, e.resolveCheck(base.skills[0], st, 16, 0).outcome],
      group: [e.resolveGroup([{ outcome: "success" }, { outcome: "failure" }]), e.resolveGroup([{ outcome: "success" }, { outcome: "failure" }, { outcome: "failure" }]), e.resolveGroup([{ outcome: "success" }, { outcome: "failure" }], "all"), e.resolveGroup([{ outcome: "success" }], "all")]
    };
  }, { ENGINE, CHALLENGE });
  assert.ok(engine.again, "normalizing twice changes nothing (the editor relies on it)");
  assert.deepStrictEqual(engine.front, [7, 9, "Appeal to her interests.", true], "route: DC override keeps the rest, extra skill added, successes needed overridden");
  assert.deepStrictEqual(engine.back, ["dip", "blu", "his"], "route can remove a skill");
  assert.deepStrictEqual(engine.view.skills.map(s => [s.id, s.difficulty]), [["arc", "medium"], ["dip", "easy"], ["his", "hard"], ["stl", "easy"]], "players: difficulty words, hidden skill left out");
  assert.ok(!/"dc"|note|secret|GM|guards|stage|trust|max|hands it over/i.test(engine.viewText), "nothing secret in what players get: " + engine.viewText);
  assert.deepStrictEqual(engine.diff, ["easier", "easy", "medium", "medium", "hard", "hard", "harder", "easy"]);
  assert.deepStrictEqual(engine.stages, [0, 0, 1, 1], "stage 2 starts after 3 successes");
  assert.deepStrictEqual(engine.penalty, [2, 0, 0], "a stage that lists its skills penalizes the others");
  assert.deepStrictEqual(engine.mod, ["failure", "success"], "the GM's modifier is part of the judgment");
  assert.deepStrictEqual(engine.group, [{ ds: 1, df: 0 }, { ds: 0, df: 1 }, { ds: 0, df: 1 }, { ds: 1, df: 0 }], "half succeed = success; more than half fail = failure; rule all: one failure fails it");

  // ---------- GM: runner ----------
  await setup(page, { gm: true });
  await settle(page);
  await click(page, "#journal .lucd20-sc-open");
  await page.waitForSelector(".lucd20-sc-row");
  await click(page, '.lucd20-sc-row [data-action="open"]');
  await page.waitForSelector(".lucd20-sc-runner .lucd20-sc-skill");
  await settle(page);
  // Route: first one by default; changing it changes the rows.
  assert.deepStrictEqual(await page.$$eval(".lucd20-sc-runner .lucd20-sc-skill", els => els.map(e => e.dataset.skill)), ["arc", "dip", "blu", "stl", "his"]);
  await page.selectOption('.lucd20-sc-runner select[name="route"]', "back");
  await settle(page);
  assert.deepStrictEqual(await page.$$eval(".lucd20-sc-runner .lucd20-sc-skill", els => els.map(e => e.dataset.skill)), ["dip", "blu", "his"]);
  await page.selectOption('.lucd20-sc-runner select[name="route"]', "front");
  await settle(page);
  // What players got: no hidden skill until the GM reveals it.
  let pub = Object.values(await published(page))[0];
  assert.deepStrictEqual(pub.skills.map(s => s.id), ["arc", "dip", "his", "stl"]);
  await click(page, '.lucd20-sc-skill[data-skill="blu"] [data-action="reveal-skill"]');
  await settle(page);
  pub = Object.values(await published(page))[0];
  assert.deepStrictEqual(pub.skills.find(s => s.id === "blu"), { id: "blu", skill: "blu", role: "primary", description: "Flatter her.", difficulty: "hard", spent: false }, "revealed skill reaches players, still without a DC");
  // Stage 1 with the "wrong stage" penalty: 16 − 2 misses DC 15. Kira's player is online, so answer for her.
  await click(page, '.lucd20-sc-runner .lucd20-sc-pcs [data-actor="a2"]'); // Borin: the GM rolls
  await settle(page);
  assert.ok((await page.locator(".lucd20-sc-runner .lucd20-sc-bar strong").first().innerText()).includes("Earn her trust"));
  await click(page, '.lucd20-sc-runner [data-action="stage-penalty"]');
  await settle(page);
  assert.strictEqual(await page.inputValue('.lucd20-sc-runner input[name="mod"]'), "-2");
  await rollRow(page, "arc", 16);
  assert.deepStrictEqual(await tally(page), ["0/6", "1/3"], "modifier applied");
  assert.strictEqual(await page.inputValue('.lucd20-sc-runner input[name="mod"]'), "0", "modifier is for one check");
  assert.ok(await page.locator('.lucd20-sc-runner select[name="route"]').isDisabled(), "route locked after the first roll");
  await rollRow(page, "arc", 16);
  assert.deepStrictEqual(await tally(page), ["1/6", "1/3"]);
  // Successes needed.
  await click(page, '.lucd20-sc-runner [data-action="needed"][data-d="1"]');
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["1/7", "1/3"]);
  await click(page, '.lucd20-sc-runner [data-action="needed"][data-d="-1"]');
  await settle(page);

  // Group check from the preset: Kira's player is asked; the GM rolls for Borin and Zed (choosing a skill each).
  await page.evaluate(() => { window.__chat.length = 0; window.__emits.length = 0; window.__next.push(12, 5); });
  await page.evaluate(() => {
    // The mock dialog runs the default button: pick the preset in the form first; skill choices answer "ath".
    const wait = foundry.applications.api.DialogV2.wait;
    foundry.applications.api.DialogV2.wait = async opts => {
      if (opts.buttons.some(b => b.action === "start")) { window.__dialogMode = undefined; window.__dialogPrep = form => (form.elements.preset.value = "0"); const r = await wait(opts); window.__dialogMode = "lock"; return r; }
      return opts.buttons[0].action;
    };
  });
  await click(page, '.lucd20-sc-runner [data-action="group"]');
  await settle(page, 400);
  const ask = await page.evaluate(() => window.__emits.filter(m => m.type === "skillChallenge.groupRoll").map(m => m.payload));
  assert.strictEqual(ask.length, 1);
  assert.deepStrictEqual([ask[0].userId, ask[0].skills, Object.keys(ask[0]).sort()], ["p1", ["ath", "acr"], ["actorUuid", "groupId", "name", "skills", "userId"]], "the player is asked with the allowed skills, no DCs");
  assert.ok((await page.locator(".lucd20-sc-group").innerText()).includes("waiting for Alice"), "panel shows who is still rolling");
  assert.strictEqual(await page.evaluate(() => window.__chat.length), 0, "nothing counted until everyone is in");
  const groupAnswers = await page.evaluate(async p => [await window.__sc.onGroupResult({ groupId: p.groupId, actorUuid: p.actorUuid, skill: "acr", total: 17 }, "p2"), await window.__sc.onGroupResult({ groupId: p.groupId, actorUuid: p.actorUuid, skill: "acr", total: 17 }, "p1")], ask[0]);
  assert.deepStrictEqual(groupAnswers, [false, true], "only the asked player's roll is accepted");
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["2/6", "1/3"], "2 of 3 succeeded: 1 success");
  const groupCard = await page.evaluate(() => window.__chat.at(-1).content.replace(/<[^>]+>/g, " "));
  assert.ok(/Collapse/.test(groupCard) && /Kira\s+·\s+Acrobatics/.test(groupCard) && /Zed\s+·\s+Athletics/.test(groupCard) && !/DC|17|12/.test(groupCard), "public group card: who, which skill, outcome; no numbers");
  await page.screenshot({ path: `${out}/p30-runner.png` });

  // Threshold: the 2nd failure whispers its text to the GM.
  await page.evaluate(() => (window.__chat.length = 0));
  await click(page, '.lucd20-sc-runner [data-action="manual"][data-df="1"]');
  await settle(page);
  const th = await page.evaluate(() => window.__chat.map(c => ({ whisper: c.whisper ?? null, text: c.content.replace(/<[^>]+>/g, " ") })));
  assert.ok(th.length === 2 && th[0].whisper === null && !th[0].text.includes("guards") && th[1].whisper?.includes("u1") && th[1].text.includes("The guards are alert."), "threshold text goes to the GM only");

  // A player's Roll button: checked on the GM's client.
  const asks = await page.evaluate(async () => {
    const key = Object.keys(window.__sc.state.runs)[0];
    window.__emits.length = 0;
    const r = [];
    r.push(await window.__sc.onPlayerRoll({ key, skillId: "dip", actorId: "a2" }, "p1")); // not her character
    r.push(await window.__sc.onPlayerRoll({ key, skillId: "nope", actorId: "a1" }, "p1"));
    r.push(await window.__sc.onPlayerRoll({ key, skillId: "dip", actorId: "a1" }, "p1"));
    r.push(await window.__sc.onPlayerRoll({ key, skillId: "arc", actorId: "a1" }, "p1")); // one at a time
    const sent = window.__emits.map(m => [m.type, m.payload.userId, m.payload.skill]);
    await window.__sc.finishCheck(window.__emits[0].payload.checkId, 9, "p1");
    return { r: r.map(x => x.ok ? "ok" : x.reason), sent };
  });
  assert.deepStrictEqual(asks, { r: ["closed", "closed", "ok", "busy"], sent: [["skillChallenge.roll", "p1", "dip"]] });
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["3/6", "2/3"], "route DC 9: the player's 9 succeeds");
  // Player rolls off, then secret: nothing is published.
  await click(page, '.lucd20-sc-runner [data-action="playerRolls"]');
  await settle(page);
  assert.strictEqual(Object.values(await published(page))[0].canRoll, false);
  assert.deepStrictEqual(Object.values(await published(page))[0].tally, [3, 2]);
  await click(page, '.lucd20-sc-runner [data-action="visibility"]');
  await settle(page);
  assert.deepStrictEqual(await published(page), {}, "secret challenges are not published");
  await click(page, '.lucd20-sc-runner [data-action="visibility"]');
  await settle(page);
  const all = await page.evaluate(() => JSON.stringify([game.settings.get("lucd20-automations", "skillChallenge_public"), game.settings.get("lucd20-automations", "skillChallenge_runs")]));
  assert.ok(!/"dc"|secret note|GM overview|guards|hands it over|Earn her trust/.test(all), "no DC or GM text in either world setting");

  // ---------- GM: editor ----------
  await click(page, '.lucd20-sc-runner [data-action="edit"]');
  await page.waitForSelector(".lucd20-sc-editor");
  const set = (sel, value) => page.evaluate(([s, v]) => { const el = document.querySelector(s); if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, value]);
  await set('.lucd20-sc-editor [data-path="name"]', "Claim the Prize");
  await set('.lucd20-sc-editor [data-path="skills.0.dc"]', "13");
  await set('.lucd20-sc-editor [data-path="skills.2.hidden"]', false);
  await click(page, '.lucd20-sc-editor [data-action="add"][data-list="skills"]');
  await settle(page);
  assert.strictEqual(await page.inputValue('.lucd20-sc-editor [data-path="skills.0.dc"]'), "13", "typing survives adding a row");
  await set('.lucd20-sc-editor [data-path="skills.4.skill"]', "stl");
  await set('.lucd20-sc-editor [data-path="skills.4.bonusSkills"]', "ath, acr");
  await click(page, '.lucd20-sc-editor [data-action="add"][data-list="groupChecks"]');
  await settle(page);
  await set('.lucd20-sc-editor [data-path="groupChecks.1.name"]', "Troublemakers");
  await set('.lucd20-sc-editor [data-path="groupChecks.1.options"]', "stl 17, blu 12");
  await click(page, '.lucd20-sc-editor [data-action="remove"][data-list="thresholds"]');
  await settle(page);
  await page.screenshot({ path: `${out}/p30-editor.png` });
  await set(".lucd20-sc-editor textarea.routes", "{ not json");
  await click(page, '.lucd20-sc-editor [data-action="save"]');
  await settle(page);
  assert.strictEqual(await page.evaluate(() => window.__updates.length), 0, "invalid routes: not saved");
  await set(".lucd20-sc-editor textarea.routes", JSON.stringify(CHALLENGE.routes));
  await click(page, '.lucd20-sc-editor [data-action="save"]');
  await settle(page, 300);
  const savedFlag = await page.evaluate(() => { const u = window.__updates[0]; return { name: u.name, data: u["flags.lucd20-automations.skillChallenge"] }; });
  assert.strictEqual(savedFlag.name, "Claim the Prize");
  assert.deepStrictEqual([savedFlag.data.skills[0].dc, savedFlag.data.skills[2].hidden, savedFlag.data.skills[4].skill, savedFlag.data.skills[4].bonusSkills], [13, false, "stl", ["ath", "acr"]]);
  assert.deepStrictEqual(savedFlag.data.groupChecks[1], { name: "Troublemakers", note: "", rule: "half", options: [{ skill: "stl", dc: 17 }, { skill: "blu", dc: 12 }] });
  assert.deepStrictEqual([savedFlag.data.thresholds.length, savedFlag.data.routes.length, savedFlag.data.successes, savedFlag.data.visibility], [0, 2, 6, null]);
  assert.strictEqual(await page.locator(".lucd20-sc-editor").count(), 0, "saved and closed");
  assert.ok((await page.locator('.lucd20-sc-skill[data-skill="arc"] .chip.dc').innerText()).includes("13"), "the open runner uses the edited challenge");

  // ---------- A player's client ----------
  page = await open("gm=0&system=dnd4e");
  await setup(page, { gm: false });
  const PUBLIC = { run1: { name: "Claim It", successes: 6, failures: 3, tally: [2, 1], canRoll: true, skills: [
    { id: "arc", skill: "arc", role: "primary", description: "Show what you know.", difficulty: "medium", spent: false },
    { id: "dip", skill: "dip", role: "primary", description: "", difficulty: "easy", spent: true },
    { id: "his", skill: "his", role: "secondary", description: "", difficulty: "hard", spent: false }] } };
  await page.evaluate(async PUBLIC => {
    game.users.activeGM = { query: async (name, request) => { (window.__queries ??= []).push(request); return { ok: true }; } };
    await new Promise(r => setTimeout(r, 100));
    window.__before = document.querySelectorAll(".lucd20-sc-open, .lucd20-sc-player").length;
    await game.settings.set("lucd20-automations", "skillChallenge_public", PUBLIC);
  }, PUBLIC);
  await page.waitForSelector(".lucd20-sc-player .lucd20-sc-skill");
  await settle(page);
  assert.strictEqual(await page.evaluate(() => window.__before), 0, "nothing for players while no challenge runs");
  assert.strictEqual(await page.locator("#journal .lucd20-sc-open").count(), 1, "a button to reopen it while one runs");
  const pw = await page.evaluate(() => ({
    text: document.querySelector(".lucd20-sc-player").innerText.replace(/\s+/g, " "),
    chips: [...document.querySelectorAll(".lucd20-sc-player .chip.diff")].map(c => c.textContent),
    disabled: [...document.querySelectorAll('.lucd20-sc-player [data-action="roll"]')].map(b => b.disabled),
    tally: [...document.querySelectorAll(".lucd20-sc-player .track b")].map(b => b.textContent)
  }));
  console.log(pw.text);
  assert.deepStrictEqual([pw.chips, pw.disabled, pw.tally], [["Medium", "Easy", "Hard"], [false, true, false], ["2/6", "1/3"]]);
  assert.ok(pw.text.includes("Show what you know.") && !/DC/.test(pw.text), "descriptions, no DC");
  await page.screenshot({ path: `${out}/p30-player.png` });
  await click(page, '.lucd20-sc-player .lucd20-sc-skill[data-skill="arc"] [data-action="roll"]');
  await settle(page);
  assert.deepStrictEqual(await page.evaluate(() => [window.__queries[0].type, window.__queries[0].payload]), ["skillChallenge.playerRoll", { key: "run1", skillId: "arc", actorId: "a1" }], "rolling asks the GM's client");
  // The GM turns player rolls off; then the challenge ends.
  await page.evaluate(P => game.settings.set("lucd20-automations", "skillChallenge_public", { run1: { ...P.run1, canRoll: false } }), PUBLIC);
  await settle(page);
  assert.strictEqual(await page.locator('.lucd20-sc-player [data-action="roll"]').count(), 0, "no Roll buttons when the GM calls for checks");
  await page.evaluate(() => game.settings.set("lucd20-automations", "skillChallenge_public", {}));
  await settle(page);
  assert.strictEqual(await page.locator(".lucd20-sc-player, #journal .lucd20-sc-open").count(), 0, "window and button go when nothing runs");
  // Group roll request: choose a skill, roll, answer the GM.
  const g = await page.evaluate(async () => {
    foundry.applications.api.DialogV2.wait = async opts => { window.__choices = opts.buttons.map(b => b.label); return "acr"; };
    window.__next.push(14); window.__queries.length = 0;
    const socket = await import("/modules/lucd20-automations/scripts/core/socket.js");
    let handler; const on = game.socket.on; game.socket.on = (n, f) => (handler = f); socket.initSocket(); game.socket.on = on;
    handler({ type: "skillChallenge.groupRoll", payload: { userId: "p1", actorUuid: "Actor.a1", skills: ["ath", "acr"], groupId: "g1", name: "Collapse" }, senderId: "u1" });
    await new Promise(r => setTimeout(r, 100));
    return { choices: window.__choices, rolled: window.__rolled.at(-1), query: window.__queries[0]?.payload };
  });
  assert.deepStrictEqual(g, { choices: ["Athletics +3", "Acrobatics +1"], rolled: ["Kira", "acr"], query: { groupId: "g1", actorUuid: "Actor.a1", skill: "acr", total: 14 } });

  assert.deepStrictEqual(errors.filter(e => !e.includes("NOTIFY Routes")), [], "no page errors");
  console.log("PHASE 30 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
