import { MODULE_ID, error } from "./constants.js";
import { Feature } from "./feature.js";

/** @type {Map<string, Feature>} */
const features = new Map();

/** setting key → { feature, setting } (setting is null for the on/off switch). */
const settingIndex = new Map();

/**
 * Declare a feature. Call at module load time (top level of a feature file).
 * Features whose `systems` don't include the active system are kept but never
 * registered or started.
 */
export function defineFeature(definition) {
  if (features.has(definition.id)) throw new Error(`${MODULE_ID} | Feature "${definition.id}" is defined twice.`);
  const feature = new Feature(definition);
  features.set(feature.id, feature);
  return feature;
}

export function getFeature(id) {
  const feature = features.get(id);
  return feature?.available ? feature : undefined;
}

export function availableFeatures() {
  return [...features.values()].filter(f => f.available);
}

/** Look up which feature a full setting key belongs to. */
export function settingInfo(key) {
  return settingIndex.get(key);
}

/** At `init`: register settings for every available feature and run their init(). */
export function initFeatures() {
  for (const feature of availableFeatures()) {
    try {
      feature.registerSettings();
    } catch (err) {
      error(`Feature "${feature.id}" could not register its settings.`, err);
      continue;
    }
    settingIndex.set(feature.key("enabled"), { feature, setting: null });
    for (const s of feature.settings) settingIndex.set(feature.key(s.key), { feature, setting: s });
    feature.runInit();
  }
}

/** At `ready`: start every feature that is switched on. */
export function startFeatures() {
  for (const feature of availableFeatures()) {
    if (settingIndex.has(feature.key("enabled")) && feature.isEnabled) feature.start();
  }
}
