import { localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { addChatControl } from "../../core/chat-controls.js";
import { sysConfig } from "./sys.js";

/**
 * Multiple Checks (owner, PLAN §24, Q312–Q316). PF2e / SF2e, GM only.
 * - The GM collects checks in a window and posts them as one chat card. Add a check by Shift-clicking the
 *   "send to chat" icon of an inline check (a journal, an item, a chat card; a check group adds all of its
 *   checks), by pasting or dropping selected journal text (its inline checks are read) or `@Check[…]` /
 *   `[[/act …]]` codes, or with the "+" row (a skill, save or Lore and a DC).
 * - The card lists one button per check, in order. Players don't see the DCs: each check but the hardest says
 *   how much lower its DC is ("Stealth (DC 2 lower)"); the GM sees the DCs. The buttons are PF2e's own inline
 *   check / action links (`data-pf2-check` / `data-pf2-action`, `data-pf2-show-dc="gm"`), so clicking one rolls
 *   with the system's own handler against the real DC.
 * (verify) in PF2e 8.7 / SF2e 1.7: the repost icon `i[data-pf2-repost]`, the action link's dataset
 * (`pf2Action`, `pf2Skill`, `pf2Dc`), and that `[data-visibility="gm"]` hides the DC in chat for players.
 */

const ID = "lucd20-multi-check";
const esc = value => Handlebars.escapeExpression(String(value ?? ""));
const t = (key, data) => localize(`LUCD20.MultiCheck.${key}`, data);
const SAVES = ["fortitude", "reflex", "will"];

/** The checks in the window (this client, until cleared). */
const state = { title: "", checks: [] };

/* -------------------------------------------- */
/*  Reading checks                              */
/* -------------------------------------------- */

const titleCase = slug => String(slug).split("-").map(w => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");

/** The label of a check type: skill, save, Perception, a Lore, or an action. */
export function checkLabel(type) {
  const config = sysConfig() ?? {};
  const entry = config.skills?.[type] ?? config.saves?.[type];
  const label = typeof entry === "string" ? entry : entry?.label;
  if (label) return game.i18n.localize(label);
  if (type === "perception") return game.i18n.localize("PF2E.PerceptionLabel") === "PF2E.PerceptionLabel" ? "Perception" : game.i18n.localize("PF2E.PerceptionLabel");
  return titleCase(type);
}

/** One check from an inline link (PF2e's `a[data-pf2-check]` / `[data-pf2-action]`). */
export function fromLink(link) {
  const d = link?.dataset ?? {};
  const dc = Number(d.pf2Dc);
  const adjustment = Number(d.pf2Adjustment) || 0;
  const text = (link.querySelector?.(".label")?.textContent ?? link.textContent ?? "").replace(/\bDC\s*\d+\s*/gi, "").trim();
  if (d.pf2Check) {
    return { kind: "check", type: d.pf2Check, dc: Number.isFinite(dc) && d.pf2Dc !== "" ? dc + adjustment : null,
      traits: d.pf2Traits ?? "", label: text || checkLabel(d.pf2Check) };
  }
  if (d.pf2Action) {
    return { kind: "action", type: d.pf2Action, skill: d.pf2Skill ?? "", variant: d.pf2Variant ?? "",
      dc: Number.isFinite(dc) && d.pf2Dc !== "" ? dc : null, traits: d.pf2Traits ?? "",
      label: text || titleCase(d.pf2Action) + (d.pf2Skill ? ` (${checkLabel(d.pf2Skill)})` : "") };
  }
  return null;
}

/** Every check in a piece of HTML (selected journal text) or plain text with codes. */
export function parseChecks({ html = "", text = "" } = {}) {
  const found = [];
  if (html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    for (const link of div.querySelectorAll("[data-pf2-check], [data-pf2-action]")) {
      const check = fromLink(link);
      if (check) found.push(check);
    }
    if (found.length) return found;
    text ||= div.textContent;
  }
  // @Check[athletics|dc:20|traits:…]  /  @Check[type:athletics|dc:20]  /  @Check[athletics,stealth|dc:20|adjustment:0,-2]
  for (const m of String(text).matchAll(/@Check\[([^\]]+)\]/g)) {
    const parts = m[1].split("|");
    const params = Object.fromEntries(parts.slice(1).map(p => p.split(":")).map(([k, ...v]) => [k.trim(), v.join(":").trim()]));
    const first = parts[0].replace(/^type:/, "");
    const types = first.split(",").map(s => s.trim()).filter(Boolean);
    const adjustments = String(params.adjustment ?? "").split(",").map(Number);
    types.forEach((type, i) => {
      const dc = params.dc !== undefined && params.dc !== "" ? Number(params.dc) + (adjustments[i] || 0) : null;
      found.push({ kind: "check", type, dc: Number.isFinite(dc) ? dc : null, traits: params.traits ?? "", label: checkLabel(type) });
    });
  }
  // [[/act seek dc=20]]  /  [[/act recall-knowledge statistic=arcana dc=25]]
  for (const m of String(text).matchAll(/\[\[\/act\s+([a-z-]+)([^\]]*)\]\]/g)) {
    const params = Object.fromEntries([...m[2].matchAll(/([a-z]+)=("[^"]*"|\S+)/gi)].map(([, k, v]) => [k.toLowerCase(), v.replace(/"/g, "")]));
    const dc = params.dc !== undefined ? Number(params.dc) : null;
    const skill = params.statistic ?? params.skill ?? "";
    found.push({ kind: "action", type: m[1], skill, variant: params.variant ?? "", dc: Number.isFinite(dc) ? dc : null,
      traits: params.traits ?? "", label: titleCase(m[1]) + (skill ? ` (${checkLabel(skill)})` : "") });
  }
  return found;
}

/* -------------------------------------------- */
/*  The card                                    */
/* -------------------------------------------- */

/** The chat card's HTML. Each check but the hardest says how much lower its DC is; the DCs are GM-only. */
export function cardHTML({ title = "", checks = [] }) {
  const dcs = checks.map(c => c.dc).filter(Number.isFinite);
  const top = dcs.length ? Math.max(...dcs) : null;
  const items = checks.map(c => {
    const dcData = Number.isFinite(c.dc) ? ` data-pf2-dc="${c.dc}" data-pf2-show-dc="gm"` : "";
    const traits = c.traits ? ` data-pf2-traits="${esc(c.traits)}"` : "";
    const dcText = Number.isFinite(c.dc) ? `<span data-visibility="gm">${esc(t("DC", { dc: c.dc }))}</span> ` : "";
    const link = c.kind === "action"
      ? `<a class="inline-action" data-pf2-action="${esc(c.type)}"${c.skill ? ` data-pf2-skill="${esc(c.skill)}"` : ""}${c.variant ? ` data-pf2-variant="${esc(c.variant)}"` : ""}${dcData}${traits}><i class="fa-solid fa-person-running icon"></i><span class="label">${dcText}${esc(c.label)}</span></a>`
      : `<a class="inline-check" data-pf2-check="${esc(c.type)}"${dcData}${traits} data-pf2-label="${esc(c.label)}"><i class="fa-solid ${SAVES.includes(c.type) ? { fortitude: "fa-heart-pulse", reflex: "fa-person-running", will: "fa-brain" }[c.type] : c.type === "perception" ? "fa-eye" : "fa-dice-d20"} icon"></i><span class="label">${dcText}${esc(c.label)}</span></a>`;
    const lower = Number.isFinite(c.dc) && top !== null && top - c.dc > 0 ? ` <span class="lucd20-mc-diff">(${esc(t("Lower", { n: top - c.dc }))})</span>` : "";
    return `<li>${link}${lower}</li>`;
  }).join("");
  const heading = title ? `<p class="lucd20-mc-title"><strong>${esc(title)}</strong></p>` : "";
  return `<div class="lucd20-multi-check">${heading}<ul>${items}</ul></div>`;
}

export async function postCard(data = state) {
  if (!data.checks.length) return null;
  return ChatMessage.create({ content: cardHTML(data), speaker: ChatMessage.getSpeaker({ alias: game.user.name }) });
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

export class MultiCheckWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID,
    classes: ["lucd20-loot-app", "lucd20-multi-check-app"],
    window: { title: "LUCD20.MultiCheck.Title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 420, height: "auto" },
    actions: {
      send: MultiCheckWindow.#onSend,
      clear: MultiCheckWindow.#onClear,
      remove: MultiCheckWindow.#onRemove,
      up: MultiCheckWindow.#onUp,
      add: MultiCheckWindow.#onAdd
    }
  };

  static open() {
    return (foundry.applications.instances?.get(ID) ?? new this()).render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances?.get(ID);
    if (app?.rendered) app.render();
  }

  /** Add checks and show the window. */
  static add(checks) {
    if (!checks?.length) return;
    state.checks.push(...checks);
    this.open();
  }

  static skillOptions() {
    const config = sysConfig() ?? {};
    const skills = Object.keys(config.skills ?? {}).map(slug => [slug, checkLabel(slug)]);
    const list = [["perception", checkLabel("perception")], ...SAVES.map(s => [s, checkLabel(s)]), ...skills.sort((a, b) => a[1].localeCompare(b[1]))];
    return list.map(([slug, label]) => `<option value="${esc(slug)}">${esc(label)}</option>`).join("")
      + `<option value="lore">${esc(t("Lore"))}</option>`;
  }

  async _renderHTML() {
    const dcs = state.checks.map(c => c.dc).filter(Number.isFinite);
    const top = dcs.length ? Math.max(...dcs) : null;
    const rows = state.checks.map((c, i) => `
      <li class="lucd20-mc-row" data-index="${i}">
        <span class="name">${esc(c.label)}${c.kind === "action" ? ` <span class="sub">${esc(t("Action"))}</span>` : ""}</span>
        <input type="number" class="dc" value="${Number.isFinite(c.dc) ? c.dc : ""}" placeholder="${esc(t("NoDC"))}" aria-label="${esc(t("DCLabel"))}">
        <span class="sub diff">${Number.isFinite(c.dc) && top - c.dc > 0 ? esc(t("Lower", { n: top - c.dc })) : ""}</span>
        <button type="button" class="ll-btn" data-action="up" data-tooltip="${esc(t("Up"))}" aria-label="${esc(t("Up"))}" ${i ? "" : "disabled"}><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" class="ll-btn ll-btn-danger" data-action="remove" data-tooltip="${esc(t("Remove"))}" aria-label="${esc(t("Remove"))}"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join("");
    return `
      <div class="lucd20-mc">
        <input type="text" class="title" value="${esc(state.title)}" placeholder="${esc(t("TitlePlaceholder"))}">
        ${rows ? `<ol class="lucd20-mc-list">${rows}</ol>` : `<p class="lucd20-mc-empty">${esc(t("Empty"))}</p>`}
        <div class="lucd20-mc-add">
          <select class="type">${MultiCheckWindow.skillOptions()}</select>
          <input type="text" class="lore" placeholder="${esc(t("LorePlaceholder"))}" hidden>
          <input type="number" class="new-dc" placeholder="${esc(t("DCLabel"))}">
          <button type="button" class="ll-btn" data-action="add" data-tooltip="${esc(t("Add"))}" aria-label="${esc(t("Add"))}"><i class="fa-solid fa-plus"></i></button>
        </div>
        <textarea class="paste" rows="2" placeholder="${esc(t("PastePlaceholder"))}"></textarea>
        <footer class="lucd20-mc-footer">
          <button type="button" data-action="clear"><i class="fa-solid fa-trash"></i> ${esc(t("Clear"))}</button>
          <button type="button" data-action="send" ${state.checks.length ? "" : "disabled"}><i class="fa-solid fa-comment"></i> ${esc(t("Send"))}</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.querySelector("input.title")?.addEventListener("input", ev => { state.title = ev.target.value; });
    for (const input of root.querySelectorAll(".lucd20-mc-row input.dc")) {
      input.addEventListener("change", ev => {
        const i = Number(ev.target.closest("[data-index]").dataset.index);
        const value = ev.target.value === "" ? null : Number(ev.target.value);
        state.checks[i].dc = Number.isFinite(value) ? value : null;
        this.render();
      });
    }
    const type = root.querySelector("select.type");
    const lore = root.querySelector("input.lore");
    type?.addEventListener("change", () => { lore.hidden = type.value !== "lore"; });
    // Paste codes or selected journal text into the box; drop selected text anywhere on the window.
    const take = (html, text) => {
      const checks = parseChecks({ html, text });
      if (!checks.length) return false;
      state.checks.push(...checks);
      this.render();
      return true;
    };
    root.querySelector("textarea.paste")?.addEventListener("paste", ev => {
      const html = ev.clipboardData?.getData("text/html") ?? "";
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      if (take(html, text)) ev.preventDefault();
    });
    root.querySelector("textarea.paste")?.addEventListener("change", ev => {
      if (take("", ev.target.value)) ev.target.value = "";
    });
  }

  /** Window-level listeners once: the element stays across renders. Drop selected journal text anywhere. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("dragover", ev => ev.preventDefault());
    this.element.addEventListener("drop", ev => {
      const checks = parseChecks({ html: ev.dataTransfer?.getData("text/html") ?? "", text: ev.dataTransfer?.getData("text/plain") ?? "" });
      if (!checks.length) return;
      ev.preventDefault();
      state.checks.push(...checks);
      this.render();
    });
  }

  static async #onSend() {
    await postCard(state);
  }

  static #onClear() {
    state.checks = [];
    state.title = "";
    this.render();
  }

  static #onRemove(event, target) {
    state.checks.splice(Number(target.closest("[data-index]").dataset.index), 1);
    this.render();
  }

  static #onUp(event, target) {
    const i = Number(target.closest("[data-index]").dataset.index);
    if (i > 0) [state.checks[i - 1], state.checks[i]] = [state.checks[i], state.checks[i - 1]];
    this.render();
  }

  static #onAdd() {
    const root = this.element;
    let type = root.querySelector("select.type").value;
    if (type === "lore") {
      const name = root.querySelector("input.lore").value.trim();
      if (!name) return;
      type = `${name.toLowerCase().replace(/\s+lore$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-lore`;
    }
    const value = root.querySelector("input.new-dc").value;
    const dc = value === "" ? null : Number(value);
    state.checks.push({ kind: "check", type, dc: Number.isFinite(dc) ? dc : null, traits: "", label: checkLabel(type) });
    this.render();
  }
}

/* -------------------------------------------- */
/*  Shift-click on "send to chat"               */
/* -------------------------------------------- */

/** Capture phase, before PF2e's own (bubbling) listener: Shift + the repost icon collects instead of posting. */
function onClick(event) {
  if (!event.shiftKey || !game.user.isGM) return;
  const icon = event.target?.closest?.("i[data-pf2-repost]");
  if (!icon) return;
  const link = icon.closest("a, span");
  if (!link) return;
  const group = link.parentElement?.dataset?.pf2Checkgroup !== undefined
    ? [...link.parentElement.querySelectorAll("[data-pf2-check], [data-pf2-action]")]
    : [link];
  const checks = group.map(fromLink).filter(Boolean);
  if (!checks.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  MultiCheckWindow.add(checks);
  ui.notifications.info(t("Added", { n: checks.length }));
}

defineFeature({
  id: "pf2eMultiCheck",
  category: "pf2e",
  systems: ["pf2e"],
  gmOnly: true,
  defaultEnabled: true,
  enable(feature) {
    if (!game.user.isGM) return;
    document.addEventListener("click", onClick, true);
    feature.onCleanup(() => document.removeEventListener("click", onClick, true));
    feature.onCleanup(addChatControl({
      id: "multiCheck",
      icon: "fa-solid fa-list-check",
      tooltip: t("Title"),
      order: 40,
      visible: () => game.user.isGM,
      onClick: () => MultiCheckWindow.open()
    }));
    feature.onCleanup(() => foundry.applications.instances?.get(ID)?.close());
  }
});
