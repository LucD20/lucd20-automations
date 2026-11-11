/**
 * Bridge between the settings window and the Force Player Settings feature.
 * The feature registers itself as the provider while it is switched on; when
 * it is off, no lock buttons or locks are shown.
 *
 * Provider interface:
 *   info(fullKey) → { key, mode: "none"|"default"|"lock", gm, lockedForMe, icon, tooltip }
 *   openDialog(fullKey, event) → Promise (Shift/Ctrl+click are shortcuts)
 */

let provider = null;

export function setLockProvider(value) {
  provider = value;
}

/** Lock state for a per-player setting ("namespace.key"), or null when the feature is off. */
export function lockInfo(fullKey) {
  return provider?.info(fullKey) ?? null;
}

export function openLockDialog(fullKey, event) {
  return provider?.openDialog(fullKey, event);
}
