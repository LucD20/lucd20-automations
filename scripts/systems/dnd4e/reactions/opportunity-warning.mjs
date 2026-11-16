import { defineFeature } from "../../../core/registry.js";
import { provokedAlong } from "./opportunity.mjs";

/*
 * Opportunity Attack Warning (D&D 4e).
 *
 * While a token is dragged in combat, every enemy the planned move would provoke an opportunity
 * attack from gets a warning mark and an arrow to the square the mover would leave. The rules are
 * the opportunity cards' own (provokedAlong): leaving a square next to an enemy that still has its
 * opportunity action, can act and is not on its own turn; shifting and teleporting never provoke.
 * Only enemies this user can see are marked.
 *
 * The planned path comes from Token#findMovementPath: Pathfinding announces every search it answers
 * (hook lucd20MovementPath), and this feature wraps the method too for when Pathfinding is off.
 * The marks are drawn on this client only, above the tokens, and cleared when the drag ends. A short
 * "shing" plays when another enemy becomes a threat (per-player setting).
 */

const COLOR = 0xff5a3d;
const state = { layer: null, serial: 0, marked: new Set(), feature: null, audio: null };

function clear() {
	state.serial++;
	state.layer?.destroy({ children: true });
	state.layer = null;
	state.marked = new Set();
}

function centre(x, y, width, height) {
	const size = canvas.grid.size;
	return { x: x + (width * size) / 2, y: y + (height * size) / 2 };
}

function draw(mover, provoked) {
	state.layer?.destroy({ children: true });
	state.layer = null;
	// The sound marks the moment an enemy becomes a threat, not every redraw of the same ones.
	const before = state.marked ?? new Set();
	state.marked = new Set(provoked.keys());
	if (state.feature?.get("sound") && [...state.marked].some(t => !before.has(t))) shing();
	if (!provoked.size) return;
	const size = canvas.grid.size;
	const layer = new PIXI.Container();
	layer.eventMode = "none";
	for (const [threat, from] of provoked) {
		const a = centre(threat.document.x, threat.document.y, threat.document.width, threat.document.height);
		const b = centre(from.x, from.y, mover.document.width, mover.document.height);
		const angle = Math.atan2(b.y - a.y, b.x - a.x);
		const head = size * 0.22;
		// Stop the arrow at the edge of the square that is left, so it does not cover the token being dragged.
		const tip = { x: b.x - Math.cos(angle) * size * 0.3, y: b.y - Math.sin(angle) * size * 0.3 };
		const arrow = new PIXI.Graphics();
		arrow.lineStyle(Math.max(4, size / 14), 0x000000, 0.55).moveTo(a.x, a.y).lineTo(tip.x, tip.y);
		arrow.lineStyle(Math.max(2, size / 22), COLOR, 1).moveTo(a.x, a.y).lineTo(tip.x, tip.y);
		arrow.lineStyle(1, 0x000000, 0.6).beginFill(COLOR, 1)
			.moveTo(tip.x + Math.cos(angle) * head * 0.6, tip.y + Math.sin(angle) * head * 0.6)
			.lineTo(tip.x - Math.cos(angle - 0.5) * head, tip.y - Math.sin(angle - 0.5) * head)
			.lineTo(tip.x - Math.cos(angle + 0.5) * head, tip.y - Math.sin(angle + 0.5) * head)
			.closePath().endFill();
		layer.addChild(arrow);
		// A badge on the threatening token's corner.
		const r = size * 0.17;
		const corner = { x: threat.document.x + threat.document.width * size - r, y: threat.document.y + r };
		const badge = new PIXI.Graphics();
		badge.lineStyle(2, 0x000000, 0.8).beginFill(COLOR, 1).drawCircle(corner.x, corner.y, r).endFill();
		const mark = new PIXI.Text("!", { fontFamily: "Signika, sans-serif", fontSize: r * 1.7, fontWeight: "900", fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
		mark.anchor.set(0.5);
		mark.position.set(corner.x, corner.y);
		layer.addChild(badge, mark);
	}
	// Above the tokens (and the one being dragged): the controls layer is drawn over them.
	const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
	layer.zIndex = 10000;
	parent.addChild(layer);
	if (parent.sortableChildren) parent.sortChildren?.();
	state.layer = layer;
}

/** A short metallic "shing", made here (no sound file): played when another enemy becomes a threat. */
function shing() {
	try {
		const Ctx = window.AudioContext ?? window.webkitAudioContext;
		if (!Ctx) return;
		const ctx = (state.audio ??= new Ctx());
		if (ctx.state === "suspended") ctx.resume();
		const volume = Math.min(1, Math.max(0, Number(game.settings.get("core", "globalInterfaceVolume") ?? 0.5)));
		if (!volume) return;
		const now = ctx.currentTime;
		const out = ctx.createGain();
		out.gain.value = volume * 0.5;
		out.connect(ctx.destination);
		// The scrape: filtered noise sweeping upward.
		const length = Math.floor(ctx.sampleRate * 0.28);
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 2.5;
		band.frequency.setValueAtTime(2200, now);
		band.frequency.exponentialRampToValueAtTime(9000, now + 0.22);
		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.0001, now);
		noiseGain.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
		noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
		noise.connect(band).connect(noiseGain).connect(out);
		noise.start(now);
		// The ring: two high partials that fade.
		for (const [frequency, level] of [[3520, 0.22], [5280, 0.14]]) {
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.setValueAtTime(frequency * 0.97, now);
			osc.frequency.exponentialRampToValueAtTime(frequency, now + 0.08);
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, now + 0.02);
			gain.gain.exponentialRampToValueAtTime(level, now + 0.06);
			gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.55);
			osc.connect(gain).connect(out);
			osc.start(now + 0.02);
			osc.stop(now + 0.6);
		}
		state.shings = (state.shings ?? 0) + 1;
	} catch (err) {
		// No sound is not worth an error.
	}
}

/** A path search was answered for a token: mark who it would provoke. */
async function onPath(token, search) {
	const serial = ++state.serial;
	if (!game.combat?.started || !token?.document?.combatant || !canvas.grid || canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return draw(token, new Map());
	let path = search?.result;
	if (!Array.isArray(path)) {
		try {
			path = await search?.promise;
		} catch (err) {
			path = null;
		}
	}
	if (serial !== state.serial) return; // a newer search, or the drag ended
	if (!Array.isArray(path) || path.length < 2) return draw(token, new Map());
	draw(token, provokedAlong(token, path[0], path.slice(1), { visibleOnly: !game.user.isGM }));
}

defineFeature({
	id: "dnd4eOpportunityWarning",
	category: "dnd4e",
	systems: ["dnd4e"],
	scope: "world",
	defaultEnabled: true,
	settings: {
		sound: { kind: "boolean", default: true, scope: "client" }
	},

	enable(feature) {
		state.feature = feature;
		feature.on("lucd20MovementPath", onPath);
		const TokenClass = CONFIG.Token?.objectClass;
		if (typeof TokenClass?.prototype?.findMovementPath === "function") {
			feature.wrap(TokenClass.prototype, "findMovementPath", function (original, waypoints, options) {
				const search = original(waypoints, options);
				onPath(this, search);
				return search;
			});
		}
		// The drag is over (dropped, cancelled) or the token moved: the marks go.
		for (const hook of ["moveToken", "combatTurnChange", "canvasTearDown"]) feature.on(hook, clear);
		const onKey = event => { if (event.key === "Escape") clear(); };
		window.addEventListener("pointerup", clear, true);
		window.addEventListener("contextmenu", clear, true);
		window.addEventListener("keydown", onKey, true);
		feature.onCleanup(() => {
			window.removeEventListener("pointerup", clear, true);
			window.removeEventListener("contextmenu", clear, true);
			window.removeEventListener("keydown", onKey, true);
			clear();
			state.feature = null;
		});
	}
});

export const _test = { onPath, clear, state };
