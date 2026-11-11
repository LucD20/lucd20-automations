import { MODULE_ID, TEMPLATE_PATH, error, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";

/**
 * Chat Pins (replaces DFreds Chat Pins). GM only.
 *
 * - Right-click a message → Pin / Unpin. Pinned messages get a coloured outline.
 * - A pin button next to "Export Chat Log" opens the Pinned Messages window.
 * - Clear Chat deletes everything except pinned messages; those are marked
 *   "archived": hidden from the chat log but kept in the Pinned Messages window.
 *   Unpinning an archived message deletes it.
 *
 * Flags on ChatMessage: pinned (bool), pinnedAt (ms), archived (bool).
 */

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const isPinned = message => !!message?.getFlag(MODULE_ID, "pinned");
const isArchived = message => !!message?.getFlag(MODULE_ID, "archived");
const asElement = html => (html instanceof HTMLElement ? html : html?.[0] ?? null);

const state = { feature: null };

/* -------------------------------------------- */
/*  Pin / unpin                                 */
/* -------------------------------------------- */

async function setPinned(message, pinned) {
  if (!game.user.isGM || !message) return;
  if (pinned) {
    await message.update({ [`flags.${MODULE_ID}`]: { pinned: true, pinnedAt: Date.now(), archived: false } });
  } else if (isArchived(message)) {
    // Already cleared from the chat log: unpinning removes it for good.
    await message.delete();
  } else {
    await message.update({ [`flags.${MODULE_ID}.pinned`]: false });
  }
}

function messageFromLi(li) {
  const el = asElement(li);
  const id = el?.dataset.messageId ?? el?.closest("[data-message-id]")?.dataset.messageId;
  return game.messages.get(id);
}

function addContextOptions(app, options) {
  // Older Foundry passes (html, options); newer passes (app, options).
  const list = Array.isArray(options) ? options : Array.isArray(app) ? app : null;
  if (!list) return;
  list.push(
    {
      name: "LUCD20.ChatPins.Pin",
      icon: '<i class="fa-solid fa-thumbtack"></i>',
      condition: li => game.user.isGM && !isPinned(messageFromLi(li)),
      callback: li => setPinned(messageFromLi(li), true)
    },
    {
      name: "LUCD20.ChatPins.Unpin",
      icon: '<i class="fa-solid fa-xmark"></i>',
      condition: li => game.user.isGM && isPinned(messageFromLi(li)),
      callback: li => setPinned(messageFromLi(li), false)
    }
  );
}

/* -------------------------------------------- */
/*  Chat log decoration                         */
/* -------------------------------------------- */

function decorateMessage(message, html) {
  const el = asElement(html);
  if (!el) return;
  const feature = state.feature;
  const pinned = isPinned(message);
  const showOutline = pinned && (game.user.isGM || feature.get("showToPlayers"));
  el.classList.toggle("lucd20-pinned", showOutline);
  el.classList.remove("lucd20-pin-gold", "lucd20-pin-blue");
  if (showOutline) el.classList.add(`lucd20-pin-${feature.get("color")}`);
  el.classList.toggle("lucd20-pin-archived", pinned && isArchived(message));

  el.querySelector(".lucd20-pin-icon")?.remove();
  if (showOutline) {
    const icon = document.createElement("i");
    icon.className = "lucd20-pin-icon fa-solid fa-thumbtack";
    icon.dataset.tooltip = localize("LUCD20.ChatPins.Pinned");
    (el.querySelector(".message-header .message-metadata") ?? el.querySelector(".message-header") ?? el).prepend(icon);
  }
}

/** Pin button next to "Export Chat Log" (GM only). */
function addPinsButton(app, html) {
  if (!game.user.isGM) return;
  const root = asElement(html) ?? appElement(app);
  if (!root || root.querySelector(".lucd20-pins-button")) return;
  const exportButton = root.querySelector('[data-action="export"], .export-log, #chat-export');
  if (!exportButton) return;

  const button = exportButton.cloneNode(true);
  button.removeAttribute("id");
  button.removeAttribute("data-action");
  button.classList.add("lucd20-pins-button");
  const label = localize("LUCD20.ChatPins.Open");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  for (const el of [button, ...button.querySelectorAll("i")]) {
    el.className = el.className.replace(/\bfa-(?!solid\b|regular\b|fw\b)[\w-]+/g, "").trim();
    if (el.matches("i") || !button.querySelector("i")) el.classList.add("fa-solid", "fa-thumbtack");
  }
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    ChatPinsWindow.open();
  });
  exportButton.before(button);
}

/* -------------------------------------------- */
/*  Clear Chat keeps pinned messages            */
/* -------------------------------------------- */

async function flushKeepingPins(original) {
  const pinned = game.messages.filter(isPinned);
  if (!pinned.length) return original();

  const confirmed = await DialogV2.confirm({
    window: { title: localize("LUCD20.ChatPins.FlushTitle"), icon: "fa-solid fa-trash" },
    content: `<p>${localize("LUCD20.ChatPins.FlushContent", { count: pinned.length })}</p>`
  });
  if (!confirmed) return;

  const remove = game.messages.filter(m => !isPinned(m)).map(m => m.id);
  if (remove.length) await ChatMessage.deleteDocuments(remove);
  const archive = pinned.filter(m => !isArchived(m)).map(m => ({ _id: m.id, [`flags.${MODULE_ID}.archived`]: true }));
  if (archive.length) await ChatMessage.updateDocuments(archive);
}

/* -------------------------------------------- */
/*  Pinned Messages window                      */
/* -------------------------------------------- */

class ChatPinsWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lucd20-chat-pins",
    classes: ["lucd20-pins"],
    window: { title: "LUCD20.ChatPins.WindowTitle", icon: "fa-solid fa-thumbtack", resizable: true },
    position: { width: 420, height: 600 },
    actions: {
      jump: ChatPinsWindow.#onJump,
      unpin: ChatPinsWindow.#onUnpin
    }
  };

  static PARTS = {
    list: { template: `${TEMPLATE_PATH}/chat-pins.hbs`, scrollable: [".lucd20-pins-list"] }
  };

  static open() {
    const existing = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
    return (existing ?? new this()).render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const pins = game.messages
      .filter(isPinned)
      .sort((a, b) => (b.getFlag(MODULE_ID, "pinnedAt") ?? 0) - (a.getFlag(MODULE_ID, "pinnedAt") ?? 0))
      .map(m => ({ id: m.id, archived: isArchived(m) }));
    return Object.assign(context, {
      pins,
      empty: !pins.length,
      labels: {
        empty: localize("LUCD20.ChatPins.Empty"),
        jump: localize("LUCD20.ChatPins.Jump"),
        unpin: localize("LUCD20.ChatPins.Unpin"),
        unpinArchived: localize("LUCD20.ChatPins.UnpinArchived"),
        archived: localize("LUCD20.ChatPins.Archived")
      }
    });
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    for (const slot of this.element.querySelectorAll(".lucd20-pin-message[data-message-id]")) {
      const message = game.messages.get(slot.dataset.messageId);
      if (!message) continue;
      try {
        const html = asElement(message.renderHTML ? await message.renderHTML() : await message.getHTML());
        if (!html) continue;
        html.classList.remove("lucd20-pin-archived");
        slot.replaceChildren(html);
      } catch (err) {
        error("Could not render a pinned message.", err);
      }
    }
  }

  static #onJump(event, target) {
    const id = target.closest("[data-message-id]")?.dataset.messageId;
    const el = document.querySelector(`#chat .chat-log [data-message-id="${id}"], #sidebar [data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("lucd20-pin-flash");
    setTimeout(() => el.classList.remove("lucd20-pin-flash"), 1600);
  }

  static async #onUnpin(event, target) {
    const id = target.closest("[data-message-id]")?.dataset.messageId;
    await setPinned(game.messages.get(id), false);
  }
}

function refreshPinsWindow() {
  const app = foundry.applications.instances?.get(ChatPinsWindow.DEFAULT_OPTIONS.id);
  if (app?.rendered) app.render();
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "chatPins",
  category: "chat",
  scope: "world",
  defaultEnabled: false,
  settings: {
    color: {
      kind: "select",
      default: "gold",
      choices: { gold: "LUCD20.ChatPins.Color.gold", blue: "LUCD20.ChatPins.Color.blue" }
    },
    showToPlayers: { kind: "boolean", default: false }
  },

  enable(feature) {
    state.feature = feature;
    feature.on("getChatMessageContextOptions", addContextOptions);
    feature.on("getChatLogEntryContext", addContextOptions);
    feature.on("renderChatMessageHTML", decorateMessage);
    feature.on("renderChatMessage", decorateMessage);
    feature.on("renderChatLog", addPinsButton);
    for (const hook of ["createChatMessage", "updateChatMessage", "deleteChatMessage"]) feature.on(hook, refreshPinsWindow);
    if (game.user.isGM) feature.wrap(game.messages, "flush", flushKeepingPins);

    // Apply to what is already on screen.
    for (const el of document.querySelectorAll("[data-message-id]")) {
      const message = game.messages.get(el.dataset.messageId);
      if (message) decorateMessage(message, el);
    }
    if (ui.chat) addPinsButton(ui.chat, appElement(ui.chat));

    feature.onCleanup(() => {
      state.feature = null;
      document.querySelectorAll(".lucd20-pins-button, .lucd20-pin-icon").forEach(el => el.remove());
      document.querySelectorAll(".lucd20-pinned, .lucd20-pin-archived").forEach(el =>
        el.classList.remove("lucd20-pinned", "lucd20-pin-gold", "lucd20-pin-blue", "lucd20-pin-archived"));
      foundry.applications.instances?.get(ChatPinsWindow.DEFAULT_OPTIONS.id)?.close();
    });
  }
});
