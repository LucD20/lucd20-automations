import { localize } from "./constants.js";

/**
 * One "Clear Chat" dialog that features can add to.
 *
 * addFlushContributor(id, {
 *   wantsDialog: () => bool,            // this feature has something to say right now
 *   dialogContent: () => "<html>",       // extra lines / checkboxes (named inputs)
 *   keepMessage: message => bool,        // optional: messages that must not be deleted
 *   afterFlush: async values => {}       // values = { inputName: value } from the dialog
 * }) → remove()
 *
 * When no contributor wants the dialog, Foundry's own Clear Chat runs unchanged.
 */

const contributors = new Map();
let installed = null;

export function addFlushContributor(id, contributor) {
  contributors.set(id, contributor);
  install();
  return () => {
    contributors.delete(id);
    if (!contributors.size) uninstall();
  };
}

function install() {
  if (installed || !game.messages) return;
  const messages = game.messages;
  const hadOwn = Object.prototype.hasOwnProperty.call(messages, "flush");
  const original = messages.flush;
  const wrapped = function (...args) {
    return flush(() => original.apply(this, args));
  };
  messages.flush = wrapped;
  installed = () => {
    if (messages.flush !== wrapped) return;
    if (hadOwn) messages.flush = original;
    else delete messages.flush;
  };
}

function uninstall() {
  installed?.();
  installed = null;
}

async function flush(original) {
  const active = [...contributors.values()].filter(c => c.wantsDialog?.());
  if (!game.user.isGM || !active.length) return original();

  const extra = active.map(c => c.dialogContent?.() ?? "").join("");
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("LUCD20.ChatFlush.Title"), icon: "fa-solid fa-trash" },
    classes: ["lucd20-flush-dialog"],
    content: `<p>${localize("LUCD20.ChatFlush.Content")}</p>${extra}`,
    buttons: [
      {
        action: "yes",
        label: localize("LUCD20.ChatFlush.Yes"),
        icon: "fa-solid fa-trash",
        default: true,
        callback: (event, button) => Object.fromEntries(
          [...button.form.elements].filter(el => el.name).map(el => [el.name, el.type === "checkbox" ? el.checked : el.value])
        )
      },
      { action: "no", label: localize("LUCD20.ChatFlush.No"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  });
  if (!values || typeof values !== "object") return;

  const keepers = active.filter(c => c.keepMessage);
  if (keepers.length) {
    const remove = game.messages.filter(m => !keepers.some(c => c.keepMessage(m))).map(m => m.id);
    if (remove.length) await ChatMessage.deleteDocuments(remove);
  } else {
    await ChatMessage.deleteDocuments([], { deleteAll: true });
  }
  for (const c of active) await c.afterFlush?.(values);
}
