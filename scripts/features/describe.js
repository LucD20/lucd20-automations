import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { broadcast, onBroadcast } from "../core/socket.js";

/**
 * Describe (replaces Narrator Tools' "describe"). GM only (owner's decision).
 *
 * - Select text anywhere and right-click → Describe. On chat messages it is an
 *   entry in Foundry's own message menu; elsewhere (journals, item
 *   descriptions …) a small menu in Foundry's context-menu style appears,
 *   only while text is selected.
 * - `/describe Text` in chat does the same; no chat message is posted.
 * - Everyone sees the text centered on screen over a black gradient (dark
 *   behind the text, transparent at the edges), fading in and out.
 * - It stays 3 s + 0.3 s per word, between 4 and 30 s (Q3). A click dismisses
 *   it; the GM's click dismisses it for everyone.
 */

const COMMAND = /^\/describe(?:\s+([\s\S]*))?$/i;
const FADE_MS = 600;
const state = { feature: null, current: null, selection: "", menu: null };

export function describeDuration(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.min(30, Math.max(4, 3 + 0.3 * words)) * 1000;
}

/* -------------------------------------------- */
/*  Overlay (every client)                      */
/* -------------------------------------------- */

function hide(id = null, { local = true } = {}) {
  const current = state.current;
  if (!current || (id && current.id !== id)) return;
  state.current = null;
  clearTimeout(current.timer);
  current.el.classList.remove("visible");
  setTimeout(() => current.el.remove(), FADE_MS);
  if (!local) broadcast("describe.hide", { id: current.id });
}

function show({ id, text, duration }) {
  if (!text) return;
  if (state.current) {
    clearTimeout(state.current.timer);
    state.current.el.remove();
    state.current = null;
  }
  const el = document.createElement("div");
  el.className = "lucd20-describe";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-live", "polite");
  const box = document.createElement("div");
  box.className = "lucd20-describe-text";
  box.textContent = text; // plain text only
  el.append(box);
  el.dataset.tooltip = "";
  el.title = localize("LUCD20.Describe.Dismiss");
  el.addEventListener("click", () => hide(id, { local: !game.user.isGM }));
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("visible")));
  const timer = setTimeout(() => hide(id), duration);
  state.current = { id, el, timer };
}

/** GM: show on every screen. */
export function describe(text) {
  const clean = String(text ?? "").replace(/\r/g, "").trim();
  if (!clean || !game.user.isGM) return;
  const payload = { id: foundry.utils.randomID?.() ?? String(Date.now()), text: clean, duration: describeDuration(clean) };
  show(payload);
  broadcast("describe.show", payload);
}

onBroadcast("describe.show", payload => {
  if (state.feature?.active && typeof payload?.text === "string") show(payload);
});
onBroadcast("describe.hide", payload => hide(payload?.id));

/* -------------------------------------------- */
/*  /describe                                   */
/* -------------------------------------------- */

/** V14 sends chat input as HTML ("<p>…</p>"); turn it into plain text with line breaks. */
function plainText(message) {
  const div = document.createElement("div");
  div.innerHTML = String(message ?? "");
  for (const br of div.querySelectorAll("br")) br.replaceWith("\n");
  for (const p of div.querySelectorAll("p, div, li")) p.append("\n");
  return div.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function onChatMessage(chatLog, message) {
  if (!game.user.isGM) return true;
  const text = plainText(message);
  const match = text.match(COMMAND);
  if (!match) return true;
  if (match[1]?.trim()) describe(match[1]);
  else ui.notifications.info(localize("LUCD20.Describe.Usage"));
  return false; // no chat message
}

/* -------------------------------------------- */
/*  Right-click on selected text                */
/* -------------------------------------------- */

function selectedText() {
  return window.getSelection?.()?.toString().trim() ?? "";
}

function closeMenu() {
  state.menu?.remove();
  state.menu = null;
}

function openMenu(x, y, text) {
  closeMenu();
  const nav = document.createElement("nav");
  nav.id = "lucd20-describe-menu";
  nav.className = "context-menu lucd20-describe-menu";
  nav.innerHTML = `<menu class="context-items"><li class="context-item" role="menuitem" tabindex="0"><i class="fa-solid fa-scroll fa-fw"></i><span></span></li></menu>`;
  nav.querySelector("span").textContent = localize("LUCD20.Describe.Menu");
  const item = nav.querySelector(".context-item");
  item.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    describe(text);
  });
  document.body.append(nav);
  const rect = nav.getBoundingClientRect();
  nav.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
  nav.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
  state.menu = nav;
}

/** Inside a chat message, Foundry's own menu gets the entry instead. */
function inChatMessage(target) {
  return !!target.closest("[data-message-id]");
}

function onContextMenu(event) {
  if (!game.user.isGM) return;
  const text = selectedText();
  state.selection = text;
  const target = event.target instanceof Element ? event.target : null;
  if (!text || !target || inChatMessage(target)) return;
  if (target.closest("input, textarea, [contenteditable='true'], prose-mirror, .editor-content")) return; // editing: keep the editor's menu
  event.preventDefault();
  event.stopPropagation();
  openMenu(event.clientX, event.clientY, text);
}

function onOutside(event) {
  if (state.menu && !state.menu.contains(event.target)) closeMenu();
}

function onKey(event) {
  if (event.key === "Escape") closeMenu();
}

defineFeature({
  id: "describe",
  category: "chat",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    state.feature = feature;
    feature.on("chatMessage", onChatMessage);
    feature.on("getChatMessageContextOptions", (app, options) => {
      if (!game.user.isGM) return;
      options.push({
        name: "LUCD20.Describe.Menu",
        icon: '<i class="fa-solid fa-scroll"></i>',
        condition: () => !!state.selection,
        callback: () => describe(state.selection)
      });
    });
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", closeMenu);
    feature.onCleanup(() => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", closeMenu);
      closeMenu();
      hide();
    });
  }
});
