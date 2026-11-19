import { localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { watchDOM } from "../../core/dom-watch.js";
import { appElement } from "../../core/dom.js";
import { addImmunity, DAY, immunitiesOf, timeLeft, usedBy } from "./immunity.js";
import { sysFlags } from "./sys.js";

/**
 * Rule 23 (docs/pf2e-rules.md, owner Q291): Battle Medicine on the Token HUD. PF2e / SF2e.
 * - Tracked in our own flags (immunity.js, kind "battleMedicine"; no PF2e effect is added), written by the active
 *   GM's client, by world time: 1 day (1 hour when the healer has Paragon Battle Medicine).
 * - What counts as a Battle Medicine use (PF2e has no roll option of its own for it; it is a Medicine check at
 *   Treat Wounds' DCs): a Medicine skill check message whose roll options, origin item or text name Battle
 *   Medicine, with a target (the roll's own target, else the roller's targets sent along by the roller's
 *   client); or PF2e's "Effect: Battle Medicine Immunity" appearing on an actor (as PF2e Workbench and
 *   players apply it), the healer taken from the effect's origin.
 * - A button in the Token HUD (under Riding's): shown when the token's creature has Battle Medicine, was
 *   treated with it, or is immune to a Combat Assessment (rule 21). Its tooltip: "Treated by: Kyra — again
 *   in 18 h", "Treated: Amiri (18 h)", "Combat Assessment: immune to Kyra (18 h)". Players see it for tokens
 *   they can open the HUD of; actors they can't see are left out.
 * (verify) in PF2e 8.7: the Medicine check's `flags.pf2e.context` (type "skill-check", `domains` with
 * "medicine", `target`), and the immunity effect's `system.context.origin.actor`.
 */

const KIND = "battleMedicine";
const CA_KIND = "combatAssessment";
const SLUG = "battle-medicine";
const EFFECT_SLUG = "effect-battle-medicine-immunity";
const t = (key, data) => localize(`LUCD20.BattleMedicine.${key}`, data);
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

const slugOf = item => item?.slug ?? item?.system?.slug ?? game.pf2e?.system?.sluggify?.(item?.name ?? "") ?? String(item?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const hasFeat = (actor, slug) => !!actor?.items?.some?.(i => (i.type === "feat" || i.type === "action") && slugOf(i) === slug);
const secondsFor = healer => (hasFeat(healer, "paragon-battle-medicine") ? 3600 : DAY);

/* -------------------------------------------- */
/*  Reading a use                               */
/* -------------------------------------------- */

/** Is this message a Battle Medicine check? Returns { healer, targetUuid } or null. */
export function readUse(message) {
  const flags = sysFlags(message) ?? {};
  const context = flags.context ?? {};
  if (context.type && context.type !== "skill-check") return null;
  const options = [...(context.options ?? []), ...(context.domains ?? []).map(d => `domain:${d}`)];
  const medicine = (context.domains ?? []).includes("medicine") || options.some(o => /(^|:)medicine$/.test(o) || o === "skill:medicine" || o.startsWith("check:statistic:medicine"));
  if (!medicine) return null;
  const originUuid = flags.origin?.uuid ?? "";
  const originItem = originUuid ? fromUuidSync?.(originUuid) : null;
  const named = [message.flavor, message.content].some(s => new RegExp(t("Name"), "i").test(String(s ?? "")) || /battle medicine/i.test(String(s ?? "")));
  const isBM = options.some(o => o.includes(SLUG)) || slugOf(originItem) === SLUG || named;
  if (!isBM) return null;
  const healer = message.actor ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
  const targetUuid = context.target?.actor ?? message.getFlag?.("lucd20-automations", "bmTarget") ?? null;
  if (!healer || !targetUuid) return null;
  return { healer, targetUuid };
}

async function record(healer, targetActor, name) {
  if (!healer || !targetActor) return;
  await addImmunity(targetActor, { kind: KIND, by: healer.uuid, name: name ?? healer.name, seconds: secondsFor(healer) });
}

async function onCreateMessage(message) {
  if (!game.user.isActiveGM) return;
  const use = readUse(message);
  if (!use) return;
  const target = await fromUuid(use.targetUuid);
  const actor = target?.actor ?? target;
  if (!actor) return;
  const token = message.token ?? use.healer.getActiveTokens?.(true, true)?.[0]?.document;
  await record(use.healer, actor, token?.name ?? use.healer.name);
}

/** PF2e's own immunity effect on an actor: record it too (the healer from the effect's origin). */
async function onCreateItem(item) {
  if (!game.user.isActiveGM || item.type !== "effect" || slugOf(item) !== EFFECT_SLUG) return;
  const actor = item.actor;
  const originUuid = item.system?.context?.origin?.actor ?? item.origin ?? null;
  const origin = originUuid ? await fromUuid(originUuid) : null;
  const healer = origin?.actor ?? origin;
  if (!actor || !healer?.uuid) return;
  if (immunitiesOf(actor, { kind: KIND, by: healer.uuid }).length) return;
  await record(healer, actor, healer.name);
}

/**
 * The roller's client: a Medicine check without a target in its context gets the roller's single target
 * in our flag, so the GM's client knows who was treated.
 */
function onPreCreateMessage(message, data, options, userId) {
  if (userId !== game.user.id) return;
  const context = (sysFlags(data) ?? sysFlags(message))?.context;
  if (context?.type !== "skill-check" || !(context.domains ?? []).includes("medicine") || context.target?.actor) return;
  const targets = [...(game.user.targets ?? [])];
  if (targets.length !== 1) return;
  const actorUuid = targets[0].actor?.uuid;
  if (actorUuid) message.updateSource({ "flags.lucd20-automations.bmTarget": actorUuid });
}

/* -------------------------------------------- */
/*  The HUD                                     */
/* -------------------------------------------- */

const visibleName = actor => (game.user.isGM || actor?.visible !== false ? actor?.name : null);

/** The tooltip lines for a token's actor (empty: nothing to show). */
export function hudLines(actor) {
  if (!actor) return [];
  const lines = [];
  for (const e of immunitiesOf(actor, { kind: KIND })) lines.push(t("TreatedBy", { name: e.name, time: timeLeft(e) }));
  for (const e of usedBy(actor.uuid, KIND)) {
    const name = visibleName(e.actor);
    if (name) lines.push(t("Treated", { name, time: timeLeft(e) }));
  }
  for (const e of immunitiesOf(actor, { kind: CA_KIND })) lines.push(t("AssessedBy", { name: e.name, time: timeLeft(e) }));
  return lines;
}

function hudState() {
  const hud = canvas?.hud?.token;
  const doc = hud?.document ?? hud?.object?.document ?? null;
  const root = appElement(hud) ?? document.getElementById("token-hud");
  return { doc, root };
}

function drawHudButton() {
  const { doc, root } = hudState();
  if (!root || !doc) return;
  const actor = doc.actor;
  const lines = hudLines(actor);
  const show = lines.length || hasFeat(actor, SLUG);
  const existing = root.querySelector(".lucd20-battle-medicine");
  const tooltip = lines.length ? lines.map(esc).join("<br>") : esc(t("None"));
  if (existing?.dataset.tokenId === doc.id && existing.dataset.tooltipHtml === tooltip && show) return;
  existing?.remove();
  if (!show) return;
  const column = root.querySelector(".col.left") ?? root.querySelector(".col.right") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon lucd20-battle-medicine";
  button.classList.toggle("active", lines.length > 0);
  button.dataset.tokenId = doc.id;
  button.dataset.tooltipHtml = tooltip;
  button.dataset.tooltipDirection = "LEFT";
  button.setAttribute("aria-label", t("Title"));
  button.innerHTML = '<i class="fa-solid fa-kit-medical"></i>';
  button.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); });
  // After Riding's horse when it is there (owner: "under rideable").
  const horse = column.querySelector(".lucd20-rideable");
  if (horse) horse.after(button);
  else column.append(button);
}

defineFeature({
  id: "pf2eBattleMedicine",
  category: "pf2e",
  systems: ["pf2e"],
  defaultEnabled: true,
  enable(feature) {
    feature.on("createChatMessage", onCreateMessage);
    feature.on("preCreateChatMessage", onPreCreateMessage);
    feature.on("createItem", onCreateItem);
    feature.on("renderTokenHUD", () => drawHudButton());
    feature.onCleanup(watchDOM("battle-medicine-hud", drawHudButton));
    feature.onCleanup(() => document.querySelectorAll(".lucd20-battle-medicine").forEach(el => el.remove()));
  }
});
