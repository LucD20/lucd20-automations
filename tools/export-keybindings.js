// Export your Foundry keybindings to a JSON file.
//
// Paste into the browser console (F12 → Console) while signed in as yourself,
// or save as a Script macro and run it. Keybindings are per user and per
// browser, so run it where you normally play.
//
// The file lists every action that has a key (Foundry's, the system's and each
// module's), with its current key, its default key and whether you changed it.
(() => {
  const keyText = b => [...(b.modifiers ?? []), b.key].join("+");
  const stored = game.settings.get("core", "keybindings") ?? {};
  const actions = [];
  for (const [id, action] of game.keybindings.actions) {
    const current = (game.keybindings.bindings.get(id) ?? []).map(keyText);
    const defaults = [...(action.uneditable ?? []), ...(action.editable ?? [])].map(keyText);
    if (!current.length && !defaults.length) continue;
    const ns = action.namespace ?? id.split(".")[0];
    actions.push({
      id,
      source: ns === "core" ? "Foundry" : ns === game.system.id ? game.system.title : (game.modules.get(ns)?.title ?? ns),
      name: game.i18n.localize(action.name ?? id),
      current,
      defaults,
      changed: id in stored
    });
  }
  const data = {
    exported: new Date().toISOString(),
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    user: game.user.isGM ? "GM" : "player",
    modules: game.modules.filter(m => m.active).map(m => `${m.id} ${m.version}`),
    actions
  };
  const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
  save(JSON.stringify(data, null, 2), "application/json", `keybindings-${game.system.id}.json`);
  ui.notifications.info(`Exported ${actions.length} keybindings.`);
})();
