import { MODULE_ID, error, localize } from "./constants.js";

/**
 * Shared picks (owner, v0.76.0, docs/PLAN.md §22 Q284): while someone chooses on the map (Shove's squares,
 * Demoralizing Charge's squadmates, a 4e push / pull / slide / shift / charge), everyone else sees the same
 * highlights live, read-only: only the indicator, no bar, no warning. The GM also gets a small bar with
 * **Take over**: the chooser's picker closes, the GM's opens with the same choices, and the GM's choice is
 * sent back to the chooser's client, which carries on exactly as if it had been clicked there.
 *
 * Chooser:   const session = sharePick({ tokens, hint, takeover: { type, data } });
 *            session.draw({ rects, arrow, path });  session.end();
 *            session.onTaken = () => close the own UI;  session.onResult = value => resolve with it.
 * GM opener: registerTakeover(type, async (data, { hint, share }) => value | null).
 *
 * What is drawn is sent as plain shapes (scene pixels):
 *   rects: [{ x, y, w, h, color, fill?, line? }], arrow: { from: {x,y}, to: {x,y} } | null,
 *   path: { points: [{x,y}], color } | null.
 *
 * Who gets it: every other active user; only the GMs when a token involved is hidden (so nothing about
 * hidden tokens is ever sent to a player). A client draws it only on the same scene and only while it sees
 * every token involved. Sent with `User#query` to each user (Foundry's module socket would reach everyone).
 */

const QUERY = `${MODULE_ID}.pick`;
const THROTTLE_MS = 80;
const openers = new Map();
const own = new Map(); // id → session (this client chooses)
const watched = new Map(); // id → { user, scene, tokens, hint, state, takeover, layer, bar }
let enabled = () => true;
let idSeq = 0;

/** The feature switch (features/shared-picks.js) tells us whether sharing is on. */
export function setSharedPicksEnabled(fn) {
  enabled = fn;
}

export function registerTakeover(type, opener) {
  openers.set(type, opener);
}

/* -------------------------------------------- */
/*  Sending                                     */
/* -------------------------------------------- */

const docOf = uuid => {
  try {
    return fromUuidSync(uuid);
  } catch (err) {
    return null;
  }
};

function recipients(tokens) {
  const hidden = tokens.some(uuid => docOf(uuid)?.hidden);
  return Array.from(game.users?.values?.() ?? game.users ?? []).filter(u => u.active && u.id !== game.user.id && (u.isGM || !hidden));
}

function send(user, payload) {
  try {
    const query = user.query?.(QUERY, { ...payload, from: game.user.id }, { timeout: 10_000 });
    query?.catch?.(() => {});
  } catch (err) {
    /* an offline user: nothing to do */
  }
}

/**
 * Start sharing a pick made on this client. Always returns a session (a no-op one when sharing is off,
 * there is no canvas, or nobody else is connected), so callers need no checks.
 */
export function sharePick(options = {}) {
  try {
    return startSharing(options);
  } catch (err) {
    // Sharing must never stop the pick itself.
    error("Shared Picks: could not share this pick.", err);
    return quietSession();
  }
}

function quietSession() {
  return { id: `${game.user?.id}.${Date.now().toString(36)}.${++idSeq}`, taken: false, ended: false, onTaken: null, onResult: null, draw() {}, end() {} };
}

function startSharing({ tokens = [], hint = "", takeover = null } = {}) {
  const session = {
    id: `${game.user.id}.${Date.now().toString(36)}.${++idSeq}`,
    tokens,
    taken: false,
    ended: false,
    onTaken: null,
    onResult: null,
    draw() {},
    end() {}
  };
  if (!enabled() || !canvas?.ready || !canvas.scene) return session;
  const scene = canvas.scene.id;
  const users = recipients(tokens);
  if (!users.length) return session;
  const base = { id: session.id, user: game.user.id, scene, tokens };
  // The hint (it may name a creature) and the take over data go to the GMs only.
  for (const u of users) send(u, u.isGM ? { op: "open", ...base, hint, takeover: takeover && !game.user.isGM ? takeover : null } : { op: "open", ...base, hint: "", takeover: null });
  let state = null, timer = null, last = 0;
  const flush = () => {
    timer = null;
    last = Date.now();
    if (session.ended) return;
    for (const u of users) send(u, { op: "state", id: session.id, state });
  };
  session.draw = next => {
    state = next;
    if (session.ended || timer) return;
    const wait = THROTTLE_MS - (Date.now() - last);
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };
  session.end = () => {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(timer);
    own.delete(session.id);
    for (const u of users) send(u, { op: "close", id: session.id });
  };
  own.set(session.id, session);
  return session;
}

/* -------------------------------------------- */
/*  Receiving                                   */
/* -------------------------------------------- */

/** Foundry's query handlers don't get the sender: it is named in the payload (`from`). */
async function onQuery(payload) {
  const sender = game.users.get(payload?.from) ?? null;
  switch (payload?.op) {
    case "open": return void open(payload, sender);
    case "state": return void setState(payload.id, payload.state);
    case "close": return void close(payload.id);
    case "takeover": return takenHere(payload.id, sender);
    case "cancel": return cancelHere(payload.id, sender);
    case "result": return resultHere(payload.id, payload.value, sender);
  }
  return false;
}

function open(payload) {
  close(payload.id);
  if (!enabled()) return;
  watched.set(payload.id, { ...payload, state: null, layer: null, bar: null });
  render(payload.id);
}

function setState(id, state) {
  const w = watched.get(id);
  if (!w) return;
  w.state = state;
  render(id);
}

function close(id) {
  const w = watched.get(id);
  if (!w) return;
  watched.delete(id);
  w.layer?.destroy({ children: true });
  w.bar?.remove();
}

/** Does this client see every token involved (on the scene it is viewing)? */
function sees(w) {
  if (!canvas?.ready || canvas.scene?.id !== w.scene) return false;
  return w.tokens.every(uuid => {
    const doc = docOf(uuid);
    if (!doc) return true; // not a token (nothing to hide)
    if (doc.parent && doc.parent.id !== w.scene) return false;
    if (game.user.isGM) return true;
    const token = doc.object;
    return !doc.hidden && (token ? token.visible !== false : true);
  });
}

function render(id) {
  const w = watched.get(id);
  if (!w) return;
  if (!sees(w)) {
    w.layer?.destroy({ children: true });
    w.layer = null;
    w.bar?.remove();
    w.bar = null;
    return;
  }
  if (!w.layer || w.layer.destroyed) {
    w.layer = new PIXI.Container();
    w.layer.eventMode = "none";
    w.layer.zIndex = 9999;
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(w.layer);
    if (parent.sortableChildren) parent.sortChildren?.();
  }
  w.layer.removeChildren().forEach(c => c.destroy());
  const g = new PIXI.Graphics();
  w.layer.addChild(g);
  drawShapes(g, w.state, { watching: true });
  if (!w.bar && game.user.isGM && w.takeover) w.bar = watchBar(w);
  // v0.90.1 (owner: "Add button to cancel shove for players (currently only GM sees it)"): the player who owns
  // the acting creature (the first token shared) can cancel a pick someone else is making for it.
  else if (!w.bar && !game.user.isGM && ownsActor(w)) w.bar = watchBar(w, { cancelOnly: true });
}

/** Does this user own the creature the pick is for (the first token shared)? */
function ownsActor(w) {
  const doc = docOf(w.tokens?.[0]);
  return !!(doc?.isOwner || doc?.actor?.isOwner);
}

/** The watcher's bar: who is choosing what; Take over (GM) and Cancel (GM, the creature's owner). */
function watchBar(w, { cancelOnly = false } = {}) {
  const bar = document.createElement("div");
  bar.className = "lucd20-pick-bar lucd20-pick-watch";
  const text = document.createElement("span");
  text.textContent = localize("LUCD20.SharedPicks.Watching", { user: game.users.get(w.user)?.name ?? "?", hint: w.hint });
  bar.append(text);
  if (!cancelOnly) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = '<i class="fa-solid fa-hand"></i> ';
    button.append(localize("LUCD20.SharedPicks.TakeOver"));
    button.addEventListener("click", () => takeOver(w.id).catch(err => error("Take over failed.", err)));
    bar.append(button);
  }
  const stop = document.createElement("button");
  stop.type = "button";
  stop.innerHTML = '<i class="fa-solid fa-xmark"></i> ';
  stop.append(localize("LUCD20.SharedPicks.Cancel"));
  stop.addEventListener("click", () => cancelPick(w.id).catch(err => error("Cancel failed.", err)));
  bar.append(stop);
  const hotbar = (document.getElementById("lucd20-hud4e") ?? document.getElementById("hotbar"))?.getBoundingClientRect();
  bar.style.bottom = `${hotbar?.height ? Math.max(8, window.innerHeight - hotbar.top + 12) : 100}px`;
  document.body.append(bar);
  return bar;
}

/* -------------------------------------------- */
/*  Take over                                   */
/* -------------------------------------------- */

/** GM: ask the chooser to hand over, then choose here and send the choice back. */
export async function takeOver(id) {
  const w = watched.get(id);
  if (!w?.takeover || !game.user.isGM) return false;
  const opener = openers.get(w.takeover.type);
  const chooser = game.users.get(w.user);
  if (!opener || !chooser?.active) return false;
  const ok = await chooser.query(QUERY, { op: "takeover", id, from: game.user.id }, { timeout: 10_000 }).catch(() => false);
  if (!ok) return false;
  close(id);
  let value = null;
  try {
    value = await opener(w.takeover.data, { hint: w.hint, share: { tokens: w.tokens } });
  } catch (err) {
    error("Take over: the picker failed.", err);
  }
  await chooser.query(QUERY, { op: "result", id, value: value ?? null, from: game.user.id }, { timeout: 30_000 }).catch(err => error("Take over: the choice could not be sent.", err));
  return true;
}

/** Watcher (the GM, or the creature's owner): ask the chooser to cancel the pick. */
export async function cancelPick(id) {
  const w = watched.get(id);
  const chooser = w ? game.users.get(w.user) : null;
  if (!w || !chooser?.active || !(game.user.isGM || ownsActor(w))) return false;
  const ok = await chooser.query(QUERY, { op: "cancel", id, from: game.user.id }, { timeout: 10_000 }).catch(() => false);
  if (ok) close(id);
  return !!ok;
}

/** Chooser: cancelled by the GM or the creature's owner: the picker closes with nothing chosen. */
function cancelHere(id, sender) {
  const session = own.get(id);
  if (!session || session.ended || !sender) return false;
  const doc = docOf(session.tokens?.[0]);
  const allowed = sender.isGM || !!doc?.testUserPermission?.(sender, "OWNER") || !!doc?.actor?.testUserPermission?.(sender, "OWNER");
  if (!allowed) return false;
  session.end();
  try { session.onTaken?.(); } catch (err) { error("Cancel: closing the picker failed.", err); }
  try { session.onResult?.(null); } catch (err) { error("Cancel: resolving the picker failed.", err); }
  ui.notifications?.info(localize("LUCD20.SharedPicks.Cancelled", { user: sender.name }));
  return true;
}

/** Chooser: the GM takes over. Our picker's UI closes; the choice comes later. */
function takenHere(id, sender) {
  const session = own.get(id);
  if (!session || session.taken || !sender?.isGM) return false;
  session.taken = true;
  session.end();
  try {
    session.onTaken?.();
  } catch (err) {
    error("Take over: closing the picker failed.", err);
  }
  ui.notifications?.info(localize("LUCD20.SharedPicks.Taken", { user: sender.name }));
  session.takenBy = sender.id;
  pending.set(id, session);
  return true;
}

const pending = new Map();

function resultHere(id, value, sender) {
  const session = pending.get(id);
  if (!session || sender?.id !== session.takenBy) return false;
  pending.delete(id);
  session.onResult?.(value);
  return true;
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

/** Draw the shared shapes into a PIXI.Graphics. `watching`: someone else's pick (a little fainter). */
export function drawShapes(g, state, { watching = false } = {}) {
  if (!state) return;
  const k = watching ? 0.75 : 1;
  for (const r of state.rects ?? []) {
    g.lineStyle(r.line ?? 3, r.color, 0.95 * k).beginFill(r.color, (r.fill ?? 0.3) * k).drawRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4).endFill();
  }
  if (state.path?.points?.length > 1) {
    const pts = state.path.points;
    const line = (width, color, alpha) => {
      g.lineStyle(width, color, alpha).moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    };
    line(6, 0x000000, 0.5 * k);
    line(3, state.path.color ?? 0xffffff, 0.95 * k);
    for (const p of pts.slice(1)) g.lineStyle(0).beginFill(0xffffff, 0.95 * k).drawCircle(p.x, p.y, state.path.dot ?? 5).endFill();
  }
  if (state.arrow) drawArrow(g, state.arrow.from, state.arrow.to, state.arrow.head ?? 28, k);
}

/** The white arrow with a dark outline (Shove's hover). */
export function drawArrow(g, from, to, head, k = 1) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  g.lineStyle(9, 0x000000, 0.55 * k).moveTo(from.x, from.y).lineTo(to.x, to.y);
  g.lineStyle(5, 0xffffff, k).moveTo(from.x, from.y).lineTo(to.x, to.y);
  g.lineStyle(2, 0x000000, 0.7 * k).beginFill(0xffffff, k)
    .moveTo(to.x + Math.cos(angle) * head * 0.5, to.y + Math.sin(angle) * head * 0.5)
    .lineTo(to.x - Math.cos(angle - 0.55) * head, to.y - Math.sin(angle - 0.55) * head)
    .lineTo(to.x - Math.cos(angle + 0.55) * head, to.y - Math.sin(angle + 0.55) * head)
    .closePath().endFill();
}

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

/** At init: the query handler (every client), and clean-ups. */
export function initSharedPicks() {
  if (CONFIG.queries) CONFIG.queries[QUERY] = payload => onQuery(payload);
  Hooks.on("canvasTearDown", () => {
    for (const w of watched.values()) {
      w.layer = null;
      w.bar?.remove();
      w.bar = null;
    }
  });
  Hooks.on("canvasReady", () => {
    for (const id of watched.keys()) render(id);
  });
  Hooks.on("userConnected", (user, connected) => {
    if (connected) return;
    for (const [id, w] of [...watched]) if (w.user === user.id) close(id);
  });
  // Visibility changes (a token moves into or out of sight): redraw what is watched.
  Hooks.on("sightRefresh", () => {
    for (const id of watched.keys()) render(id);
  });
}

/** Switched off: nothing watched stays on screen. */
export function clearWatched() {
  for (const id of [...watched.keys()]) close(id);
}

export const _test = { own, watched, pending, onQuery, sees };
