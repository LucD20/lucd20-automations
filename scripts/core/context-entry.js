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
