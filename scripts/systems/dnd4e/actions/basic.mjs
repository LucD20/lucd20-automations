import { MODULE_ID } from "../constants.mjs";
import { F, L } from "../utils.mjs";
import { createEffects } from "../effects.mjs";
import { spend, setChargePending } from "./state.mjs";
import { startMovementBlock } from "./movement.mjs";
import { pickMovement } from "../movement/picker.mjs";
import { runCharge } from "../movement/charge.mjs";
import { setting, tokenForActor } from "../utils.mjs";

/*
 * Basic combat actions available from the panel. Each one spends its action and, where the
 * system supports it, applies the matching condition/effect.
 */

async function statusEffect(actor, statusId, durationType) {
	const Cls = CONFIG.ActiveEffect.documentClass;
	const base = Cls.fromStatusEffect ? await Cls.fromStatusEffect(statusId) : null;
	const data = base ? base.toObject() : { name: statusId, statuses: [statusId], img: "icons/svg/aura.svg" };
	data.origin = actor.uuid;
	data.system = { ...(data.system ?? {}), durationType };
	data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { kind: "basicAction", source: actor.uuid } };
	await createEffects(actor, [data]);
}

function chat(actor, key) {
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${F(key, { name: actor.name })}</p>`,
	});
}

export const BASIC_ACTIONS = {
	walk: { kind: "move", icon: "fa-person-walking", run: async (actor, combatant) => startMovementBlock(combatant, "walk") },
	shift: {
		kind: "move", icon: "fa-shoe-prints",
		run: async (actor, combatant) => startMovementBlock(combatant, "shift"),
		// Then choose the square on the map (the move continues the block started above, no second action)
		after: (actor) => {
			const token = tokenForActor(actor);
			if (!token || !setting("clickMovement")) return;
			const squares = Number(actor.system?.movement?.shift?.value) || 1;
			pickMovement({ token, mode: "shift", squares, power: L("Actions.Basic.shift"), moveOptions: { countMovement: true } });
		},
	},
	run: {
		kind: "move", icon: "fa-person-running",
		run: async (actor, combatant) => {
			await statusEffect(actor, "running", "startOfUserTurn");
			await startMovementBlock(combatant, "run");
		},
	},
	standUp: {
		kind: "move", icon: "fa-person-arrow-up-from-line",
		run: async (actor) => {
			if (actor.statuses.has("prone")) await actor.toggleStatusEffect("prone", { active: false });
		},
	},
	charge: {
		kind: "standard", icon: "fa-bolt",
		run: async (actor, combatant) => {
			if (!setting("clickMovement") || !tokenForActor(actor)) {
				await statusEffect(actor, "charging", "endOfUserCurrent");
				await setChargePending(combatant, true);
				return;
			}
			// Charge line: choose the attack, the target and the end square (nearest square to attack from);
			// the action is spent and the attack opened once the move is done. Cancelled -> nothing spent.
			const done = await runCharge(actor, {
				beforeAttack: async () => {
					await statusEffect(actor, "charging", "endOfUserCurrent");
					await spend(combatant, "standard", { source: "charge" });
					await setChargePending(combatant, true);
					chat(actor, "Actions.Chat.charge");
				},
			});
			return done ? "handled" : false;
		},
	},
	totalDefense: {
		kind: "standard", icon: "fa-shield-halved",
		run: async (actor) => {
			await createEffects(actor, [{
				name: L("Actions.Basic.totalDefense"),
				img: "icons/svg/shield.svg",
				origin: actor.uuid,
				system: {
					durationType: "startOfUserTurn",
					changes: [{ key: "system.modifiers.defences.untyped", type: "add", value: "2", priority: null }],
				},
				flags: { [MODULE_ID]: { kind: "basicAction", source: actor.uuid } },
			}]);
		},
	},
	secondWind: {
		kind: "standard", icon: "fa-heart-pulse",
		run: async (actor) => {
			if (actor.system.details?.secondwind || actor.system.details?.secondWind) ui.notifications.warn(F("Actions.WarnSecondWindUsed", { name: actor.name }));
			await actor.secondWind?.(null, { bonus: "" });
		},
		noChat: true,
	},
	aidAnother: { kind: "standard", icon: "fa-handshake-angle" },
	ready: { kind: "standard", icon: "fa-hourglass-half" },
	actionPoint: {
		kind: null, icon: "fa-star",
		run: async (actor) => {
			if ((actor.system.actionpoints?.value ?? 0) < 1) {
				ui.notifications.warn(F("Actions.WarnNoActionPoint", { name: actor.name }));
				return false;
			}
			// The extra action is granted by the updateActor watcher, which also catches AP spent from the sheet.
			await actor.actionPoint?.(null, {});
		},
		noChat: true,
	},
};

export async function useBasicAction(key, combatant) {
	const def = BASIC_ACTIONS[key];
	const actor = combatant?.actor;
	if (!def || !actor) return;
	const outcome = def.run ? await def.run(actor, combatant) : undefined;
	if (outcome === false) return;
	if (outcome === "handled") return; // the action did its own bookkeeping
	if (def.kind) await spend(combatant, def.kind, { source: key });
	if (!def.noChat) chat(actor, `Actions.Chat.${key}`);
	def.after?.(actor, combatant);
}
