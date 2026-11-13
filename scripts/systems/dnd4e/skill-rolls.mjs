import { MODULE_ID, KIND } from "./constants.mjs";
import { setting } from "./utils.mjs";
import { deleteEffects, effectsOfKind } from "./effects.mjs";

/*
 * Skill checks:
 *  - The system rolls "1d20 + @mod" with the whole skill total in @mod. We split it into named parts
 *    (ability, training, ½ level, armour penalty, the rest) so the roll dialog and the chat breakdown
 *    show where each number comes from.
 *  - The module's own bonuses are listed in the roll dialog with a toggle, like the attack dialog:
 *      Words of Friendship   +5 to the next Diplomacy check (on by default; used up by the check)
 *      Fate of the Void      +N to one d20 roll on your turn (off by default; used up if you turn it on)
 *    A bonus left on is used up when the check is rolled; one turned off stays for later.
 *  - Skill lists on actor sheets are sorted by their displayed label, so they stay alphabetical in any
 *    language (the system orders them by key: acr, arc, ath...).
 * Bonuses for one skill come from active effects with flags[MODULE_ID].skillBonus = { skill, value, var }.
 * The bonus part is taken out of the skill total (the effect already raised it), so the total is unchanged.
 */

const TRAINING = { 8: "expertise", 5: "trained", 0: "untrained" };
let pending = null; // { actor, skillId, optional: [...], time } for the skill check being rolled

/** Fixed named parts for a skill check: [{ var, value }], plus the module bonuses that are already in the total. */
export function skillParts(actor, skillId) {
	const sys = actor?.system;
	const skl = sys?.skills?.[skillId];
	if (!skl || !Number.isFinite(Number(skl.total)) || Number.isFinite(parseInt(skl.absolute))) return null;
	const total = Number(skl.total);
	const parts = [];
	const add = (v, value) => { if (value) parts.push({ var: v, value }); };
	add(`ability_${skl.ability}`, Number(skl.mod) || 0);
	const tr = sys.skillTraining?.[TRAINING[skl.training]];
	add("training", tr ? (Number(tr.value) || 0) + (Number(tr.untyped) || 0) : 0);
	let halfLevel = true;
	try { halfLevel = !game.settings.get("dnd4e", "halfLevelOptions"); } catch (e) { /* default rules */ }
	if (halfLevel) add("lvhalf", Math.floor((Number(sys.details?.level) || 0) / 2));
	add("armourPen", -(Number(skl.armourPen) || 0));
	const bonuses = skillBonuses(actor, skillId);
	const known = parts.reduce((a, p) => a + p.value, 0) + bonuses.reduce((a, b) => a + b.value, 0);
	add("skillOther", total - known);
	return parts.concat(bonuses.map((b) => ({ var: b.var, value: b.value })));
}

/** The module's bonuses that are already part of this skill's total (Words of Friendship). */
function skillBonuses(actor, skillId) {
	return (actor.effects ?? []).filter((e) => !e.disabled && e.flags?.[MODULE_ID]?.skillBonus?.skill === skillId)
		.map((e) => ({ ...e.flags[MODULE_ID].skillBonus, value: Number(e.flags[MODULE_ID].skillBonus.value) || 0, effect: e }));
}

/** Bonuses shown with a toggle in the dialog: [{ var, value, label, checked, inTotal, effectId }]. */
export function optionalBonuses(actor, skillId) {
	const out = skillBonuses(actor, skillId).map((b) => ({
		var: b.var, value: b.value, label: varLabel(b.var), checked: true, inTotal: true, effectId: b.effect.id,
	}));
	const fate = effectsOfKind(actor, KIND.FATE_OF_THE_VOID)[0];
	const stacks = Number(fate?.flags?.[MODULE_ID]?.stacks) || 0;
	if (stacks) {
		out.push({
			var: "fateOfTheVoid", value: stacks, checked: false, inTotal: false, effectId: fate.id,
			label: (fate.name ?? "").replace(/\s*\(\s*[+−-]?\d+\s*\)\s*$/, "") || varLabel("fateOfTheVoid"),
		});
	}
	return out;
}

const varLabel = (v) => game.i18n.localize(`DND4EAUTO.RollVars.${v}`);

function wrapRollSkill() {
	const proto = CONFIG.Actor?.documentClass?.prototype;
	if (!proto?.rollSkill || proto.rollSkill.d4eaParts) return;
	const original = proto.rollSkill;
	const wrapped = async function (skillId, options = {}) {
		let optional = [];
		try {
			optional = optionalBonuses(this, skillId);
			if (setting("readableRolls") && !options.parts) {
				const parts = skillParts(this, skillId);
				if (parts?.length) {
					// A bonus that is in the total but turned off later is subtracted in the dialog
					const used = parts.filter((p) => !optional.some((o) => o.var === p.var) || optional.find((o) => o.var === p.var).checked);
					options.parts = used.map((p) => `@${p.var}`);
					options.data = Object.fromEntries(parts.concat(optional).map((p) => [p.var, p.value]));
				}
			}
			pending = { actor: this, skillId, optional, time: Date.now() };
		} catch (err) {
			console.error(`${MODULE_ID} | skill parts`, err);
		}
		const result = await original.call(this, skillId, options);
		// Rolled (not cancelled): bonuses left on are used up
		if (result) {
			const spent = optional.filter((o) => o.checked && o.effectId).map((o) => o.effectId);
			if (spent.length) await deleteEffects(this, spent).catch((e) => console.error(`${MODULE_ID} | skill bonus`, e));
		}
		if (pending?.actor === this) pending = null;
		return result;
	};
	wrapped.d4eaParts = true;
	proto.rollSkill = wrapped;
}

/* -------------------------------------------- */
/*  Roll dialog                                   */
/* -------------------------------------------- */

const SKILL_VARS = /@(ability_|training|skillOther|armourPen|lvhalf)/;

function formulaText(rollConfig, labelFor) {
	const data = rollConfig.data ?? {};
	return ["1d20", ...rollConfig.parts.filter((p) => p !== "@bonus").map((p) => {
		const v = p.replace(/^@/, "");
		const value = Number(data[v]);
		return Number.isFinite(value) ? `${value} (${labelFor(v)})` : p;
	})].join(" + ");
}

/**
 * Turning a bonus on/off adds or drops its part. Words of Friendship is already inside the skill total,
 * but it has its own part (taken out of "Other bonuses"), so dropping the part removes exactly its +5.
 */
function setBonus(rollConfig, opt, on) {
	const parts = rollConfig.parts;
	const name = `@${opt.var}`;
	const idx = parts.indexOf(name);
	if (on && idx < 0) {
		const at = parts.indexOf("@bonus");
		parts.splice(at < 0 ? parts.length : at, 0, name);
	} else if (!on && idx >= 0) parts.splice(idx, 1);
	opt.checked = on;
}

export function onRenderRollDialog(app, element, labelFor) {
	const root = element instanceof HTMLElement ? element : element?.[0];
	const input = root?.querySelector("input[name='formula']");
	const rollConfig = app?.rollConfig;
	if (!input || !rollConfig?.parts || !SKILL_VARS.test(rollConfig.parts.join(" "))) return;
	input.value = formulaText(rollConfig, labelFor);
	input.title = input.value;

	if (!app.d4eaSkill) {
		app.d4eaSkill = pending && Date.now() - pending.time < 10000 ? pending : { optional: [] };
	}
	const { optional } = app.d4eaSkill;
	root.querySelector(".d4ea-skill-mods")?.remove();
	if (!optional.length) return;
	const box = document.createElement("fieldset");
	box.className = "d4ea-atk-mods d4ea-skill-mods";
	box.innerHTML = `<legend>${game.i18n.localize("DND4EAUTO.OnHit.AutoModsLegend")}</legend>` + optional.map((o, i) => `
		<label class="d4ea-atk-mod bonus ${o.checked ? "" : "off"}">
			<input type="checkbox" data-d4ea-skill-mod="${i}" ${o.checked ? "checked" : ""}>
			${foundry.utils.escapeHTML(o.label)} +${o.value}</label>`).join(" ");
	box.addEventListener("change", (ev) => {
		const opt = optional[Number(ev.target?.dataset?.d4eaSkillMod)];
		if (!opt) return;
		setBonus(rollConfig, opt, ev.target.checked);
		ev.target.closest(".d4ea-atk-mod")?.classList.toggle("off", !ev.target.checked);
		input.value = formulaText(rollConfig, labelFor);
		input.title = input.value;
	});
	(input.closest(".form-group") ?? input).after(box);
}

/* -------------------------------------------- */
/*  Alphabetical skill lists                      */
/* -------------------------------------------- */

const labelOf = (el) => (el.querySelector(".skill-name, [data-action='rollSkillCheck'], h4") ?? el).textContent.trim();

export function sortSkillLists(element) {
	const root = element instanceof HTMLElement ? element : element?.[0];
	if (!root) return;
	const parents = new Set([...root.querySelectorAll("[data-skill]")].map((el) => el.parentElement));
	const lang = game.i18n?.lang || "pt-BR";
	for (const parent of parents) {
		const items = [...parent.children].filter((el) => el.dataset?.skill);
		if (items.length < 5) continue;
		const sorted = [...items].sort((a, b) => labelOf(a).localeCompare(labelOf(b), lang, { sensitivity: "base" }));
		if (sorted.every((el, i) => el === items[i])) continue;
		const marker = document.createComment("d4ea-skills");
		items[0].before(marker);
		marker.after(...sorted);
		marker.remove();
	}
}

export function registerSkillRollHooks() {
	Hooks.once("ready", wrapRollSkill);
	Hooks.on("renderApplicationV2", (app, element) => {
		try {
			if (app.document instanceof Actor) sortSkillLists(element);
		} catch (err) {
			console.error(`${MODULE_ID} | skill sort`, err);
		}
	});
}
