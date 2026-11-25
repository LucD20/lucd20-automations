/**
 * Combat Cards: the 55 cards (owner, PLAN §26.8; v0.85.0) and how a fight's recorded data earns them.
 * Pure (no Foundry): `computeStats(data)` reads the Encounter Report's recording; `dealCards(data)` gives
 * every player character exactly one card.
 *
 * Numbers (#1–55) are the review page's (`docs/mockups/combat-cards-catalog.html`); text lives in
 * `lang/en.json` under LUCD20.CombatCards.Card.<id> (Name, Rule, Stat, Q1, Q2).
 * `pf2` cards need PF2e / SF2e roll data (attack / save outcomes, skill actions, spells, Hero Points, dying):
 * they never trigger elsewhere and are left out of the Deck's totals there.
 */

export const RARITIES = ["common", "rare", "epic", "legendary"];
const FRIENDLY = 1, HOSTILE = -1;
const SUCCESS = new Set(["success", "criticalSuccess"]);

/* -------------------------------------------- */
/*  What happened, per player character         */
/* -------------------------------------------- */

export function computeStats(data) {
  const list = data?.participants ?? [];
  const p = Object.fromEntries((Array.isArray(list) ? list : Object.entries(list).map(([uuid, x]) => ({ uuid, ...x }))).map(x => [x.uuid, x]));
  const events = data?.events ?? [];
  const side = uuid => p[uuid]?.side ?? 0;
  const isFoe = uuid => side(uuid) === HOSTILE && !p[uuid]?.hidden;
  // Player characters (older recordings have no "pc": the friendly side without a master).
  const pcs = Object.values(p).filter(x => !x.hidden && (x.pc ?? (x.side === FRIENDLY && !x.master))).map(x => x.uuid);
  const levels = pcs.map(u => p[u].level).filter(n => Number.isFinite(n));
  const partyLevel = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
  const masterOf = uuid => p[uuid]?.master && p[p[uuid].master] ? p[uuid].master : null;

  const st = {};
  const me = uuid => (st[uuid] ??= {
    damage: 0, maxHit: 0, enemiesHit: new Set(), round1: 0, finals: 0, executions: 0, maxExecution: 0, bossDamage: 0, giantSlain: 0,
    taken: 0, minHp: null, minFrac: 1, wentDown: false, cameBack: false, revived: new Set(), healed: 0, healedAllies: new Set(),
    companions: 0, onTurnByAllies: 0, attacks: 0, hits: 0, crits: 0, attackedTimes: 0, hitOnMe: 0,
    saves: 0, saveSucc: 0, saveCrits: 0, nat20: 0, skills: {}, skillTargets: {}, spells: 0, maxRankCast: 0, squares: 0, hero: 0, maxDying: 0
  });
  for (const u of pcs) me(u);
  const party = { pcs, partyLevel, rounds: Number(data?.rounds) || Math.max(1, ...events.map(e => e.round || 0)), totalDamage: 0, totalTaken: 0, enemyHP: 0,
    hits: [], first: null, lastFoeDown: null };
  party.enemyHP = Object.values(p).filter(x => x.side === HOSTILE && !x.hidden).reduce((n, x) => n + (x.hp || 0), 0);
  const foesDown = new Set();
  // Whose damage it counts as: a PC's own, or its companion's (for Pack Leader / party totals).
  const owner = uuid => (pcs.includes(uuid) ? uuid : pcs.includes(masterOf(uuid)) ? masterOf(uuid) : null);

  for (const ev of events) {
    const src = ev.source, tgt = ev.target;
    switch (ev.kind) {
      case "damage": {
        if (isFoe(tgt) && side(src) === FRIENDLY) {
          party.totalDamage += ev.amount;
          if (!party.first) party.first = { uuid: owner(src) ?? src, round: ev.round };
          if (ev.down) { foesDown.add(tgt); party.lastFoeDown = owner(src) ?? src; }
        }
        if (isFoe(tgt) && pcs.includes(src)) {
          const s = me(src);
          s.damage += ev.amount;
          s.maxHit = Math.max(s.maxHit, ev.amount);
          party.hits.push(ev.amount);
          s.enemiesHit.add(tgt);
          if (ev.round === 1) s.round1 += ev.amount;
          if (ev.down) s.finals += 1;
          if (ev.down && ev.full) { s.executions += 1; s.maxExecution = Math.max(s.maxExecution, ev.amount); }
          const lvl = p[tgt]?.level;
          if (partyLevel != null && Number.isFinite(lvl) && lvl >= partyLevel + 2) s.bossDamage += ev.amount;
          if (ev.down && partyLevel != null && Number.isFinite(lvl) && lvl >= partyLevel + 3) s.giantSlain = Math.max(s.giantSlain, lvl - partyLevel);
        } else if (isFoe(tgt) && pcs.includes(masterOf(src))) {
          me(masterOf(src)).companions += ev.amount;
          party.hits.push(ev.amount);
          if (ev.down) foesDown.add(tgt);
        } else if (isFoe(tgt) && ev.down) {
          foesDown.add(tgt);
        }
        if (isFoe(tgt) && ev.turn && pcs.includes(ev.turn) && src !== ev.turn && side(src) === FRIENDLY) me(ev.turn).onTurnByAllies += ev.amount;
        if (pcs.includes(tgt)) {
          const s = me(tgt);
          s.taken += ev.amount;
          party.totalTaken += ev.amount;
          if (ev.down) s.wentDown = true;
          if (Number.isFinite(ev.hp) && ev.max > 0) {
            if (s.minHp == null || ev.hp < s.minHp) s.minHp = ev.hp;
            s.minFrac = Math.min(s.minFrac, ev.hp / ev.max);
          }
        }
        break;
      }
      case "heal": {
        if (pcs.includes(tgt) && ev.up) me(tgt).cameBack = true;
        const healer = pcs.includes(src) ? src : null;
        if (healer) {
          const s = me(healer);
          s.healed += ev.amount;
          if (tgt !== healer && side(tgt) === FRIENDLY) s.healedAllies.add(tgt);
          if (ev.up && tgt !== healer && side(tgt) === FRIENDLY) s.revived.add(tgt);
        }
        break;
      }
      case "attack": {
        if (pcs.includes(src)) {
          const s = me(src);
          s.attacks += 1;
          if (SUCCESS.has(ev.outcome)) s.hits += 1;
          if (ev.outcome === "criticalSuccess") s.crits += 1;
        }
        if (pcs.includes(tgt) && isFoe(src)) {
          const s = me(tgt);
          s.attackedTimes += 1;
          if (SUCCESS.has(ev.outcome)) s.hitOnMe += 1;
        }
        break;
      }
      case "save": if (pcs.includes(src)) { const s = me(src); s.saves += 1; if (SUCCESS.has(ev.outcome)) s.saveSucc += 1; if (ev.outcome === "criticalSuccess") s.saveCrits += 1; } break;
      case "skill": if (pcs.includes(src)) {
        const s = me(src);
        const k = (s.skills[ev.action] ??= { count: 0, success: 0 });
        k.count += 1;
        if (SUCCESS.has(ev.outcome)) k.success += 1;
        if (ev.target) (s.skillTargets[ev.action] ??= new Set()).add(ev.target);
      } break;
      case "spell": if (pcs.includes(src)) { const s = me(src); s.spells += 1; s.maxRankCast = Math.max(s.maxRankCast, ev.rank || 0); } break;
      case "nat20": if (pcs.includes(src)) me(src).nat20 += 1; break;
      case "move": if (pcs.includes(src)) me(src).squares += ev.squares || 0; break;
      case "hero": if (pcs.includes(src)) me(src).hero += 1; break;
      case "dying": if (pcs.includes(tgt)) me(tgt).maxDying = Math.max(me(tgt).maxDying, ev.value || 0); break;
    }
  }
  const foes = Object.values(p).filter(x => x.side === HOSTILE && !x.hidden).map(x => x.uuid);
  party.won = foes.length > 0 && foes.every(u => foesDown.has(u));
  party.clutch = party.won ? party.lastFoeDown : null;
  party.avgHit = party.hits.length ? party.hits.reduce((a, b) => a + b, 0) / party.hits.length : 0;
  party.maxHit = Math.max(0, ...party.hits);
  return { p, st, party };
}

/* -------------------------------------------- */
/*  The cards                                   */
/* -------------------------------------------- */

const sk = (s, ...actions) => actions.reduce((n, a) => n + (s.skills[a]?.success ?? 0), 0);
const takedowns = s => sk(s, "trip", "shove", "grapple");
/** "Most X" among the PCs (ties all qualify; one card per fight sorts it out). */
const top = (ctx, key, s) => s[key] > 0 && ctx.party.pcs.every(u => (ctx.st[u][key] ?? 0) <= s[key]);
const share = (n, total) => (total > 0 ? n / total : 0);
const pct = n => `${Math.round(n * 100)}%`;

/**
 * id, rarity, pf2 (needs PF2e roll data), test(s, ctx, uuid) → { value, score } | null.
 * score (0–1+) decides between two cards of the same rarity.
 */
export const CARDS = [
  // Common
  { id: "hammer", rarity: "common", test: (s, c) => top(c, "damage", s) && { value: s.damage, score: share(s.damage, c.party.totalDamage) } },
  { id: "wall", rarity: "common", test: (s, c) => top(c, "taken", s) && { value: s.taken, score: share(s.taken, c.party.totalTaken) } },
  { id: "lifeline", rarity: "common", test: (s, c) => top(c, "healed", s) && { value: s.healed, score: 0.6 } },
  { id: "firstBlood", rarity: "common", test: (s, c, u) => c.party.first?.uuid === u && { value: c.party.first.round, score: 0.3 } },
  { id: "finisher", rarity: "common", test: (s, c) => top(c, "finals", s) && { value: s.finals, score: 0.4 + s.finals / 10 } },
  { id: "sharpshooter", rarity: "common", pf2: true, test: (s, c) => s.attacks >= 2 && s.hits > 0 && c.party.pcs.every(u => { const o = c.st[u]; return o.attacks < 2 || o.hits / o.attacks <= s.hits / s.attacks; }) && { value: `${s.hits}/${s.attacks}`, score: s.hits / s.attacks } },
  { id: "commander", rarity: "common", test: (s, c) => top(c, "onTurnByAllies", s) && { value: s.onTurnByAllies, score: share(s.onTurnByAllies, c.party.totalDamage) } },
  { id: "packLeader", rarity: "common", test: (s, c) => top(c, "companions", s) && { value: s.companions, score: share(s.companions, c.party.totalDamage) } },
  { id: "steadfast", rarity: "common", fallback: true, test: (s, c) => !s.wentDown && { value: c.party.rounds, score: 0.01 } },
  { id: "shoulder", rarity: "common", fallback: true, test: (s, c) => ({ value: c.party.rounds, score: 0 }) },
  // Rare
  { id: "onePunch", rarity: "rare", test: (s, c) => s.maxHit > 0 && s.maxHit >= c.party.maxHit && s.maxHit >= 2 * c.party.avgHit && c.party.hits.length >= 3 && { value: s.maxHit, score: s.maxHit / Math.max(1, c.party.avgHit) / 4 } },
  { id: "luckyStar", rarity: "rare", pf2: true, test: s => s.crits >= 2 && { value: s.crits, score: 0.5 } },
  { id: "closeCall", rarity: "rare", test: s => !s.wentDown && s.minHp != null && s.minHp > 0 && s.minFrac < 0.25 && { value: s.minHp, score: 1 - s.minFrac } },
  { id: "untouchable", rarity: "rare", test: (s, c) => s.taken === 0 && c.party.rounds >= 3 && { value: 0, score: 0.5 } },
  { id: "backFromTheBrink", rarity: "rare", test: s => s.wentDown && s.cameBack && { value: 1, score: 0.6 } },
  { id: "fieldMedic", rarity: "rare", test: s => s.healedAllies.size >= 2 && { value: s.healedAllies.size, score: 0.5 } },
  { id: "whirlwind", rarity: "rare", test: s => s.enemiesHit.size >= 3 && { value: s.enemiesHit.size, score: s.enemiesHit.size / 10 } },
  { id: "openingSalvo", rarity: "rare", test: (s, c) => c.party.enemyHP > 0 && s.round1 >= 0.25 * c.party.enemyHP && { value: pct(s.round1 / c.party.enemyHP), score: s.round1 / c.party.enemyHP } },
  { id: "ironHide", rarity: "rare", test: (s, c) => c.party.pcs.length >= 2 && c.party.totalTaken > 0 && !s.wentDown && s.taken >= c.party.totalTaken / 3 && { value: pct(s.taken / c.party.totalTaken), score: s.taken / c.party.totalTaken } },
  { id: "clutch", rarity: "rare", test: (s, c, u) => c.party.clutch === u && { value: c.party.rounds, score: 0.5 } },
  // Common (#31–38)
  { id: "spellslinger", rarity: "common", pf2: true, test: (s, c) => s.spells >= 2 && top(c, "spells", s) && { value: s.spells, score: 0.3 + s.spells / 20 } },
  { id: "marathon", rarity: "common", test: (s, c) => top(c, "squares", s) && { value: s.squares, score: 0.2 } },
  { id: "immovable", rarity: "common", test: (s, c) => c.party.rounds >= 3 && s.squares <= 1 && { value: s.squares, score: 0.15 } },
  { id: "scholar", rarity: "common", pf2: true, test: s => (s.skills["recall-knowledge"]?.count ?? 0) >= 1 && { value: s.skills["recall-knowledge"].count, score: 0.2 } },
  { id: "ironWill", rarity: "common", pf2: true, test: s => s.saveSucc >= 3 && { value: s.saveSucc, score: 0.3 } },
  { id: "terror", rarity: "common", pf2: true, test: s => sk(s, "demoralize") >= 1 && { value: sk(s, "demoralize"), score: 0.3 } },
  { id: "wrestler", rarity: "common", pf2: true, test: s => takedowns(s) >= 1 && { value: takedowns(s), score: 0.3 } },
  { id: "acrobat", rarity: "common", pf2: true, test: s => sk(s, "tumble-through") >= 1 && { value: sk(s, "tumble-through"), score: 0.3 } },
  // Rare (#39–46)
  { id: "trickster", rarity: "rare", pf2: true, test: s => sk(s, "feint") >= 2 && { value: sk(s, "feint"), score: 0.4 } },
  { id: "natural", rarity: "rare", test: s => s.nat20 >= 2 && { value: s.nat20, score: 0.5 } },
  { id: "unshakable", rarity: "rare", pf2: true, test: s => s.saveCrits >= 1 && { value: s.saveCrits, score: 0.4 } },
  { id: "combatMedic", rarity: "rare", pf2: true, test: s => (s.skillTargets["battle-medicine"]?.size ?? 0) >= 2 && { value: s.skillTargets["battle-medicine"].size, score: 0.5 } },
  { id: "fatesFavourite", rarity: "rare", pf2: true, test: (s, c) => s.hero >= 1 && c.party.won && { value: s.hero, score: 0.4 } },
  { id: "bigGuns", rarity: "rare", pf2: true, test: (s, c, u) => s.maxRankCast >= 1 && c.p[u]?.maxRank != null && s.maxRankCast >= c.p[u].maxRank && { value: s.maxRankCast, score: 0.4 } },
  { id: "shruggedItOff", rarity: "rare", pf2: true, test: s => s.saves >= 3 && s.saveSucc === s.saves && { value: `${s.saveSucc}/${s.saves}`, score: 0.5 } },
  { id: "blitz", rarity: "rare", test: (s, c) => c.party.rounds === 1 && c.party.won && top(c, "damage", s) && { value: 1, score: 0.7 } },
  // Epic (#47–51)
  { id: "deathsDoor", rarity: "epic", pf2: true, test: s => s.maxDying >= 2 && s.maxDying < 4 && { value: s.maxDying, score: 0.6 } },
  { id: "endurance", rarity: "epic", test: (s, c) => c.party.rounds >= 6 && !s.wentDown && { value: c.party.rounds, score: 0.3 } },
  { id: "bossFight", rarity: "epic", test: (s, c) => top(c, "bossDamage", s) && { value: s.bossDamage, score: 0.6 } },
  { id: "lockdown", rarity: "epic", pf2: true, test: s => takedowns(s) >= 3 && { value: takedowns(s), score: 0.5 } },
  { id: "naturalDisaster", rarity: "epic", test: s => s.nat20 >= 3 && { value: s.nat20, score: 0.6 } },
  // Legendary (#52–55)
  { id: "perfectAim", rarity: "legendary", pf2: true, test: s => s.attacks >= 4 && s.hits === s.attacks && s.crits >= 1 && { value: `${s.hits}/${s.attacks}`, score: 0.7 } },
  { id: "saviour", rarity: "legendary", test: s => s.revived.size >= 2 && { value: s.revived.size, score: 0.8 } },
  { id: "unstoppableForce", rarity: "legendary", test: (s, c) => c.party.enemyHP > 0 && s.damage >= 0.75 * c.party.enemyHP && { value: pct(s.damage / c.party.enemyHP), score: s.damage / c.party.enemyHP } },
  { id: "ironMind", rarity: "legendary", pf2: true, test: s => s.saveCrits >= 3 && { value: s.saveCrits, score: 0.8 } }
];

// Epic / Legendary from the first 30 (#21–30): kept in the review page's order below.
CARDS.splice(20, 0,
  // #21–25 Epic
  { id: "executioner", rarity: "epic", test: s => s.executions >= 1 && { value: s.maxExecution, score: 0.7 } },
  { id: "critStorm", rarity: "epic", pf2: true, test: s => s.crits >= 3 && { value: s.crits, score: 0.7 } },
  { id: "guardianAngel", rarity: "epic", test: s => s.revived.size >= 1 && { value: s.revived.size, score: 0.7 } },
  { id: "juggernaut", rarity: "epic", test: (s, c) => c.party.pcs.length >= 2 && c.party.totalTaken > 0 && !s.wentDown && s.taken >= c.party.totalTaken / 2 && { value: pct(s.taken / c.party.totalTaken), score: s.taken / c.party.totalTaken } },
  { id: "tripleThreat", rarity: "epic", test: s => s.finals >= 3 && { value: s.finals, score: 0.6 + s.finals / 20 } },
  // #26–30 Legendary
  { id: "oneHeroArmy", rarity: "legendary", test: (s, c) => c.party.pcs.length >= 3 && c.party.totalDamage > 0 && s.damage >= 0.5 * c.party.totalDamage && { value: pct(s.damage / c.party.totalDamage), score: s.damage / c.party.totalDamage } },
  { id: "flawless", rarity: "legendary", test: (s, c) => c.party.won && c.party.totalTaken === 0 && top(c, "damage", s) && { value: 0, score: 0.9 } },
  { id: "giantSlayer", rarity: "legendary", test: s => s.giantSlain >= 3 && { value: `+${s.giantSlain}`, score: 0.8 } },
  { id: "ghost", rarity: "legendary", pf2: true, test: s => s.attackedTimes >= 5 && s.hitOnMe === 0 && { value: `0/${s.attackedTimes}`, score: 0.8 } },
  { id: "lastStand", rarity: "legendary", test: (s, c, u) => c.party.won && c.party.pcs.length >= 2 && !s.wentDown && c.party.pcs.every(o => o === u || c.st[o].wentDown) && { value: c.party.pcs.length - 1, score: 0.9 } }
);

/** The card's number on the review page (#1–55). */
export const cardNumber = id => CARDS.findIndex(c => c.id === id) + 1;
export const cardById = id => CARDS.find(c => c.id === id) ?? null;

/**
 * One card per player character: best rarity first, then the strongest score; each card once per fight
 * (the two fall-back cards may repeat). → [{ uuid, card: id, value }]
 */
export function dealCards(data) {
  const ctx = computeStats(data);
  const pairs = [];
  for (const uuid of ctx.party.pcs) {
    const s = ctx.st[uuid];
    for (const card of CARDS) {
      let r = null;
      try { r = card.test(s, ctx, uuid); } catch { r = null; }
      if (r) pairs.push({ uuid, card, value: r.value, score: Number(r.score) || 0 });
    }
  }
  pairs.sort((a, b) => RARITIES.indexOf(b.card.rarity) - RARITIES.indexOf(a.card.rarity) || b.score - a.score);
  const dealt = new Map(), used = new Set();
  for (const pair of pairs) {
    if (dealt.has(pair.uuid) || (used.has(pair.card.id) && !pair.card.fallback)) continue;
    dealt.set(pair.uuid, { uuid: pair.uuid, card: pair.card.id, value: pair.value });
    used.add(pair.card.id);
  }
  return ctx.party.pcs.map(u => dealt.get(u)).filter(Boolean);
}
