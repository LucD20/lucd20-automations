/**
 * Finding a free place for a token: shared by Folder Drop and Loot Pile.
 * A spot is free when it is inside the scene, overlaps no token (hidden ones
 * included) and, on the viewed scene, is not across a wall from the origin.
 */

function gridSize(scene) {
  return scene?.grid?.size ?? canvas.dimensions?.size ?? 100;
}

function isGridless(scene) {
  if ((!scene || scene === canvas.scene) && typeof canvas.grid?.isGridless === "boolean") return canvas.grid.isGridless;
  const type = scene?.grid?.type ?? canvas.grid?.type;
  return type !== undefined && type === CONST.GRID_TYPES?.GRIDLESS;
}

/** Top-left position for a token of w×h centred near a point, snapped to the grid. */
export function snapTopLeft(point, w, h, scene = canvas.scene) {
  const size = gridSize(scene);
  if (isGridless(scene)) return { x: Math.round(point.x - w / 2), y: Math.round(point.y - h / 2) };
  return { x: Math.round((point.x - w / 2) / size) * size, y: Math.round((point.y - h / 2) / size) * size };
}

/** Rectangles of every token on the scene. */
export function occupiedRects(scene = canvas.scene, { exclude = [] } = {}) {
  const size = gridSize(scene);
  let tokens = scene?.tokens ? [...scene.tokens] : (canvas.tokens?.placeables ?? []).map(t => t.document);
  if (exclude.length) tokens = tokens.filter(t => !exclude.includes(t.id));
  return tokens.map(t => ({ x: t.x, y: t.y, w: t.width * size, h: t.height * size }));
}

export function overlaps(rects, x, y, w, h) {
  const e = 1;
  return rects.some(r => x < r.x + r.w - e && x + w > r.x + e && y < r.y + r.h - e && y + h > r.y + e);
}

function insideScene(x, y, w, h, scene) {
  const dims = scene === canvas.scene || !scene?.dimensions ? canvas.dimensions : scene.dimensions;
  const r = dims.sceneRect ?? { x: 0, y: 0, width: dims.width, height: dims.height };
  return x >= r.x && y >= r.y && x + w <= r.x + r.width && y + h <= r.y + r.height;
}

function blockedByWall(from, to, scene) {
  if (scene && canvas.scene && scene !== canvas.scene) return false; // walls are only known for the viewed scene
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  if (!backend?.testCollision) return false;
  try {
    return !!backend.testCollision(from, to, { type: "move", mode: "any" });
  } catch {
    return false;
  }
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Free top-left spot for a w×h token near `origin`, searching rings of grid
 * cells outward. `random`: random order within each ring (scatter); otherwise
 * the closest cell first. Returns null when nothing is free within 15 rings.
 */
export function findFreeSpot(origin, w, h, { occupied, scene = canvas.scene, random = false } = {}) {
  occupied ??= occupiedRects(scene);
  const size = gridSize(scene);
  const base = snapTopLeft(origin, w, h, scene);
  for (let ring = 0; ring <= 15; ring++) {
    const cells = [];
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) cells.push({ dx, dy });
      }
    }
    if (random) shuffle(cells);
    else cells.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    for (const { dx, dy } of cells) {
      const x = base.x + dx * size;
      const y = base.y + dy * size;
      if (!insideScene(x, y, w, h, scene) || overlaps(occupied, x, y, w, h)) continue;
      if (blockedByWall(origin, { x: x + w / 2, y: y + h / 2 }, scene)) continue;
      return { x, y };
    }
  }
  return null;
}
