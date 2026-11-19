const { chromium } = require("playwright");
const assert = require("assert");

/**
 * Phase 66: Shared Picks (docs/PLAN.md §22 Q284). Everyone else sees what is being chosen, only the
 * indicator; the GM can take over and the GM's choice is carried out on the chooser's client.
 * One page plays each side in turn: the queries other clients would get are recorded and fed back.
 */
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async q => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on("pageerror", e => errors.push(`${q}: ${e.message} ${e.stack?.split("\n")[1] ?? ""}`));
    page.on("console", m => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`${q}: ${m.text()}`));
    await page.goto(`http://localhost:8765/index.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
    return page;
  };

  // ---------------- PF2e: Shove squares and Demoralizing Charge's squadmates ----------------
  const page = await open("gm=1&system=pf2e");
  const r = await page.evaluate(async () => {
    const M = "lucd20-automations";
    const settle = (ms = 40) => new Promise(res => setTimeout(res, ms));
    const out = {};
    for (const el of document.querySelectorAll(".lucd20-hub, #core-config")) el.style.display = "none";
    const sp = await import(`/modules/${M}/scripts/core/shared-pick.js`);
    const { pickSquare, pickSeveral } = await import(`/modules/${M}/scripts/core/square-picker.js`);
    await game.settings.set(M, "sharedPicks_enabled", true);
    await settle();

    // Users: the GM (u1), this client (p1, the chooser), another player (p2). Queries are recorded.
    const sent = [];
    const mk = (id, name, isGM) => ({ id, name, isGM, active: true, async query(n, payload) { sent.push({ to: id, payload }); return id === "u1" && payload.op === "takeover" ? window.__gmAnswer ?? true : true; } });
    game.users = Object.assign([mk("u1", "GM", true), mk("p1", "Kyra", false), mk("p2", "Ezren", false)], { get(id) { return this.find(u => u.id === id); }, get activeGM() { return this[0]; } });
    const asUser = id => { game.user = game.users.get(id); };
    asUser("p1");

    // A scene with the shover and the target; canvas.
    const registry = {};
    window.fromUuidSync = u => registry[u];
    const scene = { id: "s" };
    const tok = (id, col, row, hidden = false) => { const d = { id, uuid: `Scene.s.Token.${id}`, name: id, x: col * 100, y: row * 100, width: 1, height: 1, hidden, parent: scene }; d.object = { document: d, visible: true }; registry[d.uuid] = d; return d; };
    const shover = tok("amiri", 5, 6), target = tok("ogre", 5, 5), lurker = tok("lurker", 1, 1, true);
    Object.assign(canvas, { ready: true, scene, grid: { size: 100 }, dimensions: { size: 100 }, interface: new PIXI.Container(), stage: null, app: { view: document.body } });
    canvas.controls = canvas.interface;

    const squares = [{ x: 500, y: 400, width: 100, height: 100, color: 0x3fb950 }, { x: 400, y: 400, width: 100, height: 100, color: 0x3fb950 }, { x: 500, y: 300, width: 100, height: 100, color: 0x3b82f6 }];
    const ops = op => sent.filter(s => s.payload.op === op);

    // 1. The chooser: the others are told (the GM gets the hint and the take over data, the player neither).
    let resolved = "pending";
    const p = pickSquare(squares, { hint: "Shove: push ogre", from: { x: 550, y: 550 }, share: { tokens: [shover.uuid, target.uuid] } }).then(v => { resolved = v; });
    await settle(150);
    const opens = ops("open");
    out.opens = opens.map(o => [o.to, o.payload.hint, !!o.payload.takeover, o.payload.tokens.length]);
    out.firstState = ops("state").map(o => [o.to, o.payload.state.rects.length, !!o.payload.state.arrow]);
    // Hovering a square: the arrow goes to everyone (throttled).
    sent.length = 0;
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 550, clientY: 350, bubbles: true }));
    await settle(150);
    out.hoverState = ops("state").map(o => [o.to, o.payload.state.arrow ? [o.payload.state.arrow.to.x, o.payload.state.arrow.to.y] : null]);

    // 2. The GM takes over: our bar goes, nothing else is said to the players; then the GM's choice resolves the pick here.
    const id = opens[0].payload.id;
    out.spoofed = await sp._test.onQuery({ op: "takeover", id, from: "p2" }); // a player can't take over
    out.taken = await sp._test.onQuery({ op: "takeover", id, from: "u1" });
    await settle();
    out.afterTaken = [!!document.querySelector(".lucd20-pick-bar"), canvas.interface.children.length, ops("close").length, resolved];
    out.wrongSender = await sp._test.onQuery({ op: "result", id, value: 0, from: "p2" });
    await sp._test.onQuery({ op: "result", id, value: 2, from: "u1" });
    await settle();
    out.result = resolved && [resolved.x, resolved.y];

    // 3. A hidden token involved: only the GM is told.
    sent.length = 0;
    const p2 = pickSquare(squares, { hint: "x", share: { tokens: [lurker.uuid] } });
    await settle(120);
    out.hiddenTo = [...new Set(sent.map(s => s.to))];
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await p2; await settle();
    out.cancelClose = ops("close").map(o => o.to);

    // 4. Watching, as another player: only the indicator (no bar), and nothing when a token is hidden from them.
    asUser("p2");
    const watchedOpen = { op: "open", id: "w1", user: "p1", scene: "s", tokens: [shover.uuid, target.uuid], hint: "", takeover: null, from: "p1" };
    await sp._test.onQuery(watchedOpen);
    await sp._test.onQuery({ op: "state", id: "w1", state: { rects: [{ x: 500, y: 400, w: 100, h: 100, color: 0x3fb950 }], arrow: { from: { x: 550, y: 550 }, to: { x: 550, y: 450 } } }, from: "p1" });
    out.playerWatch = [canvas.interface.children.length, canvas.interface.children[0]?.children[0]?.geometry?.graphicsData?.length > 0, !!document.querySelector(".lucd20-pick-bar")];
    target.object.visible = false;
    await sp._test.onQuery({ op: "state", id: "w1", state: { rects: [] }, from: "p1" });
    out.playerUnseen = canvas.interface.children.length;
    target.object.visible = true;
    await sp._test.onQuery({ op: "close", id: "w1", from: "p1" });
    out.playerClosed = canvas.interface.children.length;

    // 5. Watching as the GM: the bar names the chooser and offers Take over; the GM picks; the choice is sent back.
    asUser("u1");
    sent.length = 0;
    await sp._test.onQuery({ ...watchedOpen, id: "w2", hint: "Shove: push ogre", takeover: { type: "square", data: { squares, hint: "Shove: push ogre", cancel: "Cancel", from: { x: 550, y: 550 } } } });
    await sp._test.onQuery({ op: "state", id: "w2", state: { rects: squares.map(s => ({ x: s.x, y: s.y, w: 100, h: 100, color: s.color })) }, from: "p1" });
    const bar = document.querySelector(".lucd20-pick-watch");
    out.gmBar = bar?.textContent;
    // The chooser is p1: its answer to "takeover" comes from its mock (true).
    game.users.get("p1").query = async (n, payload) => { sent.push({ to: "p1", payload }); return true; };
    bar.querySelector("button").click();
    await settle(120);
    out.gmPicking = [!document.querySelector(".lucd20-pick-watch"), document.querySelector(".lucd20-pick-bar")?.textContent];
    // The GM's own picker is shared with the others too (but not offered for a second take over).
    out.gmShares = ops("open").filter(o => o.to !== "u1").map(o => [o.to, !!o.payload.takeover]);
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 450, clientY: 450, button: 0, bubbles: true }));
    await settle(120);
    out.gmResult = sent.filter(s => s.payload.op === "result").map(s => [s.to, s.payload.id, s.payload.value]);

    // 6. pickSeveral (Demoralizing Charge): the chosen squadmates are shared; a take over returns the GM's values.
    asUser("p1");
    sent.length = 0;
    const entries = [{ x: 100, y: 100, width: 100, height: 100, color: 0x3fb950, value: "A" }, { x: 300, y: 100, width: 100, height: 100, color: 0x3fb950, value: "B" }, { x: 500, y: 100, width: 100, height: 100, color: 0x3fb950, value: "C" }];
    let several = "pending";
    pickSeveral(entries, { max: 2, hint: "Pick", confirm: "Signal", share: { tokens: [shover.uuid] } }).then(v => { several = v; });
    await settle(120);
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 150, clientY: 150, button: 0, bubbles: true }));
    await settle(150);
    const st = ops("state").at(-1)?.payload.state;
    out.severalState = st?.rects.map(x => x.color);
    const sid = ops("open")[0].payload.id;
    await sp._test.onQuery({ op: "takeover", id: sid, from: "u1" });
    await sp._test.onQuery({ op: "result", id: sid, value: ["C", "Z"], from: "u1" });
    await settle();
    out.several = several;

    // 7. Switched off: nothing is shared.
    await game.settings.set(M, "sharedPicks_enabled", false);
    await settle();
    sent.length = 0;
    const p3 = pickSquare(squares, { hint: "x", share: { tokens: [shover.uuid] } });
    await settle(120);
    out.offSent = sent.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await p3;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  assert.deepStrictEqual(r.opens, [["u1", "Shove: push ogre", true, 2], ["p2", "", false, 2]], "the GM gets the hint and the take over; the other player only the shapes");
  assert.deepStrictEqual(r.firstState, [["u1", 3, false], ["p2", 3, false]], "the squares go to everyone");
  assert.deepStrictEqual(r.hoverState, [["u1", [550, 350]], ["p2", [550, 350]]], "the hover arrow goes to everyone");
  assert.deepStrictEqual([r.spoofed, r.taken], [false, true], "only a GM can take over");
  assert.deepStrictEqual(r.afterTaken, [false, 0, 2, "pending"], "taken over: the chooser's bar and highlights go, the others are told to clear, the pick waits");
  assert.strictEqual(r.wrongSender, false, "only the GM who took over can answer");
  assert.deepStrictEqual(r.result, [500, 300], "the GM's choice resolves the chooser's pick");
  assert.deepStrictEqual(r.hiddenTo, ["u1"], "a hidden token involved: only the GM is told");
  assert.deepStrictEqual(r.cancelClose, ["u1"], "cancelled: the watchers clear");
  assert.deepStrictEqual(r.playerWatch, [1, true, false], "a player sees the indicator, no bar");
  assert.strictEqual(r.playerUnseen, 0, "a token the player can't see: nothing drawn");
  assert.strictEqual(r.playerClosed, 0, "closed: gone");
  assert.strictEqual(r.gmBar, "Kyra: Shove: push ogre Take over", "the GM's bar names the chooser");
  assert.deepStrictEqual(r.gmPicking, [true, "Shove: push ogre Cancel"], "Take over: the GM's own picker opens");
  assert.deepStrictEqual(r.gmShares, [["p1", false], ["p2", false]], "the GM's picker is shown to the others, no second take over");
  assert.ok(r.gmResult.length === 1 && r.gmResult[0][0] === "p1" && r.gmResult[0][1] === "w2" && r.gmResult[0][2] === 1, "the GM's click goes back to the chooser as the square's index");
  assert.deepStrictEqual(r.severalState, [0x3b82f6, 0x3fb950, 0x3fb950], "pickSeveral: the chosen squadmate is shared");
  assert.deepStrictEqual(r.several, ["C"], "pickSeveral: the GM's values (unknown ones dropped)");
  assert.strictEqual(r.offSent, 0, "switched off: nothing sent");
  await page.screenshot({ path: `${__dirname}/p66-shared.png` });

  assert.deepStrictEqual(errors, [], "no page errors");
  await browser.close();
  console.log("PHASE 66 CHECKS PASSED");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
