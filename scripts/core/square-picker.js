import { drawArrow as paintArrow, registerTakeover, sharePick } from "./shared-pick.js";

/**
 * Pick one of a few highlighted squares on the map.
 *
 * pickSquare([{ x, y, width, height, color }], { hint, cancel, from }) → the chosen entry, or null.
 * x / y are scene pixels of the square's top-left; the highlights are drawn above the tokens. A bar
 * near the bottom of the screen says what to do and has a Cancel button; Escape cancels too (a right
 * click does not: it is how the map is dragged). With `from` (a point), hovering a square draws an
 * arrow from that point to it. Clicks on a square are taken before Foundry sees them, so picking
 * never selects or moves a token.
 *
 * `share: { tokens }` (token uuids involved): everyone else sees the squares and the arrow live, and the GM
 * can take over (core/shared-pick.js); the GM's choice resolves this promise as if clicked here.
 */
export function pickSquare(squares, { hint = "", cancel = "Cancel", from = null, share = null } = {}) {
  return new Promise(resolve => {
    if (!squares.length || !canvas?.ready) return resolve(null);
    const session = share ? sharePick({ tokens: share.tokens ?? [], hint, takeover: share.noTakeover ? null : { type: "square", data: { squares: squares.map(plain), hint, cancel, from } } }) : null;
    const shapes = () => ({ rects: squares.map(s => ({ x: s.x, y: s.y, w: s.width, h: s.height, color: s.color, fill: 0.35 })), arrow: hovered && from ? { from, to: centre(hovered), head: Math.min(hovered.width, hovered.height) * 0.28 } : null });
    const layer = new PIXI.Container();
    layer.eventMode = "none";
    layer.zIndex = 10000;
    for (const s of squares) {
      const box = new PIXI.Graphics();
      box.lineStyle(3, s.color, 0.95).beginFill(s.color, 0.35).drawRect(s.x + 2, s.y + 2, s.width - 4, s.height - 4).endFill();
      layer.addChild(box);
    }
    const arrow = new PIXI.Graphics();
    layer.addChild(arrow);
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(layer);
    if (parent.sortableChildren) parent.sortChildren?.();

    const bar = document.createElement("div");
    bar.className = "lucd20-pick-bar";
    const text = document.createElement("span");
    text.textContent = hint;
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = '<i class="fa-solid fa-xmark"></i> ';
    button.append(cancel);
    bar.append(text, button);
    const hotbar = (document.getElementById("lucd20-hud4e") ?? document.getElementById("hotbar"))?.getBoundingClientRect();
    bar.style.bottom = `${hotbar?.height ? Math.max(8, window.innerHeight - hotbar.top + 12) : 100}px`;
    document.body.append(bar);

    const view = canvas.app?.view ?? document.body;
    const at = event => {
      const rect = view.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const point = canvas.stage?.worldTransform?.applyInverse
        ? canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top))
        : { x: event.clientX, y: event.clientY };
      return squares.find(s => point.x >= s.x && point.x < s.x + s.width && point.y >= s.y && point.y < s.y + s.height) ?? null;
    };
    const overUI = event => !!event.target.closest?.(".application, #sidebar, #ui-left, #hotbar, .lucd20-pick-bar");
    let hovered = null;
    const drawArrow = square => {
      if (square === hovered) return;
      hovered = square;
      arrow.clear();
      session?.draw(shapes());
      if (!square || !from) return;
      paintArrow(arrow, from, centre(square), Math.min(square.width, square.height) * 0.28);
    };
    session?.draw(shapes());
    let closed = false;
    const closeUI = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("keydown", onKey, true);
      layer.destroy({ children: true });
      bar.remove();
    };
    const done = value => {
      closeUI();
      session?.end();
      resolve(value);
    };
    if (session) {
      session.onTaken = closeUI;
      session.onResult = index => resolve(Number.isInteger(index) ? squares[index] ?? null : null);
    }
    const swallow = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    function onDown(event) {
      if (event.button !== 0 || overUI(event)) return; // windows and the bar stay usable
      const square = at(event);
      if (!square) return;
      swallow(event);
      done(square);
    }
    function onMove(event) {
      drawArrow(overUI(event) ? null : at(event));
    }
    function onKey(event) {
      if (event.key !== "Escape") return;
      swallow(event);
      done(null);
    }
    button.addEventListener("click", () => done(null));
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Pick up to `max` of a few highlighted areas (tokens, squares) on the map: a click toggles one (it turns
 * blue), the bar's confirm button (or Enter) ends the choice; Cancel or Escape gives null. Entries
 * [{ x, y, width, height, color, value }]; resolves the chosen entries' values, in click order.
 * `preselected`: values chosen to begin with. `auto`: a click that reaches `max` ends the choice at once.
 */
export function pickSeveral(entries, { max = 2, hint = "", confirm = "OK", cancel = "Cancel", preselected = [], auto = false, share = null, autoConfirmMs = 0, countdown = "" } = {}) {
  return new Promise(resolve => {
    if (!entries.length || !canvas?.ready) return resolve(null);
    const CHOSEN = 0x3b82f6;
    const session = share ? sharePick({ tokens: share.tokens ?? [], hint, takeover: share.noTakeover ? null : { type: "several", data: { entries: entries.map(plain), max, hint, confirm, cancel, preselected, auto } } }) : null;
    const layer = new PIXI.Container();
    layer.eventMode = "none";
    layer.zIndex = 10000;
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(layer);
    if (parent.sortableChildren) parent.sortChildren?.();
    const chosen = entries.filter(e => preselected.includes(e.value)).slice(0, max);
    const draw = () => {
      layer.removeChildren().forEach(c => c.destroy());
      for (const e of entries) {
        const on = chosen.includes(e);
        const color = on ? CHOSEN : e.color;
        const box = new PIXI.Graphics();
        box.lineStyle(on ? 4 : 3, color, 0.95).beginFill(color, on ? 0.4 : 0.25).drawRect(e.x + 2, e.y + 2, e.width - 4, e.height - 4).endFill();
        layer.addChild(box);
      }
      session?.draw({ rects: entries.map(e => { const on = chosen.includes(e); return { x: e.x, y: e.y, w: e.width, h: e.height, color: on ? CHOSEN : e.color, fill: on ? 0.4 : 0.25, line: on ? 4 : 3 }; }) });
    };
    draw();

    const bar = document.createElement("div");
    bar.className = "lucd20-pick-bar";
    const text = document.createElement("span");
    const ok = document.createElement("button");
    ok.type = "button";
    const no = document.createElement("button");
    no.type = "button";
    no.innerHTML = '<i class="fa-solid fa-xmark"></i> ';
    no.append(cancel);
    // v0.90.1 (owner, Demoralizing Charge: "gives the choice normally but automatically selects after 3 seconds"):
    // with something preselected and `autoConfirmMs`, a countdown confirms it; any click or key stops it.
    let left = autoConfirmMs && chosen.length ? Math.ceil(autoConfirmMs / 1000) : 0, timer = null;
    const stopCountdown = () => { if (timer) { clearInterval(timer); timer = null; left = 0; label(); } };
    const label = () => {
      text.textContent = `${hint} (${chosen.length}/${max})${left > 0 && countdown ? ` · ${countdown.replace("{n}", left)}` : ""}`;
      ok.innerHTML = '<i class="fa-solid fa-flag"></i> ';
      ok.append(confirm);
      ok.disabled = !chosen.length;
    };
    label();
    bar.append(text, ok, no);
    const hotbar = (document.getElementById("lucd20-hud4e") ?? document.getElementById("hotbar"))?.getBoundingClientRect();
    bar.style.bottom = `${hotbar?.height ? Math.max(8, window.innerHeight - hotbar.top + 12) : 100}px`;
    document.body.append(bar);

    const view = canvas.app?.view ?? document.body;
    const at = event => {
      const rect = view.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const point = canvas.stage?.worldTransform?.applyInverse
        ? canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top))
        : { x: event.clientX, y: event.clientY };
      return entries.find(e => point.x >= e.x && point.x < e.x + e.width && point.y >= e.y && point.y < e.y + e.height) ?? null;
    };
    const overUI = event => !!event.target.closest?.(".application, #sidebar, #ui-left, #hotbar, .lucd20-pick-bar");
    let closed = false;
    const closeUI = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("pointerdown", stopOnAny, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      layer.destroy({ children: true });
      bar.remove();
    };
    const done = value => {
      closeUI();
      session?.end();
      resolve(value);
    };
    if (session) {
      session.onTaken = closeUI;
      session.onResult = values => resolve(Array.isArray(values) ? values.filter(v => entries.some(e => e.value === v)) : null);
    }
    function onDown(event) {
      if (event.button !== 0 || overUI(event)) return;
      const entry = at(event);
      if (!entry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const i = chosen.indexOf(entry);
      if (i >= 0) chosen.splice(i, 1);
      else if (chosen.length < max) chosen.push(entry);
      if (auto && i < 0 && chosen.length === max) return done(chosen.map(e => e.value));
      draw();
      label();
    }
    function onKey(event) {
      if (event.key === "Enter" && chosen.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return done(chosen.map(e => e.value));
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      done(null);
    }
    ok.addEventListener("click", () => done(chosen.map(e => e.value)));
    no.addEventListener("click", () => done(null));
    function stopOnAny() { stopCountdown(); }
    window.addEventListener("pointerdown", stopOnAny, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    if (left > 0) {
      window.addEventListener("keydown", stopOnAny, { capture: true, once: true });
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) { clearInterval(timer); timer = null; if (chosen.length) return done(chosen.map(e => e.value)); }
        label();
      }, 1000);
    }
  });
}

/* -------------------------------------------- */
/*  Shared picks: what is sent, the GM's side   */
/* -------------------------------------------- */

const centre = s => ({ x: s.x + s.width / 2, y: s.y + s.height / 2 });

/** An entry without functions or class instances, to send. */
function plain(e) {
  const out = {};
  for (const [k, v] of Object.entries(e)) if (["string", "number", "boolean"].includes(typeof v) || v === null) out[k] = v;
  return out;
}

// The GM took over: the same picker here (shared with the others, no second take over); the choice goes back
// as an index (squares) or the chosen values (several).
registerTakeover("square", async ({ squares, hint, cancel, from }, { share }) => {
  const choice = await pickSquare(squares, { hint, cancel, from, share: { ...share, noTakeover: true } });
  return choice ? squares.indexOf(choice) : null;
});
registerTakeover("several", async ({ entries, ...opts }, { share }) => pickSeveral(entries, { ...opts, share: { ...share, noTakeover: true } }));
