/** The root HTMLElement of an application (works for ApplicationV2 and the older jQuery-based windows). */
export function appElement(app) {
  const el = app?.element;
  if (!el) return null;
  return el instanceof HTMLElement ? el : el[0] ?? null;
}

/** The title bar of an application window, or null. */
export function appHeader(app) {
  const root = appElement(app);
  if (!root) return null;
  return root.querySelector(":scope > .window-header") ?? root.querySelector(".window-header");
}

/** Every application window currently open (both window styles). */
export function openAppWindows() {
  const apps = new Set(foundry.applications.instances?.values() ?? []);
  for (const app of Object.values(globalThis.ui?.windows ?? {})) apps.add(app);
  return [...apps];
}
