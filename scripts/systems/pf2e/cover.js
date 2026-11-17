import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";

/**
 * Rule 19 (docs/pf2e-rules.md): PF2e cover for attack rolls (owner, Q228–Q232; the owner's diagram):
 * - From the attacker's point of view (the center of its space): if walls hide more than half of the target's
 *   space, greater cover (+4); else if the line center to center crosses a wall, standard (+2); else if it
 *   passes through another creature's space, lesser (+1). Dead creatures don't count; prone ones are the GM's
 *   call (not counted); hidden tokens never count (nothing leaks). A line that only touches a wall's end
 *   doesn't cross it. Walls: those that block movement (open doors don't).
 * - Applied per roll: the target's AC goes up by the bonus for that attack only (a Cover effect it already has,
 *   from Take Cover or set by hand, counts: the higher wins, no stacking). Not on rerolls.
 * - The roll window shows four buttons above Roll: No cover | Lesser | Standard | Greater, the automatic one
 *   chosen; anyone rolling can change it. The attack card says the cover used, and "set by hand" if changed.
 * - While targeting, the line and the cover it gives are drawn on the map, for the user only.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Cover.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
export const LEVELS = ["none", "lesser", "standard", "greater"];
export const BONUS = { none: 0, lesser: 1, standard: 2, greater: 4 };
const ICONS = { none: "fa-ban", lesser: "fa-user-group", standard: "fa-shield-halved", greater: "fa-shield" };
const ATTACKS = new Set(["attack-roll", "spell-attack-roll"]);
const KEY = "lucd20Cover";

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

const docOf = (t) => t?.document ?? t;
export function rectOf(token) {
	const d = docOf(token), size = canvas.grid?.size ?? 100;
	return { x: d.x, y: d.y, w: (d.width ?? 1) * size, h: (d.height ?? 1) * size };
}
const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Does the sight line ab cross the wall cd? The line's ends must be on opposite sides of the wall; a line that
 * runs through the wall's very end counts (the owner's diagram: a wall ending at the corner the line passes
 * gives standard cover), one that passes beside the end doesn't; a line ending on the wall counts too.
 */
export function crosses(a, b, c, d) {
	const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const eps = 1e-6;
	const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
	// The far end may lie on the wall itself (a wall along the target's edge hides what is behind it).
	const lineSplitByWall = (d1 > eps && d2 < eps) || (d1 < -eps && d2 > -eps);
	const wallMeetsLine = (d3 >= -eps && d4 <= eps) || (d3 <= eps && d4 >= -eps);
	return lineSplitByWall && wallMeetsLine;
}

/** Does segment ab pass through the inside of rect r (shrunk a little, so grazing a corner doesn't)? */
export function throughRect(a, b, r, inset = 2) {
	const x0 = r.x + inset, y0 = r.y + inset, x1 = r.x + r.w - inset, y1 = r.y + r.h - inset;
	let t0 = 0, t1 = 1;
	const dx = b.x - a.x, dy = b.y - a.y;
	for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
		if (p === 0) { if (q < 0) return false; continue; }
		const t = q / p;
		if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
	}
	return t1 - t0 > 1e-6;
}

function blockingWalls() {
	return (canvas.walls?.placeables ?? []).map((w) => w.document ?? w).filter((w) => {
		if (!(Number(w.move) > 0)) return false;
		if (Number(w.door) > 0 && Number(w.ds) === 1) return false; // an open door
		return Array.isArray(w.c) && w.c.length >= 4;
	}).map((w) => [{ x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] }]);
}

const dead = (doc) => {
	const actor = doc.actor;
	if (!actor) return false;
	const hp = actor.hitPoints ?? actor.system?.attributes?.hp;
	return (hp && Number(hp.value) <= 0 && Number(hp.max) > 0) || actor.statuses?.has?.("dead") || !!actor.hasCondition?.("dead");
};
const prone = (doc) => !!(doc.actor?.hasCondition?.("prone") ?? doc.actor?.statuses?.has?.("prone"));

/**
 * The share of the target's silhouette, as seen from the attacker's center, that walls hide: rays spread
 * evenly over the angle the target's space takes, each one to where it enters the target (so a wall behind
 * the target hides nothing). The owner's diagram: 79% greater, exactly half standard, 19% none.
 */
export function silhouetteHidden(from, rt, blocked, K = 48) {
	const center = { x: rt.x + rt.w / 2, y: rt.y + rt.h / 2 };
	const base = Math.atan2(center.y - from.y, center.x - from.x);
	const rel = (p) => { let d = Math.atan2(p.y - from.y, p.x - from.x) - base; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
	const corners = [{ x: rt.x, y: rt.y }, { x: rt.x + rt.w, y: rt.y }, { x: rt.x, y: rt.y + rt.h }, { x: rt.x + rt.w, y: rt.y + rt.h }].map(rel);
	const lo = Math.min(...corners), hi = Math.max(...corners);
	if (!(hi > lo)) return 0;
	const far = Math.hypot(rt.x + rt.w - from.x, rt.y + rt.h - from.y) + rt.w + rt.h;
	let hidden = 0, counted = 0;
	for (let i = 0; i < K; i++) {
		const ang = base + lo + (i + 0.5) * (hi - lo) / K;
		const end = { x: from.x + Math.cos(ang) * far, y: from.y + Math.sin(ang) * far };
		const entry = entryPoint(from, end, rt);
		if (!entry) continue;
		counted++;
		if (blocked(entry)) hidden++;
	}
	return counted ? hidden / counted : 0;
}

/** Where segment ab first enters rect r (null if it misses). */
function entryPoint(a, b, r) {
	let t0 = 0, t1 = 1;
	const dx = b.x - a.x, dy = b.y - a.y;
	for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
		if (p === 0) { if (q < 0) return null; continue; }
		const t = q / p;
		if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
	}
	return t1 >= t0 ? { x: a.x + dx * t0, y: a.y + dy * t0 } : null;
}

/** { level, wallShare, wall, creature } for attacker → target (token objects or documents). */
export function computeCover(attacker, target, { walls = blockingWalls(), tokens = canvas.tokens?.placeables ?? [] } = {}) {
	const ra = rectOf(attacker), rt = rectOf(target);
	const from = centerOf(ra), to = centerOf(rt);
	const blocked = (p) => walls.some(([c, d]) => crosses(from, p, c, d));
	const wallShare = silhouetteHidden(from, rt, blocked);
	const wall = blocked(to);
	const a = docOf(attacker), t = docOf(target);
	const creature = tokens.map(docOf).some((d) => d && d.id !== a.id && d.id !== t.id && !d.hidden && !dead(d) && !prone(d) && throughRect(from, to, rectOf(d)));
	const level = wallShare > 0.5 ? "greater" : wall ? "standard" : creature ? "lesser" : "none";
	return { level, wallShare, wall, creature, from, to };
}

/** Cover from a point (an area's origin) to a target: walls only (Q234: creatures don't shield from areas). */
export function coverFromPoint(from, target, { walls = blockingWalls() } = {}) {
	const rt = rectOf(target), to = centerOf(rt);
	const blocked = (p) => walls.some(([c, d]) => crosses(from, p, c, d));
	const wallShare = silhouetteHidden(from, rt, blocked);
	const wall = blocked(to);
	return { level: wallShare > 0.5 ? "greater" : wall ? "standard" : "none", wallShare, wall, from, to };
}

/**
 * The template placed for this area (Q236): the one whose PF2e origin is the spell, else the latest one that
 * covers the target. Its x / y is the area's origin (a burst's center, a cone's or line's start).
 */
export function areaOrigin(itemUuid, target) {
	// Foundry V14 / PF2e 8.7: effect areas are Regions (flags.pf2e.areaShape, origin, messageId); the shape's x / y
	// is the area's origin.
	const regions = (canvas.regions?.placeables ?? []).map((r) => r.document ?? r).filter((d) => d.flags?.pf2e?.areaShape && d.shapes?.length);
	const c = centerOf(rectOf(target));
	const byItem = regions.filter((d) => itemUuid && (d.flags.pf2e.origin?.uuid === itemUuid || d.flags.pf2e.origin?.item === itemUuid));
	const region = byItem.at(-1) ?? regions.filter((d) => d.testPoint?.({ ...c, elevation: 0 }) ?? reachesSquare(d, rectOf(target))).at(-1);
	if (region) return { x: region.shapes[0].x, y: region.shapes[0].y };
	const templates = (canvas.templates?.placeables ?? []).map((t) => ({ doc: t.document ?? t, obj: t }));
	const mine = templates.filter(({ doc }) => itemUuid && (doc.flags?.pf2e?.origin?.uuid === itemUuid || doc.flags?.pf2e?.origin?.item === itemUuid));
	let found = mine.at(-1);
	if (!found) {
		const c = centerOf(rectOf(target));
		found = templates.filter(({ doc, obj }) => obj.shape?.contains?.(c.x - doc.x, c.y - doc.y)).at(-1);
	}
	return found ? { x: found.doc.x, y: found.doc.y } : null;
}

/* -------------------------------------------- */
/*  Areas reach squares partly behind walls     */
/* -------------------------------------------- */

/**
 * PF2e 8.7 counts a grid square in an effect area only if the line from the area's origin to the square's
 * center is clear (RegionDocumentPF2e#getCoverage), so a creature whose square center sits behind a wall's
 * end is left out entirely and never targeted (owner: not the rules; a creature partly behind a wall is in
 * the area, with cover). Here a square PF2e walled off counts when a clear line reaches any part of it (its
 * corners and edges, a hair inside); cover is then worked out as usual.
 */
const SAMPLE = [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98], [0.5, 0.02], [0.5, 0.98], [0.02, 0.5], [0.98, 0.5]];
const widened = new WeakMap();

function clearLine(from, to, level) {
	const backend = CONFIG.Canvas?.polygonBackends?.move;
	if (backend?.testCollision) return !backend.testCollision(from, to, { type: "move", mode: "any", level });
	return !blockingWalls().some(([c, d]) => crosses(from, to, c, d));
}

export function widenCoverage(region, coverage, level) {
	if (!coverage?.blocked?.length || !region?.shapes?.length) return coverage;
	const cached = widened.get(coverage);
	if (cached) return cached;
	const origin = { x: region.shapes[0].x, y: region.shapes[0].y };
	const size = canvas.grid.size;
	const covered = [...coverage.covered], blocked = [];
	for (const offset of coverage.blocked) {
		const { x, y } = canvas.grid.getTopLeftPoint(offset);
		const reach = SAMPLE.some(([fx, fy]) => clearLine(origin, { x: x + fx * size, y: y + fy * size }, level));
		(reach ? covered : blocked).push(offset);
	}
	const keys = new Set(covered.map((o) => `${o.i},${o.j}`));
	const result = { covered, blocked, covers: (o) => keys.has(`${o.i},${o.j}`) };
	widened.set(coverage, result);
	return result;
}

/** Fallback for areaOrigin: does the region's PF2e coverage include one of these squares? */
function reachesSquare(region, rect) {
	const coverage = region.getCoverage?.();
	if (!coverage) return false;
	const size = canvas.grid.size;
	for (let x = rect.x; x < rect.x + rect.w; x += size) for (let y = rect.y; y < rect.y + rect.h; y += size) {
		if (coverage.covers(canvas.grid.getOffset({ x: x + size / 2, y: y + size / 2 }))) return true;
	}
	return false;
}

function refreshRegions() {
	for (const r of canvas.regions?.placeables ?? []) {
		r.document?.clearCoverage?.();
		r.renderFlags?.set?.({ refreshGeometry: true });
	}
}

/* -------------------------------------------- */
/*  The roll                                    */
/* -------------------------------------------- */

const tokenOfContext = (side) => {
	const t = side?.token;
	return t?.object ?? t ?? null;
};

/** A Cover the target already has (Take Cover, or set by hand): the highest circumstance bonus labelled cover. */
function existingCover(dc) {
	const mods = dc?.statistic?.modifiers ?? [];
	return Math.max(0, ...mods.filter((m) => m.enabled !== false && m.type === "circumstance" && /cover/i.test(`${m.slug} ${m.label}`)).map((m) => Number(m.modifier) || 0));
}

/** Before PF2e's check: the cover for this attack, added to the DC (the roll window can change it). */
export function prepare(context, check = null) {
	if (!context || context.isReroll || context[KEY]) return;
	if (context.type === "saving-throw") return prepareSave(context, check);
	if (!ATTACKS.has(context.type) || !context.dc) return;
	const attacker = tokenOfContext(context.origin) ?? context.token?.object ?? context.actor?.getActiveTokens?.()?.[0];
	const target = tokenOfContext(context.target);
	if (!attacker || !target || !canvas?.ready) return;
	const auto = computeCover(attacker, target).level;
	const existing = existingCover(context.dc);
	const applied = Math.max(0, BONUS[auto] - existing);
	context.dc.value = Number(context.dc.value) + applied;
	context[KEY] = { auto, chosen: auto, applied, existing };
}

const MOD_SLUG = "lucd20-cover";
const optionsOf = (context) => (context?.options instanceof Set ? context.options : new Set(context?.options ?? []));

/**
 * A Reflex save against an area (the roll has "area-effect"): cover is a circumstance bonus to the save, put
 * in as a modifier, so PF2e's own stacking keeps the higher of it and a Cover effect the saver already has.
 */
function prepareSave(context, check) {
	const options = optionsOf(context);
	const reflex = check?.slug === "reflex" || context.statistic === "reflex" || options.has("reflex");
	if (!reflex || !options.has("area-effect") || !check) return;
	const target = context.token?.object ?? context.token ?? context.actor?.getActiveTokens?.()?.[0];
	let auto = "none";
	if (target && canvas?.ready) {
		const item = context.origin?.item ?? context.item;
		const origin = areaOrigin(item?.uuid ?? null, target);
		if (origin) auto = coverFromPoint(origin, target).level;
	}
	context[KEY] = { kind: "area", auto, chosen: auto };
	setSaveModifier(check, context, auto);
}

function setSaveModifier(check, context, level) {
	check.delete?.(MOD_SLUG);
	const Modifier = game.pf2e?.Modifier;
	if (BONUS[level] && Modifier) check.push(new Modifier({ slug: MOD_SLUG, label: L(`Level.${level}`), modifier: BONUS[level], type: "circumstance" }));
	check.calculateTotal?.(optionsOf(context));
}

export function choose(context, level, check = null) {
	const c = context?.[KEY];
	if (!c || !LEVELS.includes(level)) return;
	if (c.kind === "area") {
		if (check) setSaveModifier(check, context, level);
		c.chosen = level;
		return;
	}
	const applied = Math.max(0, BONUS[level] - c.existing);
	context.dc.value = Number(context.dc.value) - c.applied + applied;
	Object.assign(c, { chosen: level, applied });
}

function onDialog(app, html) {
	const c = app?.context?.[KEY];
	const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
	if (!c || !root) return;
	root.querySelector(".lucd20-cover-pick")?.remove();
	const buttons = LEVELS.map((l) => `<button type="button" class="${l === c.chosen ? "active" : ""}" data-lucd20-cover="${l}" aria-label="${esc(L(`Level.${l}`))}"><i class="fa-solid ${ICONS[l]}"></i><span>${esc(L(`Short.${l}`))}</span></button>`).join("");
	const bar = `<div class="lucd20-cover-pick">${buttons}</div>`;
	const roll = root.querySelector("button.roll, button[type='submit'], [data-action='roll']");
	const chances = root.querySelector(".lucd20-ch-dialog");
	const anchor = chances ?? roll;
	if (anchor) anchor.insertAdjacentHTML("beforebegin", bar);
	else root.querySelector(".window-content")?.insertAdjacentHTML("beforeend", bar);
	fitWindow(app);
	for (const b of root.querySelectorAll("[data-lucd20-cover]")) {
		b.addEventListener("click", (event) => {
			event.preventDefault();
			choose(app.context, b.dataset.lucd20Cover, app.check);
			app.render?.();
		});
	}
}

/** The window grows to fit what we added (owner: no scrolling). */
export function fitWindow(app) {
	requestAnimationFrame(() => {
		try { app?.setPosition?.({ height: "auto" }); } catch { /* not positionable */ }
	});
}

function onCard(message, html) {
	const c = message.flags?.pf2e?.context?.[KEY];
	if (!c || html.querySelector?.(".lucd20-cover-note")) return;
	if (c.chosen === "none" && c.auto === "none") return;
	const text = c.chosen === c.auto ? L("Note", { level: L(`Level.${c.chosen}`), bonus: BONUS[c.chosen] })
		: L("NoteHand", { level: L(`Level.${c.chosen}`), bonus: BONUS[c.chosen], auto: L(`Level.${c.auto}`) });
	const anchor = html.querySelector(".degree-of-success") ?? html.querySelector(".dice-roll");
	anchor?.insertAdjacentHTML(anchor.matches(".degree-of-success") ? "beforebegin" : "afterend", `<div class="lucd20-cover-note"><i class="fa-solid ${ICONS[c.chosen]}"></i> ${esc(text)}</div>`);
}

/* -------------------------------------------- */
/*  Map preview                                 */
/* -------------------------------------------- */

let layer = null;
const COLORS = { none: 0x43a047, lesser: 0xfdd835, standard: 0xfb8c00, greater: 0xe53935 };

function clearPreview() {
	if (layer && !layer.destroyed) layer.removeChildren().forEach((c) => c.destroy({ children: true }));
}

function drawPreview() {
	clearPreview();
	if (!canvas?.ready) return;
	const attacker = canvas.tokens?.controlled?.[0] ?? game.user.character?.getActiveTokens?.()?.[0];
	if (!attacker || !game.user.targets?.size) return;
	if (!layer || layer.destroyed) {
		layer = new PIXI.Container();
		layer.eventMode = "none";
		// Above the tokens (owner: the text was under them).
		(canvas.controls ?? canvas.interface ?? canvas.stage).addChild(layer);
	}
	for (const target of game.user.targets) {
		if (target === attacker) continue;
		const r = computeCover(attacker, target);
		const g = new PIXI.Graphics();
		g.lineStyle(3, COLORS[r.level], 0.9);
		g.moveTo(r.from.x, r.from.y);
		g.lineTo(r.to.x, r.to.y);
		layer.addChild(g);
		const Precise = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
		const style = { fontFamily: "Signika", fontSize: 18, fill: COLORS[r.level], stroke: 0x000000, strokeThickness: 4 };
		const text = Precise ? new Precise(L(`Level.${r.level}`), new PIXI.TextStyle(style)) : new PIXI.Text(L(`Level.${r.level}`), style);
		text.anchor?.set?.(0.5, 1);
		text.position.set((r.from.x + r.to.x) / 2, (r.from.y + r.to.y) / 2 - 4);
		layer.addChild(text);
	}
}

let timer = null;
const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { try { drawPreview(); } catch (err) { error("Cover preview failed.", err); } }, 50); };

defineFeature({
	id: "pf2eCover",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		preview: { kind: "boolean", default: true, scope: "client" },
		areaReach: { kind: "boolean", default: true, scope: "world" }
	},

	enable(feature) {
		const Check = game.pf2e?.Check;
		if (Check?.roll) {
			feature.wrap(Check, "roll", function (original, check, context = {}, ...rest) {
				try { prepare(context, check); } catch (err) { error("Cover failed.", err); }
				return original(check, context, ...rest);
			});
		}
		const RegionDoc = CONFIG.Region?.documentClass;
		if (typeof RegionDoc?.prototype?.getCoverage === "function") {
			feature.wrap(RegionDoc.prototype, "getCoverage", function (original, level, ...rest) {
				const coverage = original(level, ...rest);
				if (!feature.get("areaReach")) return coverage;
				try { return widenCoverage(this, coverage, level ?? canvas.level); } catch (err) { error("Cover failed.", err); return coverage; }
			});
			refreshRegions();
			feature.onCleanup(refreshRegions);
		}
		feature.on("renderCheckModifiersDialog", (app, html) => onDialog(app, html));
		feature.on("renderChatMessageHTML", (message, html) => onCard(message, html));
		for (const hook of ["targetToken", "controlToken", "refreshToken", "updateWall", "createWall", "deleteWall"]) {
			feature.on(hook, () => (feature.get("preview") ? redraw() : clearPreview()));
		}
		feature.onCleanup(() => { clearPreview(); layer?.destroy?.({ children: true }); layer = null; });
	},

	onSettingChange() {
		redraw();
		refreshRegions();
	}
});

export const _test = { widenCoverage, computeCover, coverFromPoint, areaOrigin, crosses, throughRect, prepare, choose, onDialog, onCard, existingCover };
