/**
 * Run callbacks whenever the page changes (throttled to once per frame).
 *
 * Foundry draws parts of its UI before modules start, re-draws them later, and
 * moves some of them around. Hooks alone miss some of those moments; a watcher
 * catches every one. Callbacks must be cheap and idempotent (do nothing when
 * the page is already as they want it).
 *
 * watchDOM(id, callback) → stop()
 */

const callbacks = new Map();
let observer = null;
let frame = null;

export function watchDOM(id, callback) {
  callbacks.set(id, callback);
  if (!observer) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  schedule();
  return () => {
    callbacks.delete(id);
    if (!callbacks.size) {
      observer?.disconnect();
      observer = null;
    }
  };
}

export function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(run);
}

function run() {
  frame = null;
  for (const [id, callback] of callbacks) {
    try {
      callback();
    } catch (err) {
      console.error(`lucd20-automations | DOM watcher "${id}" failed.`, err);
    }
  }
}
