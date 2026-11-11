import { MODULE_ID, localize } from "../../core/constants.js";
import { blockedBySight, pixelsPerUnit, RANKS } from "./search-engine.js";

/**
 * The two kinds of things that can be found, behind one interface:
 *   { kind, id, doc, label, dc, minRank, note, found, failed, enabled, range,
 *     centre, save(patch), contains(point) }
 *
 * - Hazard: a hazard token. Its settings live in the token's flags; missing
 *   values come from the feature defaults and the hazard's Stealth (DC and
 *   "(expert)" etc. for the minimum proficiency). Its area spreads from the
 *   token's edge and is blocked by walls.
 * - Region: a search spot drawn with the "Place search spot" tool. Its
 *   settings live in the Region's flags.
 */

export const HAZARD_FLAG = "hazardSearch";
export const REGION_FLAG = "searchSpot";

/** "(expert)" in a hazard's Stealth details → 2. */
export function parseRank(details) {
  const match = String(details ?? "").match(/\b(trained|expert|master|legendary)\b/i);
  return match ? RANKS.indexOf(match[1].toLowerCase()) : 0;
}

function tokenCentre(doc) {
  const size = canvas.dimensions.size;
  return { x: doc.x + (doc.width * size) / 2, y: doc.y + (doc.height * size) / 2 };
}

/* -------------------------------------------- */
/*  Hazards                                     */
/* -------------------------------------------- */

export function hazardSpot(tokenDoc, defaults) {
  const actor = tokenDoc?.actor;
  if (actor?.type !== "hazard") return null;
  const flags = tokenDoc.getFlag(MODULE_ID, HAZARD_FLAG) ?? {};
  const stealth = actor.system?.attributes?.stealth;
  const dc = Number.isFinite(flags.dc) ? flags.dc : Number.isFinite(stealth?.dc) ? stealth.dc : null;
  const spot = {
    kind: "hazard",
    id: tokenDoc.uuid,
    doc: tokenDoc,
    label: tokenDoc.name ?? actor.name,
    enabled: flags.enabled ?? defaults.autoEnable,
    range: Number.isFinite(flags.range) ? flags.range : defaults.defaultRange,
    dc,
    minRank: Number.isFinite(flags.minRank) ? flags.minRank : parseRank(stealth?.details),
    note: flags.note ?? "",
    found: !!flags.found,
    failed: flags.failed ?? [],
    rolls: flags.rolls ?? {},
    get centre() {
      return tokenCentre(tokenDoc);
    },
    /** Only the changed fields are sent; Foundry merges them into the stored flags. */
    async save(patch) {
      await tokenDoc.update({ [`flags.${MODULE_ID}.${HAZARD_FLAG}`]: patch });
    },
    /** Inside the area: within range of the token's edge, and not behind a wall. */
    contains(point) {
      const size = canvas.dimensions.size;
      const left = tokenDoc.x;
      const top = tokenDoc.y;
      const right = left + tokenDoc.width * size;
      const bottom = top + tokenDoc.height * size;
      if (spot.range > 0) {
        const dx = Math.max(left - point.x, 0, point.x - right);
        const dy = Math.max(top - point.y, 0, point.y - bottom);
        if (Math.hypot(dx, dy) > spot.range * pixelsPerUnit()) return false;
      }
      return !blockedBySight(tokenCentre(tokenDoc), point);
    }
  };
  return spot;
}

/* -------------------------------------------- */
/*  Regions                                     */
/* -------------------------------------------- */

/** Point inside one Region shape (rectangle, ellipse/circle, polygon), ignoring holes. */
function inShape(shape, p) {
  switch (shape.type) {
    case "rectangle": {
      const r = (-(shape.rotation ?? 0) * Math.PI) / 180;
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const x = Math.cos(r) * (p.x - cx) - Math.sin(r) * (p.y - cy) + cx;
      const y = Math.sin(r) * (p.x - cx) + Math.cos(r) * (p.y - cy) + cy;
      return x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;
    }
    case "circle":
      return Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.radius;
    case "ellipse": {
      const r = (-(shape.rotation ?? 0) * Math.PI) / 180;
      const dx = Math.cos(r) * (p.x - shape.x) - Math.sin(r) * (p.y - shape.y);
      const dy = Math.sin(r) * (p.x - shape.x) + Math.cos(r) * (p.y - shape.y);
      return (dx * dx) / (shape.radiusX * shape.radiusX) + (dy * dy) / (shape.radiusY * shape.radiusY) <= 1;
    }
    case "polygon": {
      const pts = shape.points ?? [];
      let inside = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const [xi, yi, xj, yj] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
        if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    default:
      return false;
  }
}

export function regionSpot(regionDoc) {
  const flags = regionDoc?.getFlag?.(MODULE_ID, REGION_FLAG);
  if (!flags) return null;
  const shapes = regionDoc.shapes ?? [];
  const spot = {
    kind: "region",
    id: regionDoc.uuid,
    doc: regionDoc,
    label: flags.label || regionDoc.name,
    enabled: flags.enabled ?? true,
    range: 0,
    dc: Number(flags.dc) || 0,
    minRank: Number(flags.minRank) || 0,
    note: flags.note ?? "",
    found: !!flags.found,
    failed: flags.failed ?? [],
    rolls: flags.rolls ?? {},
    get centre() {
      const pts = shapes.map(s => (s.type === "rectangle" ? { x: s.x + s.width / 2, y: s.y + s.height / 2 } : { x: s.x ?? 0, y: s.y ?? 0 }));
      if (!pts.length) return null;
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    },
    async save(patch) {
      await regionDoc.update({ [`flags.${MODULE_ID}.${REGION_FLAG}`]: patch });
    },
    contains(point) {
      const solid = shapes.filter(s => !s.hole);
      const holes = shapes.filter(s => s.hole);
      return solid.some(s => inShape(s, point)) && !holes.some(s => inShape(s, point));
    }
  };
  return spot;
}

/* -------------------------------------------- */
/*  Scene                                       */
/* -------------------------------------------- */

export function sceneHazards(scene, defaults) {
  return (scene?.tokens ?? []).map(t => hazardSpot(t, defaults)).filter(Boolean);
}

export function sceneRegionSpots(scene) {
  return (scene?.regions ?? []).map(r => regionSpot(r)).filter(Boolean);
}

export function hazardDefaults() {
  const get = (key, fallback) => {
    try {
      return game.settings.get(MODULE_ID, `hazardDetection_${key}`);
    } catch {
      return fallback;
    }
  };
  return { autoEnable: get("autoEnable", true), defaultRange: get("defaultRange", 50) };
}

export function rankLabel(rank) {
  return localize(`LUCD20.Search.Rank.${RANKS[rank] ?? "untrained"}`);
}
