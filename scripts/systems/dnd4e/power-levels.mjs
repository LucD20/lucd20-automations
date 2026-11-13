import { MODULE_ID, MATCHERS } from "./constants.mjs";
import { matches, isRagePower } from "./utils.mjs";
import { forcedMovesFor, allyShiftsFor, proneRiderFor, sectionTexts } from "./movement/parse.mjs";
import { freeShiftFor } from "./actions/free-shift.mjs";

/*
 * Two small symbols next to each power's name (sheets and chat cards):
 *   ◆ automation   0 grey: not automated · 1 bronze: a little · 2 silver: moderately · 3 gold: automated
 *                  (or nothing to automate)
 *   ■ translation  0 grey: no translation · 1 bronze: unofficial · 2 silver: partly unofficial · 3 gold: official
 *
 * Automation: powers the module handles are listed below; any other power is judged from its text
 * (attack + damage only -> gold; clauses the module/system reads -> bronze/silver; otherwise grey).
 * Translation: Portuguese text -> gold (official), "*marked*" errata -> silver, English -> grey.
 * The GM can override either symbol by clicking it; overrides are stored per power for the whole world.
 */

export const LEVELS = ["grey", "bronze", "silver", "gold"];
export const OVERRIDES = "powerLevels-overrides";

const m = (ids, names) => ({ ids, names });

/** Powers the module automates: [matcher, level]. */
const REGISTRY = [
	[MATCHERS.huntersQuarry, 3],
	[MATCHERS.warlocksCurse, 3],
	[MATCHERS.misdirectedMark, 3],
	[MATCHERS.pressingStrike, 3],
	[MATCHERS.bloodhuntRage, 3],
	[MATCHERS.furiousAssault, 3],
	[m(["bard-01-vicious-mockery"], /vicious mockery|zombaria mal[ée]vola/i), 3],
	[m(["warlock-01-dreadful-word", "palavra-pavorosa"], /dreadful word|palavra pavorosa/i), 3],
	[m(["warlock-01-curse-of-the-dark-dream"], /curse of the dark dream|maldi[çc][ãa]o do sonho obscuro/i), 2],
	[m(["bard-01-stirring-shout"], /stirring shout|grito inspirador/i), 3],
	[m(["barbarian-01-great-cleave"], /great cleave|grande trespassar/i), 3],
	[m(["tiefling-power-infernal-wrath", "infernal-wrath"], /infernal wrath|c[óo]lera infernal/i), 3],
	[m(["warlock-01-dire-radiance", "radiancia-atroz"], /dire radiance|radi[âa]ncia atroz/i), 3],
	[m(["elf-power-elven-accuracy", "precisao-elfica", "elven-accuracy"], /elven accuracy|precis[ãa]o [ée]lfica/i), 3],
	[m(["ranger-01-foxs-cunning"], /fox'?s cunning|ast[úu]cia da raposa/i), 3],
	[m(["ranger-01-nimble-strike"], /nimble strike|golpe l[ée]pido/i), 3],
	[m(["bard-01-blunder"], /\bblunder\b|\bgafe\b/i), 3],
	[m(["bard-majestic-word"], /majestic word|palavra majestosa/i), 3],
	[m(["bard-words-of-friendship"], /words of friendship|palavras de amizade/i), 3],
	[m(["barbarian-swift-charge"], /swift charge|investida c[ée]lere/i), 3],
	[m(["barbarian-01-howling-strike"], /howling strike|golpe uivante/i), 3],
	[m(["warlock-pact-boon-01-fate-of-the-void", "fate-of-the-void"], /fate of the void|destino do v[áa]cuo/i), 3],
];

/* -------------------------------------------- */
/*  Text helpers                                  */
/* -------------------------------------------- */

function plain(html) {
	return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

const BOILERPLATE = /^(published in|publicado em|level \d+|n[íi]vel \d+|special|especial)\b/i;

/** The rules clauses of a power's Hit / Miss / Effect text (one per sentence or "and the target..." part). */
export function clauses(item) {
	// Detail fields, or the description's Hit/Miss/Effect paragraphs when those are empty (monster sheets)
	const s = sectionTexts(item);
	const text = [s.hit, s.miss, s.effect].map((t) => plain(t).replace(/\*/g, "")).filter(Boolean).join(" ");
	return text.split(/(?<=[.;])\s+/)
		.flatMap((s) => s.split(/,?\s+(?:and|e)\s+(?=(?:the target|you|each|o alvo|voc[êe]|cada|ele|ela)\b)/i))
		.map((s) => s.trim().replace(/[.;]$/, ""))
		.filter((s) => s && !BOILERPLATE.test(s));
}

const DAMAGE = /(\d+d\d+|\d*\[[AW]\]|modifier|modificador)[^]*\b(damage|dano)\b|\b(damage|dano)\b[^]*(\d+d\d+|\d*\[[AW]\])/i;
const HEALING = /(healing surge|pulso de cura|regain|recupera|hit points|pontos de vida|\bPV\b)/i;
const HALF = /^(half damage|metade do dano)/i;

function isPureClause(sys, clause) {
	if (DAMAGE.test(clause) && !/\b(until|at[ée]|whenever|sempre que|each|cada)\b/i.test(clause)) return true;
	if (HALF.test(clause)) return true;
	if (sys.hit?.isHealing && HEALING.test(clause)) return true;
	return false;
}

const CONDITION = /\b(dazed|stunned|slowed|immobilized|weakened|blinded|deafened|prone|restrained|marked|grants combat advantage|pasmo|atordoado|lento|imobilizado|enfraquecido|cego|surdo|derrubado|impedido|marcado|vantagem de combate)\b/i;
const MOVEMENT = /\b(push|pull|slide|shift|empurr|pux|conduz|ajust)\w*\b/i;
const PRONE = /\bprone\b|derrubad/i;

/**
 * Instructions in the "Attack:" line beyond "Ability vs. Defence" ("two attacks", "make two attack
 * rolls and use the better result"): the system doesn't do those.
 */
export function attackLineExtras(item) {
	const sys = item?.system ?? {};
	const desc = plain(sys.description?.value);
	const line = [sys.attack?.detail, desc.match(/\b(?:Ataque|Attack)\s*:\s*(.*?)(?=\b(?:Sucesso|Hit|Acerto|Fracasso|Miss|Erro|Efeito|Effect|Especial|Special|Published|Publicado)\b\s*:?|$)/i)?.[1]]
		.filter(Boolean).join(" ");
	const rest = line.replace(/\*/g, " ").replace(/\([^)]*\)/g, " ")
		.replace(/[+−-]?\s*\d+\s+vs\.?\s+[\wÀ-ú]+/gi, " ")
		.replace(/[\wÀ-ú]+(?:\s*[+−-]\s*\d+)?\s+vs\.?\s+[\wÀ-ú]+/gi, " ")
		// monster attack lines start with the range: "Melee 1", "Corpo a corpo 1", "Close burst 2"
		.replace(/(?<![\wÀ-ú])(melee|ranged|reach|close|area|burst|blast|wall|corpo a corpo|[àa] dist[âa]ncia|toque|explos[ãa]o|rajada|cont[íi]gua|[áa]rea|muralha|weapon|arma)(?![\wÀ-ú])/gi, " ")
		.replace(/[+−-]?\d+/g, " ")
		.replace(/(?<![\wÀ-ú])(or|ou|and|e)(?![\wÀ-ú])/gi, " ")
		.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
	return rest.split(" ").filter((w) => w.length > 2).length >= 2 ? [rest] : [];
}

/** Automation level guessed from the power's text. */
export function guessAutomation(item) {
	const sys = item?.system ?? {};
	const all = clauses(item);
	const extra = [...all.filter((c) => !isPureClause(sys, c)), ...attackLineExtras(item)];
	const pure = all.length - all.filter((c) => !isPureClause(sys, c)).length;
	if (!extra.length) return 3; // attack + damage (or healing): the system does it
	const hasEffects = (item.effects?.size ?? item.effects?.length ?? 0) > 0;
	const moves = forcedMovesFor(item).length + allyShiftsFor(item).length + (freeShiftFor(item) ? 1 : 0);
	const prone = !!proneRiderFor(item);
	// Movement and prone riders are done by the module itself; a condition word next to the power's own
	// effects only probably is (the effect may need a click)
	const sure = (c) => (moves && MOVEMENT.test(c)) || (prone && PRONE.test(c));
	const likely = (c) => hasEffects && CONDITION.test(c);
	const covered = extra.filter((c) => sure(c) || likely(c)).length;
	if (extra.every(sure)) return 3;
	if (covered >= extra.length) return 2;
	// The system still rolls the attack/damage: a little automated; nothing at all: not automated
	return covered || pure ? 1 : 0;
}

export function registryAutomation(item) {
	for (const [matcher, level] of REGISTRY) if (matches(item, matcher)) return level;
	if (isRagePower(item)) return 2; // the rage effect is applied; its specific benefits only for some rages
	return null;
}

/* -------------------------------------------- */
/*  Translation                                   */
/* -------------------------------------------- */

const PT = /\b(voc[êe]|o alvo|de dano|a[çc][ãa]o|quadrados?|at[ée]|inimigos?|aliados?|n[ãa]o|sucesso|efeito|ataque|fracasso|contra|seu|sua|uma?|com|pelo|pela)\b/gi;
const EN = /\b(you|the target|damage|action|squares?|until|enem(?:y|ies)|all(?:y|ies)|hit|effect|attack|miss|against|your|with|the|of)\b/gi;

/** "pt" | "en" | "mixed" | null for a piece of text. */
export function languageOf(text) {
	const t = plain(text).replace(/published in[^.]*\.?/gi, "");
	if (t.length < 3) return null;
	const pt = (t.match(PT) ?? []).length;
	const en = (t.match(EN) ?? []).length;
	if (!pt && !en) return null;
	if (pt >= en * 2) return "pt";
	if (en >= pt * 2) return "en";
	return "mixed";
}

/**
 * Translation level guessed from the text the players read (name and description):
 *   Portuguese -> gold (the table's powers are typed in from the official PT-BR books),
 *   Portuguese with "*text*" -> silver (an errata the official translation doesn't have, marked by the GM),
 *   English -> grey.
 * The system's own detail fields (often still in English from the compendium) don't count; they are
 * only used when the description is empty.
 */
export function guessTranslation(item) {
	const sys = item?.system ?? {};
	const name = languageOf(item?.name) ?? (/[ãõçáéíóúâêô]/i.test(item?.name ?? "") ? "pt" : null);
	let text = languageOf(sys.description?.value);
	if (!text) {
		const parts = new Set([sys.hit?.detail, sys.miss?.detail, sys.effect?.detail].map(languageOf).filter(Boolean));
		text = parts.has("pt") || parts.has("mixed") ? "pt" : (parts.has("en") ? "en" : null);
	}
	const portuguese = [name, text].some((l) => l === "pt" || l === "mixed");
	if (!portuguese) return 0;
	const marked = [item?.name, sys.description?.value, sys.description?.chat, sys.trigger].some((t) => /\*[^*\s][^*]*\*/.test(plain(t)));
	return marked ? 2 : 3;
}

/* -------------------------------------------- */
/*  Levels with overrides                         */
/* -------------------------------------------- */

const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Keys under which the GM's choice is stored: automation per power (any language), translation per name. */
export function overrideKeys(item) {
	const id = item?.system?.identifier;
	return { auto: id ? `id:${norm(id)}` : `name:${norm(item?.name)}`, tr: `name:${norm(item?.name)}` };
}

function overrides() {
	try {
		return game.settings.get(MODULE_ID, OVERRIDES) ?? {};
	} catch (err) {
		return {};
	}
}

/** { auto: {level, manual}, tr: {level, manual} } */
export function levelsFor(item) {
	const keys = overrideKeys(item);
	const o = overrides();
	const autoManual = o.auto?.[keys.auto];
	const trManual = o.tr?.[keys.tr];
	const autoGuess = registryAutomation(item) ?? guessAutomation(item);
	return {
		auto: { level: Number.isInteger(autoManual) ? autoManual : autoGuess, manual: Number.isInteger(autoManual) },
		tr: { level: Number.isInteger(trManual) ? trManual : guessTranslation(item), manual: Number.isInteger(trManual) },
	};
}

/** Set (level 0-3) or clear (null) the GM's choice for one symbol. */
export async function setOverride(item, kind, level) {
	const keys = overrideKeys(item);
	const o = foundry.utils.deepClone(overrides());
	o[kind] ??= {};
	if (level === null) delete o[kind][keys[kind]];
	else o[kind][keys[kind]] = level;
	await game.settings.set(MODULE_ID, OVERRIDES, o);
}
