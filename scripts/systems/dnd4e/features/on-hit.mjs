import { MODULE_ID, MATCHERS } from "../constants.mjs";
import { F, L, matches, actorHas, abilityMod, setting, log, tokenForActor, gridDistance, areAllies, areEnemies, isRangedPower } from "../utils.mjs";
import { buildEffect, createEffects } from "../effects.mjs";
import { conditionalModifiers, markApplied } from "./conditional.mjs";
import { bloodhuntModifier } from "./class-features.mjs";
import { proneRiderFor } from "../movement/parse.mjs";

/*
 * Power riders applied automatically to the targets a power hits, plus attack-roll modifiers:
 *   Vicious Mockery     -2 to the target's attack rolls until the end of your next turn
 *   Dreadful Word       -1 Will (Star Pact: 1 + Int) until the end of your next turn
 *   Curse of the Dark Dream  "subjected to the dark dream" (save ends), as a reminder (Effect: hit or miss)
 *   Stirring Shout      until the end of the encounter, an ally who hits the target regains HP = your Cha
 *                       (Effect: hit or miss)
 *   Prime Shot          +1 to ranged attacks when no ally is nearer to the target than you
 *   Great Cleave        +1 damage per enemy adjacent to you (damage dialog toggle)
 * Riders with `effect: true` come from an "Effect:" line and reach every target, hit or missed.
 */

export const RIDERS = [
	{
		key: "viciousMockery",
		matcher: { ids: ["bard-01-vicious-mockery"], names: /vicious mockery|zombaria mal[ée]vola/i },
		build: (actor, item) => ({
			name: F("OnHit.MockeryName", { power: item.name }),
			durationType: "endOfUserTurn",
			extraFlags: { attackMod: -2 },
			description: L("OnHit.MockeryDesc"),
		}),
	},
	{
		key: "dreadfulWord",
		matcher: { ids: ["warlock-01-dreadful-word", "palavra-pavorosa"], names: /dreadful word|palavra pavorosa/i },
		build: (actor, item) => {
			const penalty = actorHas(actor, MATCHERS.starPact) ? 1 + Math.max(0, abilityMod(actor, "int")) : 1;
			return {
				name: F("OnHit.DreadfulName", { power: item.name, penalty }),
				durationType: "endOfUserTurn",
				changes: [{ key: "system.defences.wil.untyped", type: "add", value: String(-penalty), priority: null }],
				description: F("OnHit.DreadfulDesc", { penalty }),
			};
		},
	},
	{
		key: "darkDream",
		effect: true,
		matcher: { ids: ["warlock-01-curse-of-the-dark-dream"], names: /curse of the dark dream|maldi[çc][ãa]o do sonho obscuro/i },
		build: (actor, item) => ({
			name: item.name,
			durationType: "saveEnd",
			description: L("OnHit.DarkDreamDesc"),
			extraFlags: { minorSlide: 1 }, // "you can slide the target 1 square as a minor action once per round"
		}),
	},
	{
		key: "stirringShout",
		effect: true,
		matcher: { ids: ["bard-01-stirring-shout"], names: /stirring shout|grito inspirador/i },
		build: (actor, item) => {
			const heal = Math.max(0, abilityMod(actor, "cha"));
			return {
				name: F("OnHit.StirringName", { power: item.name, heal }),
				durationType: "endOfEncounter",
				extraFlags: { stirringHeal: heal },
				description: F("OnHit.StirringDesc", { source: actor.name, heal }),
			};
		},
	},
];

function riderFor(itemData) {
	return RIDERS.find((r) => matches(itemData, r.matcher));
}

/** Apply the matching rider to every hit target (every target for "Effect:" riders), then handle Stirring Shout heals. */
export async function onAttackRolled(itemData, targetData, actor) {
	const hit = targetData?.targetHit ?? [];
	const rider = setting("powerRiders") ? riderFor(itemData) : null;
	const reached = rider?.effect ? (targetData?.targets ?? hit) : hit;
	if (rider && reached.length) {
		const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
		if (item) {
			const def = rider.build(actor, item);
			for (const target of reached) {
				if (!target.actor) continue;
				const effect = buildEffect({
					kind: `rider-${rider.key}`,
					name: def.name,
					img: item.img,
					source: actor,
					durationType: def.durationType,
					changes: def.changes ?? [],
					description: def.description ?? "",
					extraFlags: def.extraFlags ?? {},
				});
				await createEffects(target.actor, [effect]);
			}
			log("rider", rider.key, reached.map((t) => t.name));
		}
	}
	await stirringShoutHeal(actor, hit);
	await applyProneRider(itemData, targetData, actor);
}

/* -------------------------------------------- */
/*  "The target falls prone" riders               */
/* -------------------------------------------- */

// The rider is read by proneRiderFor (movement/parse.mjs); combat advantage per target comes from the attack dialog.
const combatAdvantage = new Map(); // attacker actor uuid -> Map(target token id -> had combat advantage)

function noteCombatAdvantage(actor, target, had) {
	if (!combatAdvantage.has(actor.uuid)) combatAdvantage.set(actor.uuid, new Map());
	combatAdvantage.get(actor.uuid).set(target.id, had);
}

async function applyProneRider(itemData, targetData, actor) {
	const ca = combatAdvantage.get(actor?.uuid);
	combatAdvantage.delete(actor?.uuid);
	if (!setting("powerRiders")) return;
	const item = itemData?.uuid ? fromUuidSync(itemData.uuid) : null;
	const rider = proneRiderFor(item ?? itemData);
	if (!rider) return;
	const status = CONFIG.statusEffects?.find((s) => s.id === "prone");
	const reached = rider.when === "effect" ? (targetData?.targets ?? []) : (targetData?.targetHit ?? []);
	for (const target of reached) {
		if (!target.actor || target.actor.statuses?.has("prone")) continue;
		if (rider.combatAdvantage && !ca?.get(target.id)) continue;
		await createEffects(target.actor, [{
			name: game.i18n.localize(status?.name ?? "EFFECT.StatusProne"),
			img: status?.img ?? "icons/svg/falling.svg",
			statuses: ["prone"],
			disabled: false,
			origin: actor.uuid,
			flags: { [MODULE_ID]: { kind: "proneRider", source: actor.uuid } },
		}]);
		ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${F("OnHit.Prone", { target: target.name, power: item?.name ?? itemData?.name ?? "" })}</p>` });
		log("prone rider", item?.name, target.name, rider.combatAdvantage ? "(combat advantage)" : "");
	}
}

/** Stirring Shout: "whenever an ally hits the target, that ally regains hit points equal to your Charisma modifier". */
async function stirringShoutHeal(attacker, hit) {
	if (!setting("powerRiders") || !hit.length || !attacker?.isOwner) return;
	const attackerToken = tokenForActor(attacker);
	let total = 0;
	for (const target of hit) {
		for (const e of target.actor?.effects ?? []) {
			const flags = e.flags?.[MODULE_ID];
			if (flags?.kind !== "rider-stirringShout") continue;
			const bard = fromUuidSync(flags.source);
			const bardToken = tokenForActor(bard);
			if (!bard || bard === attacker) continue;
			if (attackerToken && bardToken && !areAllies(attackerToken, bardToken)) continue;
			total += flags.stirringHeal || 0;
		}
	}
	if (!total) return;
	const hp = attacker.system.attributes.hp;
	const value = Math.min(hp.max, Math.max(0, hp.value) + total);
	await attacker.update({ "system.attributes.hp.value": value });
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor: attacker }),
		content: `<p>${F("OnHit.StirringHeal", { actor: attacker.name, heal: total })}</p>`,
	});
}

/* -------------------------------------------- */
/*  Attack roll modifiers (dnd4e.preAttackRoll)   */
/* -------------------------------------------- */

const PRIME_SHOT = { ids: ["prime-shot"], names: /prime shot|tiro primoroso|tiro certeiro/i };

function primeShotApplies(item, attackerToken, target) {
	if (!attackerToken || !target || !actorHas(attackerToken.actor, PRIME_SHOT)) return false;
	if (!isRangedPower(item, target, attackerToken)) return false;
	const mine = gridDistance(attackerToken, target);
	return !canvas.tokens.placeables.some((t) => t !== attackerToken && t !== target && t.actor && areAllies(attackerToken, t)
		&& !t.document.hidden && gridDistance(t, target) < mine);
}

/** Attack modifiers the module adds for this attacker/target: [{ key, label, value }]. */
export function attackModifiers(item, attacker, target) {
	const mods = [];
	if (!attacker?.actor) return mods;
	// Penalties from module effects on the attacker (e.g. Vicious Mockery)
	if (setting("powerRiders")) {
		for (const e of attacker.actor.effects) {
			const mod = Number(e.flags?.[MODULE_ID]?.attackMod);
			if (!mod || e.disabled) continue;
			mods.push({ key: `effect-${e.id}`, label: e.name, value: mod });
		}
	}
	if (setting("primeShot") && primeShotApplies(item, attacker, target)) mods.push({ key: "primeShot", label: L("OnHit.PrimeShot"), value: 1 });
	const bloodhunt = bloodhuntModifier(attacker, target);
	if (bloodhunt) mods.push(bloodhunt);
	mods.push(...conditionalModifiers(item, attacker));
	return mods;
}

/*
 * Choices made in the attack dialog: target token id (or "none") -> Set of disabled modifier keys.
 * Set while the dialog is open, read when the attack is rolled, cleared afterwards.
 */
const disabledMods = new Map();
const targetKey = (t) => t?.id ?? "none";

export function clearAttackModChoices() {
	disabledMods.clear();
}

export function onPreAttackRoll(item, attacker, target, config) {
	if (attacker?.actor && target) noteCombatAdvantage(attacker.actor, target, !!config?.commonAttackBonuses?.comAdv?.shouldApply);
	const bonuses = config?.targetOptions?.bonuses;
	if (!bonuses?.untyped) return;
	const off = disabledMods.get(targetKey(target)) ?? new Set();
	const mods = attackModifiers(item, attacker, target).filter((m) => !off.has(m.key));
	// Typed bonuses (racial, power...) don't stack with others of the same type: the system keeps the highest
	for (const m of mods) (bonuses[m.type ?? "untyped"] ??= []).push(String(m.value));
	markApplied(mods);
	// Remember them on the roll so the chat card can show them
	config.targetOptions.d4eaMods = mods.map((m) => ({ label: m.label, value: m.value, type: m.type ?? "untyped" }));
	config.targetOptions.d4eaInfo = { actor: attacker?.name ?? "", power: item?.name ?? "", ability: item?.system?.attack?.ability ?? "" };
	if (mods.length) console.log(`${MODULE_ID} | attack modifiers ${attacker?.name} -> ${target?.name ?? "-"}:`, mods.map((m) => `${m.label} ${m.value > 0 ? "+" : ""}${m.value}`).join(", "));
}

/** Attack dialog: list the automatic modifiers per target, each with a toggle. */
export function onRenderAttackDialog(app, element) {
	if (!app.dialogData?.isAttackRoll || !app.rollConfig) return;
	const actor = app.rollConfig.actor;
	const item = app.rollConfig.item;
	const attacker = tokenForActor(actor);
	if (!attacker) return;
	if (!app.d4eaModsInit) {
		clearAttackModChoices();
		app.d4eaModsInit = true;
	}
	const targets = Array.from(game.user.targets);
	const rows = (targets.length ? targets : [null]).map((t) => {
		const mods = attackModifiers(item, attacker, t);
		if (!mods.length) return "";
		const off = disabledMods.get(targetKey(t)) ?? new Set();
		const list = mods.map((m) => `<label class="d4ea-atk-mod ${m.value < 0 ? "penalty" : "bonus"}">
			<input type="checkbox" data-d4ea-target="${targetKey(t)}" data-d4ea-mod="${m.key}" ${off.has(m.key) ? "" : "checked"}>
			${foundry.utils.escapeHTML(m.label)} ${m.value > 0 ? "+" : ""}${m.value}</label>`).join(" ");
		return `<div class="d4ea-atk-row">${t ? `<strong>${foundry.utils.escapeHTML(t.name)}:</strong> ` : ""}${list}</div>`;
	}).join("");
	const root = element instanceof HTMLElement ? element : element[0];
	root.querySelector(".d4ea-atk-mods")?.remove();
	if (!rows) return;
	const box = document.createElement("fieldset");
	box.className = "d4ea-atk-mods";
	box.innerHTML = `<legend>${L("OnHit.AutoModsLegend")}</legend>${rows}`;
	box.addEventListener("change", (ev) => {
		const input = ev.target;
		if (!input?.dataset?.d4eaMod) return;
		const key = input.dataset.d4eaTarget;
		if (!disabledMods.has(key)) disabledMods.set(key, new Set());
		if (input.checked) disabledMods.get(key).delete(input.dataset.d4eaMod);
		else disabledMods.get(key).add(input.dataset.d4eaMod);
		input.closest(".d4ea-atk-mod")?.classList.toggle("off", !input.checked);
	});
	const anchor = root.querySelector(".target-detail") ?? root.querySelector("input[name='bonus']")?.closest(".form-group");
	if (anchor) anchor.after(box);
	else root.querySelector(".roll-dialogue")?.append(box);
	app.setPosition?.({ height: "auto" });
}

/* -------------------------------------------- */
/*  Great Cleave damage                           */
/* -------------------------------------------- */

const GREAT_CLEAVE = { ids: ["barbarian-01-great-cleave"], names: /great cleave|grande trespassar/i };

export function damageExtra({ actor, item }) {
	if (!setting("powerRiders") || !matches(item, GREAT_CLEAVE)) return null;
	const me = tokenForActor(actor);
	if (!me) return null;
	const adjacent = canvas.tokens.placeables.filter((t) => t !== me && t.actor && !t.document.hidden && areEnemies(me, t)
		&& gridDistance(me, t) === 1 && !(t.actor.system?.attributes?.hp?.value <= 0)).length;
	if (!adjacent) return null;
	return {
		id: "greatCleave",
		label: F("OnHit.GreatCleave", { count: adjacent }),
		hint: L("OnHit.GreatCleaveHint"),
		formula: String(adjacent),
		checked: true,
		requiresHit: true,
	};
}
