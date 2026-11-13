const { chromium } = require("playwright");
const assert = require("assert");
const out = __dirname;

/** Phase 29: D&D 4e Skill Challenges (rules engine, list, runner, rolls, chat cards, nothing leaked). */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message} ${e.stack?.split("\n").slice(1, 3).join(" ")}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    await page.evaluate(() => window.__hub?.close());
    return page;
  };
  const SC = "/modules/lucd20-automations/scripts/systems/dnd4e/skill-challenge.mjs";

  /** Mock world: two PCs, a journal page with a challenge, a compendium with another. */
  const setup = page => page.evaluate(async SC => {
    const ID = "lucd20-automations";
    CONFIG.DND4E = { skills: Object.fromEntries(["acr", "ath", "blu", "dip", "ins", "itm", "prc", "stl"].map(k => [k, { label: `SK.${k}` }])) };
    const names = { acr: "Acrobatics", ath: "Athletics", blu: "Bluff", dip: "Diplomacy", ins: "Insight", itm: "Intimidate", prc: "Perception", stl: "Stealth" };
    const loc = game.i18n.localize;
    game.i18n.localize = k => (String(k).startsWith("SK.") ? names[k.slice(3)] : loc(k));
    window.__next = []; // totals the next rolls will give
    window.__rolled = [];
    const pc = (id, name, owners) => ({
      id, name, uuid: `Actor.${id}`, type: "Player Character", hasPlayerOwner: true,
      system: { skills: Object.fromEntries(Object.keys(names).map((k, i) => [k, { total: i + 1 }])) },
      testUserPermission: u => owners.includes(u.id),
      async rollSkill(skill, options) { window.__rolled.push([name, skill, options]); const total = window.__next.shift(); return total === undefined ? null : { total }; }
    });
    const actors = [pc("a1", "Kira", ["p1"]), pc("a2", "Borin", ["p2"]), { id: "n1", name: "Goblin", type: "NPC" }];
    game.actors = Object.assign(actors, { contents: actors });
    const users = [{ id: "u1", name: "GM", isGM: true, active: true }, { id: "p1", name: "Alice", isGM: false, active: false }, { id: "p2", name: "Bob", isGM: false, active: false }];
    game.users = Object.assign(users, { activeGM: users[0] });
    Object.assign(game.user, users[0], { isActiveGM: true });
    const challenge = {
      level: 1, xp: 100, complexity: 1,
      skills: [
        { skill: "ath", dc: 10, max: 1, note: "Climb the wall." },
        { skill: "stl", dc: 10 },
        { skill: "dip", dc: 12, dcStep: 5 },
        { skill: "prc", role: "secondary", dc: 10, effect: "bonus", bonus: 2, penalty: 2 },
        { skill: "ins", role: "secondary", dc: 15, effect: "bonus", bonus: 2, bonusSkills: ["stl"], max: 1 },
        { skill: "itm", role: "secondary", dc: 12, effect: "cancelFailure" }
      ],
      successText: "They get across.", failureText: "The guards are alerted.", note: "GM only note."
    };
    const page1 = { id: "pg1", name: "Cross the Marsh", uuid: "JournalEntry.j1.JournalEntryPage.pg1", flags: { [ID]: { skillChallenge: challenge } } };
    const plain = { id: "pg0", name: "Just text", uuid: "JournalEntry.j1.JournalEntryPage.pg0", flags: {} };
    const entry1 = { name: "Test Adventure", pages: [plain, page1] };
    page1.parent = entry1;
    const page2 = { id: "pg2", name: "Secret Watch", uuid: "Compendium.x.y.JournalEntry.j2.JournalEntryPage.pg2", flags: { [ID]: { skillChallenge: { successes: 2, failures: 1, visibility: "secret", skills: [{ skill: "stl", dc: 14 }] } } } };
    game.journal = [entry1];
    game.packs = [{ documentName: "JournalEntry", collection: "x.y", metadata: { label: "Adventure Pack" }, getDocuments: async () => [{ name: "Pack Entry", pages: [page2] }] },
      { documentName: "Actor", collection: "x.z", getDocuments: async () => { throw new Error("must not be read"); } }];
    window.fromUuid = async uuid => [page1, page2, ...actors].find(d => d.uuid === uuid) ?? null;
    window.__chat = [];
    window.ChatMessage = { create: async data => { window.__chat.push(data); return data; } };
    window.__emits = [];
    game.socket.emit = (name, msg) => window.__emits.push(msg);
    foundry.utils.randomID = () => Math.random().toString(36).slice(2, 12);
    // A Journal tab for the button.
    const tab = document.createElement("section"); tab.id = "journal"; tab.style.cssText = "position:absolute;right:0;top:0;width:300px";
    tab.innerHTML = `<footer class="directory-footer"></footer>`; document.body.append(tab);
    window.__sc = (await import(SC))._test;
  }, SC);

  const settle = page => page.waitForTimeout(120);
  const rollRow = async (page, skill, total) => {
    await page.evaluate(t => window.__next.push(t), total);
    await page.click(`.lucd20-sc-runner .lucd20-sc-skill[data-skill="${skill}"] [data-action="roll"]`);
    await settle(page);
  };
  const tally = page => page.evaluate(() => [...document.querySelectorAll(".lucd20-sc-runner .lucd20-sc-head .track b")].map(b => b.textContent));

  // ---------- Rules engine ----------
  let page = await open("gm=1&system=dnd4e");
  const engine = await page.evaluate(async () => {
    const e = await import("/modules/lucd20-automations/scripts/systems/dnd4e/skill-challenge-engine.mjs");
    const def = e.normalizeChallenge({ complexity: 5, skills: [{ skill: "dip", dc: 17, dcStep: 5 }, { skill: "end", dc: 12, max: 1 }, { skill: "prc", role: "secondary", dc: 12 }, { skill: "dip" }] });
    const dip = def.skills[0];
    const log = [];
    const play = (s, total) => { const r = e.resolveCheck(s, e.computeState(def, log), total); log.push({ type: "check", skillId: s.id, skill: s.skill, ...r, dc: undefined }); return r; };
    const first = play(dip, 17);
    const second = play(dip, 21);
    const end1 = play(def.skills[1], 12);
    const end2 = play(def.skills[1], 30);
    return { goal: [def.successes, def.failures], ids: def.skills.map(s => s.id), secondary: [def.skills[2].effect, def.skills[2].countsFailure],
      first: [first.dc, first.outcome], second: [second.dc, second.outcome, second.df], end: [end1.ds, end2.ds, end2.outcome],
      state: e.computeState(def, log), bad: e.normalizeChallenge(null) };
  });
  assert.deepStrictEqual(engine.goal, [12, 3], "complexity 5 = 12 successes before 3 failures");
  assert.deepStrictEqual(engine.ids, ["dip", "end", "prc", "dip+"], "skill ids are unique");
  assert.deepStrictEqual(engine.secondary, ["none", false], "secondary skills: no success, no failure by default");
  assert.deepStrictEqual([engine.first, engine.second], [[17, "success"], [22, "failure", 1]], "the DC rises with each use");
  assert.deepStrictEqual(engine.end, [1, 0, "success"], "maximum 1 success");
  assert.deepStrictEqual([engine.state.successes, engine.state.failures, engine.state.status], [2, 1, "running"]);
  assert.strictEqual(engine.bad, null);

  // ---------- List ----------
  await setup(page);
  await settle(page);
  assert.strictEqual(await page.locator("#journal .lucd20-sc-open").count(), 1, "button at the bottom of the Journal tab");
  await page.click("#journal .lucd20-sc-open");
  await page.waitForSelector(".lucd20-sc-row");
  const rows = await page.$$eval(".lucd20-sc-row", els => els.map(e => e.innerText.replace(/\s+/g, " ").trim()));
  console.log(rows);
  assert.strictEqual(rows.length, 2, "one from the world, one from the compendium; plain pages ignored");
  assert.ok(rows[0].includes("Cross the Marsh") && rows[0].includes("4 successes before 3 failures") && rows[0].includes("Not started"));
  assert.ok(rows[1].includes("Secret Watch") && rows[1].includes("Adventure Pack"));
  await page.screenshot({ path: `${out}/p29-list.png` });

  // ---------- Runner: open challenge ----------
  await page.evaluate(sel => document.querySelector(sel).click(), '.lucd20-sc-row[data-uuid="JournalEntry.j1.JournalEntryPage.pg1"] [data-action="open"]');
  await page.waitForSelector(".lucd20-sc-runner .lucd20-sc-skill", { timeout: 3000 }).catch(async e => { console.log(errors, await page.evaluate(() => document.querySelector(".lucd20-sc-runner")?.outerHTML.slice(0, 600))); throw e; });
  assert.deepStrictEqual(await tally(page), ["0/4", "0/3"]);
  await page.click('.lucd20-sc-runner .lucd20-sc-pcs [data-actor="a1"]');
  await settle(page);
  // Nobody who owns Kira is online: the GM rolls. Nothing but the skill goes to the system's roll.
  await rollRow(page, "ath", 10);
  assert.deepStrictEqual(await page.evaluate(() => [...window.__rolled.at(-1).slice(0, 2), window.__rolled.at(-1)[2] === undefined]), ["Kira", "ath", true], "rolled with the system's skill roll, no DC passed");
  assert.deepStrictEqual(await tally(page), ["1/4", "0/3"]);
  assert.ok(await page.locator('.lucd20-sc-skill[data-skill="ath"] [data-action="roll"]').isDisabled(), "maximum 1 success: the row is done");
  // Perception (secondary) succeeds: +2 to the next check, no success. Then Stealth 8 + 2 beats DC 10.
  await rollRow(page, "prc", 15);
  assert.deepStrictEqual(await tally(page), ["1/4", "0/3"]);
  assert.ok((await page.locator(".lucd20-sc-banner.bonus").innerText()).includes("+2"), "waiting bonus shown");
  await rollRow(page, "stl", 8);
  assert.deepStrictEqual(await tally(page), ["2/4", "0/3"], "the +2 turned an 8 into a success");
  assert.strictEqual(await page.locator(".lucd20-sc-banner.bonus").count(), 0, "bonus used up");
  // Failed Perception: −2 to the next check, no failure. Stealth 11 − 2 misses DC 10.
  await rollRow(page, "prc", 3);
  await rollRow(page, "stl", 11);
  assert.deepStrictEqual(await tally(page), ["2/4", "1/3"]);
  // Intimidate cancels the failure. Diplomacy's DC goes 12 → 17.
  await rollRow(page, "itm", 12);
  assert.deepStrictEqual(await tally(page), ["2/4", "0/3"], "failure cancelled");
  await rollRow(page, "dip", 12);
  assert.ok((await page.locator('.lucd20-sc-skill[data-skill="dip"] .chip.dc').innerText()).includes("17"), "DC +5 after a use");
  await rollRow(page, "dip", 16);
  assert.deepStrictEqual(await tally(page), ["3/4", "1/3"]);
  // Undo, another character, the "Other skill" row, a manual success.
  await page.click('.lucd20-sc-runner [data-action="undo"]');
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["3/4", "0/3"], "undo drops the last entry");
  await page.click('.lucd20-sc-runner .lucd20-sc-pcs [data-actor="a2"]');
  await settle(page);
  await page.selectOption('.lucd20-sc-runner select[name="otherSkill"]', "acr");
  await page.fill('.lucd20-sc-runner input[name="otherDC"]', "20");
  await page.evaluate(() => window.__next.push(19));
  await page.click('.lucd20-sc-runner [data-action="rollOther"]');
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["3/4", "1/3"], "other skill against a typed DC");
  assert.deepStrictEqual(await page.evaluate(() => window.__rolled.at(-1).slice(0, 2)), ["Borin", "acr"]);
  await page.screenshot({ path: `${out}/p29-runner.png` });

  // Open challenge: every card is public and none shows a DC.
  const openCards = await page.evaluate(() => window.__chat.map(c => ({ whisper: c.whisper ?? null, text: c.content.replace(/<[^>]+>/g, " ") })));
  assert.ok(openCards.length >= 9 && openCards.every(c => c.whisper === null), "open: public cards");
  assert.ok(openCards.every(c => !/DC/.test(c.text)), "no DC in public cards");
  assert.ok(openCards[0].text.includes("Kira") && openCards[0].text.includes("Athletics") && openCards[0].text.includes("Success"));

  // A cancelled roll (the dialog was closed) counts nothing.
  await page.click('.lucd20-sc-skill[data-skill="stl"] [data-action="roll"]');
  await settle(page);
  assert.deepStrictEqual(await tally(page), ["3/4", "1/3"]);

  // The 4th success ends it: result to the GM only, "Show players" posts the public one.
  await page.evaluate(() => (window.__chat.length = 0));
  await page.click('.lucd20-sc-runner [data-action="manual"][data-ds="1"]');
  await settle(page);
  const endCards = await page.evaluate(() => window.__chat.map(c => ({ whisper: c.whisper ?? null, html: c.content })));
  assert.strictEqual(endCards.length, 2);
  assert.ok(endCards[1].whisper?.includes("u1") && endCards[1].html.includes("They get across.") && endCards[1].html.includes("100 XP") && endCards[1].html.includes('data-lucd20-sc="reveal"'), "result card: GM only, with the outcome text and a reveal button");
  assert.ok(await page.locator('.lucd20-sc-skill[data-skill="stl"] [data-action="roll"]').isDisabled(), "no more rolls once it is over");
  // The chat button.
  await page.evaluate(html => {
    const el = document.createElement("div"); el.id = "msg"; el.innerHTML = html; document.body.append(el);
    Hooks.callAll("renderChatMessageHTML", { flags: {}, getFlag: () => null }, el);
  }, endCards[1].html);
  await page.evaluate(() => document.querySelector('#msg [data-lucd20-sc="reveal"]').click());
  await settle(page);
  const pub = await page.evaluate(() => window.__chat.at(-1));
  assert.ok(!pub.whisper && pub.content.includes("They get across.") && !pub.content.includes("XP") && !pub.content.includes("reveal") && !pub.content.includes("GM only note"), "public result: outcome text, no XP, no GM note");

  // ---------- Secret challenge, roll sent to the player ----------
  await page.evaluate(async () => { game.users.find(u => u.id === "p1").active = true; window.__chat.length = 0; for (const app of window.__sc.SkillChallengeRunner.all()) await app.close(); });
  await page.evaluate(sel => document.querySelector(sel).click(), '.lucd20-sc-row[data-uuid^="Compendium"] [data-action="open"]');
  await settle(page);
  const secretKey = await page.evaluate(() => window.__sc.keyOf("Compendium.x.y.JournalEntry.j2.JournalEntryPage.pg2"));
  const runner2 = ".lucd20-sc-runner"; // the mock windows have no id
  await page.waitForSelector(`${runner2} .lucd20-sc-skill`);
  await page.click(`${runner2} .lucd20-sc-pcs [data-actor="a1"]`);
  await settle(page);
  await page.click(`${runner2} .lucd20-sc-skill[data-skill="stl"] [data-action="roll"]`);
  await settle(page);
  const emit = await page.evaluate(() => window.__emits.at(-1));
  assert.strictEqual(emit.type, "skillChallenge.roll");
  assert.deepStrictEqual(Object.keys(emit.payload).sort(), ["actorUuid", "checkId", "skill", "userId"], "the request carries no DC");
  assert.strictEqual(emit.payload.userId, "p1", "sent to Kira's player");
  assert.ok((await page.locator(`${runner2} .lucd20-sc-banner.waiting`).innerText()).includes("Alice"), "waiting for the player");
  const answers = await page.evaluate(async id => [await window.__sc.finishCheck(id, 30, "p2"), await window.__sc.finishCheck(id, 14, "p1")], emit.payload.checkId);
  assert.deepStrictEqual(answers, [false, true], "only the asked player's result is accepted");
  await settle(page);
  const secretCards = await page.evaluate(() => window.__chat.map(c => ({ whisper: c.whisper ?? null, text: c.content.replace(/<[^>]+>/g, " ") })));
  assert.ok(secretCards.length === 1 && secretCards[0].whisper?.includes("u1") && /14 vs DC 14/.test(secretCards[0].text), "secret: one card, whispered to the GM, with the numbers");
  await page.screenshot({ path: `${out}/p29-secret.png` });

  // Dice So Nice: the card waits for the dice of that player's roll.
  const dsn = await page.evaluate(async () => {
    game.modules.set("dice-so-nice", { active: true });
    let release; const order = [];
    game.dice3d = { waitFor3DAnimationByMessageID: id => new Promise(r => { order.push(`wait:${id}`); release = () => { order.push("dice done"); r(true); }; }) };
    const msgs = [{ id: "old", author: { id: "p1" }, rolls: [{}], timestamp: Date.now() - 60000 }, { id: "m1", author: { id: "p1" }, rolls: [{}], timestamp: Date.now() }];
    game.messages = { contents: msgs };
    window.__chat.length = 0;
    document.querySelector('.lucd20-sc-runner .lucd20-sc-skill[data-skill="stl"] [data-action="roll"]').click();
    await new Promise(r => setTimeout(r, 50));
    const done = window.__sc.finishCheck(window.__emits.at(-1).payload.checkId, 20, "p1");
    await new Promise(r => setTimeout(r, 150));
    const before = window.__chat.length;
    release();
    await done;
    order.push(`cards:${window.__chat.length}`);
    game.modules.delete("dice-so-nice"); delete game.dice3d;
    return { before, order };
  });
  assert.deepStrictEqual(dsn, { before: 0, order: ["wait:m1", "dice done", "cards:2"] }, "nothing in chat until the 3D dice stop");
  await settle(page);

  // A journal entry with a challenge gets a Run button in its title bar; one without doesn't.
  const sheet = await page.evaluate(async () => {
    const mk = (id, entry) => { const el = document.createElement("div"); el.id = id; el.innerHTML = `<header class="window-header"><h1 class="window-title">J</h1><button data-action="toggleControls"></button><button data-action="close"></button></header>`; document.body.append(el);
      foundry.applications.instances.set(id, { document: Object.assign(entry, { documentName: "JournalEntry" }), element: el }); return el; };
    const withOne = mk("js1", game.journal[0]);
    const none = mk("js2", { name: "Plain", pages: [{ flags: {} }] });
    document.body.append(document.createElement("i")); // any page change wakes the watcher
    await new Promise(r => setTimeout(r, 100));
    for (const app of window.__sc.SkillChallengeRunner.all()) await app.close();
    const button = withOne.querySelector(".lucd20-sc-run");
    const place = button?.nextElementSibling?.dataset.action;
    button?.click();
    await new Promise(r => setTimeout(r, 150));
    const out = { has: !!button, place, none: !!none.querySelector(".lucd20-sc-run"), opened: document.querySelector(".lucd20-sc-runner .window-header")?.textContent ?? null, runners: document.querySelectorAll(".lucd20-sc-runner").length };
    for (const app of window.__sc.SkillChallengeRunner.all()) await app.close();
    foundry.applications.instances.delete("js1"); foundry.applications.instances.delete("js2"); withOne.remove(); none.remove();
    return out;
  });
  assert.deepStrictEqual([sheet.has, sheet.place, sheet.none, sheet.runners], [true, "toggleControls", false, 1], "Run button before the ⋮ button, and it opens the runner");

  // The saved runs hold no DC and no GM text (players' clients receive world settings).
  const saved = await page.evaluate(() => JSON.stringify(game.settings.get("lucd20-automations", "skillChallenge_runs")));
  assert.ok(!/"dc"|GM only note|Climb the wall|They get across/.test(saved), "nothing secret in the saved runs");
  assert.strictEqual(JSON.parse(saved)[secretKey].log.length, 2);

  // Reset from the list; switching the feature off removes everything.
  await page.evaluate(sel => document.querySelector(sel).click(), '.lucd20-sc-row[data-uuid^="Compendium"] [data-action="reset"]');
  await settle(page);
  assert.strictEqual(await page.locator(runner2).count(), 0, "reset closes the runner");
  assert.ok((await page.locator('.lucd20-sc-row[data-uuid^="Compendium"]').innerText()).includes("Not started"));
  await page.evaluate(() => game.settings.set("lucd20-automations", "dnd4eSkillChallenge_enabled", false));
  await settle(page);
  assert.strictEqual(await page.locator(".lucd20-sc-open, .lucd20-sc-runner, .lucd20-sc-list-window").count(), 0, "switched off without a reload");
  await page.evaluate(() => game.settings.set("lucd20-automations", "dnd4eSkillChallenge_enabled", true));
  await settle(page);
  assert.strictEqual(await page.locator("#journal .lucd20-sc-open").count(), 1, "and on again");

  // ---------- A player's client ----------
  page = await open("gm=0&system=dnd4e");
  await setup(page);
  const player = await page.evaluate(async () => {
    Object.assign(game.user, { id: "p1", name: "Alice", isGM: false, isActiveGM: false });
    game.users.activeGM = { query: async (name, request) => { window.__query = request; return true; } };
    await new Promise(r => setTimeout(r, 100));
    const button = document.querySelectorAll(".lucd20-sc-open").length;
    window.__next.push(13);
    const { MODULE_ID } = await import("/modules/lucd20-automations/scripts/core/constants.js");
    // Deliver the GM's request as the socket would.
    const socket = await import("/modules/lucd20-automations/scripts/core/socket.js");
    let handler; const on = game.socket.on; game.socket.on = (n, f) => (handler = f); socket.initSocket(); game.socket.on = on;
    handler({ type: "skillChallenge.roll", payload: { userId: "p2", actorUuid: "Actor.a2", skill: "stl", checkId: "zz" }, senderId: "u1" });
    await new Promise(r => setTimeout(r, 50));
    const other = window.__rolled.length;
    handler({ type: "skillChallenge.roll", payload: { userId: "p1", actorUuid: "Actor.a1", skill: "stl", checkId: "c1" }, senderId: "u1" });
    await new Promise(r => setTimeout(r, 50));
    return { button, other, rolled: window.__rolled.at(-1)?.slice(0, 2), query: window.__query, info: window.__infos?.at(-1), card: document.querySelector('[data-category="dnd4e"] [data-feature="dnd4eSkillChallenge"]') !== null };
  });
  console.log(player);
  assert.strictEqual(player.button, 0, "no Journal button for players");
  assert.strictEqual(player.other, 0, "a request for someone else is ignored");
  assert.deepStrictEqual(player.rolled, ["Kira", "stl"], "the asked player rolls");
  assert.deepStrictEqual([player.query.type, player.query.payload], ["skillChallenge.result", { checkId: "c1", total: 13 }], "and reports the total to the GM");
  assert.ok(player.info.includes("Stealth") && player.info.includes("Kira"));

  // ---------- Another system ----------
  page = await open("gm=1&system=pf2e");
  const other = await page.evaluate(async () => {
    const { getFeature } = await import("/modules/lucd20-automations/scripts/core/registry.js");
    return { registered: [...game.settings.settings.keys()].some(k => k.includes("dnd4eSkillChallenge")), active: !!getFeature("dnd4eSkillChallenge")?.active };
  });
  assert.deepStrictEqual(other, { registered: false, active: false }, "nothing of it in PF2e");

  assert.deepStrictEqual(errors, [], "no page errors");
  console.log("PHASE 29 CHECKS PASSED");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
