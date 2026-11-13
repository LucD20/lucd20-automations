import { MODULE_ID, SOCKET } from "../constants.mjs";
import { F, L, log } from "../utils.mjs";
import { reachable, rectAt, pointOf, key } from "./reach.mjs";

/*
 * Click-to-move: highlights the squares a token can reach, shows the path under the cursor, and
 * moves the token when a highlighted square is clicked. Esc or a right click skips.
 *
 * Step by step (toggle in the bar, remembered per user, or Shift+click for a single step): each click
 * adds that stretch to the planned path and the squares are recomputed from there with what's left;
 * the move happens on "Confirm" (Enter) or when no squares are left. Right click / Backspace undoes
 * the last stretch.
 *
 * While choosing, open windows are minimized so the map is clear, and restored afterwards.
 *
 * A bar above the hotbar says what is being chosen. It sits between the left controls and the
 * sidebar/chat, shrinking with the window (text is cut with "…", the buttons stay on the right).
 *
 * Only one picker is open at a time; further requests wait in a queue.
 */

const ORANGE = 0xef6c00;
const COLORS = { shift: 0x1e88e5, push: ORANGE, pull: ORANGE, slide: ORANGE, charge: 0xc62828 };
const ICONS = { shift: "fa-shoe-prints", push: "fa-arrow-right-from-bracket", pull: "fa-arrow-right-to-bracket", slide: "fa-arrows-up-down-left-right", charge: "fa-bolt" };
const STEP_KEY = `${MODULE_ID}.stepMove`;

let queue = Promise.resolve();
let active = null;

function stepPreference() {
	try {
		return localStorage.getItem(STEP_KEY) === "1";
	} catch (err) {
		return false;
	}
}

function setStepPreference(on) {
	try {
		localStorage.setItem(STEP_KEY, on ? "1" : "0");
	} catch (err) { /* private window: not remembered */ }
}

/**
 * Let the user choose where `token` goes.
 * @param {object} opts
 * @param {Token}  opts.token
 * @param {"shift"|"push"|"pull"|"slide"|"charge"} opts.mode
 * @param {number} opts.squares
 * @param {Token}  [opts.source]   Who pushes/pulls (and from whose point of view enemies are counted)
 * @param {string} [opts.power]    Name of the power, shown in the bar
 * @param {Map}    [opts.destinations]  Fixed destinations (charge); disables step by step
 * @param {string} [opts.targetName]    Shown in the bar for a charge
 * @param {string} [opts.action]   Token movement action for the waypoints (default "shift")
 * @param {object} [opts.moveOptions]  Extra flags passed with the movement (forced, countMovement)
 * @returns {Promise<{moved: boolean, squares: number, path?: {i,j}[]}>}
 */
export function pickMovement(opts) {
	const run = queue.then(() => openPicker(opts));
	queue = run.catch(() => {});
	return run;
}

export function isPicking() {
	return !!active;
}

function openPicker(opts) {
	return new Promise((resolve) => {
		const { token } = opts;
		if (!canvas.ready || !token?.document || token.destroyed || canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return resolve({ moved: false, squares: 0 });
		const picker = new Picker({ source: null, power: "", moveOptions: {}, action: "shift", ...opts, resolve });
		if (!picker.recompute()) {
			ui.notifications.warn(F("Move.NoSquares", { name: token.name }));
			return resolve({ moved: false, squares: 0 });
		}
		active = picker;
		picker.open();
	});
}

/* -------------------------------------------- */
/*  Windows                                       */
/* -------------------------------------------- */

/** Minimize every open window (ApplicationV2 and legacy), returning the ones minimized. */
function minimizeWindows() {
	const apps = new Set();
	for (const app of foundry.applications?.instances?.values?.() ?? []) {
		if (app.rendered && app.hasFrame && !app.minimized && (app.options?.window?.minimizable !== false)) apps.add(app);
	}
	for (const app of Object.values(ui.windows ?? {})) {
		if (app.rendered && !app._minimized && typeof app.minimize === "function" && app.options?.minimizable !== false) apps.add(app);
	}
	for (const app of apps) {
		try {
			app.minimize();
		} catch (err) { /* ignore */ }
	}
	return [...apps];
}

function restoreWindows(apps) {
	for (const app of apps ?? []) {
		try {
			if (app.rendered) app.maximize();
		} catch (err) { /* ignore */ }
	}
}

class Picker {
	constructor(opts) {
		Object.assign(this, opts);
		this.fixed = opts.destinations ?? null;
		this.hover = null;
		this.handlers = [];
		this.closed = false;
		this.plan = []; // committed stretches (step by step): [{ pos, steps, path, canStop }]
		this.step = !this.fixed && stepPreference();
	}

	get used() {
		return this.plan.reduce((a, e) => a + e.steps, 0);
	}

	get remaining() {
		return this.squares - this.used;
	}

	get planEnd() {
		return this.plan.at(-1)?.pos ?? null;
	}

	get fullPath() {
		return this.plan.flatMap((e) => e.path);
	}

	/** Recompute the highlighted squares from the end of the plan. Returns false if there are none. */
	recompute() {
		if (this.fixed) {
			this.destinations = this.fixed;
			return this.destinations.size > 0;
		}
		if (this.remaining <= 0) {
			this.destinations = new Map();
			return false;
		}
		this.destinations = reachable(this.token, {
			mode: this.mode, squares: this.remaining, source: this.source,
			from: this.planEnd, includePass: this.step,
		});
		return this.destinations.size > 0;
	}

	/* ---------------------------------------- */

	open() {
		this.minimized = minimizeWindows();
		this.layer = new PIXI.Container();
		this.layer.name = `${MODULE_ID}-move-picker`;
		this.layer.eventMode = "none";
		this.fill = new PIXI.Graphics();
		this.path = new PIXI.Graphics();
		this.layer.addChild(this.fill, this.path);
		canvas.interface.addChild(this.layer);
		this.drawSquares();
		this.openBar();
		this.listen();
		canvas.animatePan?.({ ...this.token.center, duration: 250 });
		log("move picker", this.mode, this.token.name, this.squares, `${this.destinations.size} squares`);
	}

	close(result) {
		if (this.closed) return;
		this.closed = true;
		for (const [target, type, fn, opts] of this.handlers) target.removeEventListener(type, fn, opts);
		this.layer?.destroy({ children: true });
		clearInterval(this.layoutTimer);
		window.removeEventListener("resize", this.layoutFn);
		this.bar?.remove();
		restoreWindows(this.minimized);
		active = null;
		this.resolve(result);
	}

	/* ---------------------------------------- */
	/*  Drawing                                  */
	/* ---------------------------------------- */

	get size() {
		return { w: Math.max(1, Math.round(this.token.document.width)), h: Math.max(1, Math.round(this.token.document.height)) };
	}

	drawSquares() {
		const g = this.fill;
		const color = COLORS[this.mode];
		const s = canvas.grid.size;
		const cells = new Map(); // cell -> can stop there
		const { w, h } = this.size;
		for (const d of this.destinations.values()) {
			const r = rectAt(d.pos, w, h);
			for (let i = r.i0; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) {
				const k = `${i},${j}`;
				cells.set(k, cells.get(k) || d.canStop !== false);
			}
		}
		g.clear();
		for (const [c, stop] of cells) {
			const [i, j] = c.split(",").map(Number);
			g.lineStyle(2, color, stop ? 0.9 : 0.45).beginFill(color, stop ? 0.22 : 0.08).drawRect(j * s + 2, i * s + 2, s - 4, s - 4).endFill();
		}
	}

	drawHover() {
		const g = this.path;
		g.clear();
		const s = canvas.grid.size;
		const { w, h } = this.size;
		const color = COLORS[this.mode];
		const center = (p) => ({ x: (p.j + w / 2) * s, y: (p.i + h / 2) * s });
		const start = center({ i: Math.round(this.token.document.y / s), j: Math.round(this.token.document.x / s) });
		const committed = this.fullPath;
		const all = [...committed, ...(this.hover?.path ?? [])];
		const line = (points, width, c, alpha) => {
			if (!points.length) return;
			g.lineStyle(width, c, alpha).moveTo(start.x, start.y);
			for (const p of points) g.lineTo(center(p).x, center(p).y);
		};
		line(all, 6, 0x000000, 0.5);
		line(all, 3, 0xffffff, 0.95);
		line(committed, 3, color, 1); // stretches already planned (step by step)
		for (const p of all) g.lineStyle(0).beginFill(0xffffff, 0.95).drawCircle(center(p).x, center(p).y, Math.max(4, s * 0.06)).endFill();
		const end = this.hover?.pos ?? this.planEnd;
		if (end) g.lineStyle(4, color, 1).beginFill(color, 0.35).drawRect(end.j * s + 3, end.i * s + 3, w * s - 6, h * s - 6).endFill();
		this.setCount(this.used + (this.hover?.steps ?? 0));
	}

	/* ---------------------------------------- */
	/*  Input                                    */
	/* ---------------------------------------- */

	on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts);
		this.handlers.push([target, type, fn, opts]);
	}

	destinationAt(ev) {
		const pt = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
		const s = canvas.grid.size;
		const cell = { i: Math.floor(pt.y / s), j: Math.floor(pt.x / s) };
		const exact = this.destinations.get(key(cell));
		if (exact) return exact;
		// Larger creatures: any destination whose footprint covers the cell (fewest steps first)
		const { w, h } = this.size;
		let best = null;
		for (const d of this.destinations.values()) {
			const r = rectAt(d.pos, w, h);
			if (cell.i < r.i0 || cell.i > r.i1 || cell.j < r.j0 || cell.j > r.j1) continue;
			if (!best || d.steps < best.steps) best = d;
		}
		return best;
	}

	listen() {
		const view = canvas.app.view;
		const capture = { capture: true };
		this.on(view, "pointermove", (ev) => {
			const d = this.destinationAt(ev);
			if (d !== this.hover) {
				this.hover = d;
				this.drawHover();
			}
		}, capture);
		this.on(view, "pointerdown", (ev) => {
			if (ev.button === 0) {
				const d = this.destinationAt(ev);
				if (!d) return;
				ev.preventDefault();
				ev.stopImmediatePropagation();
				if (!this.fixed && (this.step || ev.shiftKey)) this.addStep(d);
				else if (d.canStop !== false) this.finish([...this.fullPath, ...d.path], this.used + d.steps);
			} else if (ev.button === 2) {
				this.rightDown = { x: ev.clientX, y: ev.clientY };
			}
		}, capture);
		this.on(view, "pointerup", (ev) => {
			if (ev.button !== 2 || !this.rightDown) return;
			const moved = Math.hypot(ev.clientX - this.rightDown.x, ev.clientY - this.rightDown.y);
			this.rightDown = null;
			if (moved >= 6) return; // a right-drag pans the map
			if (this.plan.length) this.undo();
			else this.close({ moved: false, squares: 0 });
		}, capture);
		this.on(window, "keydown", (ev) => {
			if (ev.target?.closest?.("input, textarea, [contenteditable]")) return;
			if (ev.key === "Escape") {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				this.close({ moved: false, squares: 0 });
			} else if (ev.key === "Enter" && this.canConfirm) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				this.confirm();
			} else if (ev.key === "Backspace" && this.plan.length) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				this.undo();
			}
		}, capture);
	}

	/* ---------------------------------------- */
	/*  Step by step                             */
	/* ---------------------------------------- */

	get canConfirm() {
		return this.plan.length > 0 && this.plan.at(-1).canStop !== false;
	}

	addStep(d) {
		this.plan.push(d);
		this.hover = null;
		if (!this.recompute()) {
			// Nothing left: go if we can stop here, otherwise take the last stretch back
			if (this.canConfirm) return this.confirm();
			this.plan.pop();
			this.recompute();
		}
		this.refresh();
	}

	undo() {
		this.plan.pop();
		this.hover = null;
		this.recompute();
		this.refresh();
	}

	confirm() {
		if (this.canConfirm) this.finish(this.fullPath, this.used);
	}

	refresh() {
		this.drawSquares();
		this.drawHover();
		this.updateButtons();
	}

	setStepMode(on) {
		if (this.fixed) return;
		this.step = on;
		setStepPreference(on);
		if (!on) this.plan = [];
		this.hover = null;
		this.recompute();
		this.refresh();
	}

	async finish(path, steps) {
		if (this.busy || !path.length) return;
		this.busy = true;
		const ok = await moveTokenAlong(this.token.document, path, this.moveOptions, this.action);
		this.close({ moved: ok, squares: steps, path });
	}

	/* ---------------------------------------- */
	/*  Bar                                      */
	/* ---------------------------------------- */

	openBar() {
		const bar = document.createElement("div");
		bar.id = `${MODULE_ID}-move-bar`;
		bar.className = `d4ea-move-bar ${this.mode}`;
		const what = F(`Move.Bar.${this.mode}`, { name: this.token.name, squares: this.squares, target: this.targetName ?? "" });
		const power = this.power ? `<span class="d4ea-move-power">${foundry.utils.escapeHTML(this.power)}</span>` : "";
		const stepToggle = this.fixed ? "" : `<button type="button" class="d4ea-move-step" data-d4ea-move="step" data-tooltip="${L("Move.StepHint")}"><i class="fa-solid fa-shoe-prints"></i><span>${L("Move.Step")}</span></button>`;
		bar.innerHTML = `
			<i class="fa-solid ${ICONS[this.mode]} d4ea-move-icon"></i>
			<div class="d4ea-move-text">${power}<span class="d4ea-move-what">${foundry.utils.escapeHTML(what)}</span>
				<span class="d4ea-move-hint"></span></div>
			<span class="d4ea-move-count"></span>
			${stepToggle}
			<button type="button" data-d4ea-move="confirm" class="d4ea-move-confirm" data-tooltip="${L("Move.Confirm")}"><i class="fa-solid fa-check"></i><span>${L("Move.Confirm")}</span></button>
			<button type="button" data-d4ea-move="skip" data-tooltip="${L("Move.Skip")}"><i class="fa-solid fa-forward"></i><span>${L("Move.Skip")}</span></button>`;
		bar.addEventListener("click", (ev) => {
			const btn = ev.target.closest("[data-d4ea-move]");
			if (!btn) return;
			const action = btn.dataset.d4eaMove;
			if (action === "skip") this.close({ moved: false, squares: 0 });
			else if (action === "confirm") this.confirm();
			else if (action === "step") this.setStepMode(!this.step);
		});
		document.body.append(bar);
		this.bar = bar;
		this.updateButtons();
		this.layoutFn = () => layoutBar(bar);
		window.addEventListener("resize", this.layoutFn);
		this.layoutTimer = setInterval(this.layoutFn, 300); // follows the sidebar opening/closing
		this.layoutFn();
	}

	updateButtons() {
		if (!this.bar) return;
		this.bar.classList.toggle("stepping", this.step);
		this.bar.querySelector(".d4ea-move-step")?.classList.toggle("active", this.step);
		const confirm = this.bar.querySelector(".d4ea-move-confirm");
		confirm.hidden = !this.step;
		confirm.disabled = !this.canConfirm;
		this.bar.querySelector(".d4ea-move-hint").textContent = this.fixed ? L("Move.HintCharge") : (this.step ? L("Move.HintStep") : L("Move.Hint"));
		this.setCount(this.used);
	}

	setCount(steps) {
		const el = this.bar?.querySelector(".d4ea-move-count");
		if (el) el.textContent = steps ? F("Move.Count", { steps, squares: this.squares }) : "";
	}
}

/* -------------------------------------------- */
/*  Bar layout                                    */
/* -------------------------------------------- */

function visibleRect(id) {
	const el = document.getElementById(id);
	if (!el) return null;
	const r = el.getBoundingClientRect();
	if (!r.width || !r.height) return null;
	const style = getComputedStyle(el);
	if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
	return r;
}

/**
 * Place the bar right above the hotbar, between the left UI column and the sidebar / chat
 * notifications, and as wide as that gap allows (up to 640px).
 */
export function layoutBar(bar) {
	const vw = window.innerWidth, vh = window.innerHeight;
	const gap = 10;
	const hotbar = visibleRect("hotbar");
	let left = gap;
	const uiLeft = visibleRect("ui-left");
	if (uiLeft) left = Math.max(left, Math.min(uiLeft.right, vw * 0.35) + gap);
	let right = vw - gap;
	for (const id of ["sidebar", "ui-right"]) {
		const r = visibleRect(id);
		if (r && r.left > vw / 2) right = Math.min(right, r.left - gap);
	}
	const bottom = hotbar ? (vh - hotbar.top + 6) : 16;
	const notes = visibleRect("chat-notifications");
	if (notes && notes.left > vw / 2 && notes.top < vh - bottom) right = Math.min(right, notes.left - gap);

	const available = Math.max(220, right - left);
	const width = Math.min(640, available);
	const anchor = hotbar ? (hotbar.left + hotbar.right) / 2 : (left + right) / 2;
	const x = Math.min(Math.max(anchor - width / 2, left), Math.max(left, right - width));
	Object.assign(bar.style, { left: `${Math.round(x)}px`, width: `${Math.round(width)}px`, bottom: `${Math.round(bottom)}px` });
	// Narrow: the buttons keep their place but show only their icons
	bar.classList.toggle("compact", width < 460);
}

/* -------------------------------------------- */
/*  Moving                                        */
/* -------------------------------------------- */

/**
 * Move a token through the given squares as a shift (no opportunity attacks). Tokens the user
 * doesn't own are moved by the active GM.
 * @param {TokenDocument} tokenDoc
 * @param {{i, j}[]} path
 * @param {object} flags   { forced?: boolean, countMovement?: boolean }
 */
export async function moveTokenAlong(tokenDoc, path, flags = {}, action = "shift") {
	const waypoints = path.map((p) => ({ ...pointOf(p), action }));
	if (tokenDoc.isOwner) return doMove(tokenDoc, waypoints, flags);
	if (!game.users.activeGM) {
		ui.notifications.warn(F("Warn.NoGM", { name: tokenDoc.name }));
		return false;
	}
	game.socket.emit(SOCKET, { op: "move", tokenUuid: tokenDoc.uuid, waypoints, flags });
	return true;
}

async function doMove(tokenDoc, waypoints, flags) {
	try {
		await tokenDoc.move(waypoints, {
			[MODULE_ID]: flags,
			constrainOptions: { ignoreCost: true },
			autoRotate: false,
		});
		return true;
	} catch (err) {
		console.error(`${MODULE_ID} | move failed`, err);
		return false;
	}
}

export async function handleMoveSocket(payload) {
	const tokenDoc = await fromUuid(payload.tokenUuid);
	if (tokenDoc) await doMove(tokenDoc, payload.waypoints, payload.flags ?? {});
}
