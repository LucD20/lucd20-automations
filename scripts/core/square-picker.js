/**
 * Pick one of a few highlighted squares on the map.
 *
 * pickSquare([{ x, y, width, height, color }]) → the chosen entry, or null (right click, Escape).
 * x / y are scene pixels of the square's top-left; the highlights are drawn above the tokens and a
 * small bar at the top says what to do. Clicks are taken before Foundry sees them, so picking a
 * square never selects or moves a token.
 */
export function pickSquare(squares, { hint = "" } = {}) {
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
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(layer);
    if (parent.sortableChildren) parent.sortChildren?.();

    let bar = null;
    if (hint) {
      bar = document.createElement("div");
      bar.className = "lucd20-pick-bar";
      bar.textContent = hint;
      document.body.append(bar);
    }
    const view = canvas.app?.view ?? document.body;
    const at = event => {
      const rect = view.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const point = canvas.stage?.worldTransform?.applyInverse
        ? canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top))
        : { x: event.clientX, y: event.clientY };
      return squares.find(s => point.x >= s.x && point.x < s.x + s.width && point.y >= s.y && point.y < s.y + s.height) ?? null;
    };
    const done = value => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onMenu, true);
      window.removeEventListener("keydown", onKey, true);
      layer.destroy({ children: true });
      bar?.remove();
      resolve(value);
    };
    const swallow = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    function onDown(event) {
      if (event.button !== 0 || event.target.closest?.(".application, #sidebar, #ui-left, #hotbar")) return; // windows stay usable
      const square = at(event);
      if (!square) return;
      swallow(event);
      done(square);
    }
    function onMenu(event) {
      swallow(event);
      done(null);
    }
    function onKey(event) {
      if (event.key !== "Escape") return;
      swallow(event);
      done(null);
    }
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onMenu, true);
    window.addEventListener("keydown", onKey, true);
  });
}
