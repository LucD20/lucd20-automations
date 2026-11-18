import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { initializeTables, TABLES } from "./creature-scale-tables.js";

/**
 * Creature Scale (replaces pF2e See Simple Scale Statistics; owner, Q274: colours first). PF2e, GM only.
 * - On an NPC's sheet, each number GM Core's "Building Creatures" rates is coloured by where it sits for the
 *   creature's level: Terrible (red), Low (orange), Moderate (yellow), High (green), Extreme (blue). AC, HP,
 *   Perception, saves, attribute modifiers, skills, weaknesses and resistances, each Strike's attack bonus and
 *   average damage, each spellcasting entry's attack and DC.
 * - Hovering one shows the table rows for the level below, the level and the level above, with its place marked.
 * - A "Scale" switch in the sheet's header (by Elite / Weak) turns it on and off for this GM (all sheets).
 * - As the original (MIT): its tables and its "Terrible" row; ties go to the middle; broad resistances and
 *   weaknesses (physical, all damage) count double; persistent damage ×1.5, splash ×2; Elite / Weak sheets and
 *   the simple NPC sheet are left alone; levels past the tables count as −1 or 24.
 * - The ⚠️ creature-building warnings are not included (Q274: later, if wanted).
 */

const SCALES = ["Terrible", "Low", "Moderate", "High", "Extreme"];
const TABLE = { ac: "AC", hp: "HP", perception: "PERCEPTION", save: "SAVES", ability: "ABILITY_MODIFIER", skill: "SKILLS",
  weakness: "WEAKNESSES", resistance: "RESISTANCES", strikeAttack: "STRIKE_ATTACK", strikeDamage: "STRIKE_DAMAGE",
  spellAttack: "SPELL_ATTACK", spellDc: "SPELL_DC" };
const SHOWN = { hp: "HP_RANGE", strikeDamage: "STRIKE_DAMAGE_RANGE" };
const BROAD = new Set(["physical", "all-damage"]);
const t = (key, data) => localize(`LUCD20.CreatureScale.${key}`, data);
let tablesReady = false;
let feature = null;

/* -------------------------------------------- */
/*  The scale                                   */
/* -------------------------------------------- */

const clampLevel = (level) => Math.max(-1, Math.min(24, Math.round(Number(level) || 0)));
const middleFirst = (a, b) => (a === "Moderate" ? true : b === "Moderate" ? false : a === "Low" || a === "High");

function tables() {
  if (!tablesReady) { initializeTables(); tablesReady = true; }
  return TABLES;
}

/** Where a value sits for a level: { key, delta, reference }, or null when the table has no row. */
export function scaleOf(value, level, type) {
  const row = tables()[TABLE[type]]?.[clampLevel(level)];
  if (!row || !Number.isFinite(value)) return null;
  let best = null;
  for (const [key, ref] of Object.entries(row)) {
    if (ref === null || ref === undefined) continue;
    const delta = value - ref, diff = Math.abs(delta);
    if (!best || diff < best.diff || (diff === best.diff && middleFirst(key, best.key))) best = { key, diff, delta, reference: ref };
  }
  return best && { key: best.key, delta: best.delta, reference: best.reference };
}

/* -------------------------------------------- */
/*  Average damage                              */
/* -------------------------------------------- */

/** A small arithmetic evaluator (+ − × ÷, parentheses); NaN when the text is anything else. */
function evaluate(text) {
  const tokens = text.replace(/\s+/g, "").match(/\d+(?:\.\d+)?|[-+*/()]/g);
  if (!tokens || tokens.join("") !== text.replace(/\s+/g, "")) return Number.NaN;
  let i = 0;
  const peek = () => tokens[i];
  const factor = () => {
    const tk = tokens[i++];
    if (tk === "(") { const v = expr(); if (tokens[i++] !== ")") throw new Error("paren"); return v; }
    if (tk === "-") return -factor();
    if (tk === "+") return factor();
    const n = Number(tk);
    if (!Number.isFinite(n)) throw new Error("number");
    return n;
  };
  const term = () => { let v = factor(); while (peek() === "*" || peek() === "/") v = tokens[i++] === "*" ? v * factor() : v / factor(); return v; };
  const expr = () => { let v = term(); while (peek() === "+" || peek() === "-") v = tokens[i++] === "+" ? v + term() : v - term(); return v; };
  try {
    const v = expr();
    return i === tokens.length ? v : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** The average of a damage formula ("2d6+4"); dice count their average. */
export function averageOf(formula) {
  const text = String(formula ?? "").replace(/(\d*)d(\d+)/gi, (_, n, d) => `(${n || 1}*${(Number(d) + 1) / 2})`);
  return evaluate(text);
}

/** A Strike's average damage over its damage rolls (persistent ×1.5, splash ×2), or NaN. */
export function strikeAverage(damageRolls) {
  let total = 0;
  for (const roll of Object.values(damageRolls ?? {})) {
    const avg = averageOf(roll?.damage);
    if (!Number.isFinite(avg)) return Number.NaN;
    total += avg * (roll.category === "persistent" ? 1.5 : roll.category === "splash" ? 2 : 1);
  }
  return total;
}

/* -------------------------------------------- */
/*  The sheet                                   */
/* -------------------------------------------- */

const MAIN = [
  { id: "ac", type: "ac", path: "_source.system.attributes.ac.value", selector: 'input[data-property="system.attributes.ac.value"]' },
  { id: "hp", type: "hp", path: "_source.system.attributes.hp.max", selector: 'input[data-property="system.attributes.hp.max"]' },
  { id: "perception", type: "perception", path: "_source.system.perception.mod", selector: 'input[data-property="system.perception.mod"]', plus: true },
  ...["fortitude", "reflex", "will"].map(s => ({ id: s, type: "save", path: `_source.system.saves.${s}.value`, selector: `input[data-property="system.saves.${s}.value"]`, plus: true })),
  ...["str", "dex", "con", "int", "wis", "cha"].map(a => ({ id: a, type: "ability", path: `_source.system.abilities.${a}.mod`, selector: `input[data-property="system.abilities.${a}.mod"]`, plus: true }))
];

const SHEET_CLASSES = SCALES.map(s => `lucd20-cs-${s}`).concat(["lucd20-cs", "lucd20-cs-primary", "lucd20-cs-secondary"]);

/** The tooltip: "+14 Perception is High (1 above 13)" and three table rows. */
function tooltipHtml(value, name, level, type, found, plus) {
  const esc = (s) => Handlebars.escapeExpression(String(s));
  const shown = tables()[SHOWN[type] ?? TABLE[type]];
  const lv = clampLevel(level);
  const rows = [lv - 1, lv, lv + 1].filter(l => shown?.[l]);
  const keys = Object.keys(shown?.[lv] ?? {}).sort((a, b) => SCALES.indexOf(b) - SCALES.indexOf(a));
  const word = t(`Scale.${found.key}`);
  const shownValue = plus && value > 0 ? `+${Math.round(value * 10) / 10}` : `${Math.round(value * 10) / 10}`;
  const head = found.delta === 0 ? t("Exactly", { value: shownValue, name, scale: word })
    : t(found.delta > 0 ? "Above" : "Below", { value: shownValue, name, scale: word, delta: Math.round(Math.abs(found.delta) * 10) / 10, reference: found.reference });
  let html = `<p>${esc(head)}</p><table class="lucd20-cs-table"><tr><th></th>${keys.map(k => `<th class="${k === found.key ? "lucd20-cs-hl" : ""}">${esc(t(`Scale.${k}`))}</th>`).join("")}</tr>`;
  for (const l of rows) {
    html += `<tr class="${l === lv ? "" : "lucd20-cs-other"}"><td class="${l === lv ? "lucd20-cs-hl" : ""}">${esc(t("Level", { level: l }))}</td>`;
    html += keys.map(k => `<td class="${l === lv && k === found.key ? "lucd20-cs-hl" : ""}">${esc(shown[l][k] ?? "—")}</td>`).join("");
    html += "</tr>";
  }
  return `${html}</table>`;
}

/** Colour one element and give it the tooltip. */
function mark(el, { value, type, name, level, kind = "primary", plus = false }) {
  if (!el || !Number.isFinite(value)) return false;
  const found = scaleOf(value, level, type);
  if (!found) return false;
  el.classList.add("lucd20-cs", `lucd20-cs-${found.key}`, `lucd20-cs-${kind}`);
  el.dataset.lucd20Scale = found.key;
  const html = tooltipHtml(value, name, level, type, found, plus);
  // The sheet sets its own tooltips while it renders: ours go on just after (as the original does).
  setTimeout(() => { el.dataset.tooltipHtml = html; el.dataset.tooltipClass = "lucd20-cs-tooltip"; }, 100);
  return true;
}

function clearMarks(root) {
  for (const el of root.querySelectorAll(".lucd20-cs")) {
    el.classList.remove(...SHEET_CLASSES);
    delete el.dataset.lucd20Scale;
    delete el.dataset.tooltipHtml;
    delete el.dataset.tooltipClass;
  }
}

const skillValue = (actor, slug) => foundry.utils.getProperty(actor, `skills.${slug}.base`) ?? foundry.utils.getProperty(actor, `skills.${slug}.modifiers.0.modifier`);

/** Mark every rated number on an NPC sheet. Returns how many were marked. */
export function markSheet(actor, root) {
  const level = actor.level ?? actor.system?.details?.level?.value ?? 0;
  const get = (path) => Number(foundry.utils.getProperty(actor, path));
  let count = 0;
  for (const s of MAIN) {
    if (mark(root.querySelector(s.selector), { value: get(s.path), type: s.type, name: t(`Stat.${s.id}`), level, plus: s.plus })) count++;
  }
  for (const entry of root.querySelectorAll("div.skills.section-container div.list div.skill-entry[data-statistic]")) {
    const slug = entry.dataset.statistic;
    if (mark(entry.querySelector("a"), { value: Number(skillValue(actor, slug)), type: "skill", name: t("Stat.skill"), level, plus: true })) count++;
  }
  for (const [attr, type] of [["weakness", "weakness"], ["resistance", "resistance"]]) {
    const list = actor.system?.attributes?.[`${attr === "weakness" ? "weaknesses" : "resistances"}`] ?? [];
    for (const li of root.querySelectorAll(`li[data-${attr}]`)) {
      const data = list.find(x => x.type === li.dataset[attr]);
      if (!data) continue;
      const value = Number(data.value) * (BROAD.has(data.type) ? 2 : 1);
      if (mark(li, { value, type, name: t(`Stat.${type}`), level })) count++;
    }
  }
  for (const li of root.querySelectorAll("ol.strikes-list li.item.action[data-action-index]")) {
    const i = Number(li.dataset.actionIndex);
    const item = actor.system?.actions?.[i]?.item;
    if (!item) continue;
    const attack = li.querySelector('button[data-action="strike-attack"][data-variant-index="0"]');
    if (mark(attack, { value: Number(item.system?.bonus?.value), type: "strikeAttack", name: t("Stat.strikeAttack"), level, kind: "secondary", plus: true })) count++;
    const avg = strikeAverage(item.system?.damageRolls);
    if (avg > 0 && mark(li.querySelector('button[data-action="strike-damage"]'), { value: avg, type: "strikeDamage", name: t("Stat.strikeDamage"), level, kind: "secondary" })) count++;
  }
  for (const li of root.querySelectorAll("div.tab.spells li.spellcasting-entry[data-item-id]")) {
    const entry = actor.spellcasting?.get?.(li.dataset.itemId);
    const dc = entry?.system?.spelldc;
    if (!dc) continue; // rituals
    if (mark(li.querySelector("div.spellAttack label"), { value: Number(dc.value), type: "spellAttack", name: t("Stat.spellAttack"), level, kind: "secondary", plus: true })) count++;
    if (mark(li.querySelector("div.spellDC label"), { value: Number(dc.dc), type: "spellDc", name: t("Stat.spellDc"), level, kind: "secondary" })) count++;
  }
  return count;
}

/* -------------------------------------------- */
/*  The header switch                           */
/* -------------------------------------------- */

function addSwitch(root, on, adjusted) {
  root.querySelector(".lucd20-cs-switch")?.remove();
  const a = document.createElement("a");
  a.className = `lucd20-cs-switch${on ? " active" : ""}`;
  a.dataset.tooltip = adjusted ? t("Adjusted") : t(on ? "SwitchOff" : "SwitchOn");
  a.innerHTML = `<span>${Handlebars.escapeExpression(t("Switch"))}</span><span class="lucd20-cs-legend">${SCALES.map(s => `<i class="lucd20-cs-swatch-${s}"></i>`).join("")}</span>`;
  a.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    feature.set("show", !feature.get("show"));
  });
  const elite = root.querySelector("div.adjustments > a.elite, div.adjustments > .elite");
  const size = root.querySelector("select.size-select");
  const tags = root.querySelector("header > div.rarity-size > div.tags");
  if (elite) elite.before(a);
  else if (size) size.after(a);
  else if (tags) tags.after(a);
  else return false;
  return true;
}

function onRender(sheet, html) {
  if (!feature?.active || !game.user.isGM) return;
  const actor = sheet.actor ?? sheet.object ?? sheet.document;
  if (actor?.type !== "npc") return;
  if ((sheet.options?.classes ?? []).includes("simple")) return; // the simple NPC sheet: not a built creature
  const root = html?.[0] ?? html?.element ?? html ?? sheet.element?.[0] ?? sheet.element;
  if (!(root instanceof HTMLElement)) return;
  const adjusted = ["elite", "weak"].includes(actor.attributes?.adjustment ?? actor.system?.attributes?.adjustment);
  const on = !!feature.get("show");
  addSwitch(root, on, adjusted);
  clearMarks(root);
  if (!on || adjusted) return;
  try {
    markSheet(actor, root);
  } catch (err) {
    error("Creature Scale: could not mark the sheet.", err);
  }
}

/** Re-draw the open NPC sheets (the switch changed). */
function rerenderSheets() {
  for (const app of Object.values(ui.windows ?? {})) {
    if ((app.actor ?? app.object)?.type === "npc") app.render(false);
  }
  for (const app of foundry.applications?.instances?.values?.() ?? []) {
    if (app.document?.type === "npc" && app.document?.documentName === "Actor") app.render(false);
  }
}

defineFeature({
  id: "pf2eCreatureScale",
  category: "pf2e",
  systems: ["pf2e"],
  scope: "world",
  gmOnly: true,
  defaultEnabled: true,
  settings: {
    show: { kind: "boolean", default: true, scope: "client" }
  },

  enable(f) {
    feature = f;
    f.on("renderActorSheetPF2e", onRender);
    rerenderSheets();
    f.onCleanup(() => setTimeout(rerenderSheets, 0));
  },

  onSettingChange() {
    rerenderSheets();
  }
});

export const _test = { scaleOf, averageOf, strikeAverage, markSheet, onRender };
