import { MODULE_ID } from "./constants.mjs";
import { SETTING_MAP } from "./cards.mjs";
import { getFeature } from "../../core/registry.js";

/*
 * One-time migration from the separate module "dnd4e-combat-automation"
 * (Q35), run on the GM's client the first time a dnd4e world loads with the
 * merged code:
 * - world data: monster texts, power-level marks, and the old on/off
 *   switches (onto the cards);
 * - flags under the old scope on actors, their effects (quarry, curse,
 *   marks, rage …), tokens and their synthetic actors, combatants (action
 *   tracker) and chat messages (damage buttons, cards) → copied to ours.
 * Each player's own (client) options migrate on their own client.
 * Old data is left in place; nothing is deleted.
 */

const OLD = "dnd4e-combat-automation";
const DONE_KEY = "dnd4eMigrated";
const CLIENT_DONE = `${MODULE_ID}.dnd4eClientMigrated`;

function parse(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A stored world setting of the old module, or undefined. */
function oldWorldSetting(key) {
  const storage = game.settings.storage?.get?.("world");
  const doc = storage?.find?.(s => s.key === `${OLD}.${key}`) ?? storage?.getSetting?.(`${OLD}.${key}`);
  return doc ? parse(doc.value) : undefined;
}

async function setCard(oldKey, value) {
  const entry = SETTING_MAP[oldKey];
  const feature = entry ? getFeature(entry[0]) : null;
  if (!feature) return;
  const key = entry[1] ?? "enabled";
  const settingKey = feature.key(key);
  const scope = game.settings.settings.get(`${MODULE_ID}.${settingKey}`)?.scope;
  if (scope === "client") return; // per-player options migrate on each client
  if (entry[1]) await feature.set(entry[1], !!value);
  else await game.settings.set(MODULE_ID, settingKey, !!value);
}

async function migrateWorldSettings(report) {
  const texts = oldWorldSetting("textOverrides");
  if (texts && typeof texts === "object" && Object.keys(texts).length) {
    const current = game.settings.get(MODULE_ID, "textOverrides") ?? {};
    await game.settings.set(MODULE_ID, "textOverrides", { ...texts, ...current });
    report.texts = Object.keys(texts).length;
  }
  const levels = oldWorldSetting("powerLevels-overrides");
  if (levels && typeof levels === "object" && Object.keys(levels).length) {
    const current = game.settings.get(MODULE_ID, "powerLevels-overrides") ?? {};
    await game.settings.set(MODULE_ID, "powerLevels-overrides", { ...levels, ...current });
    report.levels = Object.keys(levels).length;
  }
  for (const oldKey of Object.keys(SETTING_MAP)) {
    const value = oldWorldSetting(oldKey);
    if (typeof value === "boolean") {
      await setCard(oldKey, value);
      report.switches++;
    }
  }
}

/** Copy old-scope flags onto ours (only where ours aren't set yet). */
function flagUpdate(doc) {
  const old = doc?.flags?.[OLD];
  if (!old || doc.flags?.[MODULE_ID]?.migratedFrom4e) return null;
  return { _id: doc.id, [`flags.${MODULE_ID}`]: { ...foundry.utils.deepClone(old), ...(doc.flags?.[MODULE_ID] ?? {}), migratedFrom4e: true } };
}

async function migrateEmbedded(parent, collection, type, report) {
  const updates = [...(parent[collection] ?? [])].map(flagUpdate).filter(Boolean);
  if (!updates.length) return;
  await parent.updateEmbeddedDocuments(type, updates);
  report.docs += updates.length;
}

async function migrateActor(actor, report) {
  const own = flagUpdate(actor);
  if (own) {
    const { _id, ...data } = own;
    await actor.update(data);
    report.docs++;
  }
  await migrateEmbedded(actor, "effects", "ActiveEffect", report);
}

async function migrateDocuments(report) {
  for (const actor of game.actors ?? []) await migrateActor(actor, report);
  for (const scene of game.scenes ?? []) {
    await migrateEmbedded(scene, "tokens", "Token", report);
    for (const token of scene.tokens ?? []) {
      if (!token.actorLink && token.actor) await migrateEmbedded(token.actor, "effects", "ActiveEffect", report);
    }
  }
  for (const combat of game.combats ?? []) await migrateEmbedded(combat, "combatants", "Combatant", report);
  const messages = [...(game.messages ?? [])].map(flagUpdate).filter(Boolean);
  if (messages.length) {
    await ChatMessage.updateDocuments(messages);
    report.docs += messages.length;
  }
}

/** Per player: their old client options (Foundry keeps them in localStorage). */
async function migrateClientSettings() {
  try {
    if (localStorage.getItem(CLIENT_DONE)) return;
    for (const oldKey of [...Object.keys(SETTING_MAP), "gameLanguage"]) {
      const raw = localStorage.getItem(`${OLD}.${oldKey}`);
      if (raw === null) continue;
      const value = parse(raw);
      if (oldKey === "gameLanguage") {
        const card = getFeature("dnd4eGameLanguage");
        if (card && typeof value === "string" && value !== "foundry") {
          await game.settings.set(MODULE_ID, card.key("enabled"), true);
          await card.set("language", value);
        }
        continue;
      }
      const entry = SETTING_MAP[oldKey];
      const feature = entry ? getFeature(entry[0]) : null;
      if (!feature || typeof value !== "boolean") continue;
      const settingKey = feature.key(entry[1] ?? "enabled");
      if (game.settings.settings.get(`${MODULE_ID}.${settingKey}`)?.scope !== "client") continue;
      await game.settings.set(MODULE_ID, settingKey, value);
    }
    localStorage.setItem(CLIENT_DONE, "1");
  } catch (err) {
    console.warn(`${MODULE_ID} | D&D 4e: client settings migration skipped.`, err);
  }
}

export async function runMigration() {
  await migrateClientSettings();
  if (!game.user.isActiveGM || game.settings.get(MODULE_ID, DONE_KEY)) return null;
  const report = { texts: 0, levels: 0, switches: 0, docs: 0 };
  try {
    await migrateWorldSettings(report);
    await migrateDocuments(report);
    await game.settings.set(MODULE_ID, DONE_KEY, true);
    const any = report.texts || report.levels || report.switches || report.docs;
    if (any) ui.notifications.info(game.i18n.format("LUCD20.DnD4e.Migrated", report), { permanent: true });
    console.log(`${MODULE_ID} | D&D 4e Combat Automation data migrated`, report);
  } catch (err) {
    console.error(`${MODULE_ID} | D&D 4e: migration failed (it will try again next time).`, err);
    ui.notifications.error(game.i18n.localize("LUCD20.DnD4e.MigrationFailed"));
  }
  return report;
}

export function registerMigration() {
  game.settings.register(MODULE_ID, DONE_KEY, { scope: "world", config: false, type: Boolean, default: false });
  Hooks.once("ready", () => runMigration());
}
