import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Pathfinding (replaces Wayfinder). Square grids only (Q27).
 *
 * While dragging a token, Foundry's ruler shows the cheapest route around
 * walls and closed doors instead of a straight line; your own waypoints are
 * kept and each leg is routed. One wrap: `findMovementPath` on the token
 * class (V14's async { result, promise, cancel } contract, as Wayfinder uses).
 *
 * Cost of a route (owner's rules, Q29):
 * - steps per the scene's diagonal rule (PF2e 5/10/5 included);
 * - difficult terrain (regions with a movement-cost behaviour) costs what it
 *   costs, so a route around it wins when it's better — hold **T** while
 *   dragging to ignore terrain;
 * - squares next to a visible enemy count as threatened (no reach or
 *   reaction checks, on purpose): passing through them costs extra, so a
 *   route around them wins when there is one — hold **Q** to ignore threats.
 *   The destination itself is never penalised.
 * - Players only route through explored or currently visible areas (Q28),
 *   so a route can't reveal unexplored corridors. The GM routes anywhere.
 *
 * Off on gridless/hex scenes and when Foundry asks to ignore walls or cost.
 * Per-player toggle in Token controls (Q26), on by default.
 * Plain JavaScript A* (binary heap); walls in a bucket grid rebuilt when
 * walls change. Wayfinder (MIT) was the reference for the contract.
 */

const ACTIVE_KEY = "pathfindingActive";
const THREAT_COST = 4; // extra squares for stepping through a threatened square
const MAX_NODES = 60000;
const state = { feature: null, versions: 0, context: null };

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

const keyDown = code => !!game.keyboard?.downKeys?.has?.(code);

function isActive() {
  return state.feature?.active && game.settings.get(MODULE_ID, ACTIVE_KEY);
}

function squareGrid() {
  const grid = canvas?.grid;
  if (!grid || grid.isGridless) return false;
  if (grid.isSquare !== undefined) return grid.isSquare;
  return grid.type === CONST.GRID_TYPES?.SQUARE;
}

class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Does the move p→q cross wall c = [x0, y0, x1, y1]? A wall end lying on the
 * move counts too, so a diagonal can't slip through the corner where two
 * walls meet.
 */
function segmentsCross(p, q, c) {
  const a = { x: c[0], y: c[1] };
  const b = { x: c[2], y: c[3] };
  const o = (p1, p2, p3) => (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const d1 = o(a, b, p);
  const d2 = o(a, b, q);
  const d3 = o(p, q, a);
  const d4 = o(p, q, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const within = r => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d3 === 0 && within(a)) || (d4 === 0 && within(b));
}

/* -------------------------------------------- */
/*  What the search needs (cached per drag)     */
/* -------------------------------------------- */

function wallIndex(size) {
  const buckets = new Map();
  const M = CONST.WALL_MOVEMENT_TYPES ?? { NONE: 0 };
  const S = CONST.WALL_DOOR_STATES ?? { OPEN: 1 };
  for (const wall of canvas.walls?.placeables ?? []) {
    const d = wall.document;
    if (d.move === M.NONE) continue;
    if (d.door && d.ds === S.OPEN) continue;
    const c = d.c;
    const [i0, i1] = [Math.floor(Math.min(c[0], c[2]) / size), Math.floor(Math.max(c[0], c[2]) / size)];
    const [j0, j1] = [Math.floor(Math.min(c[1], c[3]) / size), Math.floor(Math.max(c[1], c[3]) / size)];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i},${j}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
  }
  return (p, q) => {
    const [i0, i1] = [Math.floor(Math.min(p.x, q.x) / size), Math.floor(Math.max(p.x, q.x) / size)];
    const [j0, j1] = [Math.floor(Math.min(p.y, q.y) / size), Math.floor(Math.max(p.y, q.y) / size)];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const c of buckets.get(`${i},${j}`) ?? []) if (segmentsCross(p, q, c)) return true;
    }
    return false;
  };
}

/** Movement cost multiplier of a region behaviour, or 1. */
function behaviourCost(behaviour, action) {
  if (behaviour.disabled) return 1;
  const sys = behaviour.system ?? {};
  if (/movementcost/i.test(behaviour.type ?? "")) {
    const d = sys.difficulties ?? {};
    const v = Number(d[action] ?? d.walk ?? Math.max(1, ...Object.values(d).map(Number).filter(Number.isFinite)));
    return Number.isFinite(v) && v > 1 ? v : 1;
  }
  // System behaviours (e.g. PF2e environments) that mark difficult terrain.
  if (sys.difficult === true || sys.difficultTerrain === true) return sys.greater ? 3 : 2;
  if (typeof sys.terrain === "string" && /difficult/i.test(sys.terrain)) return /greater/i.test(sys.terrain) ? 3 : 2;
  return 1;
}

function terrainGrid(doc, size) {
  const costs = new Map();
  const action = doc.movementAction ?? "walk";
  for (const region of canvas.regions?.placeables ?? canvas.scene?.regions ?? []) {
    const rdoc = region.document ?? region;
    const mult = Math.max(1, ...[...(rdoc.behaviors ?? [])].map(b => behaviourCost(b, action)));
    if (mult <= 1) continue;
    const bounds = region.bounds ?? rdoc.bounds;
    if (!bounds) continue;
    const elevation = doc.elevation ?? 0;
    for (let x = Math.floor(bounds.x / size) * size; x < bounds.x + bounds.width; x += size) {
      for (let y = Math.floor(bounds.y / size) * size; y < bounds.y + bounds.height; y += size) {
        const point = { x: x + size / 2, y: y + size / 2, elevation };
        let inside = false;
        try {
          inside = region.testPoint?.(point, elevation) ?? rdoc.testPoint?.(point) ?? false;
        } catch {
          inside = false;
        }
        if (!inside) continue;
        const k = `${Math.floor(x / size)},${Math.floor(y / size)}`;
        costs.set(k, Math.max(costs.get(k) ?? 1, mult));
      }
    }
  }
  return costs;
}

function isDown(token) {
  const statuses = token.actor?.statuses;
  return !!(statuses?.has?.("dead") || statuses?.has?.("unconscious") || token.combatant?.isDefeated);
}

/** Squares next to visible enemies (only tokens this user can see: nothing leaks). */
function threatGrid(mover, size) {
  const set = new Set();
  const D = CONST.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, HOSTILE: -1 };
  const mine = mover.document.disposition;
  const enemy = mine === D.FRIENDLY ? D.HOSTILE : mine === D.HOSTILE ? D.FRIENDLY : null;
  if (enemy === null) return set;
  for (const t of canvas.tokens?.placeables ?? []) {
    if (t === mover || !t.visible || t.document.disposition !== enemy || isDown(t)) continue;
    const i0 = Math.floor(t.document.x / size);
    const j0 = Math.floor(t.document.y / size);
    for (let i = i0 - 1; i <= i0 + t.document.width; i++) for (let j = j0 - 1; j <= j0 + t.document.height; j++) set.add(`${i},${j}`);
  }
  return set;
}

/** Players: is this point explored (fog) or visible right now? */
function exploredTester() {
  const visible = p => {
    try {
      return !!canvas.visibility?.testVisibility?.(p, { tolerance: 2 });
    } catch {
      return false;
    }
  };
  if (game.user.isGM || !state.feature?.get("exploredOnly")) return () => true;
  const fog = canvas.fog;
  const exploration = fog?.fogExploration ?? canvas.scene?.fog?.exploration ?? canvas.scene?.fogExploration;
  const tokenVision = canvas.visibility?.tokenVision ?? canvas.scene?.tokenVision;
  if (!exploration || !tokenVision) return () => true;
  if (typeof fog?.isPointExplored === "function") return p => fog.isPointExplored(p) || visible(p);
  // Read the explored texture once (same approach as Wayfinder).
  try {
    const sprite = fog.sprite;
    const renderer = canvas.app.renderer;
    const Canvas = foundry.canvas?.Canvas;
    const rt = Canvas?.getRenderTexture
      ? Canvas.getRenderTexture({ clearColor: [0, 0, 0, 1], textureConfiguration: fog.textureConfiguration })
      : PIXI.RenderTexture.create({ width: sprite.width, height: sprite.height });
    renderer.render(sprite, { renderTexture: rt, transform: new PIXI.Matrix(1, 0, 0, 1, -sprite.x, -sprite.y) });
    const pixels = renderer.extract.pixels(rt);
    const width = rt.realWidth ?? Math.round(rt.width * rt.resolution);
    const height = rt.realHeight ?? Math.round(rt.height * rt.resolution);
    rt.destroy(true);
    const rect = canvas.dimensions.sceneRect;
    const res = width / rect.width;
    return p => {
      const x = Math.floor((p.x - rect.x) * res);
      const y = Math.floor((p.y - rect.y) * res);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        if (pixels[(yy * width + xx) * 4] > 0) return true;
      }
      return visible(p);
    };
  } catch (err) {
    console.warn(`${MODULE_ID} | Pathfinding: could not read explored areas, using what's visible now.`, err);
    return visible;
  }
}

function context(token) {
  const size = canvas.grid.size;
  const flags = `${keyDown("KeyQ")}|${keyDown("KeyT")}`;
  const key = `${canvas.scene?.id}|${token.id}|${state.versions}|${flags}`;
  const now = Date.now();
  if (state.context?.key === key && now - state.context.time < 1500) return state.context;
  const feature = state.feature;
  state.context = {
    key,
    time: now,
    size,
    blocked: wallIndex(size),
    terrain: feature.get("avoidTerrain") && !keyDown("KeyT") ? terrainGrid(token.document, size) : new Map(),
    threats: feature.get("avoidThreats") && !keyDown("KeyQ") ? threatGrid(token, size) : new Set(),
    explored: exploredTester(),
    rect: canvas.dimensions.sceneRect
  };
  return state.context;
}

/* -------------------------------------------- */
/*  A*                                          */
/* -------------------------------------------- */

function diagonalRule() {
  const D = CONST.GRID_DIAGONALS ?? {};
  const rule = canvas.grid.diagonals;
  if (rule === D.ALTERNATING_1) return (odd) => (odd ? 2 : 1);
  if (rule === D.ALTERNATING_2) return (odd) => (odd ? 1 : 2);
  if (rule === D.EXACT || rule === D.APPROXIMATE) return () => Math.SQRT2;
  if (rule === D.RECTILINEAR || rule === D.MANHATTAN) return () => 2;
  if (rule === D.ILLEGAL) return null;
  return () => 1;
}

/** Cheapest route from cell a to cell b for a w×h token. Returns cells or null. */
function route(ctx, from, to, w, h, startOdd) {
  const { size, rect } = ctx;
  const diag = diagonalRule();
  const minI = Math.floor(rect.x / size);
  const minJ = Math.floor(rect.y / size);
  const maxI = Math.floor((rect.x + rect.width) / size) - w;
  const maxJ = Math.floor((rect.y + rect.height) / size) - h;
  const centre = (i, j) => ({ x: (i + w / 2) * size, y: (j + h / 2) * size });
  const cells = (i, j) => {
    const out = [];
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) out.push(`${i + a},${j + b}`);
    return out;
  };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (diag) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  const heuristic = (i, j) => Math.max(Math.abs(i - to.i), Math.abs(j - to.j));
  const startKey = `${from.i},${from.j},${startOdd ? 1 : 0}`;
  const open = new Heap();
  const best = new Map([[startKey, 0]]);
  const parent = new Map();
  open.push({ i: from.i, j: from.j, odd: !!startOdd, g: 0, f: heuristic(from.i, from.j), key: startKey });
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur.g > (best.get(cur.key) ?? Infinity)) continue;
    if (cur.i === to.i && cur.j === to.j) {
      const out = [];
      for (let k = cur.key; k; k = parent.get(k)) {
        const [i, j] = k.split(",").map(Number);
        out.push({ i, j });
      }
      return out.reverse();
    }
    if (++expanded > MAX_NODES) return null;
    const p = centre(cur.i, cur.j);
    for (const [di, dj] of dirs) {
      const i = cur.i + di;
      const j = cur.j + dj;
      if (i < minI || j < minJ || i > maxI || j > maxJ) continue;
      const q = centre(i, j);
      if (ctx.blocked(p, q)) continue;
      const isGoal = i === to.i && j === to.j;
      if (!isGoal && !ctx.explored(q)) continue;
      const isDiag = di && dj;
      let step = isDiag ? diag(cur.odd) : 1;
      const odd = isDiag ? !cur.odd : cur.odd;
      const footprint = cells(i, j);
      let mult = 1;
      for (const c of footprint) mult = Math.max(mult, ctx.terrain.get(c) ?? 1);
      // A little extra on difficult squares: of two equally costly routes, the one that avoids them wins.
      if (mult > 1) step = step * mult + 0.25;
      if (!isGoal && footprint.some(c => ctx.threats.has(c))) step += THREAT_COST;
      const g = cur.g + step;
      const key = `${i},${j},${odd ? 1 : 0}`;
      if (g >= (best.get(key) ?? Infinity)) continue;
      best.set(key, g);
      parent.set(key, cur.key);
      open.push({ i, j, odd, g, f: g + heuristic(i, j), key });
    }
  }
  return null;
}

/** Keep only the cells where the direction changes. */
function simplify(path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  for (let k = 1; k < path.length - 1; k++) {
    const a = path[k - 1];
    const b = path[k];
    const c = path[k + 1];
    if (b.i - a.i !== c.i - b.i || b.j - a.j !== c.j - b.j) out.push(b);
  }
  out.push(path.at(-1));
  return out;
}

/* -------------------------------------------- */
/*  Foundry's findMovementPath                  */
/* -------------------------------------------- */

function fullWaypoints(doc, waypoints) {
  let prev = {
    x: doc.x,
    y: doc.y,
    elevation: doc.elevation,
    width: doc.width,
    height: doc.height,
    shape: doc.shape,
    action: doc.movementAction ?? "walk",
    snapped: false,
    explicit: false,
    checkpoint: false
  };
  if (doc.level !== undefined) prev.level = doc.level;
  return waypoints.map(w => (prev = { ...prev, ...w }));
}

function solve(token, waypoints, options) {
  const doc = token.document;
  const ctx = context(token);
  const size = ctx.size;
  const full = fullWaypoints(doc, waypoints);
  const cellOf = w => ({ i: Math.round(w.x / size), j: Math.round(w.y / size) });
  let odd = false;
  try {
    const history = options?.constrainOptions?.history;
    if (history) {
      const measured = doc.measureMovementPath?.(Array.isArray(history) ? history : doc.movementHistory ?? []);
      odd = (measured?.diagonals ?? 0) % 2 === 1;
    }
  } catch {
    odd = false;
  }
  const out = [waypoints[0]];
  for (let k = 1; k < full.length; k++) {
    const a = full[k - 1];
    const b = full[k];
    if (a.level !== b.level || a.width !== b.width || a.height !== b.height) return null;
    const cells = route(ctx, cellOf(a), cellOf(b), Math.max(1, Math.round(a.width)), Math.max(1, Math.round(a.height)), odd);
    if (!cells) return null;
    for (const c of simplify(cells).slice(1, -1)) {
      out.push({ ...a, x: c.i * size, y: c.j * size, snapped: true, explicit: false, checkpoint: true });
    }
    out.push(waypoints[k]);
    // Diagonal parity carries on (PF2e 5/10/5).
    for (let n = 1; n < cells.length; n++) if (cells[n].i !== cells[n - 1].i && cells[n].j !== cells[n - 1].j) odd = !odd;
  }
  return out;
}

defineFeature({
  id: "pathfinding",
  category: "tokens",
  scope: "world",
  defaultEnabled: false,
  settings: {
    avoidTerrain: { kind: "boolean", default: true },
    avoidThreats: { kind: "boolean", default: true },
    exploredOnly: { kind: "boolean", default: true }
  },

  init() {
    game.settings.register(MODULE_ID, ACTIVE_KEY, { scope: "client", config: false, type: Boolean, default: true });
    // Per-player toggle in Token controls (V13+ object shape).
    Hooks.on("getSceneControlButtons", controls => {
      if (!state.feature?.active) return;
      const tokens = controls.tokens ?? controls.token;
      if (!tokens?.tools || Array.isArray(tokens.tools)) return;
      tokens.tools.lucd20Pathfinding = {
        name: "lucd20Pathfinding",
        order: 50,
        title: "LUCD20.Pathfinding.Tool",
        icon: "fa-solid fa-route",
        toggle: true,
        active: game.settings.get(MODULE_ID, ACTIVE_KEY),
        onChange: (event, active) => {
          if (active !== undefined) game.settings.set(MODULE_ID, ACTIVE_KEY, active);
        }
      };
    });
  },

  enable(feature) {
    state.feature = feature;
    const TokenClass = CONFIG.Token.objectClass;
    if (typeof TokenClass?.prototype?.findMovementPath !== "function") {
      console.warn(`${MODULE_ID} | Pathfinding: Token#findMovementPath not found.`);
      return;
    }
    feature.wrap(TokenClass.prototype, "findMovementPath", function (original, waypoints, options) {
      const c = options?.constrainOptions;
      if (!isActive() || !squareGrid() || c?.ignoreWalls || c?.ignoreCost || !Array.isArray(waypoints) || waypoints.length < 2) {
        return original(waypoints, options);
      }
      let cancelled = false;
      const token = this;
      const promise = new Promise(resolve => {
        setTimeout(() => {
          if (cancelled) return resolve(null);
          let path = null;
          try {
            path = solve(token, waypoints, options);
          } catch (err) {
            console.error(`${MODULE_ID} | Pathfinding failed.`, err);
          }
          if (path) return resolve(path);
          // No route found (or an error): Foundry's own result.
          const fallback = original(waypoints, options);
          resolve(fallback?.result ?? fallback?.promise ?? null);
        }, 0);
      });
      return { result: undefined, promise, cancel: () => (cancelled = true) };
    });
    const bump = () => (state.versions++, (state.context = null));
    for (const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
      "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "createToken", "updateToken", "deleteToken", "canvasReady", "sightRefresh"]) {
      feature.on(hook, bump);
    }
    ui.controls?.render?.();
    feature.onCleanup(() => {
      state.context = null;
      ui.controls?.render?.();
    });
  },

  onSettingChange() {
    state.context = null;
  }
});

export { solve as _solveForTests, route as _routeForTests };
