import { setting } from "./utils.mjs";

/*
 * Readable roll breakdowns in chat. The dnd4e system shows the roll "expression" with raw
 * variables ("1d20 + @wepAttack + @powerMod + @lvhalf"); each variable span is paired by id with
 * the span of its value in the formula. We replace that line with a grouped breakdown:
 *
 *   Aegustarion — Ranged Basic Attack: 1d20 + 7
 *   Bonuses        Weapon (Training) +2 · Ability (Dexterity) +4 · ½ Level +0
 *   Situational    Prime Shot +1
 *   Penalties      Long Range −2
 *
 * The module's own modifiers (Prime Shot, Vicious Mockery) and damage extras (Hunter's Quarry...)
 * are stored on the roll options and included too.
 */

const L = (k, d) => (d ? game.i18n.format(`DND4EAUTO.RollVars.${k}`, d) : game.i18n.localize(`DND4EAUTO.RollVars.${k}`));

const LABEL_KEYS = {
	wepAttack: "wepAttack", impAttack: "impAttack", lvhalf: "lvhalf", bonus: "bonus",
	powBase: "powBase", powMax: "powMax", wepDamage: "wepDamage", impDamage: "impDamage",
	wepCritBonus: "wepCritBonus", impCritBonus: "impCritBonus", highCrit: "highCrit", versatile: "versatile",
	extraDamage: "extraDamage", actorBonusDamage: "bonusDamage", dmg: "bonusDamage",
	ammo: "ammo", ammoC: "ammo", ammoM: "ammo", powAmmo: "ammo", powAmmoC: "ammo", powAmmoM: "ammo",
	wep2ndryDamage: "wep2ndryDamage", pow2ndryDamage: "wep2ndryDamage",
	training: "training", armourPen: "armourPen", skillOther: "skillOther", wordsOfFriendship: "wordsOfFriendship", fateOfTheVoid: "fateOfTheVoid",
};

/** Readable name for a roll variable ("@training" -> "Training"). */
export const labelForVariable = (variable) => labelFor(variable, null);

function abilityName(ability) {
	const a = CONFIG.DND4E?.abilities?.[ability];
	const label = typeof a === "string" ? a : a?.label;
	return label ? game.i18n.localize(label) : "";
}

function labelFor(variable, info) {
	const ability = variable.match(/^ability_(\w+)$/)?.[1];
	if (ability) return abilityName(ability) || ability;
	if (variable === "powerMod") {
		const ab = abilityName(info?.ability);
		return ab ? L("powerModNamed", { ability: ab }) : L("powerMod");
	}
	const common = CONFIG.DND4E?.commonAttackBonuses?.[variable];
	if (common?.label) return game.i18n.localize(common.label);
	const key = LABEL_KEYS[variable];
	return key ? L(key) : variable;
}

const isSituational = (variable) => variable === "bonus" || !!CONFIG.DND4E?.commonAttackBonuses?.[variable];
const isDice = (text) => /\d*d\d+/i.test(text);
const fmt = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "+0");

/** Collect { label, value (number|null), text, kind: "bonus"|"situational"|"penalty"|"dice" } from a rendered roll. */
function collect(rollEl, expression, roll) {
	const info = roll?.options?.d4eaInfo;
	const extras = roll?.options?.d4eaExtras ?? [];
	const ownMods = (roll?.options?.d4eaMods ?? []).map((m) => ({ ...m, type: m.type ?? "untyped" }));
	const handled = new Set();
	const items = [];
	for (const span of expression.querySelectorAll(".roll-expression")) {
		if (span.querySelector(".roll-expression")) continue; // only leaf parts
		const text = span.textContent.trim();
		if (!text) continue;
		const formulaSpan = span.id ? rollEl.querySelector(`#${CSS.escape(span.id.replace(/^exp/, "form"))}`) : null;
		const valueText = (formulaSpan?.textContent ?? text).trim();
		const varMatch = text.match(/^@([A-Za-z0-9_]+)$/);
		const numeric = Number(valueText.replace(/[()\s]/g, ""));
		if (!varMatch) {
			if (isDice(valueText)) {
				const extra = extras.find((e) => valueText.includes(String(e.formula)));
				items.push(extra ? { label: extra.label, text: valueText, kind: "situational", value: null } : { text: valueText.replace(/\[[^\]]*\]/g, ""), kind: "dice" });
			} else if (Number.isFinite(numeric)) {
				items.push({ label: L("fixed"), value: numeric, kind: numeric < 0 ? "penalty" : "bonus" });
			}
			continue;
		}
		const variable = varMatch[1];
		const effectType = variable.match(/^(\w+)EffectBonus$/)?.[1];
		if (effectType && Number.isFinite(numeric)) {
			items.push(...effectBonusItems(effectType, numeric, ownMods, handled));
			continue;
		}
		const label = labelFor(variable, info);
		if (Number.isFinite(numeric)) {
			items.push({ label, value: numeric, kind: numeric < 0 ? "penalty" : (isSituational(variable) ? "situational" : "bonus") });
		} else {
			items.push({ label, text: valueText.replace(/\[[^\]]*\]/g, ""), value: null, kind: isDice(valueText) ? "damageDice" : "bonus" });
		}
	}
	for (const m of ownMods) {
		if (!handled.has(m)) items.push({ label: m.label, value: m.value, kind: m.value < 0 ? "penalty" : "situational" });
	}
	return { items, info };
}

const kindOf = (v) => (v < 0 ? "penalty" : "situational");

/**
 * "@untypedEffectBonus" / "@raceEffectBonus"... is the total of one bonus type, from active effects
 * plus the module's own modifiers. Show the module's modifiers by name and the rest as "Effects".
 */
function effectBonusItems(type, total, ownMods, handled) {
	const mine = ownMods.filter((m) => m.type === type);
	mine.forEach((m) => handled.add(m));
	const effectsLabel = type === "untyped" ? L("effectBonus") : L("effectBonusTyped", { type: L(`bonusType.${type}`) });
	if (type === "untyped") {
		const out = mine.map((m) => ({ label: m.label, value: m.value, kind: kindOf(m.value) }));
		const rest = total - mine.reduce((a, m) => a + m.value, 0);
		if (rest) out.push({ label: effectsLabel, value: rest, kind: kindOf(rest) });
		return out;
	}
	// Typed bonuses don't stack: only the highest counts
	const best = mine.reduce((b, m) => (!b || m.value > b.value ? m : b), null);
	if (best && best.value >= total) return [{ label: best.label, value: total, kind: kindOf(total) }];
	return total ? [{ label: effectsLabel, value: total, kind: kindOf(total) }] : [];
}

function renderBreakdown({ items, info }) {
	const dice = items.filter((i) => i.kind === "dice").map((i) => i.text);
	const damageDice = items.filter((i) => i.kind === "damageDice" || (i.value === null && i.text && i.kind !== "dice"));
	const sum = items.reduce((a, i) => a + (Number.isFinite(i.value) ? i.value : 0), 0);
	const summary = [...dice, ...damageDice.map((i) => i.text)].join(" + ") + (sum ? ` ${sum > 0 ? "+" : "−"} ${Math.abs(sum)}` : "");
	const who = [info?.actor, info?.power].filter(Boolean).join(" — ");
	const line = (i) => `<li><span>${foundry.utils.escapeHTML(i.label)}</span><b>${i.value === null ? foundry.utils.escapeHTML(i.text ?? "") : fmt(i.value)}</b></li>`;
	const section = (title, cls, list) => (list.length ? `<div class="d4ea-bd-section ${cls}"><h5>${title}</h5><ul>${list.map(line).join("")}</ul></div>` : "");
	const bonuses = items.filter((i) => i.kind === "bonus" || i.kind === "damageDice");
	return `<div class="d4ea-breakdown">
		<div class="d4ea-bd-head">${who ? `<strong>${foundry.utils.escapeHTML(who)}:</strong> ` : ""}${foundry.utils.escapeHTML(summary)}</div>
		${section(L("sectionBonus"), "bonus", bonuses)}
		${section(L("sectionSituational"), "situational", items.filter((i) => i.kind === "situational"))}
		${section(L("sectionPenalty"), "penalty", items.filter((i) => i.kind === "penalty"))}
	</div>`;
}

export function onRenderChatMessage(message, html) {
	if (!setting("readableRolls") || !message.rolls?.length) return;
	html.querySelectorAll(".dice-roll").forEach((rollEl, i) => {
		const expression = rollEl.querySelector(".dice-tooltip.dice-formula");
		if (!expression || rollEl.querySelector(".d4ea-breakdown")) return;
		const data = collect(rollEl, expression, message.rolls[i]);
		if (!data.items.length) return;
		// Keep it inside the expression line, which is only shown when the roll is expanded
		const original = document.createElement("span");
		original.className = "d4ea-original-expression";
		original.hidden = true;
		while (expression.firstChild) original.append(expression.firstChild);
		expression.append(original);
		expression.insertAdjacentHTML("beforeend", renderBreakdown(data));
	});
}
