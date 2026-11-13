/**
 * Default Token Tooltip rows per game system, ported from the owner's Token
 * Tooltip Alt setups (PF2e, SWADE, Wrath & Glory). Icons are Font Awesome
 * Free equivalents where the originals were Pro-only (bat, shield-cross,
 * eye-evil, wreath-laurel, face-scream).
 *
 * Row: { icon, color, value, who, types }
 *   who:   "gm" (GM only) · "owner" (GM + owners) · "friendly" (GM, owners,
 *          and everyone on friendly tokens) · "others" (players who don't own
 *          it) · "all" (everyone)
 *   types: actor types it applies to ([] = all)
 */

const HP_NUMBERS =
  "{hp=<attributes.hp.value>; hpm=<attributes.hp.max>; hpt=<attributes.hp.temp> || 0; " +
  "hp == 0 ? \"Ø\" : hp == floor(hpm*0.69) ? (hpt ? concat(\"Nice (\", hpt, \")\") : \"Nice\") : hpt ? concat(hp, \" (\", hpt, \")\") : hp}";
const HP_STATUS =
  "{hp=<attributes.hp.value>; hpm=<attributes.hp.max>; " +
  "hp <= 0 ? \"Ø\" : hp == floor(hpm*0.69) || hp == 69 ? \"Nice\" : hpStatus(hp, hpm)}";
const DISTANCE = "{d=distance(); d === null ? \"\" : concat(\"~\", ceil(d))}";
const speed = type => `{<movement.speeds.${type}.value> || ""}`;

const CREATURES = ["character", "npc", "familiar", "vehicle"];

export const PRESETS = {
  pf2e: {
    rows: [
      { icon: "fa-heart", color: "#cd1818", value: HP_NUMBERS, who: "owner", types: [...CREATURES, "hazard"] },
      { icon: "fa-heart", color: "#cd1818", value: HP_STATUS, who: "others", types: ["npc", "hazard", "familiar"] },
      { icon: "fa-shield-halved", color: "#74a2be", value: "attributes.ac.value", who: "owner", types: [...CREATURES, "hazard"] },
      { icon: "fa-star", color: "#f2df07", value: "resources.heroPoints", who: "owner", types: ["character"] },
      { icon: "fa-chess-rook", color: "#c8621e", value: "{<saves.fortitude.value> ? <saves.fortitude.value> + 10 : \"\"}", who: "gm", types: [] },
      { icon: "fa-person-running", color: "#2fbc6c", value: "{<saves.reflex.value> ? <saves.reflex.value> + 10 : \"\"}", who: "gm", types: [] },
      { icon: "fa-brain", color: "#cd1dbf", value: "{<saves.will.value> ? <saves.will.value> + 10 : \"\"}", who: "gm", types: [] },
      { icon: "fa-eye", color: "#369fba", value: "{<perception.value> + 10}", who: "gm", types: ["npc", "familiar"] },
      { icon: "fa-eye-slash", color: "#8661b3", value: "{<skills.stealth.value> + 10}", who: "gm", types: ["npc", "hazard", "familiar"] },
      { icon: "fa-hand-fist", color: "#a3430f", value: "{<skills.athletics.value> + 10}", who: "gm", types: ["character", "npc", "familiar"] },
      { icon: "fa-shoe-prints", color: "#999999", value: speed("land"), who: "owner", types: CREATURES },
      { icon: "fa-worm", color: "#999999", value: speed("burrow"), who: "owner", types: CREATURES },
      { icon: "fa-person-hiking", color: "#999999", value: speed("climb"), who: "owner", types: CREATURES },
      { icon: "fa-feather-pointed", color: "#999999", value: speed("fly"), who: "owner", types: CREATURES },
      { icon: "fa-fish", color: "#999999", value: speed("swim"), who: "owner", types: CREATURES },
      { icon: "fa-ruler", color: "#707070", value: DISTANCE, who: "all", types: [] }
    ]
  },

  swade: {
    rows: [
      { icon: "fa-clover", color: "#24cc83", value: "{<bennies.value>}", who: "all", types: [] },
      { icon: "fa-shield-halved", color: "#758295", value: "P: {<stats.parry.value>}", who: "friendly", types: [] },
      { icon: "fa-hand-fist", color: "#df584e", value: "T: {<stats.toughness.value>}", who: "friendly", types: [] },
      { icon: "fa-person-running", color: "#d7d86e", value: "pace.ground", who: "friendly", types: [] },
      { icon: "fa-feather-pointed", color: "#d7d86e", value: "{<pace.fly>}", who: "friendly", types: [] },
      {
        icon: "fa-ruler",
        color: "#8f8f8f",
        value: "{d=distance(); d === null ? \"\" : d - canvas.dimensions.distance <= 0.19 ? \"⚔️\" : round((d - canvas.dimensions.distance) * 100) / 100}",
        who: "all",
        types: []
      },
      {
        icon: "fa-hand-sparkles",
        color: "#19cad7",
        value:
          "const list = [];\n" +
          "const pp = data.powerPoints ?? {};\n" +
          "if (pp.value && pp.max) list.push(pp.value + \"/\" + pp.max);\n" +
          "for (const arcane in pp) {\n" +
          "  if (arcane !== \"value\" && arcane !== \"max\" && pp[arcane]?.max && pp[arcane]?.value) list.push(pp[arcane].value + \"/\" + pp[arcane].max);\n" +
          "}\n" +
          "return list.join(\", \");",
        who: "friendly",
        types: []
      },
      { icon: "fa-up-down", color: "#d400f0", value: "{<stats.size>}", who: "all", types: [] },
      { icon: "fa-up-down", color: "#709e94", value: "{<stats.scale>}", who: "all", types: [] }
    ]
  },

  "wrath-and-glory": {
    rows: [
      { icon: "fa-skull", color: "#8b3434", value: "{w=<combat.wounds.value>; w == 0 ? \"\" : concat(w, \"/\", <combat.wounds.max>)}", who: "friendly", types: [] },
      { icon: "fa-face-grimace", color: "#9352a3", value: "{s=<combat.shock.value>; s == 0 ? \"\" : concat(s, \"/\", <combat.shock.max>)}", who: "friendly", types: [] },
      { icon: "fa-cross", color: "#c49a3a", value: "{f=<resources.faith.current>; f == <resources.faith.total> ? \"\" : concat(f, \"/\", <resources.faith.total>)}", who: "friendly", types: [] },
      { icon: "fa-shield-halved", color: "#427ea9", value: "combat.defence.total", who: "friendly", types: [] },
      { icon: "fa-hand-fist", color: "#b07a28", value: "combat.resilience.total", who: "friendly", types: [] },
      { icon: "fa-shoe-prints", color: "#a3a3a3", value: "combat.speed", who: "friendly", types: [] },
      { icon: "fa-eye", color: "#9a7bc1", value: "combat.passiveAwareness.total", who: "friendly", types: [] },
      { icon: "fa-skull-crossbones", color: "#6f895d", value: "{c=<corruption.current>; c == 0 ? \"\" : c}", who: "friendly", types: [] },
      { icon: "fa-crown", color: "#d2d81d", value: "resources.wrath", who: "owner", types: [] }
    ]
  },

  // Any other system: HP if it has attributes.hp, and distance.
  default: {
    rows: [
      { icon: "fa-heart", color: "#cd1818", value: "attributes.hp", who: "owner", types: [] },
      { icon: "fa-shield-halved", color: "#74a2be", value: "attributes.ac.value", who: "owner", types: [] },
      { icon: "fa-ruler", color: "#707070", value: DISTANCE, who: "all", types: [] }
    ]
  }
};

export function presetFor(systemId) {
  return foundry.utils.deepClone(PRESETS[systemId] ?? PRESETS.default);
}
