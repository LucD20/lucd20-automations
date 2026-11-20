import { localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { watchDOM } from "../../core/dom-watch.js";
import { appElement } from "../../core/dom.js";
import { addImmunity, DAY, immunitiesOf, removeImmunity, timeLeft, usedBy } from "./immunity.js";
import { sysFlags } from "./sys.js";

/**
 * Rule 23 (docs/pf2e-rules.md, owner Q291, v0.81.1 additions): Battle Medicine on the Token HUD. PF2e / SF2e.
 * - Tracked in our own flags (immunity.js, kind "battleMedicine"; no PF2e effect is added), written by the active
 *   GM's client, by world time.
 * - A use is read from (owner: "most people use the battle medicine / treat wounds macro, plus using the BM
 *   actions"):
 *   1. the "Treat Wounds and Battle Medicine" macro (PF2e Workbench's Basic Action Macros, by Asymonous): its
 *      healing / "No healing done" message has `flags.treat_wounds_battle_medicine` { id: target token id,
 *      healerId: actor id, bmBatonUsed } and "Battle Medicine" in its flavor (else it was Treat Wounds);
 *   2. the feat's own action posted to chat (origin item slug "battle-medicine") with one target: the roller's
 *      client adds the target to our flag (`bmTarget`) when the message is created;
 *   3. a Medicine check whose roll options / origin / text name Battle Medicine, with a target;
 *   4. PF2e's "Effect: Battle Medicine Immunity" (the Workbench "BM Immunity CD" macro, players): the healer
 *      from the effect's origin, else "Battle Medicine by <name>".
 *   The same use reported twice (a check and its healing message) within 30 seconds counts once.
 * - Duration (as the macro): 1 day; 1 hour with a Battle Medic's Baton, or a healer with Paragon Battle
 *   Medicine or Forensic Medicine Methodology, or a patient with Godless Healing or Robust Health.
 * - Medic Dedication: once per day (once per hour if master in Medicine) the medic may treat a creature
 *   already immune to them; such a use spends it (kind "medicDedication" on the medic; the Workbench's own
 *   "Medic dedication used" effect counts too). The HUD shows whether it is ready. (Medic's extra healing is
 *   added by the macro and by PF2e's Treat Wounds already.)
 * - A button in the Token HUD (under Riding's) when there is something to show or the creature has Battle
 *   Medicine; its tooltip lists who treated it, whom it treated, Medic Dedication and Combat Assessment
 *   immunity. The GM clicks it to edit (remove entries, add one, reset Medic Dedication).
 * (verify) in PF2e 8.7 / SF2e 1.7: the feat card's `flags.pf2e.origin`; the macro's flag on Foundry V14.
 */

const KIND = "battleMedicine";
const MEDIC = "medicDedication";
const CA_KIND = "combatAssessment";
const SLUG = "battle-medicine";
const EFFECT_SLUG = "effect-battle-medicine-immunity";
const MACRO_FLAG = "treat_wounds_battle_medicine";
const HOUR = 3600;
const SAME_USE_MS = 30000;
const t = (key, data) => localize(`LUCD20.BattleMedicine.${key}`, data);
const esc = value => Handlebars.escapeExpression(String(value ?? ""));

const slugOf = item => item?.slug ?? item?.system?.slug ?? game.pf2e?.system?.sluggify?.(item?.name ?? "") ?? String(item?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const hasFeat = (actor, slug) => !!actor?.items?.some?.(i => (i.type === "feat" || i.type === "action") && slugOf(i) === slug);
const isBattleMedicineText = s => /battle medicine/i.test(String(s ?? "")) || new RegExp(t("Name"), "i").test(String(s ?? ""));

/** How long the patient is immune (the macro's rules). */
export function secondsFor(healer, patient, { baton = false } = {}) {
  const short = baton || hasFeat(healer, "paragon-battle-medicine") || hasFeat(healer, "forensic-medicine-methodology")
    || hasFeat(patient, "godless-healing") || hasFeat(patient, "robust-health");
  return short ? HOUR : DAY;
}

/** Medic Dedication's reuse: 1 hour when master (rank 3) or better in Medicine, else 1 day. */
const medicSeconds = healer => ((healer?.skills?.medicine?.rank ?? healer?.system?.skills?.medicine?.rank ?? 0) >= 3 ? HOUR : DAY);
export const medicReady = healer => hasFeat(healer, "medic-dedication") && !immunitiesOf(healer, { kind: MEDIC }).length;

/* -------------------------------------------- */
/*  Reading a use                               */
/* -------------------------------------------- */

function tokenActor(tokenId, sceneId) {
  const scene = game.scenes?.get?.(sceneId) ?? canvas?.scene;
  return scene?.tokens?.get?.(tokenId)?.actor ?? canvas?.tokens?.get?.(tokenId)?.actor ?? null;
}

const actorFrom = async uuid => {
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.actor ?? doc ?? null;
};

/**
 * Is this message a Battle Medicine use? → { healer, patient | patientUuid, baton } or null.
 * Synchronous where it can be (tests); the patient by uuid is resolved by the caller.
 */
export function readUse(message) {
  // 1. The Treat Wounds and Battle Medicine macro.
  const macro = message.flags?.[MACRO_FLAG];
  if (macro) {
    if (!isBattleMedicineText(message.flavor)) return null; // Treat Wounds
    const healer = game.actors?.get(macro.healerId) ?? message.actor ?? null;
    const patient = tokenActor(macro.id, message.speaker?.scene);
    return healer && patient ? { healer, patient, baton: !!macro.bmBatonUsed } : null;
  }
  const flags = sysFlags(message) ?? {};
  const context = flags.context ?? {};
  const ours = message.flags?.["lucd20-automations"]?.bmTarget ?? null;
  const healer = message.actor ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
  const originItem = flags.origin?.uuid ? fromUuidSync?.(flags.origin.uuid) : null;
  // 2. The feat's own action card.
  if (!context.type && slugOf(originItem) === SLUG) return healer && ours ? { healer, patientUuid: ours } : null;
  // 3. A Medicine check naming Battle Medicine.
  if (context.type && context.type !== "skill-check") return null;
  const options = context.options ?? [];
  const medicine = (context.domains ?? []).includes("medicine") || options.some(o => o === "skill:medicine" || o.startsWith("check:statistic:medicine"));
  if (!medicine) return null;
  const named = isBattleMedicineText(message.flavor) || isBattleMedicineText(message.content);
  if (!(options.some(o => o.includes(SLUG)) || slugOf(originItem) === SLUG || named)) return null;
  const patientUuid = context.target?.actor ?? ours;
  return healer && patientUuid ? { healer, patientUuid } : null;
}

/** Record a use: Medic Dedication spent when the patient was already immune to this healer. GM's client. */
export async function record(healer, patient, { name = null, baton = false } = {}) {
  if (!healer?.uuid || !patient) return;
  const before = immunitiesOf(patient, { kind: KIND, by: healer.uuid })[0];
  if (before && Date.now() - (before.real ?? 0) < SAME_USE_MS) return; // the same use, seen twice
  if (before && medicReady(healer)) {
    await addImmunity(healer, { kind: MEDIC, by: healer.uuid, name: healer.name, seconds: medicSeconds(healer) });
  }
  await addImmunity(patient, { kind: KIND, by: healer.uuid, name: name ?? healer.name, seconds: secondsFor(healer, patient, { baton }) });
}

async function onCreateMessage(message) {
  if (!game.user.isActiveGM) return;
  const use = readUse(message);
  if (!use) return;
  const patient = use.patient ?? (await actorFrom(use.patientUuid));
  if (!patient) return;
  const token = message.token ?? use.healer.getActiveTokens?.(true, true)?.[0]?.document;
  await record(use.healer, patient, { name: token?.name ?? use.healer.name, baton: use.baton });
}

/** Effects made by others: PF2e's immunity effect, the Workbench's "Medic dedication used". */
async function onCreateItem(item) {
  if (!game.user.isActiveGM || item.type !== "effect") return;
  const actor = item.actor;
  if (!actor) return;
  if (/^medic dedication used$/i.test(item.name ?? "")) {
    if (!immunitiesOf(actor, { kind: MEDIC }).length) await addImmunity(actor, { kind: MEDIC, by: actor.uuid, name: actor.name, seconds: medicSeconds(actor) });
    return;
  }
  if (slugOf(item) !== EFFECT_SLUG && !/^battle medicine( by |$)/i.test(item.name ?? "")) return;
  let healer = await actorFrom(item.system?.context?.origin?.actor ?? item.origin ?? null);
  const byName = /^battle medicine by (.+)$/i.exec(item.name ?? "")?.[1];
  if (!healer && byName) healer = canvas?.tokens?.placeables?.find(tk => tk.name === byName)?.actor ?? game.actors?.getName?.(byName) ?? null;
  if (!healer?.uuid || immunitiesOf(actor, { kind: KIND, by: healer.uuid }).length) return;
  await addImmunity(actor, { kind: KIND, by: healer.uuid, name: byName ?? healer.name, seconds: secondsFor(healer, actor) });
}

/**
 * The roller's client: a Medicine check or the feat's own card without a target in its context gets the
 * roller's single target in our flag, so the GM's client knows who was treated.
 */
function onPreCreateMessage(message, data, options, userId) {
  if (userId !== game.user.id) return;
  const pf2 = sysFlags(data) ?? sysFlags(message) ?? {};
  const context = pf2.context;
  const origin = pf2.origin?.uuid ? fromUuidSync?.(pf2.origin.uuid) : null;
  const medicineCheck = context?.type === "skill-check" && (context.domains ?? []).includes("medicine") && !context.target?.actor;
  const featCard = !context?.type && slugOf(origin) === SLUG;
  if (!medicineCheck && !featCard) return;
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
  if (hasFeat(actor, "medic-dedication")) {
    const used = immunitiesOf(actor, { kind: MEDIC })[0];
    lines.push(used ? t("MedicUsed", { time: timeLeft(used) }) : t("MedicReady"));
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
  // The GM also gets it on every player character, to add an entry by hand.
  const show = lines.length || hasFeat(actor, SLUG) || (game.user.isGM && actor?.type === "character");
  const existing = root.querySelector(".lucd20-battle-medicine");
  let tooltip = lines.length ? lines.map(esc).join("<br>") : esc(t("None"));
  if (game.user.isGM) tooltip += `<br><em>${esc(t("ClickToEdit"))}</em>`;
  if (existing?.dataset.tokenId === doc.id && existing.dataset.tooltipHtml === tooltip && show) return;
  existing?.remove();
  if (!show) return;
  const column = root.querySelector(".col.left") ?? root.querySelector(".col.right") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon lucd20-battle-medicine";
  button.classList.toggle("active", immunitiesOf(actor, { kind: KIND }).length > 0);
  button.dataset.tokenId = doc.id;
  button.dataset.tooltipHtml = tooltip;
  button.dataset.tooltipDirection = "LEFT";
  button.setAttribute("aria-label", t("Title"));
  button.innerHTML = '<i class="fa-solid fa-kit-medical"></i>';
  button.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (game.user.isGM && actor) BattleMedicineEditor.open(actor, doc.name);
  });
  // After Riding's horse when it is there (owner: "under rideable").
  const horse = column.querySelector(".lucd20-rideable");
  if (horse) horse.after(button);
  else column.append(button);
}

/* -------------------------------------------- */
/*  The GM's editor                             */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

/** Creatures that could be healers: those with Battle Medicine, else every character. */
function healers() {
  const all = game.actors?.contents ?? [];
  const bm = all.filter(a => hasFeat(a, SLUG));
  return (bm.length ? bm : all.filter(a => a.type === "character")).sort((a, b) => a.name.localeCompare(b.name));
}

export class BattleMedicineEditor extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lucd20-battle-medicine-editor",
    classes: ["lucd20-loot-app", "lucd20-bm-editor"],
    window: { title: "LUCD20.BattleMedicine.EditorTitle", icon: "fa-solid fa-kit-medical", resizable: true },
    position: { width: 380, height: "auto" },
    actions: {
      removeTreatedBy: BattleMedicineEditor.#onRemoveTreatedBy,
      removeTreated: BattleMedicineEditor.#onRemoveTreated,
      resetMedic: BattleMedicineEditor.#onResetMedic,
      spendMedic: BattleMedicineEditor.#onSpendMedic,
      add: BattleMedicineEditor.#onAdd
    }
  };

  static open(actor, name) {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? new this();
    app.actor = actor;
    app.tokenName = name ?? actor.name;
    return app.render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
    if (app?.rendered) app.render();
  }

  get title() {
    return t("EditorFor", { name: this.tokenName ?? this.actor?.name ?? "" });
  }

  async _renderHTML() {
    const actor = this.actor;
    const row = (label, action, by) => `<li class="lucd20-bm-row"><span>${esc(label)}</span><button type="button" class="ll-btn ll-btn-danger" data-action="${action}" data-by="${esc(by)}" data-tooltip="${esc(t("Remove"))}" aria-label="${esc(t("Remove"))}"><i class="fa-solid fa-xmark"></i></button></li>`;
    const treatedBy = immunitiesOf(actor, { kind: KIND }).map(e => row(t("TreatedBy", { name: e.name, time: timeLeft(e) }), "removeTreatedBy", e.by)).join("");
    const treated = usedBy(actor.uuid, KIND).map(e => row(t("Treated", { name: e.actor.name, time: timeLeft(e) }), "removeTreated", e.actor.uuid)).join("");
    const medicUsed = immunitiesOf(actor, { kind: MEDIC })[0];
    const medic = hasFeat(actor, "medic-dedication")
      ? `<p class="lucd20-bm-medic">${esc(medicUsed ? t("MedicUsed", { time: timeLeft(medicUsed) }) : t("MedicReady"))}
         <button type="button" data-action="${medicUsed ? "resetMedic" : "spendMedic"}">${esc(medicUsed ? t("MedicReset") : t("MedicSpend"))}</button></p>` : "";
    const options = healers().filter(a => a !== actor).map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("");
    return `
      <div class="lucd20-bm-editor-body">
        <h4>${esc(t("SectionTreatedBy"))}</h4>
        ${treatedBy ? `<ul class="lucd20-bm-list">${treatedBy}</ul>` : `<p class="muted">${esc(t("Nobody"))}</p>`}
        <h4>${esc(t("SectionTreated"))}</h4>
        ${treated ? `<ul class="lucd20-bm-list">${treated}</ul>` : `<p class="muted">${esc(t("Nobody"))}</p>`}
        ${medic}
        <h4>${esc(t("SectionAdd"))}</h4>
        <div class="lucd20-bm-add">
          <select class="healer" aria-label="${esc(t("Healer"))}">${options}</select>
          <input type="number" class="hours" value="24" min="0" step="1" aria-label="${esc(t("HoursLeft"))}" data-tooltip="${esc(t("HoursLeft"))}">
          <button type="button" class="ll-btn" data-action="add" data-tooltip="${esc(t("Add"))}" aria-label="${esc(t("Add"))}"><i class="fa-solid fa-plus"></i></button>
        </div>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onRemoveTreatedBy(event, target) {
    await removeImmunity(this.actor, { kind: KIND, by: target.dataset.by });
    this.render();
  }

  static async #onRemoveTreated(event, target) {
    const patient = await actorFrom(target.dataset.by);
    await removeImmunity(patient, { kind: KIND, by: this.actor.uuid });
    this.render();
  }

  static async #onResetMedic() {
    await removeImmunity(this.actor, { kind: MEDIC });
    this.render();
  }

  static async #onSpendMedic() {
    await addImmunity(this.actor, { kind: MEDIC, by: this.actor.uuid, name: this.actor.name, seconds: medicSeconds(this.actor) });
    this.render();
  }

  static async #onAdd() {
    const root = this.element;
    const healer = await actorFrom(root.querySelector("select.healer")?.value);
    const hours = Number(root.querySelector("input.hours")?.value);
    if (!healer || !(hours > 0)) return;
    const name = healer.getActiveTokens?.(true, true)?.[0]?.document?.name ?? healer.name;
    await addImmunity(this.actor, { kind: KIND, by: healer.uuid, name, seconds: Math.round(hours * HOUR) });
    this.render();
  }
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
    feature.on("updateActor", () => BattleMedicineEditor.refresh());
    feature.on("renderTokenHUD", () => drawHudButton());
    feature.onCleanup(watchDOM("battle-medicine-hud", drawHudButton));
    feature.onCleanup(() => document.querySelectorAll(".lucd20-battle-medicine").forEach(el => el.remove()));
    feature.onCleanup(() => foundry.applications.instances?.get(BattleMedicineEditor.DEFAULT_OPTIONS.id)?.close());
  }
});
