import { MODULE_ID, SOCKET, KIND } from "./constants.mjs";
import { log, F } from "./utils.mjs";
import { handleDamageSocket, handleRetargetSocket } from "./damage-apply.mjs";
import { handleTempHpSocket } from "./features/temp-hp.mjs";

/*
 * Creating/deleting effects on actors the player doesn't own (enemy tokens) must go through a GM.
 * Every operation here works locally when the user has permission, and otherwise is relayed over
 * the module socket to the active GM.
 */

export function registerSocket() {
	game.socket.on(SOCKET, async (payload) => {
		// For a specific user (loaded lazily to keep this module's imports small)
		if (payload.op === "pickShift") return (await import("./movement/forced.mjs")).handlePickShiftSocket(payload);
		if (!game.users.activeGM?.isSelf) return;
		try {
			if (payload.op === "create") await doCreate(payload.actorUuid, payload.effects);
			else if (payload.op === "delete") await doDelete(payload.actorUuid, payload.ids);
			else if (payload.op === "damage") await handleDamageSocket(payload);
			else if (payload.op === "retarget") await handleRetargetSocket(payload);
			else if (payload.op === "tempHp") await handleTempHpSocket(payload);
			else if (payload.op === "move") await (await import("./movement/picker.mjs")).handleMoveSocket(payload);
		} catch (err) {
			console.error(`${MODULE_ID} | socket operation failed`, payload, err);
		}
	});
}

async function doCreate(actorUuid, effects) {
	const actor = await fromUuid(actorUuid);
	if (!actor) return;
	// A creature can only be marked by one source at a time.
	if (effects.some((e) => e.statuses?.includes("mark"))) {
		const oldMarks = actor.effects.filter((e) => e.statuses.has("mark")).map((e) => e.id);
		if (oldMarks.length) await actor.deleteEmbeddedDocuments("ActiveEffect", oldMarks);
	}
	await actor.createEmbeddedDocuments("ActiveEffect", effects);
}

async function doDelete(actorUuid, ids) {
	const actor = await fromUuid(actorUuid);
	if (!actor) return;
	const existing = ids.filter((id) => actor.effects.has(id));
	if (existing.length) await actor.deleteEmbeddedDocuments("ActiveEffect", existing);
}

function canModify(actor) {
	return game.user.isGM || actor.isOwner;
}

export async function createEffects(actor, effects) {
	if (!actor || !effects.length) return;
	log("createEffects", actor.name, effects);
	if (canModify(actor)) return doCreate(actor.uuid, effects);
	if (!game.users.activeGM) {
		ui.notifications.warn(F("Warn.NoGM", { name: actor.name }));
		return;
	}
	game.socket.emit(SOCKET, { op: "create", actorUuid: actor.uuid, effects });
}

export async function deleteEffects(actor, ids) {
	if (!actor || !ids.length) return;
	if (canModify(actor)) return doDelete(actor.uuid, ids);
	if (!game.users.activeGM) return;
	game.socket.emit(SOCKET, { op: "delete", actorUuid: actor.uuid, ids });
}

/* -------------------------------------------- */
/*  Effect helpers                               */
/* -------------------------------------------- */

export function moduleFlags(effect) {
	return effect.flags?.[MODULE_ID] ?? effect.getFlag?.(MODULE_ID) ?? {};
}

/** Effects of a given kind on an actor, optionally only those created by `sourceUuid`. */
export function effectsOfKind(actor, kind, sourceUuid = null) {
	if (!actor) return [];
	return actor.effects.filter((e) => {
		const f = e.flags?.[MODULE_ID];
		return f?.kind === kind && (!sourceUuid || f.source === sourceUuid);
	});
}

/** All tokens on the canvas carrying an effect of `kind` from `sourceUuid`. */
export function tokensWithEffect(kind, sourceUuid) {
	return canvas.tokens.placeables.filter((t) => effectsOfKind(t.actor, kind, sourceUuid).length);
}

export function showIconAlways() {
	return CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? undefined;
}

/**
 * Build ActiveEffect data for a "tag" effect placed on a target (quarry, curse, mark).
 * @param {object} opts
 * @param {string} opts.kind              One of KIND
 * @param {string} opts.name              Effect name
 * @param {string} opts.img               Icon shown on the target token
 * @param {Actor}  opts.source            Actor who applied it (used as origin for durations)
 * @param {string} opts.durationType      dnd4e duration type
 * @param {object[]} [opts.changes]       Active effect changes
 * @param {string[]} [opts.statuses]
 * @param {string} [opts.description]
 * @param {object} [opts.extraFlags]
 */
export function buildEffect({ kind, name, img, source, durationType, changes = [], statuses = [], description = "", extraFlags = {} }) {
	const data = {
		name,
		img,
		origin: source.uuid,
		description,
		statuses,
		disabled: false,
		system: {
			durationType,
			changes,
		},
		flags: {
			[MODULE_ID]: { kind, source: source.uuid, ...extraFlags },
		},
	};
	const showIcon = showIconAlways();
	if (showIcon !== undefined) data.showIcon = showIcon;
	return data;
}

export { KIND };
