import { MODULE_ID, SOCKET } from "../constants.mjs";
import { F, L, matches, actorHas, abilityMod, setting, log, tokenForActor, gridDistance, areAllies, areEnemies } from "../utils.mjs";

/*
 * Temporary hit point features (active GM watches HP changes):
 *   Rageblood Vigor (barbarian): when your attack drops an enemy to 0 HP, gain temp HP equal to
 *     Con mod (+5 at 11th, +10 at 21st). Applied automatically.
 *   Virtue of Valor (bard): once per round, when an ally within 5 squares of you bloodies an
 *     enemy or drops it to 0 HP, you can give that ally temp HP equal to 1 + Con mod (3 + at 11th,
 *     5 + at 21st). Offered to the bard as a chat card.
 *   Half-Orc Resilience: the first time you are bloodied during an encounter, gain 5 temp HP
 *     (10 at 11th, 15 at 21st). Applied automatically.
 * The "attacker" is the combatant whose turn it is.
 */

const RAGEBLOOD = { ids: ["rageblood-vigor"], names: /rageblood vigor|vigor da f[úu]ria sangrenta|vigor sanguin[áa]rio/i };
const RESILIENCE = { ids: ["half-orc-resilience"], names: /^(half-orc resilience|resili[êe]ncia (do )?meio-orc)$/i };
const VALOR = { ids: ["virtue-of-valor"], names: /virtue of valor|virtude da bravura|virtude do valor/i };
const oldHp = new Map(); // actor uuid -> hp before the update (GM side)

const tier = (actor, a, b, c) => {
	const level = Number(actor.system.details?.level) || 1;
	return level >= 21 ? c : level >= 11 ? b : a;
};

export function onPreUpdateActor(actor, changes) {
	if (!game.users.activeGM?.isSelf) return;
	if (foundry.utils.getProperty(changes, "system.attributes.hp.value") === undefined) return;
	oldHp.set(actor.uuid, actor.system.attributes?.hp?.value);
}

async function grantTempHp(actor, amount) {
	const current = Number(actor.system.attributes?.temphp?.value) || 0;
	if (amount <= current) return false; // temporary HP don't stack: keep the higher value
	if (actor.isOwner) await actor.update({ "system.attributes.temphp.value": amount });
	else if (game.users.activeGM) game.socket.emit(SOCKET, { op: "tempHp", actorUuid: actor.uuid, amount });
	return true;
}

export async function handleTempHpSocket(payload) {
	const actor = await fromUuid(payload.actorUuid);
	if (actor) await grantTempHp(actor, payload.amount);
}

export async function onUpdateActor(actor, changes) {
	if (!setting("tempHpFeatures") || !game.users.activeGM?.isSelf || !game.combat?.started) return;
	const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
	if (hp === undefined) return;
	const before = oldHp.get(actor.uuid);
	oldHp.delete(actor.uuid);
	const bloodiedAt = Number(actor.system.details?.bloodied) || Math.floor((actor.system.attributes.hp.max || 0) / 2);
	const dropped = hp <= 0 && (before === undefined || before > 0);
	const bloodied = !dropped && hp <= bloodiedAt && hp > 0 && (before === undefined || before > bloodiedAt);
	if (!dropped && !bloodied) return;

	// Half-Orc Resilience (the one who got bloodied)
	const resilience = bloodied ? actor.items.find((i) => matches(i, RESILIENCE)) : null;
	if (resilience && actor.getFlag(MODULE_ID, "resilience") !== game.combat.id) {
		await actor.setFlag(MODULE_ID, "resilience", game.combat.id);
		const amount = tier(actor, 5, 10, 15);
		if (await grantTempHp(actor, amount)) {
			ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${F("TempHp.Resilience", { actor: actor.name, amount, feature: resilience.name })}</p>` });
		}
	}

	const fallen = tokenForActor(actor);
	const current = game.combat.combatant;
	const attacker = current?.actor;
	const attackerToken = current?.token?.object ?? tokenForActor(attacker);
	if (!attacker || !fallen || !attackerToken || attacker === actor || !areEnemies(attackerToken, fallen)) return;

	// Rageblood Vigor
	if (dropped && actorHas(attacker, RAGEBLOOD)) {
		const amount = Math.max(0, abilityMod(attacker, "con")) + tier(attacker, 0, 5, 10);
		if (amount && await grantTempHp(attacker, amount)) {
			ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker }), content: `<p>${F("TempHp.Rageblood", { actor: attacker.name, amount, target: actor.name })}</p>` });
		}
	}

	// Virtue of Valor: bards within 5 squares of the attacker (an ally, not the bard itself)
	for (const bardToken of canvas.tokens.placeables) {
		const bard = bardToken.actor;
		if (!bard || bard === attacker || !actorHas(bard, VALOR)) continue;
		if (!areAllies(bardToken, attackerToken) || gridDistance(bardToken, attackerToken) > 5) continue;
		const used = bard.getFlag(MODULE_ID, "valorRound");
		if (used && used.combat === game.combat.id && used.round === game.combat.round) continue;
		const amount = tier(bard, 1, 3, 5) + Math.max(0, abilityMod(bard, "con"));
		await postValorCard(bard, attacker, actor, amount, dropped);
	}
}

async function postValorCard(bard, ally, enemy, amount, dropped) {
	const whisper = game.users.filter((u) => u.isGM || bard.testUserPermission(u, "OWNER")).map((u) => u.id);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor: bard }),
		whisper,
		content: `<div class="d4ea-oa-card d4ea-react-card">
			<h3><i class="fa-solid fa-shield-heart"></i> ${L("TempHp.ValorTitle")}</h3>
			<p>${F(dropped ? "TempHp.ValorDropped" : "TempHp.ValorBloodied", { ally: ally.name, enemy: enemy.name })}</p>
			<button type="button" class="d4ea-react-use d4ea-valor" data-bard="${bard.uuid}" data-ally="${ally.uuid}" data-amount="${amount}">
				<i class="fa-solid fa-heart-circle-plus"></i> ${F("TempHp.ValorButton", { ally: ally.name, amount })}
			</button></div>`,
		flags: { [MODULE_ID]: { valor: true } },
	});
	log("virtue of valor card", bard.name, ally.name, amount);
}

function syncValorButton(btn) {
	const bard = fromUuidSync(btn.dataset.bard);
	const used = bard?.getFlag(MODULE_ID, "valorRound");
	const spent = !!(used && game.combat && used.combat === game.combat.id && used.round === game.combat.round);
	btn.dataset.label ??= btn.innerHTML;
	btn.disabled = spent;
	btn.innerHTML = spent ? `<i class="fa-solid fa-ban"></i> ${L("TempHp.ValorUsed")}` : btn.dataset.label;
}

async function onValorButton(ev) {
	const btn = ev.currentTarget;
	const bard = fromUuidSync(btn.dataset.bard);
	const ally = fromUuidSync(btn.dataset.ally);
	if (!bard || !ally) return;
	if (!bard.isOwner) return ui.notifications.warn(L("Opportunity.NotOwner"));
	const amount = Number(btn.dataset.amount) || 0;
	const granted = await grantTempHp(ally, amount);
	if (game.combat) await bard.setFlag(MODULE_ID, "valorRound", { combat: game.combat.id, round: game.combat.round });
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor: bard }),
		content: `<p>${F(granted ? "TempHp.ValorGranted" : "TempHp.ValorNotHigher", { bard: bard.name, ally: ally.name, amount })}</p>`,
	});
}

export function registerTempHpHooks() {
	Hooks.on("preUpdateActor", onPreUpdateActor);
	Hooks.on("updateActor", (actor, changes) => {
		onUpdateActor(actor, changes).catch((e) => console.error(`${MODULE_ID} | temp hp`, e));
		setTimeout(() => document.querySelectorAll(".d4ea-valor").forEach(syncValorButton), 50);
	});
	Hooks.on("combatTurnChange", () => setTimeout(() => document.querySelectorAll(".d4ea-valor").forEach(syncValorButton), 50));
	Hooks.on("renderChatMessageHTML", (message, html) => {
		if (!message.flags?.[MODULE_ID]?.valor) return;
		html.querySelectorAll(".d4ea-valor").forEach((b) => {
			b.addEventListener("click", onValorButton);
			syncValorButton(b);
		});
	});
}
