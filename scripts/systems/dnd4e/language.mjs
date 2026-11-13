import { MODULE_ID } from "./constants.mjs";
import { getFeature } from "../../core/registry.js";

/*
 * "Game language": lets a user keep Foundry's interface in one language while the dnd4e system
 * (abilities, skills, conditions, sheet labels) and this module use another, e.g. Foundry in
 * English with the 4e content in Portuguese to match hand-translated sheets.
 *
 * Foundry loads translations in Localization#setLanguage, which runs after the "init" hook. We
 * wrap it so that, once the normal translations are loaded, the system's and this module's
 * strings for the chosen language are merged on top. Strings the chosen translation lacks keep
 * the Foundry-language text.
 */

export const GAME_LANGUAGES = {
	foundry: "DND4EAUTO.Settings.gameLanguage.Foundry",
	en: "English",
	"pt-BR": "Português (Brasil)",
};

function languagePaths(pkg, lang) {
	if (!pkg?.languages) return [];
	const wanted = lang.toLowerCase();
	return Array.from(pkg.languages).filter((l) => l.lang?.toLowerCase() === wanted).map((l) => l.path);
}

async function loadJson(path) {
	try {
		const response = await fetch(foundry.utils.getRoute(path));
		if (!response.ok) return {};
		return await response.json();
	} catch (err) {
		console.warn(`${MODULE_ID} | could not load ${path}`, err);
		return {};
	}
}

export function registerGameLanguage() {
	// Merged into LucD20 Automations: the "4e game language" card (per player) holds the choice.
	const card = getFeature("dnd4eGameLanguage");
	const chosen = card?.isEnabled ? card.get("language") : "foundry";
	if (!chosen || chosen === "foundry") return;

	const i18n = game.i18n;
	const original = i18n.setLanguage.bind(i18n);
	i18n.setLanguage = async function (lang) {
		await original(lang);
		if (chosen.toLowerCase() === String(this.lang).toLowerCase()) return;
		const paths = [
			...languagePaths(game.system, chosen),
			...languagePaths(game.modules.get(MODULE_ID), chosen),
		];
		for (const path of paths) {
			const json = await loadJson(path);
			foundry.utils.mergeObject(this.translations, foundry.utils.expandObject(json), { inplace: true });
		}
		console.log(`${MODULE_ID} | 4e game language set to ${chosen} (Foundry interface: ${this.lang})`);
	};
}
