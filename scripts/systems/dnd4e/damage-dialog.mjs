import { MODULE_ID } from "./constants.mjs";
import { L, log, maximize } from "./utils.mjs";
import * as quarry from "./features/quarry.mjs";
import * as curse from "./features/curse.mjs";
import * as rage from "./features/rage.mjs";
import * as furiousAssault from "./features/furious-assault.mjs";
import * as onHit from "./features/on-hit.mjs";

/*
 * The dnd4e damage dialog doesn't receive the power being rolled, so we remember it from the
 * "dnd4e.rollDamage" hook, which fires right before the dialog opens.
 * Each "extra" is shown as a checkbox; checked extras are added to the roll when it's submitted.
 */

let pending = null;
const WRAPPED = Symbol(`${MODULE_ID}.wrapped`);

export function onRollDamage(item) {
	pending = { item, time: Date.now() };
}

/** Collect the extras that apply to this roll. */
function collectExtras(ctx) {
	const extras = [];
	for (const fn of [quarry.damageExtra, curse.damageExtra, furiousAssault.damageExtra, onHit.damageExtra]) {
		const e = fn(ctx);
		if (e) extras.push(e);
	}
	extras.push(...rage.damageExtras(ctx));
	return extras;
}

function isDamageDialog(app) {
	return !!app.rollConfig && !app.dialogData?.isD20Roll && (app.dialogData?.formula === "@damage + @bonus")
		&& !(app.buttons ?? []).some((b) => b.action === "heal");
}

export function onRenderRollDialog(app, element) {
	if (!isDamageDialog(app)) return;
	if (!pending || (Date.now() - pending.time > 5000)) return;
	const item = pending.item;
	const actor = item?.actor;
	if (!actor) return;

	if (!app[WRAPPED]) {
		const targets = Array.from(game.user.targets);
		app[WRAPPED] = { item, extras: collectExtras({ actor, item, targets }) };
		wrapCallback(app);
	}
	const { extras } = app[WRAPPED];
	if (!extras.length) return;

	const root = element instanceof HTMLElement ? element : element[0];
	root.querySelector(".d4ea-extras")?.remove();
	const fieldset = document.createElement("fieldset");
	fieldset.className = "d4ea-extras";
	fieldset.innerHTML = `<legend>${L("Damage.Legend")}</legend>` + extras.map((e) => `
		<label class="d4ea-extra" data-tooltip="${foundry.utils.escapeHTML(e.hint ?? "")}">
			<input type="checkbox" data-d4ea-extra="${e.id}" ${e.checked ? "checked" : ""}>
			<span>${foundry.utils.escapeHTML(e.label)}</span>
			${e.hint ? `<small>${foundry.utils.escapeHTML(e.hint)}</small>` : ""}
		</label>`).join("");
	fieldset.addEventListener("change", (ev) => {
		const id = ev.target?.dataset?.d4eaExtra;
		const extra = extras.find((x) => x.id === id);
		if (extra) extra.checked = ev.target.checked;
	});

	const bonusGroup = root.querySelector("input[name='bonus']")?.closest(".form-group");
	if (bonusGroup) bonusGroup.after(fieldset);
	else root.querySelector(".roll-dialogue")?.prepend(fieldset);
	app.setPosition?.({ height: "auto" });
}

/** Insert a part just before the trailing "@bonus" placeholder. */
function insertPart(parts, part) {
	if (!Array.isArray(parts)) return;
	const idx = parts.lastIndexOf("@bonus");
	if (idx >= 0) parts.splice(idx, 0, part);
	else parts.push(part);
}

function wrapCallback(app) {
	const original = app.callbackFn;
	app.callbackFn = async (form, rollConfig) => {
		const hitType = rollConfig.hitType ?? "normal";
		const damageType = rollConfig.options?.flavor;
		const typed = (f) => (damageType ? `(${f})[${damageType}]` : `(${f})`);
		const applied = [];
		for (const extra of app[WRAPPED].extras) {
			if (!extra.checked) continue;
			if (extra.requiresHit && (hitType === "miss")) continue;
			if (hitType === "crit") insertPart(rollConfig.partsCrit, typed(maximize(extra.formula)));
			else if (hitType === "miss") insertPart(rollConfig.partsMiss, typed(extra.formula));
			else insertPart(rollConfig.parts, typed(extra.formula));
			applied.push(extra);
		}
		log("damage extras applied", hitType, applied.map((e) => e.id));
		// For the readable breakdown in chat
		if (rollConfig.options) {
			const item = app[WRAPPED]?.item;
			rollConfig.options.d4eaInfo = { actor: item?.actor?.name ?? "", power: item?.name ?? "", ability: item?.system?.attack?.ability ?? "", damage: true };
			rollConfig.options.d4eaExtras = applied.map((e) => ({ label: e.label, formula: e.formula }));
		}
		pending = null;
		const result = await original(form, rollConfig);
		for (const extra of applied) await extra.onApplied?.();
		return result;
	};
}
