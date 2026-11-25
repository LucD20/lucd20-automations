/**
 * A context-menu entry that works on both V13 and V14 (v0.87.3: the chat's "Pin" option didn't show in V14).
 * V14's ContextMenuEntry is { label, icon (class or HTML), visible(target), onClick(event, target) }; V13's was
 * { name, icon (HTML), condition(li), callback(li) }. Both sets are given; `when(el)` and `run(el)` get the
 * element the menu was opened on (an HTMLElement; a jQuery object is unwrapped).
 */
const el = x => (x instanceof HTMLElement ? x : x?.[0] instanceof HTMLElement ? x[0] : x ?? null);

export function contextEntry({ label, icon, when = () => true, run, group }) {
  return {
    label, name: label, icon, ...(group ? { group } : {}),
    visible: target => !!when(el(target)),
    condition: target => !!when(el(target)),
    onClick: (event, target) => run(el(target ?? event?.currentTarget ?? event)),
    callback: target => run(el(target))
  };
}

/*
 * Entries for the chat log's right-click menu (v0.87.4). V14 calls no hook for it (owner: a listener on
 * `getChatMessageContextOptions` printed nothing), and the menu's entries may be read once, when the chat is
 * first drawn (before features start). So each source registers at `init` and the chat log's own
 * `_getEntryContextOptions` is extended once; the older hooks stay as a fallback, without duplicates.
 * `build()` → entries from `contextEntry()`; each entry's `when` should check that its feature is on.
 */
const chatSources = [];
let chatWrapped = false;

function addChatEntries(list, { onlyActive = false } = {}) {
  if (!Array.isArray(list)) return list;
  for (const { build, active } of chatSources) {
    if (onlyActive && !active()) continue;
    for (const entry of build()) {
      if (!list.some(e => e?.label === entry.label || e?.name === entry.label)) list.push(entry);
    }
  }
  return list;
}

/** build() → entries; active() → whether the feature is on (each entry's `when` checks it too). */
export function registerChatEntries(build, active = () => true) {
  chatSources.push({ build, active });
  if (chatWrapped) return;
  chatWrapped = true;
  const ChatLog = foundry.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
  const proto = ChatLog?.prototype;
  if (proto && typeof proto._getEntryContextOptions === "function") {
    const original = proto._getEntryContextOptions;
    proto._getEntryContextOptions = function (...args) {
      return addChatEntries(original.apply(this, args));
    };
  }
  // The hooks are called each time a menu is built: only the features that are on add theirs.
  Hooks.on("getChatMessageContextOptions", (app, options) => addChatEntries(Array.isArray(options) ? options : app, { onlyActive: true }));
  Hooks.on("getChatLogEntryContext", (app, options) => addChatEntries(Array.isArray(options) ? options : app, { onlyActive: true }));
}
