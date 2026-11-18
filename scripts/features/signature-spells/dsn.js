/**
 * Signature Spells: what we read from Dice So Nice (v6.4.5; docs/PLAN.md §20). Everything here is guarded:
 * when a field is missing we get no dice points and the effect falls back to its reduced form. Nothing of
 * Dice So Nice is changed, wrapped or awaited by it.
 *
 * Public: `game.dice3d`, `game.dice3d.getScreenPosition(mesh)` (a die's place in the viewport),
 * `game.dice3d.showForRoll`, the hooks `diceSoNiceMessageProcessed`, `diceSoNiceRollStart`,
 * `diceSoNiceRollComplete`.
 * Internal (verify): `game.dice3d.box.throwEngine.diceList` / `.deadDiceList` (the dice meshes of the throw in
 * play / still on the table; `box.diceList` in older versions), a mesh's `parent.parent` (in the scene once
 * spawned), `userData.persistent`, `geometry.boundingSphere`, `game.dice3d.canvas` (its element, for the
 * z-index and the rectangle), `box.camera`, `message._dice3danimating`.
 */

export const dsnActive = () => !!game.modules?.get("dice-so-nice")?.active && !!game.dice3d;

/** message id → Dice So Nice said it will / won't animate it, started, completed. */
const state = new Map();
const waiters = new Map(); // message id → [resolve]

function note(id, patch) {
  if (!id) return;
  state.set(id, Object.assign(state.get(id) ?? {}, patch));
  if (state.size > 60) state.delete(state.keys().next().value);
}

/** Hook handlers: wire them with feature.on (so they go when the feature is switched off). */
export const dsnHooks = {
  diceSoNiceMessageProcessed: (id, interception) => note(id, { will: !!interception?.willTrigger3DRoll }),
  diceSoNiceRollStart: (id, context) => note(id, { started: true, blind: !!context?.blind }),
  diceSoNiceRollComplete: id => {
    note(id, { done: true });
    for (const resolve of waiters.get(id) ?? []) resolve(true);
    waiters.delete(id);
  }
};

/** Whether Dice So Nice is animating this message on this client (ask after its createChatMessage ran). */
export function willAnimate(message) {
  if (!dsnActive() || !message?.id) return false;
  const s = state.get(message.id) ?? {};
  if (s.done || s.will === false || s.blind) return false;
  return message._dice3danimating === true || !!s.started;
}

/** Resolves true when the message's dice have landed, false after `timeout`. */
export function diceLanded(messageId, timeout = 15000) {
  if (state.get(messageId)?.done) return Promise.resolve(true);
  return new Promise(resolve => {
    const list = waiters.get(messageId) ?? [];
    waiters.set(messageId, list);
    list.push(resolve);
    setTimeout(() => resolve(false), timeout);
  });
}

export function resetDsn() {
  for (const list of waiters.values()) for (const resolve of list) resolve(false);
  waiters.clear();
  state.clear();
}

/* -------------------------------------------- */
/*  Where the dice are on the screen            */
/* -------------------------------------------- */

function rectOf(dice3d) {
  const el = dice3d.canvas;
  if (!el?.getBoundingClientRect || el.style?.display === "none") return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** A die mesh → { x, y, r } in the viewport, or null. */
function project(mesh, dice3d, rect) {
  try {
    if (!mesh || mesh.userData?.persistent) return null;
    if (mesh.parent === null || mesh.parent?.parent === null) return null; // not in the scene (yet / any more)
    let p = typeof dice3d.getScreenPosition === "function" ? dice3d.getScreenPosition(mesh) : null;
    const camera = dice3d.box?.camera;
    let world = null;
    if (camera && typeof mesh.getWorldPosition === "function" && mesh.position?.constructor) {
      world = mesh.getWorldPosition(new mesh.position.constructor());
      if (!p) { const v = world.clone().project(camera); p = { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height }; }
    }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < -40 || p.y < -40 || p.x > window.innerWidth + 40 || p.y > window.innerHeight + 40) return null;
    // Its size on the screen: the bounding sphere's radius, seen by the camera (which looks straight down).
    let r = Math.max(20, Math.min(46, rect.height * 0.035));
    const radius = mesh.geometry?.boundingSphere?.radius;
    if (world && radius > 0) {
      const scale = (mesh.scale?.x ?? 1) * (mesh.parent?.scale?.x ?? 1);
      const edge = world.clone(); edge.x += radius * scale;
      const v = edge.project(camera), ex = rect.left + (v.x + 1) / 2 * rect.width;
      if (Number.isFinite(ex) && Math.abs(ex - p.x) > 4) r = Math.max(12, Math.min(90, Math.abs(ex - p.x)));
    }
    return { x: p.x, y: p.y, r };
  } catch {
    return null;
  }
}

function lists() {
  const box = game.dice3d?.box, engine = box?.throwEngine;
  const live = engine?.diceList ?? box?.diceList, dead = engine?.deadDiceList ?? box?.deadDiceList;
  return { live: Array.isArray(live) ? live : [], dead: Array.isArray(dead) ? dead : [] };
}

/**
 * The dice on the screen: [{ x, y, r, mesh, at() }] (`at()` = where it is now, the last place when it is gone).
 * `of`: only these meshes (the ones seen rolling); else the throw in play, and with `settled` also the dice
 * left on the table.
 */
export function dicePoints({ of = null, settled = false } = {}) {
  try {
    const dice3d = game.dice3d;
    if (!dsnActive()) return [];
    const rect = rectOf(dice3d);
    if (!rect) return [];
    const { live, dead } = lists();
    const meshes = of ? [...of] : settled ? [...dead, ...live] : live;
    const out = [];
    for (const mesh of meshes) {
      const p = project(mesh, dice3d, rect);
      if (!p) continue;
      const die = { ...p, mesh, at: () => { const q = project(mesh, dice3d, rectOf(dice3d) ?? rect); if (q) { die.x = q.x; die.y = q.y; } return die; } };
      out.push(die);
    }
    return out;
  } catch {
    return [];
  }
}

/** One above Dice So Nice's canvas (which is above the interface, or raised over the windows). */
export function overlayZ() {
  let z = 1000;
  try {
    const el = game.dice3d?.canvas;
    const own = parseInt(el?.style?.zIndex || (el ? getComputedStyle(el).zIndex : ""), 10);
    if (Number.isFinite(own)) z = Math.max(z, own);
  } catch { /* the default */ }
  return z + 1;
}

/* -------------------------------------------- */
/*  Moving and removing this throw's dice       */
/* -------------------------------------------- */

/**
 * After the throw has ended, a signature may lift its own dice towards the camera (they "jump") and take them
 * off the table. Only dice handed to `grabDie` are touched: never a persistent die, never while a throw is in
 * play. Removing a die is what Dice So Nice's own `fadeOutEphemeral` does for all dice, for this one only: out
 * of the throw engine's lists, out of the scene, its physics body removed — so the next throw neither shows
 * nor collides with it, and Dice So Nice's own clean-up finds nothing left to do for it.
 *
 * Internal (verify): a die mesh sits in a container (`mesh.parent`, a Group in `box.scene`); the camera looks
 * straight down from `box.camera.position.y`, so a higher `container.position.y` draws the die bigger;
 * `box.renderScene()` redraws (Dice So Nice's own ticker may have stopped); `throwEngine.rolling`;
 * `throwEngine.physicsWorker.exec("removeDice", [mesh.id])`; once the dice have stopped nothing moves them
 * back (the physics world is asleep).
 * Anything missing: `grabDie` returns null and the dice stay as they are.
 */

const grabbed = new Set();
let dirty = false;

const boxOf = () => game.dice3d?.box ?? null;
const busy = () => { const box = boxOf(); return !!(box?.throwEngine?.rolling ?? box?.rolling); };

export function grabDie(mesh) {
  try {
    const box = boxOf(), c = mesh?.parent, scene = c?.parent;
    if (!dsnActive() || !box || typeof box.renderScene !== "function" || busy()) return null;
    if (!c || !scene || typeof scene.remove !== "function" || mesh.userData?.persistent) return null;
    const camY = Number(box.camera?.position?.y);
    if (![c.position?.x, c.position?.y, c.position?.z, c.scale?.x, c.scale?.y, c.scale?.z, camY].every(Number.isFinite) || !(camY > c.position.y)) return null;
    const base = { y: c.position.y, sx: c.scale.x, sy: c.scale.y, sz: c.scale.z };
    const ok = () => !handle.gone && c.parent === scene && !busy();
    const handle = {
      mesh, gone: false,
      /** u = 0…1: on the table … at the top of its jump (about a third bigger on the screen). */
      lift(u) { if (!ok()) return; c.position.y = base.y + (camY - base.y) * 0.24 * u; dirty = true; },
      /** u = 0…1: full size … nothing. */
      shrink(u) { if (!ok()) return; const k = Math.max(0.001, 1 - u); c.scale.x = base.sx * k; c.scale.y = base.sy * k; c.scale.z = base.sz * k; dirty = true; },
      /** Back as Dice So Nice left it. */
      restore() {
        if (handle.gone) return;
        handle.gone = true; grabbed.delete(handle);
        try { c.position.y = base.y; c.scale.x = base.sx; c.scale.y = base.sy; c.scale.z = base.sz; dirty = true; } catch { /* gone with its scene */ }
      },
      /** Off the table for good. */
      remove() {
        if (handle.gone) return;
        const can = ok();
        handle.restore();
        if (!can) return;
        try {
          const engine = box.throwEngine, owner = Array.isArray(engine?.diceList) ? engine : box;
          for (const name of ["diceList", "deadDiceList"]) if (Array.isArray(owner[name])) owner[name] = owner[name].filter(d => d !== mesh);
          scene.remove(c);
          const worker = engine?.physicsWorker ?? box.physicsWorker;
          Promise.resolve(worker?.exec?.("removeDice", [mesh.id])).catch(() => {});
        } catch {
          try { c.visible = false; } catch { /* nothing more to try */ }
        }
        dirty = true;
      }
    };
    grabbed.add(handle);
    return handle;
  } catch {
    return null;
  }
}

/** Redraw Dice So Nice's scene once, if a die was moved this frame. */
export function flushDice() {
  if (!dirty) return;
  dirty = false;
  try { boxOf()?.renderScene?.(); } catch { /* its renderer is gone */ }
}

/** A run stopped half-way: every die still held goes back to where it was. */
export function releaseDice() {
  for (const handle of [...grabbed]) handle.restore();
  flushDice();
}
