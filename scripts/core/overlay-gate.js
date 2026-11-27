/**
 * Full-screen moments that later windows wait for (v0.90.1; owner: "the Loot the fallen window should only show up
 * after the card screen is closed"). The Combat Cards overlay holds the gate while it is open; Loot Pile's "Loot
 * the fallen" waits for it.
 */
let pending = null;
let release = null;

/** Hold the gate; returns the function that releases it. */
export function holdGate() {
  if (!pending) pending = new Promise(res => { release = () => { pending = null; release = null; res(); }; });
  return () => release?.();
}

/** Resolves when nothing holds the gate. */
export const waitForGate = () => pending ?? Promise.resolve();
