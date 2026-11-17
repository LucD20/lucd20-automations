import { error } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";

/**
 * Instant Range (replaces "Instant Range"; owner, Q244–Q248, as recommended), every system:
 * - The distance from your token (the selected one, else your character's) to a hovered token, to every token
 *   while Alt is held, and to the tokens you target.
 * - Measured by the scene's grid rules (PF2e's 5-10-5 diagonals, 4e's squares) between the nearest squares of
 *   the two tokens, with their elevation, in the scene's units. Gridless: center to center.
 * - A small label just above the token, above everything; above Health Estimate's text when that sits on top
 *   (owner: texts already appear above tokens). Never for a token the user can't see.
 * - Always on, or in combat only (GM setting). The cover previews show the distance too (distanceText).
 */

let layer = null;
const labels = new Map(); // token id → PIXI text
let hovered = null, alt = false, feature = null;
/** Tokens whose distance another label already shows (the 4e cover preview above a target): skipped here. */
export const claimed = new Set();

const docOf = (t) => t?.document ?? t;

/** The centers of the squares a token occupies (or its center on a gridless scene), with its elevation. */
function occupied(token) {
	const d = docOf(token), size = canvas.grid.size, elevation = Number(d.elevation) || 0;
	if (canvas.grid.isGridless || !size) return [{ x: token.center?.x ?? d.x, y: token.center?.y ?? d.y, elevation }];
	const out = [];
	const w = Math.max(1, Math.round(d.width ?? 1)), h = Math.max(1, Math.round(d.height ?? 1));
	for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push({ x: d.x + (i + 0.5) * size, y: d.y + (j + 0.5) * size, elevation });
	return out;
}

/** { distance, units } between two tokens: the nearest occupied squares, by the grid's own rules. */
export function measure(a, b) {
	const grid = canvas.grid;
	if (!grid?.measurePath || !a || !b) return null;
	let best = Infinity;
	for (const p of occupied(a)) for (const q of occupied(b)) {
		const d = grid.measurePath([p, q]).distance;
		if (d < best) best = d;
		if (best === 0) break;
	}
	return Number.isFinite(best) ? { distance: Math.round(best * 100) / 100, units: grid.units ?? canvas.scene?.grid?.units ?? "" } : null;
}

/** "25 ft", or null when there is no source token or the feature is off (for the cover previews too). */
export function distanceText(a, b) {
	if (!feature?.active) return null;
	const m = measure(a, b);
	return m ? `${m.distance}${m.units ? ` ${m.units}` : ""}` : null;
}

const source = () => canvas.tokens?.controlled?.[0] ?? game.user.character?.getActiveTokens?.()?.[0] ?? null;
const allowed = () => !feature.get("combatOnly") || !!game.combat?.started;
const canSee = (t) => t?.visible !== false && (game.user.isGM || !docOf(t).hidden);

/** Health Estimate's text above a token: how far up our label must go (the original module's rule). */
function healthEstimateOffset(token) {
	const he = game.healthEstimate;
	const tokenHe = token?.healthEstimate;
	if (!he || he.position !== "a" || !tokenHe?.visible || !tokenHe?.height) return 0;
	const gridScale = he.scaleToGridSize ? canvas.scene.dimensions.size / 100 : 1;
	const tokenScale = he.scaleToTokenSize ? docOf(token).width : 1;
	const top = he.height - 2 - tokenHe.height * tokenScale * 0.25;
	return he.height - 2 >= -28 * gridScale ? top - 22 * gridScale : 0;
}

function ensureLayer() {
	if (layer && !layer.destroyed && layer.parent) return layer;
	if (layer && !layer.destroyed) layer.destroy({ children: true });
	const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
	if (typeof parent?.addChild !== "function") return null;
	layer = new PIXI.Container();
	layer.eventMode = "none";
	parent.addChild(layer);
	labels.clear();
	return layer;
}

function makeLabel(text) {
	const style = { fontFamily: "Signika", fontSize: 18, fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, align: "center" };
	const Precise = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
	const t = Precise ? new Precise(text, new PIXI.TextStyle(style)) : new PIXI.Text(text, style);
	t.anchor?.set?.(0.5, 1);
	return t;
}

/** Which tokens get a label now. */
export function wanted() {
	const from = source();
	if (!from || !allowed()) return { from: null, tokens: [] };
	const set = new Set();
	if (hovered) set.add(hovered);
	for (const t of game.user.targets ?? []) set.add(t);
	if (alt) for (const t of canvas.tokens?.placeables ?? []) set.add(t);
	set.delete(from);
	return { from, tokens: [...set].filter((t) => t && !t.destroyed && canSee(t) && !claimed.has(docOf(t).id)) };
}

function draw() {
	if (!canvas?.ready || !feature?.active) return clearAll();
	const { from, tokens } = wanted();
	if (!tokens.length && !labels.size) return;
	if (!ensureLayer()) return;
	const keep = new Set();
	for (const t of tokens) {
		const text = distanceText(from, t);
		if (!text) continue;
		const id = docOf(t).id;
		keep.add(id);
		let label = labels.get(id);
		if (!label || label.destroyed) { label = makeLabel(text); labels.set(id, label); layer.addChild(label); } else if (label.text !== text) label.text = text;
		const d = docOf(t);
		const w = (d.width ?? 1) * canvas.grid.size;
		label.position.set(d.x + w / 2, d.y - 4 + healthEstimateOffset(t));
	}
	for (const [id, label] of labels) if (!keep.has(id)) { label.destroy(); labels.delete(id); }
}

function clearAll() {
	for (const label of labels.values()) label.destroy?.();
	labels.clear();
}

let timer = null;
const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { try { draw(); } catch (err) { error("Instant Range failed.", err); } }, 40); };

defineFeature({
	id: "instantRange",
	category: "tokens",
	scope: "world",
	defaultEnabled: true,
	settings: {
		combatOnly: { kind: "boolean", default: false, scope: "world" }
	},

	enable(f) {
		feature = f;
		f.on("hoverToken", (token, over) => { hovered = over ? token : hovered === token ? null : hovered; redraw(); });
		f.on("highlightObjects", (active) => { alt = !!active; redraw(); });
		for (const hook of ["targetToken", "controlToken", "refreshToken", "updateToken", "deleteToken", "createCombat", "updateCombat", "deleteCombat"]) f.on(hook, redraw);
		f.on("canvasTearDown", () => { hovered = null; clearAll(); });
		f.on("canvasReady", redraw);
		f.onCleanup(() => { clearAll(); layer?.destroy?.({ children: true }); layer = null; hovered = null; });
		redraw();
	},

	onSettingChange() {
		redraw();
	}
});

export function refreshRange() { redraw(); }

export const _test = { measure, distanceText, wanted, draw, labels, setHovered: (t) => { hovered = t; }, setAlt: (v) => { alt = v; } };
