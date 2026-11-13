import { footprint, areEnemies, isDefeated, isRangedPower, isAreaPower, setting, log } from "./utils.mjs";

/*
 * 4e cover (Rules Compendium): pick a corner of a square the attacker occupies and trace lines to
 * every corner of one square the target occupies. 1-2 blocked lines = cover (-2), 3-4 = superior
 * cover (-5). The attacker picks the most favourable corner/square. A line that only runs along the
 * edge of an obstacle isn't blocked, so every end point is nudged slightly into its own square.
 * Enemies of the attacker standing in the way also block lines, but only for ranged attacks.
 */

export const COVER = { NONE: 0, COVER: 1, SUPERIOR: 2 };
const INSET = 1.5; // pixels

export function isSquareGrid() {
	return canvas?.grid && (canvas.grid.type === CONST.GRID_TYPES.SQUARE);
}

function corners(sq, size) {
	const x = sq.x * size;
	const y = sq.y * size;
	return [
		{ x: x + INSET, y: y + INSET },
		{ x: x + size - INSET, y: y + INSET },
		{ x: x + INSET, y: y + size - INSET },
		{ x: x + size - INSET, y: y + size - INSET },
	];
}

function squares(fp) {
	const out = [];
	for (let x = fp.x0; x <= fp.x1; x++) for (let y = fp.y0; y <= fp.y1; y++) out.push({ x, y });
	return out;
}

function wallBlocks(a, b, sourceDoc) {
	const backend = CONFIG.Canvas.polygonBackends?.move;
	if (!backend) return false;
	try {
		return !!backend.testCollision(a, b, { source: sourceDoc, mode: "any", type: "move" });
	} catch (err) {
		return !!backend.testCollision(a, b, { mode: "any", type: "move" });
	}
}

/** Liang-Barsky segment vs axis-aligned rectangle. */
function segmentHitsRect(a, b, r) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	let t0 = 0;
	let t1 = 1;
	const p = [-dx, dx, -dy, dy];
	const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
	for (let i = 0; i < 4; i++) {
		if (p[i] === 0) {
			if (q[i] < 0) return false;
		} else {
			const t = q[i] / p[i];
			if (p[i] < 0) t0 = Math.max(t0, t);
			else t1 = Math.min(t1, t);
			if (t0 > t1) return false;
		}
	}
	return true;
}

function blockingCreatureRects(attacker, target) {
	const size = canvas.grid.size;
	const pad = 2; // lines along a creature's edge don't count
	return canvas.tokens.placeables
		.filter((t) => t !== attacker && t !== target && t.actor && !t.document.hidden && !isDefeated(t) && areEnemies(attacker, t))
		.map((t) => {
			const fp = footprint(t);
			return { x0: fp.x0 * size + pad, y0: fp.y0 * size + pad, x1: (fp.x1 + 1) * size - pad, y1: (fp.y1 + 1) * size - pad };
		});
}

/**
 * Compute cover of `target` against `attacker`.
 * @returns {{ walls: Result, ranged: Result }} where Result = { level, blocked, origin, lines: [{a,b,wall,creature}] }
 *   `walls` ignores creatures (melee/close attacks); `ranged` counts enemy creatures too.
 */
export function computeCover(attacker, target) {
	if (!isSquareGrid() || !attacker || !target) return null;
	const size = canvas.grid.size;
	const fa = footprint(attacker);
	const ft = footprint(target);
	const creatures = blockingCreatureRects(attacker, target);

	// Unique attacker corner points (all grid vertices of its footprint, nudged inward)
	const originPoints = [];
	for (const sq of squares(fa)) originPoints.push(...corners(sq, size));

	const evaluate = (useCreatures) => {
		let best = null;
		for (const origin of originPoints) {
			for (const sq of squares(ft)) {
				const lines = corners(sq, size).map((c) => {
					const wall = wallBlocks(origin, c, attacker.document);
					const creature = useCreatures && !wall && creatures.some((r) => segmentHitsRect(origin, c, r));
					return { a: origin, b: c, wall, creature };
				});
				const blocked = lines.filter((l) => l.wall || l.creature).length;
				if (!best || blocked < best.blocked) best = { blocked, origin, lines };
				if (best.blocked === 0) break;
			}
			if (best?.blocked === 0) break;
		}
		best.level = best.blocked === 0 ? COVER.NONE : (best.blocked <= 2 ? COVER.COVER : COVER.SUPERIOR);
		best.noLineOfEffect = best.blocked === 4 && best.lines.every((l) => l.wall);
		return best;
	};

	const walls = evaluate(false);
	const ranged = creatures.length ? evaluate(true) : walls;
	return { walls, ranged };
}

/**
 * dnd4e.evaluateCommonAttackBonuses hook: tick Cover / Superior Cover in the attack dialog.
 */
export function onEvaluateCommonAttackBonuses(item, attacker, target, { bonuses }) {
	if (!setting("enableCover") || !attacker || !target || !bonuses?.cover) return;
	// Area attacks measure cover from the area's origin square, which we don't know here.
	if (isAreaPower(item)) return;
	const result = computeCover(attacker, target);
	if (!result) return;
	const r = isRangedPower(item, target, attacker) ? result.ranged : result.walls;
	log("cover", attacker.name, "->", target.name, r.level, r.blocked);
	if (r.level === COVER.SUPERIOR) {
		bonuses.coverSup.shouldApply = true;
		bonuses.cover.shouldApply = false;
	} else if ((r.level === COVER.COVER) && !bonuses.coverSup.shouldApply) {
		bonuses.cover.shouldApply = true;
	}
}
