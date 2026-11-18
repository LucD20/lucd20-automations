import { addExtra, fxLayer } from "./engine.js";

/**
 * Token Reactions: an optional JB2A impact clip on top of our own drawn effects (owner, Q279).
 * Only when a JB2A module is active; its .webm files are played directly (no Sequencer). A file that isn't
 * there is skipped quietly and not asked for again.
 *
 * (verify) every path below is a guess at JB2A's library layout: the owner's install wasn't visible while
 * this was written. The first file of a look that loads is used; the last one of each list also exists in the
 * free module.
 */

const MODULES = ["jb2a_patreon", "JB2A_DnD5e"];
const IMPACT = "Generic/Impact/";

/** look → candidate files under `modules/<jb2a>/Library/` (verify). */
export const CLIPS = {
  bludgeoning: [`${IMPACT}GroundCrackImpact_01_Regular_Orange_600x600.webm`, `${IMPACT}Impact_07_Regular_Orange_400x400.webm`, `${IMPACT}Impact_07_Regular_Blue_400x400.webm`],
  slashing: [`${IMPACT}Impact_04_Regular_Red_400x400.webm`, `${IMPACT}Impact_04_Regular_Blue_400x400.webm`],
  piercing: [`${IMPACT}Impact_03_Regular_Yellow_400x400.webm`, `${IMPACT}Impact_03_Regular_Blue_400x400.webm`],
  fire: [`${IMPACT}Impact_11_Regular_Orange_400x400.webm`, `${IMPACT}Impact_11_Regular_Blue_400x400.webm`],
  cold: [`${IMPACT}FrostImpact_01_Regular_White_600x600.webm`, `${IMPACT}Impact_12_Regular_Blue_400x400.webm`],
  electricity: [`Generic/Lightning/StaticElectricity_03_Regular_Blue_400x400.webm`, `${IMPACT}Impact_12_Regular_Blue_400x400.webm`],
  acid: [`${IMPACT}Impact_02_Regular_Green_400x400.webm`, `${IMPACT}Impact_02_Regular_Blue_400x400.webm`],
  sonic: [`${IMPACT}Impact_05_Regular_Blue_400x400.webm`],
  force: [`${IMPACT}Impact_06_Regular_PinkPurple_400x400.webm`, `${IMPACT}Impact_06_Regular_Blue_400x400.webm`],
  mental: [`${IMPACT}Impact_10_Regular_PinkPurple_400x400.webm`, `${IMPACT}Impact_10_Regular_Blue_400x400.webm`],
  void: [`${IMPACT}Impact_01_Dark_Purple_400x400.webm`, `${IMPACT}Impact_01_Regular_Blue_400x400.webm`],
  vitality: [`${IMPACT}Impact_08_Regular_Yellow_400x400.webm`, `${IMPACT}Impact_08_Regular_Blue_400x400.webm`]
};

const missing = new Set(); // paths that failed to load

/** `modules/<id>/Library/` of the active JB2A module, or null. */
export function jb2aLibrary() {
  for (const id of MODULES) if (game.modules?.get(id)?.active) return `modules/${id}/Library/`;
  return null;
}

/** The first candidate for a look that hasn't failed, as a full path; null when there is none. */
export function clipPath(look, library = jb2aLibrary()) {
  if (!library) return null;
  const file = (CLIPS[look] ?? []).find(f => !missing.has(library + f));
  return file ? library + file : null;
}

/**
 * Play the clip for a look over a point (simulation units), `size` wide, in the effects layer in use.
 * Returns false when there is nothing to play.
 */
export function playClip(look, x, y, size) {
  const layer = fxLayer();
  const path = clipPath(look);
  if (!layer || !path) return false;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  let sprite = null, failed = false, waited = 0, played = 0;
  video.addEventListener("error", () => { failed = true; missing.add(path); }, { once: true });
  video.addEventListener("canplay", () => {
    if (failed || sprite || layer.destroyed) return;
    try {
      sprite = new PIXI.Sprite(PIXI.Texture.from(video));
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.width = size; sprite.height = size;
      layer.addChild(sprite);
      video.play()?.catch?.(() => { failed = true; });
    } catch {
      failed = true;
    }
  }, { once: true });
  video.src = foundry.utils.getRoute?.(path) ?? path;
  addExtra({
    step(dt) {
      if (failed || layer.destroyed) return true;
      if (!sprite) { waited += dt; return waited > 3; } // still loading: give up after a while
      played += dt;
      return video.ended || played > 6 || sprite.destroyed;
    },
    destroy() {
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch { /* gone */ }
      try { if (sprite && !sprite.destroyed) sprite.destroy({ texture: true, baseTexture: true }); } catch { /* gone */ }
    }
  });
  return true;
}

export const _test = { missing };
