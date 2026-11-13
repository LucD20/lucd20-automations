import { L, F, nearestVisibleEnemies, gridDistance, setting } from "./utils.mjs";

/**
 * Pick the "nearest enemy you can see" for Hunter's Quarry / Warlock's Curse.
 *  - With exactly one token targeted, use it (warn if it isn't the nearest; the GM has the last word).
 *  - With no target, pick the nearest visible enemy, asking when several are tied.
 * @param {Token} source
 * @param {string} powerName  For messages
 * @returns {Promise<Token|null>}
 */
export async function pickNearestEnemy(source, powerName) {
	const targets = Array.from(game.user.targets);
	const nearest = nearestVisibleEnemies(source);

	if (targets.length > 1) {
		ui.notifications.warn(F("Warn.OneTarget", { power: powerName }));
		return null;
	}
	if (targets.length === 1) {
		const target = targets[0];
		if (setting("warnNotNearest") && nearest.length && !nearest.includes(target)) {
			const d = gridDistance(source, nearest[0]);
			ui.notifications.warn(F("Warn.NotNearest", { power: powerName, target: target.name, distance: d }));
		}
		return target;
	}
	if (!nearest.length) {
		ui.notifications.warn(F("Warn.NoEnemyVisible", { power: powerName }));
		return null;
	}
	if (nearest.length === 1) return nearest[0];
	return chooseToken(nearest, F("Dialog.ChooseNearestTitle", { power: powerName }), L("Dialog.ChooseNearestHint"));
}

/**
 * Let the user pick one token from a list.
 * @returns {Promise<Token|null>}
 */
export async function chooseToken(tokens, title, hint = "") {
	if (!tokens.length) return null;
	const buttons = tokens.map((t, i) => ({
		action: String(i),
		label: t.name,
		icon: "fa-solid fa-crosshairs",
		default: i === 0,
	}));
	const portraits = tokens.map((t) => `<figure class="d4ea-choice"><img src="${t.document.texture.src}" alt=""><figcaption>${foundry.utils.escapeHTML(t.name)}</figcaption></figure>`).join("");
	const result = await foundry.applications.api.DialogV2.wait({
		window: { title },
		content: `<p>${hint}</p><div class="d4ea-choices">${portraits}</div>`,
		buttons,
		rejectClose: false,
	});
	if (result === null || result === undefined) return null;
	return tokens[Number(result)] ?? null;
}
