import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { appElement } from "../core/dom.js";

/**
 * Multi-Token Edit (replaces the token part of Multi Token Edit).
 *
 * With several tokens selected, the token right-click menu (HUD) shows a
 * "multiple gears" button. It opens the normal Token Configuration of the
 * right-clicked token. When it is saved, exactly the fields that changed
 * (Foundry reports only the difference) are applied to every other selected
 * token. Changed fields are highlighted while editing.
 */

const SKIP_KEYS = new Set(["_id", "x", "y", "sort", "_stats"]);
const state = { session: null };
const asElement = html => (html instanceof HTMLElement ? html : html?.[0] ?? null);

function editableControlled() {
  return (canvas.tokens?.controlled ?? []).filter(t => t.document?.canUserModify(game.user, "update"));
}

/* -------------------------------------------- */
/*  HUD button                                  */
/* -------------------------------------------- */

function addHudButton(hud, html) {
  const root = asElement(html) ?? appElement(hud);
  if (!root) return;
  root.querySelector(".lucd20-mte")?.remove();
  const tokens = editableControlled();
  const base = hud.object ?? hud.document?.object;
  if (tokens.length < 2 || !base || !tokens.includes(base)) return;

  const column = root.querySelector(".col.left") ?? root.querySelector(".col.right") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon lucd20-mte";
  button.dataset.tooltip = localize("LUCD20.MultiTokenEdit.Button", { count: tokens.length });
  button.innerHTML = '<i class="fa-solid fa-gears"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    startSession(base.document, tokens);
    hud.close?.();
  });
  column.append(button);
}

/* -------------------------------------------- */
/*  Editing session                             */
/* -------------------------------------------- */

function startSession(baseDoc, tokens) {
  const sheet = baseDoc.sheet;
  state.session = {
    sheet,
    baseId: baseDoc.id,
    sceneId: baseDoc.parent?.id,
    targetIds: tokens.map(t => t.document.id).filter(id => id !== baseDoc.id)
  };
  sheet.render(true);
}

function endSession(app) {
  if (state.session && (!app || app === state.session.sheet)) state.session = null;
}

/** Banner + highlight changed fields inside the Token Configuration being used. */
function decorateSheet(app, html) {
  const session = state.session;
  if (!session || app !== session.sheet) return;
  const root = asElement(html) ?? appElement(app);
  const form = root?.matches?.("form") ? root : root?.querySelector("form") ?? root;
  if (!form || form.querySelector(".lucd20-mte-banner")) return;

  const banner = document.createElement("div");
  banner.className = "lucd20-mte-banner";
  banner.innerHTML = `<i class="fa-solid fa-gears"></i> ${localize("LUCD20.MultiTokenEdit.Banner", { count: session.targetIds.length + 1 })}`;
  const content = form.querySelector(".window-content") ?? form;
  content.prepend(banner);

  if (form._lucd20MteListener) return;
  form._lucd20MteListener = true;
  form.addEventListener("change", event => {
    if (state.session?.sheet !== app) return;
    event.target.closest?.(".form-group")?.classList.add("lucd20-mte-changed");
  });
}

async function onUpdateToken(doc, changes, options, userId) {
  const session = state.session;
  if (!session || userId !== game.user.id || options?.lucd20MultiEdit) return;
  if (doc.id !== session.baseId || doc.parent?.id !== session.sceneId) return;

  const flat = foundry.utils.flattenObject(changes);
  for (const key of Object.keys(flat)) {
    if (SKIP_KEYS.has(key.split(".")[0])) delete flat[key];
  }
  if (foundry.utils.isEmpty(flat)) return;

  const scene = doc.parent;
  const updates = session.targetIds.filter(id => scene.tokens.has(id)).map(id => ({ _id: id, ...flat }));
  if (!updates.length) return;
  await scene.updateEmbeddedDocuments("Token", updates, { lucd20MultiEdit: true });
  ui.notifications.info(localize("LUCD20.MultiTokenEdit.Applied", { count: updates.length + 1 }));
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
  id: "multiTokenEdit",
  category: "tokens",
  scope: "world",
  defaultEnabled: false,

  enable(feature) {
    feature.on("renderTokenHUD", addHudButton);
    feature.on("updateToken", onUpdateToken);
    for (const hook of ["renderTokenConfig", "renderApplicationV2", "renderApplication"]) feature.on(hook, decorateSheet);
    for (const hook of ["closeTokenConfig", "closeApplicationV2", "closeApplication"]) feature.on(hook, endSession);
    feature.onCleanup(() => {
      state.session = null;
      document.querySelectorAll(".lucd20-mte, .lucd20-mte-banner").forEach(el => el.remove());
    });
  }
});
