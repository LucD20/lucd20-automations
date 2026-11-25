import { loadBarHTML, registerPartyLoadAdapter } from "../../features/party-load.js";

/**
 * PF2e / SF2e for Party Load (PLAN §27): the active party's members and its stash (the Party actor's inventory).
 * - Members: PF2e's own `inventory.bulk` (value, encumberedAfter, max); creatures without a bulk limit
 *   (encumberedAfter = Infinity: familiars, eidolons…) are left out.
 * - Stash: PF2e's stash bulk, plus what extradimensional containers in it ignore (their contents count in the
 *   party's load), and each such container's ignored bulk is added to both limits.
 * - Drawn under the party sheet's "Total bulk" line (Stash tab).
 * (verify) in PF2e 8.7: `renderPartySheetPF2e`, `.total-bulk`, `game.actors.party`, `Bulk#plus` /
 * `toLightUnits`, the container's `system.bulk.ignored`.
 */

const bulkNumber = b => (typeof b === "number" ? b : b?.toLightUnits ? b.toLightUnits() / 10 : Number(b?.normal ?? 0) + Number(b?.light ?? 0) / 10);

/** "3", "3, 4L", "4L" from a number of Bulk (1 light = 0.1). */
export function formatBulk(n) {
  const lightUnits = Math.round(n * 10);
  const normal = Math.floor(lightUnits / 10), light = lightUnits % 10;
  if (!light) return String(normal);
  return normal ? `${normal}, ${light}L` : `${light}L`;
}

export function compute(party = game.actors?.party) {
  if (!party) return null;
  const members = (party.members ?? []).filter(a => a?.inventory?.bulk && Number.isFinite(a.inventory.bulk.encumberedAfter));
  const rows = members.map(a => ({
    name: a.name,
    load: bulkNumber(a.inventory.bulk.value),
    encumbered: a.inventory.bulk.encumberedAfter,
    max: a.inventory.bulk.max
  }));
  // The stash; extradimensional containers in it (top level) add their capacity.
  const items = party.inventory?.contents ?? party.items?.contents ?? [];
  const bags = items.filter(i => !i.system?.containerId && Number(i.system?.bulk?.ignored) > 0);
  let stashLoad = bulkNumber(party.inventory?.bulk?.value);
  for (const bag of bags) stashLoad += Math.min(bulkNumber(bag.capacity?.value ?? 0), Number(bag.system.bulk.ignored));
  const bagRows = bags.map(b => ({ name: b.name, capacity: Number(b.system.bulk.ignored) }));
  const extra = bagRows.reduce((s, b) => s + b.capacity, 0);
  const sum = key => rows.reduce((s, r) => s + r[key], 0);
  return {
    load: sum("load") + stashLoad,
    encumbered: sum("encumbered") + extra,
    max: sum("max") + extra,
    unit: "bulk",
    rows,
    stash: { load: stashLoad },
    bags: bagRows
  };
}

function onRenderParty(sheet, html) {
  const party = sheet.actor ?? sheet.document;
  if (party?.type !== "party") return;
  const root = html?.[0] ?? html?.element ?? html ?? sheet.element?.[0] ?? sheet.element;
  if (!(root instanceof HTMLElement)) return;
  root.querySelectorAll(".lucd20-party-load").forEach(el => el.remove());
  const anchor = root.querySelector(".tab.inventory .total-bulk") ?? root.querySelector(".total-bulk");
  if (!anchor) return;
  anchor.insertAdjacentHTML("afterend", loadBarHTML(compute(party), formatBulk));
}

registerPartyLoadAdapter({
  system: "pf2e",
  compute: () => compute(),
  format: formatBulk,
  mount(feature) {
    feature.on("renderPartySheetPF2e", onRenderParty);
    feature.on("renderActorSheetPF2e", onRenderParty);
    // A member's inventory changing re-renders their sheet, not the party's: refresh an open party sheet.
    const refresh = () => {
      const party = game.actors?.party;
      for (const app of Object.values(party?.apps ?? {})) if (app.rendered) app.render(false);
    };
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) feature.on(hook, item => { if (item.actor && (item.actor.type === "party" || game.actors?.party?.members?.includes(item.actor))) soon(); });
    return () => { clearTimeout(timer); document.querySelectorAll(".lucd20-party-load").forEach(el => el.remove()); };
  }
});
