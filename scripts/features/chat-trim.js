import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Chat Log Trim (long-session performance). Per player.
 *
 * In PF2e (and other roll-heavy systems), every roll leaves a large DOM tree in
 * the chat sidebar. After a few hours of play, hundreds of rendered messages
 * make every new roll and UI interaction laggy until the chat is cleared or the
 * page is reloaded.
 *
 * This trims only the rendered DOM nodes in `.chat-log` down to the newest N
 * messages (default 80) when near the bottom, without ever deleting anything
 * from `game.messages` (Chat Pins, Dice Stats, Damage Log and Export stay
 * intact). A "Show older messages" button at the top loads older messages back
 * in batches on demand.
 */

const BATCH = 40;
const NEAR_BOTTOM_PX = 200;

const logState = new WeakMap(); // logEl -> { expanded: boolean, scrollBound: boolean }
let activeFeature = null;
let raf = null;

function messageElements(log) {
  return [...log.children].filter(el => el.dataset?.messageId && !el.classList.contains("lucd20-chat-older"));
}

function scrollContainerFor(log) {
  let el = log;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return log;
}

function isNearBottom(log) {
  const scroller = scrollContainerFor(log);
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 2) return true;
  return (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) <= NEAR_BOTTOM_PX;
}

function allMessages() {
  const col = game.messages;
  if (!col) return [];
  const list = Array.isArray(col.contents) ? col.contents : [...(col.values?.() ?? [])];
  return list.filter(m => m && m.visible !== false);
}

function olderMessagesFor(log) {
  const els = messageElements(log);
  if (!els.length) return [];
  const oldestId = els[0].dataset.messageId;
  const all = allMessages();
  const idx = all.findIndex(m => m.id === oldestId);
  return idx > 0 ? all.slice(0, idx) : [];
}

function stateOf(log) {
  let s = logState.get(log);
  if (!s) {
    s = { expanded: false, scrollBound: false, ignoreUntil: 0 };
    logState.set(log, s);
  }
  return s;
}

function bindScroll(log) {
  const s = stateOf(log);
  if (s.scrollBound) return;
  const scroller = scrollContainerFor(log);
  if (!scroller) return;
  s.scrollBound = true;
  const onScroll = () => {
    if (!activeFeature || performance.now() < s.ignoreUntil) return;
    if (isNearBottom(log)) {
      s.expanded = false;
      scheduleTrim();
    }
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });
  activeFeature?.onCleanup?.(() => {
    scroller.removeEventListener("scroll", onScroll);
    s.scrollBound = false;
  });
}

async function renderMessageNode(message) {
  if (typeof message.renderHTML === "function") {
    const el = await message.renderHTML();
    if (el instanceof HTMLElement) return el;
    if (el?.[0] instanceof HTMLElement) return el[0];
  }
  if (typeof message.getHTML === "function") {
    const html = await message.getHTML();
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0];
  }
  return null;
}

async function loadOlder(log, button) {
  const older = olderMessagesFor(log);
  if (!older.length) {
    button.closest(".lucd20-chat-older")?.remove();
    return;
  }
  button.disabled = true;
  const s = stateOf(log);
  s.expanded = true;
  const slice = older.slice(-BATCH);
  const scroller = scrollContainerFor(log);
  const prevHeight = scroller?.scrollHeight ?? 0;
  const prevTop = scroller?.scrollTop ?? 0;
  const anchor = messageElements(log)[0] ?? null;

  const frag = document.createDocumentFragment();
  for (const msg of slice) {
    try {
      const el = await renderMessageNode(msg);
      if (el) frag.append(el);
    } catch {}
  }
  if (anchor) log.insertBefore(frag, anchor);
  else log.append(frag);

  if (scroller) {
    const delta = scroller.scrollHeight - prevHeight;
    if (delta > 0) {
      s.ignoreUntil = performance.now() + 200;
      scroller.scrollTop = prevTop + delta;
    }
  }
  button.disabled = false;
  updateBanner(log);
}

function updateBanner(log) {
  const older = olderMessagesFor(log);
  let row = log.querySelector(":scope > .lucd20-chat-older");
  if (!older.length) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement("li");
    row.className = "lucd20-chat-older";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lucd20-chat-older-btn";
    btn.addEventListener("click", () => loadOlder(log, btn));
    row.append(btn);
    log.prepend(row);
  }
  const btn = row.querySelector("button");
  if (btn) btn.textContent = localize("LUCD20.ChatTrim.ShowOlder", { n: older.length });
}

export function trimLog(log, limit) {
  if (!log || !limit || limit < 1) return 0;
  bindScroll(log);
  const s = stateOf(log);
  const els = messageElements(log);
  let removed = 0;
  if (els.length > limit && !s.expanded && isNearBottom(log)) {
    const cut = els.length - limit;
    for (let i = 0; i < cut; i++) {
      els[i].remove();
      removed++;
    }
  }
  updateBanner(log);
  return removed;
}

function trimAll() {
  raf = null;
  if (!activeFeature) return;
  const limit = Math.max(10, Number(activeFeature.get("maxMessages")) || 80);
  for (const log of document.querySelectorAll(".chat-log")) trimLog(log, limit);
}

function scheduleTrim() {
  if (raf) return;
  raf = requestAnimationFrame(trimAll);
}

defineFeature({
  id: "chatTrim",
  category: "chat",
  scope: "client",
  defaultEnabled: true,
  settings: {
    maxMessages: { kind: "range", min: 20, max: 300, step: 10, default: 80 }
  },

  enable(feature) {
    activeFeature = feature;
    document.documentElement.classList.add("lucd20-chat-trim-active");
    feature.on("renderChatMessageHTML", scheduleTrim);
    feature.on("renderChatMessage", scheduleTrim);
    feature.on("createChatMessage", scheduleTrim);
    feature.on("deleteChatMessage", scheduleTrim);
    feature.on("renderChatLog", scheduleTrim);
    scheduleTrim();
    feature.onCleanup(() => {
      activeFeature = null;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      document.documentElement.classList.remove("lucd20-chat-trim-active");
      document.querySelectorAll(".lucd20-chat-older").forEach(el => el.remove());
    });
  },

  onSettingChange() {
    scheduleTrim();
  }
});
