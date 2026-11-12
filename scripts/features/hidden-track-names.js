import { MODULE_ID, localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { watchDOM } from "../core/dom-watch.js";
import { appElement } from "../core/dom.js";

/**
 * Hidden Track Names (replaces part of Monk's Sound Enhancements). GM only.
 *
 * - Players see "Unknown track" instead of a track's name in the Playlists
 *   sidebar and its "Currently playing" list (owner: those are the only
 *   places). Playlist names stay visible (Q11).
 * - The GM gets an eye icon on each track (both places) to reveal or hide its
 *   name; saved as a flag on the PlaylistSound, so it survives reloads.
 *   Tracks are hidden by default.
 * - Display only: the real name is still in the player's client data.
 */

const FLAG = "revealed";

function playlistsRoot() {
  return appElement(ui.playlists) ?? document.getElementById("playlists");
}

/** The PlaylistSound a sidebar row stands for. */
function soundOf(li) {
  const soundId = li.dataset.soundId;
  if (!soundId) return null;
  const playlistId = li.dataset.playlistId
    ?? li.closest("[data-playlist-id]")?.dataset.playlistId
    ?? li.closest("li[data-entry-id], li[data-document-id]")?.dataset.entryId
    ?? li.closest("li[data-entry-id], li[data-document-id]")?.dataset.documentId;
  const playlist = playlistId ? game.playlists?.get(playlistId) : null;
  if (playlist) return playlist.sounds?.get(soundId) ?? null;
  for (const p of game.playlists ?? []) {
    const sound = p.sounds?.get(soundId);
    if (sound) return sound;
  }
  return null;
}

const isRevealed = sound => !!sound?.getFlag?.(MODULE_ID, FLAG);

/**
 * Replace every text node and attribute that shows the name. Runs on every
 * change of the sidebar (Foundry updates the "Currently playing" rows often),
 * so it must stay cheap and idempotent.
 */
function mask(li, sound) {
  const name = sound.name;
  const unknown = localize("LUCD20.HiddenTrackNames.Unknown");
  if (!name) return;
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest(".lucd20-track-eye")) continue;
    if (node.nodeValue.includes(unknown)) continue;
    if (node.nodeValue.includes(name)) node.nodeValue = node.nodeValue.split(name).join(unknown);
  }
  for (const el of [li, ...li.querySelectorAll("*")]) {
    for (const attr of ["title", "data-tooltip", "aria-label", "alt"]) {
      const value = el.getAttribute(attr);
      if (value?.includes(name) && !value.includes(unknown)) el.setAttribute(attr, value.split(name).join(unknown));
    }
  }
  li.classList.add("lucd20-track-hidden");
}

function drawEye(li, sound) {
  const revealed = isRevealed(sound);
  let eye = li.querySelector(".lucd20-track-eye");
  if (eye?.dataset.revealed === String(revealed)) return;
  if (!eye) {
    eye = document.createElement("button");
    eye.type = "button";
    eye.className = "lucd20-track-eye inline-control icon fa-solid";
    const controls = li.querySelector(".sound-controls, .entry-controls, .controls");
    if (controls) controls.prepend(eye);
    else li.append(eye);
  }
  eye.dataset.revealed = String(revealed);
  eye.classList.toggle("fa-eye", revealed);
  eye.classList.toggle("fa-eye-slash", !revealed);
  eye.classList.toggle("revealed", revealed);
  const tip = localize(revealed ? "LUCD20.HiddenTrackNames.Revealed" : "LUCD20.HiddenTrackNames.Hidden");
  eye.dataset.tooltip = tip;
  eye.setAttribute("aria-label", tip);
}

function refresh() {
  const root = playlistsRoot();
  if (!root) return;
  for (const li of root.querySelectorAll("[data-sound-id]")) {
    const sound = soundOf(li);
    if (!sound) continue;
    if (game.user.isGM) drawEye(li, sound);
    else if (!isRevealed(sound)) mask(li, sound);
  }
}

/** GM: the eye toggles the flag. Capture phase, before Foundry's own row handlers. */
function onClick(event) {
  const eye = event.target instanceof Element ? event.target.closest(".lucd20-track-eye") : null;
  if (!eye || !game.user.isGM) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const sound = soundOf(eye.closest("[data-sound-id]"));
  sound?.setFlag(MODULE_ID, FLAG, !isRevealed(sound));
}

function onPointer(event) {
  if (event.target instanceof Element && event.target.closest(".lucd20-track-eye")) event.stopImmediatePropagation();
}

defineFeature({
  id: "hiddenTrackNames",
  category: "scenes",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    feature.onCleanup(watchDOM("hidden-track-names", refresh));
    document.addEventListener("click", onClick, true);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) document.addEventListener(type, onPointer, true);
    feature.onCleanup(() => {
      document.removeEventListener("click", onClick, true);
      for (const type of ["pointerdown", "mousedown", "dblclick"]) document.removeEventListener(type, onPointer, true);
      document.querySelectorAll(".lucd20-track-eye").forEach(el => el.remove());
      // Players: Foundry's next draw brings the names back; ask for one now.
      if (document.querySelector(".lucd20-track-hidden")) ui.playlists?.render?.();
    });
  }
});
