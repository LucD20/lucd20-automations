import { MODULE_ID } from "./constants.mjs";
import { L, setting, tokenForActor } from "./utils.mjs";
import { computeCover, COVER, isSquareGrid } from "./cover.mjs";

/*
 * Client-side preview: while you target a token, draw the best set of cover lines from your
 * token to each target. Green = clear, red = blocked by a wall, orange = blocked by a creature
 * (creatures only matter for ranged attacks).
 */

let layer = null;
let redrawTimer = null;

function attackerToken() {
	return canvas.tokens.controlled[0] ?? tokenForActor(game.user.character) ?? null;
}

function ensureLayer() {
	if (layer && !layer.destroyed) return layer;
	layer = new PIXI.Container();
	layer.name = `${MODULE_ID}-cover-preview`;
	layer.eventMode = "none";
	(canvas.interface ?? canvas.stage).addChild(layer);
	return layer;
}

export function clearPreview() {
	if (layer && !layer.destroyed) layer.removeChildren().forEach((c) => c.destroy({ children: true }));
}

function label(level, prefix) {
	const key = level === COVER.SUPERIOR ? "Cover.Superior" : level === COVER.COVER ? "Cover.Cover" : "Cover.None";
	return `${prefix}: ${L(key)}`;
}

function makeText(text, color) {
	const style = { fontFamily: "Signika", fontSize: 18, fill: color, stroke: 0x000000, strokeThickness: 4, align: "center" };
	const Precise = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
	return Precise ? new Precise(text, new PIXI.TextStyle(style)) : new PIXI.Text(text, style);
}

export function drawPreview() {
	clearPreview();
	if (!setting("coverPreview") || !canvas?.ready || !isSquareGrid()) return;
	const attacker = attackerToken();
	if (!attacker) return;
	const container = ensureLayer();

	for (const target of game.user.targets) {
		if (target === attacker) continue;
		const result = computeCover(attacker, target);
		if (!result) continue;
		const shown = result.ranged;
		const g = new PIXI.Graphics();
		for (const line of shown.lines) {
			const color = line.wall ? 0xe53935 : line.creature ? 0xfb8c00 : 0x43a047;
			g.lineStyle(3, color, 0.9);
			g.moveTo(line.a.x, line.a.y);
			g.lineTo(line.b.x, line.b.y);
		}
		g.beginFill(0xffffff, 0.9).lineStyle(0).drawCircle(shown.origin.x, shown.origin.y, 4).endFill();
		container.addChild(g);

		const lines = [label(result.walls.level, L("Cover.MeleeLabel"))];
		if (result.ranged !== result.walls) lines.push(label(result.ranged.level, L("Cover.RangedLabel")));
		else lines[0] = label(result.walls.level, L("Cover.Label"));
		if (shown.noLineOfEffect) lines.push(L("Cover.NoLoE"));
		const worst = Math.max(result.walls.level, result.ranged.level);
		const color = worst === COVER.SUPERIOR ? 0xff8a80 : worst === COVER.COVER ? 0xffd180 : 0xb9f6ca;
		const text = makeText(lines.join("\n"), color);
		text.anchor?.set(0.5, 1);
		text.position.set(target.center.x, target.document.y - 4);
		container.addChild(text);
	}
}

/** Debounced redraw (token movement fires many refresh events). */
export function scheduleRedraw() {
	if (redrawTimer) clearTimeout(redrawTimer);
	redrawTimer = setTimeout(() => {
		redrawTimer = null;
		if (game.user.targets.size) drawPreview();
		else clearPreview();
	}, 60);
}

export function registerPreviewHooks() {
	Hooks.on("targetToken", (user) => {
		if (user.isSelf) scheduleRedraw();
	});
	Hooks.on("controlToken", () => scheduleRedraw());
	Hooks.on("refreshToken", (token) => {
		if (!game.user.targets.size) return;
		if (token.controlled || game.user.targets.has(token)) scheduleRedraw();
	});
	Hooks.on("updateWall", () => scheduleRedraw());
	Hooks.on("canvasTearDown", () => {
		layer = null;
	});
}
