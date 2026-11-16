/**
 * Pick one of a few highlighted squares on the map.
 *
 * pickSquare([{ x, y, width, height, color }], { hint, cancel, from }) → the chosen entry, or null.
 * x / y are scene pixels of the square's top-left; the highlights are drawn above the tokens. A bar
 * near the bottom of the screen says what to do and has a Cancel button; Escape cancels too (a right
 * click does not: it is how the map is dragged). With `from` (a point), hovering a square draws an
 * arrow from that point to it. Clicks on a square are taken before Foundry sees them, so picking
 * never selects or moves a token.
 */
export function pickSquare(squares, { hint = "", cancel = "Cancel", from = null } = {}) {
  return new Promise(resolve => {
    if (!squares.length || !canvas?.ready) return resolve(null);
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
    const hotbar = document.getElementById("hotbar")?.getBoundingClientRect();
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
      if (!square || !from) return;
      const to = { x: square.x + square.width / 2, y: square.y + square.height / 2 };
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.min(square.width, square.height) * 0.28;
      arrow.lineStyle(9, 0x000000, 0.55).moveTo(from.x, from.y).lineTo(to.x, to.y);
      arrow.lineStyle(5, 0xffffff, 1).moveTo(from.x, from.y).lineTo(to.x, to.y);
      arrow.lineStyle(2, 0x000000, 0.7).beginFill(0xffffff, 1)
        .moveTo(to.x + Math.cos(angle) * head * 0.5, to.y + Math.sin(angle) * head * 0.5)
        .lineTo(to.x - Math.cos(angle - 0.55) * head, to.y - Math.sin(angle - 0.55) * head)
        .lineTo(to.x - Math.cos(angle + 0.55) * head, to.y - Math.sin(angle + 0.55) * head)
        .closePath().endFill();
    };
    const done = value => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("keydown", onKey, true);
      layer.destroy({ children: true });
      bar.remove();
      resolve(value);
    };
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
