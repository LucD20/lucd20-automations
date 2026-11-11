import { registerDamageLogAdapter } from "../../features/damage-log.js";

/**
 * PF2e detail for the Damage Log: when PF2e applies damage or healing it posts
 * a message flagged `pf2e.appliedDamage` (with the target's uuid). Its text
 * ("Amiri takes 12 damage", resistances/weaknesses/immunities applied, shield
 * block, persistent damage) becomes the entry's cause.
 */

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  for (const el of div.querySelectorAll("button, .hidden, [hidden]")) el.remove();
  // Keep a space between paragraphs/lines ("damage." + "Resistance" → "damage. Resistance").
  for (const el of div.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, header, section")) el.append(" ");
  for (const br of div.querySelectorAll("br")) br.replaceWith(" ");
  return div.textContent.replace(/\s+/g, " ").trim();
}

registerDamageLogAdapter({
  system: "pf2e",
  causeFromMessage(message) {
    const applied = message.flags?.pf2e?.appliedDamage;
    if (!applied?.uuid) return null;
    const text = plainText(message.content);
    if (!text) return null;
    return { actorUuid: applied.uuid, text: text.length > 240 ? `${text.slice(0, 237)}…` : text, messageId: message.id };
  }
});
