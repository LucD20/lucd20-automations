// Merged into LucD20 Automations (v0.29.0): same module id and socket channel as the rest.
export const MODULE_ID = "lucd20-automations";
export const SOCKET = `module.${MODULE_ID}`;

/** Effect kinds this module creates (stored in flags[MODULE_ID].kind). */
export const KIND = {
	QUARRY: "quarry",
	CURSE: "curse",
	MARK: "mark",
	RAGE: "rage",
	FATE_OF_THE_VOID: "fateOfTheVoid",
};

/**
 * How we recognise powers and features. Identifiers come from the dnd4e compendium; the name
 * patterns are a fallback for homebrewed/renamed items, in English and Portuguese.
 */
export const MATCHERS = {
	huntersQuarry: {
		ids: ["ranger-hunters-quarry", "hunters-quarry"],
		names: /hunter'?s quarry|presa do ca[çc]ador/i,
	},
	warlocksCurse: {
		ids: ["warlock-warlocks-curse", "warlocks-curse"],
		names: /warlock'?s curse|maldi[çc][ãa]o do bruxo/i,
	},
	misdirectedMark: {
		ids: ["bard-01-misdirected-mark"],
		names: /misdirected mark|marca indireta/i,
	},
	pressingStrike: {
		ids: ["barbarian-01-pressing-strike"],
		names: /pressing strike|golpe insistente/i,
	},
	bloodhuntRage: {
		ids: ["barbarian-01-bloodhunt-rage"],
		names: /bloodhunt rage|f[úu]ria da ca[çc]ada de sangue/i,
	},
	furiousAssault: {
		ids: ["half-orc-power-furious-assault", "furious-assault"],
		names: /furious assault|assalto furioso/i,
	},
	lethalHunter: {
		ids: ["lethal-hunter"],
		names: /lethal hunter|ca[çc]ador letal/i,
	},
	starPact: {
		ids: ["star-pact", "warlock-pact-boon-01-fate-of-the-void"],
		names: /star pact|pacto estelar|fate of the void|destino do v[áa]cuo/i,
	},
};
