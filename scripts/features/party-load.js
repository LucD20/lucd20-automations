import { localize, systemMatches } from "../core/constants.js";
import { defineFeature, getFeature } from "../core/registry.js";

/**
 * Party Load (owner, PLAN §27; v0.83.0): the party's encumbrance as one bar, like PF2e's own bulk bar.
 * - Load = what every party member carries + what is in the Party Stash; the bar has two ticks: the members'
 *   encumbered limits added up and their maximums added up. Extradimensional containers in the stash (Bag of
 *   Holding, Spacious Pouch) add their capacity to both (owner Q323: only the stash's).
 * - Hover: each member (load / encumbered / max), the stash, each bag.
 * - Colour: fine, encumbered (past the first tick: orange), over the maximum (red).
 * - Per system (adapters): PF2e / SF2e in the Party actor's sheet (Stash tab, under "Total bulk"); D&D 4e in
 *   the Party Stash window (pounds).
 */

const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.PartyLoad.${key}`, data);

const adapters = [];

/**
 * { system, compute() → { load, encumbered, max, unit: "bulk" | "lb", rows: [{ name, load, encumbered, max }],
 *   stash: { load }, bags: [{ name, capacity }] } | null, format(n) → string, mount(feature) → cleanup }
 */
export function registerPartyLoadAdapter(adapter) {
  adapters.push(adapter);
}

const active = () => adapters.find(a => systemMatches(a.system)) ?? null;

/** Is the feature on (system code asks before drawing)? */
export const partyLoadOn = () => !!getFeature("partyLoad")?.active;

/** The bar's HTML for a computed load. */
export function loadBarHTML(data, format = n => String(n)) {
  if (!data) return "";
  const { load, encumbered, max } = data;
  const scale = Math.max(max * 1.12, load, 1);
  const pct = n => Math.max(0, Math.min(100, (n / scale) * 100));
  const state = load > max ? "over" : load > encumbered ? "encumbered" : "ok";
  const lines = [
    ...data.rows.map(r => `${esc(r.name)}: ${esc(format(r.load))} / ${esc(format(r.encumbered))} · ${esc(t("Max"))} ${esc(format(r.max))}`),
    `${esc(t("Stash"))}: ${esc(format(data.stash?.load ?? 0))}`,
    ...(data.bags ?? []).map(b => `${esc(b.name)}: +${esc(format(b.capacity))}`)
  ];
  return `<div class="lucd20-party-load is-${state}" data-tooltip-html="${esc(lines.join("<br>"))}" data-tooltip-direction="UP">
    <div class="lpl-track">
      <span class="lpl-fill" style="width:${pct(load).toFixed(1)}%"></span>
      <span class="lpl-tick" style="left:${pct(encumbered).toFixed(1)}%" aria-hidden="true"></span>
      <span class="lpl-tick lpl-max" style="left:${pct(max).toFixed(1)}%" aria-hidden="true"></span>
    </div>
    <div class="lpl-label"><span><b>${esc(t("Title"))}</b> ${esc(format(load))} / ${esc(t("Encumbered"))} ${esc(format(encumbered))}</span> <span>${esc(t("Max"))} ${esc(format(max))}</span></div>
  </div>`;
}

/** The active system's bar (for system code that draws it itself, e.g. the 4e Party Stash). */
export function partyLoadHTML() {
  const adapter = active();
  if (!adapter || !partyLoadOn()) return "";
  let data = null;
  try { data = adapter.compute(); } catch (err) { console.error("lucd20-automations | Party Load", err); }
  return loadBarHTML(data, adapter.format);
}

defineFeature({
  id: "partyLoad",
  category: "sheets",
  systems: ["pf2e", "dnd4e"],
  defaultEnabled: true,
  enable(feature) {
    const adapter = active();
    const cleanup = adapter?.mount?.(feature);
    if (typeof cleanup === "function") feature.onCleanup(cleanup);
  }
});
