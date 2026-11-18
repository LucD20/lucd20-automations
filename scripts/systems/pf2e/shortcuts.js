import { registerShortcuts } from "../../features/shortcuts.js";

/**
 * PF2e for Shortcuts (replaces F is for Flatfooted; Q270: all of it). Off-Guard on O for the hovered token;
 * unbound: each condition (toggle, + / − for valued ones), every system action and its variants, the Cover
 * effect, the compendium browser and its search, and cycling a creature's alliance. Conditions follow the
 * hovered → selected → your character rule; actions are taken by your one selected token, else your character.
 * Each one names the F is for Flatfooted action it replaces, so its keys are copied over.
 */

const FF = "pf2e-f-is-for-flatfooted";
const ff = (id) => ({ module: FF, id });
const ATTITUDES = new Set(["helpful", "friendly", "indifferent", "unfriendly", "hostile"]);
const VALUED = new Set(["clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened", "slowed", "stunned", "stupefied", "wounded"]);
const COVER_UUID = "Compendium.pf2e.other-effects.Item.I9lfZUiCwMiGogVi";

const sluggify = (s) => game.pf2e?.system?.sluggify?.(s) ?? String(s).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const spaced = (key) => key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());

/** Whether a condition has a value (Frightened 2), from the system when it says so. */
function isValued(slug) {
  const known = game.pf2e?.ConditionManager?.getCondition?.(slug)?.system?.value?.isValued;
  return typeof known === "boolean" ? known : VALUED.has(slug);
}

/** Toggle the Cover effect (the Take Cover / situational cover effect) on each actor. */
async function toggleCover(actors) {
  const source = (await fromUuid(COVER_UUID))?.toObject?.();
  if (!source) return;
  for (const actor of actors) {
    const existing = actor.itemTypes?.effect?.find(e => (e.sourceId ?? e._stats?.compendiumSource ?? e.flags?.core?.sourceId) === COVER_UUID);
    if (existing) await existing.delete();
    else await actor.createEmbeddedDocuments("Item", [{ ...source, _stats: { ...(source._stats ?? {}), compendiumSource: COVER_UUID } }]);
  }
}

async function cycleAlliance(actor, t) {
  if (!actor?.isOfType?.("character", "npc")) return ui.notifications.warn(t("PF2e.NotPcNpc"));
  const next = new Map([["party", "opposition"], ["opposition", null], [null, "party"]]).get(actor.alliance ?? null);
  await actor.update({ "system.details.alliance": next });
  const word = next === "party" ? t("PF2e.AllianceParty") : next === "opposition" ? t("PF2e.AllianceOpposition") : t("PF2e.AllianceNeutral");
  ui.notifications.info(t("PF2e.AllianceNow", { name: actor.name, alliance: word }));
}

function toggleBrowser() {
  const browser = game.pf2e?.compendiumBrowser;
  if (!browser) return;
  return browser.rendered ? browser.close() : browser.render(true);
}

async function focusCompendiumSearch() {
  ui.sidebar?.expand?.();
  if (ui.sidebar?.changeTab) ui.sidebar.changeTab("compendium", "primary");
  else ui.sidebar?.activateTab?.("compendium");
  await new Promise(r => setTimeout(r, 50));
  const input = document.querySelector("#compendium input[type='search'], #compendium input[name='search']");
  if (!input) return;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

/** Every system action: the Collection's Actions (with variants) and the legacy macros it still carries. */
function systemActions() {
  const actions = game.pf2e?.actions;
  if (!actions) return [];
  const bySlug = new Map();
  for (const key of Object.keys(actions)) if (typeof actions[key] === "function") bySlug.set(sluggify(key), { key });
  if (typeof actions.entries === "function") {
    for (const [slug, action] of actions.entries()) if (action) bySlug.set(slug, { ...(bySlug.get(slug) ?? {}), action });
  }
  const out = [];
  for (const [slug, { key, action }] of bySlug) {
    const name = action?.name ? game.i18n.localize(action.name) : spaced(key ?? slug);
    const v = action?.variants;
    const variants = v?.size ? (typeof v.values === "function" ? [...v.values()] : [...v]) : [];
    if (!variants.length) {
      out.push({ id: slug, name, from: key ? ff(key) : null, use: (actor) => (action?.use ? action.use({ actors: [actor] }) : actions[key]({ actors: [actor] })) });
      continue;
    }
    for (const variant of variants) {
      const vslug = variant.slug ?? sluggify(variant.name ?? "");
      out.push({
        id: `${slug}-${vslug}`,
        name: `${name} (${game.i18n.localize(variant.name ?? vslug)})`,
        from: key ? ff(`${key}-${vslug}`) : null,
        use: (actor) => (variant.use ? variant.use({ actors: [actor] }) : actions[key]?.({ actors: [actor], variant: vslug }))
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

registerShortcuts({
  system: "pf2e",
  statuses: false,
  register(add, { targetActors, actingActor, t }) {
    const onActors = (fn) => async () => { for (const actor of targetActors()) await fn(actor); };

    add("pf2e-offGuard", {
      name: t("PF2e.OffGuard"), hint: t("PF2e.OffGuardHint"), keys: [{ key: "KeyO", modifiers: [] }],
      run: onActors(a => a.toggleCondition?.("off-guard")), from: ff("flatfooted")
    });

    const types = CONFIG.PF2E?.conditionTypes ?? {};
    const conditions = Object.keys(types).filter(s => !ATTITUDES.has(s) && s !== "off-guard")
      .map(slug => ({ slug, name: game.i18n.localize(types[slug]) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const { slug, name } of conditions) {
      add(`pf2e-c-${slug}`, { name: t("PF2e.Toggle", { name }), hint: t("StatusHint", { name }), run: onActors(a => a.toggleCondition?.(slug)), from: ff(slug) });
      if (!isValued(slug)) continue;
      add(`pf2e-c-${slug}-up`, { name: t("PF2e.Increase", { name }), hint: t("StatusHint", { name }), run: onActors(a => a.increaseCondition?.(slug)), from: ff(`${slug}-increase`) });
      add(`pf2e-c-${slug}-down`, { name: t("PF2e.Decrease", { name }), hint: t("StatusHint", { name }), run: onActors(a => a.decreaseCondition?.(slug)), from: ff(`${slug}-decrease`) });
    }

    add("pf2e-cover", { name: t("PF2e.Cover"), hint: t("PF2e.CoverHint"), run: () => toggleCover(targetActors()), from: ff("takeCover") });
    add("pf2e-browser", { name: t("PF2e.Browser"), run: toggleBrowser, from: ff("compendiumBrowser") });
    add("pf2e-search", { name: t("PF2e.Search"), run: focusCompendiumSearch, from: ff("goToSearch") });
    add("pf2e-alliance", { name: t("PF2e.Alliance"), hint: t("PF2e.AllianceHint"), run: () => cycleAlliance(actingActor(), t), from: ff("cycleAlliance") });

    for (const a of systemActions()) {
      add(`pf2e-a-${a.id}`, {
        name: t("PF2e.Action", { name: a.name }), hint: t("ActionHint"), from: a.from,
        run: () => { const actor = actingActor(); return actor ? a.use(actor) : undefined; }
      });
    }
  }
});
