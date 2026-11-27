import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { areaPoint, coverFromPoint, inShape, LEVELS } from "./cover.js";
import { sysId } from "./sys.js";
import { conditionList, enableAreaEffects, initAreaEffects, setAreaEffect, VALUED } from "./area-effects.js";

/**
 * Rule 20 (docs/pf2e-rules.md): PF2e effect areas (owner, Q237–Q240, as recommended).
 * - Targeting (replaces Toolbelt's template targeting, which drops any creature whose center is behind a wall):
 *   placing an area opens a small window: Enemies / Allies / All / None, "Include me", "Include neutral",
 *   "Remove the area after". The creatures in the area (by its squares, which "Areas reach past wall ends"
 *   widens) are targeted and set as the spell message's targets (Toolbelt's save rows read them).
 *   Toolbelt's own template targeting should be off.
 * - Hovering an area: a line from its origin to each creature in it you can see, with the cover it gets.
 * - The exact reach: a light overlay of the area's shape with what walls cut off removed.
 */

const L = (key, data) => localize(`LUCD20.PF2eRules.Area.${key}`, data);
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));
const STORE = `${MODULE_ID}.areaTargets`;
const COLORS = { none: 0x43a047, lesser: 0xfdd835, standard: 0xfb8c00, greater: 0xe53935 };

const isArea = (doc) => !!doc?.flags?.[sysId()]?.areaShape && (doc.shapes?.length ?? 0) >= 1;
const remembered = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { return {}; } };
const remember = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode */ } };

/** The grid squares a token occupies. */
function offsetsOf(doc) {
	const size = canvas.grid.size, out = [];
	for (let i = 0; i < Math.max(1, Math.round(doc.width ?? 1)); i++) for (let j = 0; j < Math.max(1, Math.round(doc.height ?? 1)); j++) {
		out.push(canvas.grid.getOffset({ x: doc.x + (i + 0.5) * size, y: doc.y + (j + 0.5) * size }));
	}
	return out;
}

/** Token documents in the area: by its (widened) squares; else Foundry's own membership. */
export function tokensInArea(region) {
	const coverage = region.getCoverage?.();
	const all = (canvas.tokens?.placeables ?? []).map((t) => t.document ?? t);
	if (coverage) return all.filter((d) => offsetsOf(d).some((o) => coverage.covers(o)));
	return [...(region.tokens ?? [])];
}

/** Who the choice targets. */
export function chooseTargets(region, { targets = "enemies", self = false, neutral = false } = {}, { hidden = false } = {}) {
	if (targets === "none") return [];
	if (targets === "both") targets = "all";
	let caster = null;
	try { caster = region.flags[sysId()].origin?.actor ? fromUuidSync(region.flags[sysId()].origin.actor) : null; } catch { caster = null; }
	const alliance = caster ? caster.alliance : game.user.isGM ? "opposition" : "party";
	const opposition = alliance === "party" ? "opposition" : alliance === "opposition" ? "party" : null;
	return tokensInArea(region).filter((d) => {
		const actor = d.actor;
		if (!actor || (d.hidden && !hidden)) return false;
		if (actor.isOfType && !actor.isOfType("creature", "hazard", "vehicle")) return false;
		if (actor.isDead) return false;
		if (caster && actor === caster) return !!self;
		const a = actor.alliance ?? null;
		if (a === null && !neutral) return false;
		if (targets === "allies" && a !== alliance && a !== null) return false;
		if (targets === "enemies" && a !== opposition && a !== null) return false;
		return true;
	});
}

async function applyTargets(region, docs) {
	const ids = docs.map((d) => d.id);
	if (canvas.tokens?.setTargets) canvas.tokens.setTargets(ids);
	else {
		for (const t of game.user.targets ?? []) t.setTarget?.(false, { releaseOthers: false });
		for (const d of docs) d.object?.setTarget?.(true, { releaseOthers: false, groupSelection: true });
	}
	const message = region.flags[sysId()].messageId ? game.messages.get(region.flags[sysId()].messageId) : null;
	if (message?.isOwner ?? message?.isAuthor) await message.update({ "flags.pf2e-toolbelt.targetHelper.targets": docs.map((d) => d.uuid) }).catch(() => {});
}

/* -------------------------------------------- */
/*  v0.92.0 (owner, PLAN §29 C5): a lasting effect, folded under the targeting   */
/* -------------------------------------------- */

const WHEN = ["placed", "enter", "turnStart", "turnEnd"];

function lastingHTML(open) {
	const options = conditionList().map((c) => `<option value="${esc(c.slug)}" data-valued="${c.valued ? 1 : 0}">${esc(c.label)}</option>`).join("");
	const check = (name, on = false) => `<label><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${esc(L(`Effect.${name}`))}</label>`;
	return `<details class="lucd20-area-lasting"${open ? " open" : ""}><summary>${esc(L("Effect.Title"))}</summary>
	<div class="lucd20-area-rounds"><label>${esc(L("Effect.Rounds"))} <input type="number" name="rounds" value="0" min="0" max="100" /></label><span class="lucd20-area-note">${esc(L("Effect.RoundsHint"))}</span></div>
	<div class="lucd20-area-conds" data-lucd20-conds></div>
	<div class="lucd20-area-add"><select name="condition"><option value="">${esc(L("Effect.Condition"))}</option>${options}</select><input type="number" name="condValue" value="1" min="1" max="10" /><button type="button" data-lucd20-add-cond><i class="fa-solid fa-plus"></i></button></div>
	<div class="lucd20-area-when">${WHEN.map((w) => check(w, w === "placed")).join("")}${check("leave")}</div>
</details>`;
}

/** The + button: a removable chip per condition (valued ones with their value). */
export function wireLasting(root) {
	const host = root?.querySelector?.("[data-lucd20-conds]");
	const add = root?.querySelector?.("[data-lucd20-add-cond]");
	if (!host || !add || add.dataset.wired) return;
	add.dataset.wired = "1";
	const select = root.querySelector("[name='condition']"), value = root.querySelector("[name='condValue']");
	const sync = () => { value.hidden = select.selectedOptions[0]?.dataset.valued !== "1"; };
	select.addEventListener("change", sync);
	sync();
	add.addEventListener("click", (event) => {
		event.preventDefault();
		const slug = select.value;
		if (!slug) return;
		const valued = VALUED.has(slug);
		const v = valued ? Math.max(1, Number(value.value) || 1) : null;
		host.querySelector(`[data-slug="${slug}"]`)?.remove();
		const chip = document.createElement("span");
		chip.className = "lucd20-area-chip";
		chip.dataset.slug = slug;
		if (v) chip.dataset.value = String(v);
		chip.innerHTML = `${esc(select.selectedOptions[0]?.textContent ?? slug)}${v ? ` ${v}` : ""} <a data-lucd20-del><i class="fa-solid fa-xmark"></i></a>`;
		chip.querySelector("[data-lucd20-del]").addEventListener("click", () => chip.remove());
		host.append(chip);
		select.value = "";
		sync();
	});
	root.querySelector(".lucd20-area-lasting")?.addEventListener("toggle", (event) => remember({ ...remembered(), lastingOpen: event.target.open }));
}

function readLasting(el) {
	const conditions = [...(el?.querySelectorAll?.(".lucd20-area-chip") ?? [])].map((c) => ({ slug: c.dataset.slug, value: c.dataset.value ? Number(c.dataset.value) : null }));
	const rounds = Number(el?.querySelector?.("[name='rounds']")?.value) || 0;
	const on = (n) => !!el?.querySelector?.(`[name="${n}"]`)?.checked;
	return { rounds, conditions, when: Object.fromEntries(WHEN.map((w) => [w, on(w)])), leave: on("leave") };
}

/**
 * The window (owner, v0.61.1: Toolbelt's layout): Enemies / Allies / Both on the left, Include me / Include
 * neutral / Remove the area after on the right, Target and Cancel below. The choices are remembered.
 */
async function ask(region) {
	const DialogV2 = foundry.applications?.api?.DialogV2;
	const last = { targets: "enemies", self: false, neutral: false, dismiss: false, ...remembered() };
	if (last.targets === "all") last.targets = "both";
	const radio = (v) => `<label><input type="radio" name="targets" value="${v}" ${last.targets === v ? "checked" : ""}> ${esc(L(`Targets.${v}`))}</label>`;
	const box = (name) => `<label><input type="checkbox" name="${name}" ${last[name] ? "checked" : ""}> ${esc(L(`Choice.${name}`))}</label>`;
	const content = `<div class="lucd20-area-window"><div class="lucd20-area-col">${["enemies", "allies", "both"].map(radio).join("")}</div><div class="lucd20-area-col">${["self", "neutral", "dismiss"].map(box).join("")}</div></div>${lastingHTML(last.lastingOpen)}`;
	const read = (dialog) => {
		const el = dialog.element ?? dialog.form;
		return { targets: el?.querySelector("[name='targets']:checked")?.value ?? "enemies", ...Object.fromEntries(["self", "neutral", "dismiss"].map((n) => [n, !!el?.querySelector(`[name="${n}"]`)?.checked])), lasting: readLasting(el) };
	};
	if (!DialogV2) return { ...last };
	return DialogV2.wait({
		window: { title: region.flags[sysId()].origin?.name ?? L("Title") },
		position: { width: 300 },
		content,
		classes: ["lucd20-area-dialog"],
		rejectClose: false,
		render: (event, dialog) => wireLasting(dialog?.element ?? event?.target?.element ?? document.querySelector(".lucd20-area-dialog")),
		buttons: [
			{ action: "target", label: L("Target"), icon: "fa-solid fa-check", default: true, callback: (event, button, dialog) => read(dialog ?? button) },
			{ action: "cancel", label: L("Cancel"), icon: "fa-solid fa-xmark", callback: (event, button, dialog) => ({ ...read(dialog ?? button), cancelled: true }) }
		]
	});
}

async function onCreateRegion(feature, region, options, userId) {
	if (userId !== game.user.id || !isArea(region) || !feature.get("targeting")) return;
	if (!region.flags[sysId()].origin) return;
	await new Promise((r) => setTimeout(r, 50)); // the region's coverage is ready once drawn
	const choice = await ask(region);
	if (!choice) return;
	remember({ ...remembered(), targets: choice.targets, self: choice.self, neutral: choice.neutral, dismiss: choice.dismiss });
	if (choice.cancelled) return;
	await applyTargets(region, chooseTargets(region, choice));
	// A lasting effect (rounds or conditions): the area stays, whatever "remove after" says.
	const lasting = choice.lasting;
	if (lasting && (lasting.rounds > 0 || lasting.conditions.length)) {
		await setAreaEffect(region, { ...lasting, filter: { targets: choice.targets, self: choice.self, neutral: choice.neutral } }).catch((err) => ui.notifications.warn(err.message ?? String(err)));
		return;
	}
	if (choice.dismiss) await region.delete().catch(() => {});
}

/* -------------------------------------------- */
/*  Hover lines and the exact reach             */
/* -------------------------------------------- */

let hoverLayer = null, reachLayer = null;
const clear = (layer) => { if (layer && !layer.destroyed) layer.removeChildren().forEach((c) => c.destroy({ children: true })); };
const ensure = (layer, parent) => {
	if (layer && !layer.destroyed && layer.parent) return layer;
	if (layer && !layer.destroyed) layer.destroy({ children: true });
	const l = new PIXI.Container();
	l.eventMode = "none";
	parent?.addChild(l);
	return l;
};
const label = (text, color) => {
	const style = { fontFamily: "Signika", fontSize: Math.max(18, Math.round((canvas.grid?.size ?? 100) * 0.24)), fill: color, stroke: 0x000000, strokeThickness: Math.max(4, Math.round((canvas.grid?.size ?? 100) * 0.05)) };
	const Precise = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
	return Precise ? new Precise(text, new PIXI.TextStyle(style)) : new PIXI.Text(text, style);
};

export function hoverLines(region) {
	const origin = areaPoint(region);
	if (!origin) return [];
	return tokensInArea(region).filter((d) => d.object?.visible !== false && !d.hidden).map((d) => {
		const r = coverFromPoint(origin, d);
		return { token: d, level: r.level, from: origin, to: r.to };
	});
}

function drawHover(region, hovered) {
	clear(hoverLayer);
	if (!hovered || !isArea(region)) return;
	hoverLayer = ensure(hoverLayer, canvas.controls ?? canvas.interface);
	// What the area really covers, above the tokens (owner, v0.61.3: under them it was hard to see).
	const reach = new PIXI.Graphics();
	let poly = null;
	try { poly = reachPolygon(region); } catch { poly = null; }
	if (poly?.points?.length) {
		reach.beginFill(0xffe082, 0.07).lineStyle(2, 0xffc107, 0.6).drawPolygon(poly.points).endFill(); // v0.90.1: softer (owner: "light up too much")
	} else {
		const coverage = region.getCoverage?.();
		const size = canvas.grid.size;
		for (const o of coverage?.covered ?? []) {
			const { x, y } = canvas.grid.getTopLeftPoint(o);
			reach.beginFill(0xffe082, 0.06).lineStyle(1, 0xffc107, 0.45).drawRect(x, y, size, size).endFill();
		}
	}
	hoverLayer.addChild(reach);
	for (const line of hoverLines(region)) {
		const g = new PIXI.Graphics();
		g.lineStyle(3, COLORS[line.level], 0.9).moveTo(line.from.x, line.from.y).lineTo(line.to.x, line.to.y);
		hoverLayer.addChild(g);
		const t = label(localize(`LUCD20.PF2eRules.Cover.Level.${line.level}`), COLORS[line.level]);
		t.anchor?.set?.(0.5, 1);
		t.position.set(line.to.x, line.to.y - 6);
		hoverLayer.addChild(t);
	}
}

/** The area's shape with what walls cut off removed (Foundry's movement sweep from the origin, clipped). */
export function reachPolygon(region) {
	const origin = areaPoint(region);
	const shapePoly = region.polygons?.[0] ?? region.object?.polygons?.[0];
	const backend = CONFIG.Canvas?.polygonBackends?.move;
	if (!origin || !shapePoly || !backend?.create) return null;
	const sweep = backend.create(origin, { type: "move" });
	return sweep?.intersectPolygon ? sweep.intersectPolygon(shapePoly) : null;
}

function drawReach() {
	clear(reachLayer);
	if (!canvas?.ready) return;
	reachLayer = ensure(reachLayer, canvas.regions?._highlights ?? canvas.interface);
	for (const r of canvas.regions?.placeables ?? []) {
		const doc = r.document ?? r;
		if (!isArea(doc) || r.visible === false) continue;
		let poly = null;
		try { poly = reachPolygon(doc); } catch { poly = null; }
		if (!poly?.points?.length) continue;
		const g = new PIXI.Graphics();
		g.beginFill(0xffffff, 0.18).lineStyle(2, 0xffffff, 0.7).drawPolygon(poly.points).endFill();
		reachLayer.addChild(g);
	}
}

/**
 * The pointer over an area (owner, v0.61.2: Foundry's hoverRegion only fires with the Regions tool active):
 * the topmost effect area under the pointer, checked as the pointer moves.
 */
export function areaAt(point) {
	const areas = (canvas.regions?.placeables ?? []).map((r) => r.document ?? r).filter((d) => isArea(d) && d.object?.visible !== false);
	return areas.filter((d) => { try { return inShape(d, point); } catch { return false; } }).at(-1) ?? null;
}

let hovered = null, lastMove = 0;
function onPointerMove(feature) {
	const now = Date.now();
	if (now - lastMove < 60) return;
	lastMove = now;
	if (!canvas?.ready || !feature.get("hover")) return;
	const p = canvas.mousePosition;
	const region = p ? areaAt(p) : null;
	if (region === hovered) return;
	hovered = region;
	drawHover(region, !!region);
}

let timer = null;
const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { try { drawReach(); } catch (err) { error("Area overlay failed.", err); } }, 80); };

defineFeature({
	id: "pf2eAreas",
	category: "pf2e",
	systems: ["pf2e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		targeting: { kind: "boolean", default: true, scope: "world" },
		hover: { kind: "boolean", default: true, scope: "client" },
		reach: { kind: "boolean", default: true, scope: "client" }
	},

	init(feature) {
		initAreaEffects(feature);
	},

	enable(feature) {
		enableAreaEffects(feature, (region, filter) => chooseTargets(region, filter, { hidden: true }));
		feature.on("createRegion", (region, options, userId) => onCreateRegion(feature, region, options, userId).catch((err) => error("Area targeting failed.", err)));
		feature.on("hoverRegion", (region, over) => { if (feature.get("hover")) { hovered = over ? (region.document ?? region) : null; drawHover(hovered, over); } });
		const move = () => onPointerMove(feature);
		const attach = () => canvas.app?.view?.addEventListener?.("pointermove", move, { passive: true });
		const detach = () => canvas.app?.view?.removeEventListener?.("pointermove", move);
		attach();
		feature.on("canvasReady", () => { detach(); attach(); });
		feature.on("canvasTearDown", () => { hovered = null; clear(hoverLayer); });
		// The lines follow while things move (a token stepping into the area, a wall drawn).
		let again = null;
		const follow = () => {
			if (!hovered) return;
			clearTimeout(again);
			again = setTimeout(() => {
				const live = (canvas.regions?.placeables ?? []).some((r) => (r.document ?? r) === hovered);
				if (!live) hovered = null;
				drawHover(hovered, !!hovered);
			}, 60);
		};
		for (const hook of ["refreshToken", "updateRegion", "deleteRegion", "updateWall"]) feature.on(hook, follow);
		feature.onCleanup(detach);
		for (const hook of ["canvasReady", "createRegion", "updateRegion", "deleteRegion", "createWall", "updateWall", "deleteWall"]) {
			feature.on(hook, () => (feature.get("reach") ? redraw() : clear(reachLayer)));
		}
		redraw();
		feature.onCleanup(() => { clear(hoverLayer); clear(reachLayer); });
	},

	onSettingChange() {
		redraw();
	}
});

export const _test = { areaAt, onPointerMove, tokensInArea, chooseTargets, hoverLines, onCreateRegion, applyTargets, LEVELS };
