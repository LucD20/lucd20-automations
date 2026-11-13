import { MODULE_ID } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { evaluate, clearCache } from "./expressions.js";
import { presetFor } from "./presets.js";
import { TooltipEditor } from "./editor.js";
import { localize } from "../../core/constants.js";

/**
 * Token Tooltip (replaces Token Tooltip Alt, simpler to set up).
 *
 * Hovering a token shows a small panel next to it with rows of icon + value,
 * in two columns when there are more than five (the owner's look: dark
 * panel, accent border, coloured icons). It follows pan and zoom.
 *
 * One list of rows for the world (default: the system's preset, see
 * presets.js); each row says who sees it (GM / owner / friendly / others /
 * all) and on which actor types. Values: expressions.js.
 *
 * Never leaks: only tokens this user can see, rows filtered per user, rows
 * that come out empty are hidden. The editor (phase 24) writes the config.
 */

export const CONFIG_KEY = "tokenTooltipConfig";

const state = { feature: null, el: null, token: null };

/** The world's rows: saved config, else the system's preset. */
export function tooltipConfig() {
  const saved = game.settings.get(MODULE_ID, CONFIG_KEY);
  if (saved?.rows?.length) return saved;
  return presetFor(game.system.id);
}

export function canSeeRow(row, token, user = game.user) {
  const actor = token.actor;
  if (!actor) return false;
  if (row.types?.length && !row.types.includes(actor.type)) return false;
  const isGM = user.isGM;
  const owner = isGM || actor.testUserPermission?.(user, "OWNER") || false;
  switch (row.who) {
    case "gm":
      return isGM;
    case "owner":
      return owner;
    case "friendly":
      return owner || token.document.disposition === CONST.TOKEN_DISPOSITIONS?.FRIENDLY;
    case "others":
      return !owner;
    default:
      return true;
  }
}

function iconClass(icon) {
  const name = String(icon || "fa-circle").trim();
  return /\bfa-(solid|regular|brands|light|thin|duotone)\b|\bfa[srlbd]\b/.test(name) ? name : `fa-solid ${name}`;
}

/** Rows this user sees on this token, with their values. */
export function tooltipRows(token) {
  const rows = [];
  for (const row of tooltipConfig().rows ?? []) {
    if (!canSeeRow(row, token)) continue;
    const value = evaluate(row.value, token);
    if (value === undefined) continue;
    rows.push({ icon: iconClass(row.icon), color: row.color || "#ffffff", value });
  }
  return rows;
}

/* -------------------------------------------- */
/*  Panel                                       */
/* -------------------------------------------- */

function panel() {
  if (state.el?.isConnected) return state.el;
  const el = document.createElement("div");
  el.id = "lucd20-token-tooltip";
  el.setAttribute("role", "tooltip");
  document.body.append(el);
  state.el = el;
  return el;
}

function hide() {
  state.token = null;
  if (state.el) state.el.classList.remove("visible");
}

function position() {
  const token = state.token;
  const el = state.el;
  if (!token || !el || !canvas?.stage) return;
  const size = canvas.dimensions.size;
  const d = token.document;
  const wt = canvas.stage.worldTransform;
  // The token as drawn (Token Scatter may offset it), else its document position.
  const x = token.position?.x ?? d.x;
  const y = token.position?.y ?? d.y;
  const topLeft = wt.apply(new PIXI.Point(x, y));
  const bottomRight = wt.apply(new PIXI.Point(x + d.width * size, y + d.height * size));
  const board = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const gap = 8;
  let left = board.left + bottomRight.x + gap;
  const top = board.top + topLeft.y;
  const width = el.offsetWidth;
  if (left + width > window.innerWidth - 4) left = board.left + topLeft.x - gap - width; // no room on the right
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(4, top))}px`;
}

function show(token) {
  if (!token?.actor || !token.visible) return hide();
  const rows = tooltipRows(token);
  if (!rows.length) return hide();
  const el = panel();
  const feature = state.feature;
  el.style.setProperty("--tt-accent", feature.get("accent") || "#500085");
  el.style.setProperty("--tt-font", `${Number(feature.get("fontSize")) || 16}px`);
  const perColumn = rows.length > 5 ? Math.ceil(rows.length / 2) : rows.length;
  el.innerHTML = `<div class="tt-grid" style="grid-template-rows: repeat(${perColumn}, auto)">${rows
    .map(r => `<div class="tt-cell"><i class="${Handlebars.escapeExpression(r.icon)} fa-fw" style="color:${Handlebars.escapeExpression(r.color)}"></i><span>${Handlebars.escapeExpression(r.value)}</span></div>`)
    .join("")}</div>`;
  state.token = token;
  el.classList.add("visible");
  position();
}

function refreshIfShown(token) {
  if (state.token && (!token || token === state.token)) show(state.token);
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "tokenTooltip",
  category: "tokens",
  scope: "world",
  defaultEnabled: false,
  settings: {
    accent: { kind: "color", default: "#500085" },
    fontSize: { kind: "range", min: 12, max: 22, step: 1, default: 16, scope: "client" }
  },

  init() {
    game.settings.register(MODULE_ID, CONFIG_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: null,
      onChange: () => {
        clearCache();
        refreshIfShown();
      }
    });
  },

  enable(feature) {
    state.feature = feature;
    feature.on("hoverToken", (token, hovered) => {
      if (hovered) show(token);
      else if (state.token === token) hide();
    });
    feature.on("canvasPan", () => position());
    feature.on("refreshToken", token => {
      if (token === state.token) position();
    });
    feature.on("updateActor", actor => {
      if (state.token?.actor === actor) refreshIfShown();
    });
    feature.on("updateToken", doc => {
      if (doc === state.token?.document) refreshIfShown();
    });
    feature.on("deleteToken", doc => {
      if (doc === state.token?.document) hide();
    });
    feature.on("canvasTearDown", hide);
    feature.onCleanup(() => {
      hide();
      state.el?.remove();
      state.el = null;
    });
  },

  onSettingChange() {
    refreshIfShown();
  },

  // GM: "Edit rows" button in the feature's card.
  renderPanel() {
    const count = tooltipConfig().rows?.length ?? 0;
    const saved = !!game.settings.get(MODULE_ID, CONFIG_KEY)?.rows?.length;
    return `<div class="lucd20-tt-panel">
      <button type="button" data-action="featureAction" data-feature="tokenTooltip" data-feature-action="edit">
        <i class="fa-solid fa-table-list"></i> ${localize("LUCD20.TokenTooltip.EditRows")}</button>
      <span class="hint">${localize(saved ? "LUCD20.TokenTooltip.RowsSaved" : "LUCD20.TokenTooltip.RowsPreset", { count })}</span>
    </div>`;
  },

  hubActions: {
    edit: () => TooltipEditor.open(tooltipConfig())
  }
});
