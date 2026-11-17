const { chromium } = require("playwright");
const assert = require("assert");

/** Phase 48: PF2e Ctrl-click effects. */
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
    const settle = (ms = 60) => new Promise(res => setTimeout(res, ms));
    await import("/modules/lucd20-automations/scripts/systems/pf2e/ctrl-click.js");
    const docs = {
      "Compendium.pf2e.conditionitems.Item.fr": { type: "condition", slug: "frightened" },
      "Compendium.pf2e.spell-effects.Item.ic": { type: "effect", toObject() { return { name: "Effect: Courageous Anthem", type: "effect", system: { level: { value: 1 }, badge: null } }; } },
      "Compendium.pf2e.spells.Item.fb": { type: "spell" }
    };
    window.fromUuidSync = u => docs[u] ?? registry[u];
    window.fromUuid = async u => docs[u] ?? null;
    const registry = {};
    const log = [];
    const actor = (name, owner) => ({ name, uuid: `Actor.${name}`, isOwner: owner,
      async increaseCondition(slug, o) { log.push([name, "condition", slug, o?.value ?? null]); },
      async createEmbeddedDocuments(t, list) { for (const d of list) log.push([name, "item", d.name ?? d.system?.persistent?.formula, d.system?.level?.value ?? d.system?.persistent?.dc, d.system?.context?.origin?.actor ?? d.system?.persistent?.damageType]); } });
    const tok = (id, name, owner, seeName = true) => { const d = { id, uuid: `Scene.s.Token.${id}`, name, actor: actor(name, owner), playersCanSeeName: seeName }; registry[d.uuid] = d; return { document: d }; };
    const mine = tok("a", "Amiri", true), foe = tok("g", "Goblin", false), secret = tok("s", "Gug", false, false);
    canvas.tokens = { controlled: [] };
    game.user.targets = new Set();
    game.user.character = { getActiveTokens: () => [mine] };
    const gmCalls = [];
    // The GM relay, as seen from a player (the harness user is the GM: count what would be sent).
    const sock = await import("/modules/lucd20-automations/scripts/core/socket.js");
    const notes = [];
    ui.notifications = { info: t => notes.push(t), warn: t => notes.push(`!${t}`), error() {} };
    game.pf2e = { ConditionManager: { getCondition: () => ({ toObject: () => ({ name: "Persistent Damage", type: "condition", system: {} }) }) } };
    CONFIG.Dice = { rolls: [class DamageRoll { constructor(f) { this.formula = f; this.instances = f.includes("persistent") ? [{ persistent: true, type: "fire", head: { expression: "1d6" } }] : [{ persistent: false }]; } }] };
    const caster = actor("Ezren", true);
    const msg = { id: "m1", actor: caster, token: { uuid: "Scene.s.Token.ez" }, item: null, rolls: [], flags: { pf2e: { origin: { castRank: 3 } } } };
    game.messages = Object.assign([msg], { get(id) { return this.find(m => m.id === id); } });
    const host = document.createElement("li"); host.dataset.messageId = "m1";
    host.innerHTML = `<p><a class="content-link" data-type="Item" data-uuid="Compendium.pf2e.conditionitems.Item.fr">Frightened 2</a>
      <a class="content-link" data-type="Item" data-uuid="Compendium.pf2e.spell-effects.Item.ic">Effect: Courageous Anthem</a>
      <a class="content-link" data-type="Item" data-uuid="Compendium.pf2e.spells.Item.fb">Fireball</a>
      <a class="inline-roll" data-persistent data-formula="1d6[persistent,fire]">1d6 persistent fire</a>
      <a class="inline-roll" data-formula="2d6[fire]">2d6 fire</a></p>`;
    document.body.append(host);
    Hooks.callAll("renderChatMessageHTML", msg, host);
    const links = host.querySelectorAll("a");
    const out = {};
    out.icons = [...links].map(a => !!a.querySelector("[data-lucd20-cc]"));
    const click = async (a, opts = {}) => { a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts })); await settle(); };
    // A plain click does nothing; Ctrl-click with nothing selected or targeted: the character.
    await click(links[0]); out.plain = log.length;
    await click(links[0], { ctrlKey: true }); out.character = log.splice(0);
    // Selected tokens first; the icon works like Ctrl-click.
    canvas.tokens.controlled = [mine, foe];
    await click(links[1].querySelector("[data-lucd20-cc]")); out.effect = log.splice(0);
    canvas.tokens.controlled = [];
    game.user.targets = new Set([secret]);
    await click(links[3], { metaKey: true }); out.persistent = log.splice(0);
    out.notes = notes.slice();
    game.user.character = null; game.user.targets = new Set();
    await click(links[0], { ctrlKey: true }); out.noOne = notes.at(-1);
    await game.settings.set(M, "pf2eCtrlClick_enabled", false);
    await click(links[0], { ctrlKey: true }); out.off = log.length;
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepStrictEqual(r.icons, [true, true, false, true, false], "the hand after conditions, effects and persistent damage only");
  assert.strictEqual(r.plain, 0, "a plain click doesn't apply");
  assert.deepStrictEqual(r.character, [["Amiri", "condition", "frightened", 2]], "nothing selected or targeted: the character; the link's number");
  assert.deepStrictEqual(r.effect, [["Amiri", "item", "Effect: Courageous Anthem", 3, "Actor.Ezren"], ["Goblin", "item", "Effect: Courageous Anthem", 3, "Actor.Ezren"]], "selected tokens, including one not owned (through the GM); the cast rank and origin");
  assert.deepStrictEqual(r.persistent, [["Gug", "item", "Persistent Damage", 15, "fire"]], "targets when nothing is selected; persistent damage at DC 15");
  assert.deepStrictEqual(r.notes, ["Frightened 2 → Amiri", "Effect: Courageous Anthem → Amiri, Goblin", "1d6 persistent fire → a creature"], "a short notice; a hidden NPC name stays hidden");
  assert.strictEqual(r.noOne, "!Select or target a token first.");
  assert.strictEqual(r.off, 0, "off without a reload");
  assert.deepStrictEqual(errors, []);
  console.log("PHASE 48 CHECKS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
