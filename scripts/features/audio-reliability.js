import { localize } from "../core/constants.js";
import { watchDOM } from "../core/dom-watch.js";
import { defineFeature } from "../core/registry.js";

/**
 * Reliable Music & Audio. Per player.
 *
 * Addresses Foundry's long-standing playlist music dropout (tracks freezing or
 * failing with a console error after several tracks have played until reload):
 *  1. Lowers Sound.MAX_BUFFER_DURATION (default 600 s → 20 s) so music tracks
 *     stream via HTMLAudioElement instead of downloading and decoding huge PCM
 *     buffers into memory. Short SFX stay buffered.
 *  2. Resumes suspended AudioContexts before playback and automatically clears
 *     a stuck/failed Sound's cached buffer/element and retries once on failure.
 *  3. Adds a "Reset audio" button to the Playlists tab so a wedged browser
 *     audio context can be recovered in one click without reloading Foundry.
 */

const state = { originalMaxBuffer: undefined };

function soundClass() {
  return foundry.audio?.Sound ?? globalThis.Sound ?? null;
}

function setThreshold(seconds) {
  const Sound = soundClass();
  if (!Sound || !("MAX_BUFFER_DURATION" in Sound)) return;
  if (state.originalMaxBuffer === undefined) state.originalMaxBuffer = Sound.MAX_BUFFER_DURATION;
  Sound.MAX_BUFFER_DURATION = Math.max(0, Number(seconds) || 0);
}

function restoreThreshold() {
  const Sound = soundClass();
  if (Sound && state.originalMaxBuffer !== undefined) {
    Sound.MAX_BUFFER_DURATION = state.originalMaxBuffer;
    state.originalMaxBuffer = undefined;
  }
}

function resetSoundInstance(sound, Sound) {
  try {
    if (sound.src) {
      game.audio?.buffers?.delete?.(sound.src);
      game.audio?.sounds?.delete?.(sound.src);
    }
    try { sound.element?.pause?.(); } catch {}
    if (sound.element) {
      try { sound.element.removeAttribute?.("src"); sound.element.load?.(); } catch {}
      sound.element = null;
    }
    sound.buffer = null;
    if ("_state" in sound && Sound?.STATES?.NONE !== undefined) sound._state = Sound.STATES.NONE;
    if ("failed" in sound && Object.getOwnPropertyDescriptor(sound, "failed")?.writable) sound.failed = false;
  } catch {}
}

async function resumeContexts() {
  const audio = game.audio;
  if (!audio) return;
  for (const key of ["music", "environment", "interface"]) {
    const ctx = audio[key];
    if (ctx?.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }
  }
}

/** Reset audio caches/contexts and replay any currently playing playlist tracks. */
export async function resetAudio() {
  const Sound = soundClass();
  await resumeContexts();
  try { game.audio?.buffers?.clear?.(); } catch {}
  try {
    for (const [src, ref] of [...(game.audio?.sounds?.entries?.() ?? [])]) {
      const s = ref?.deref ? ref.deref() : ref;
      if (!s || s.failed || !s.playing) game.audio.sounds.delete(src);
    }
  } catch {}
  let restarted = 0;
  for (const playlist of game.playlists ?? []) {
    if (!playlist?.playing) continue;
    for (const ps of playlist.sounds ?? []) {
      if (!ps?.playing) continue;
      try {
        if (ps.sound) resetSoundInstance(ps.sound, Sound);
        if (typeof ps.sync === "function") await ps.sync();
        else if (typeof ps.sound?.play === "function") await ps.sound.play();
        restarted++;
      } catch {}
    }
  }
  ui.notifications?.info?.(localize("LUCD20.AudioReliability.ResetDone", { n: restarted }));
  return restarted;
}

function addResetButton() {
  const header = document.querySelector("#playlists .directory-header .action-buttons, #playlists .header-actions");
  if (!header || header.querySelector(".lucd20-audio-reset")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lucd20-audio-reset";
  btn.dataset.tooltip = localize("LUCD20.AudioReliability.ResetHint");
  btn.innerHTML = `<i class="fa-solid fa-volume-high"></i> ${localize("LUCD20.AudioReliability.Reset")}`;
  btn.addEventListener("click", () => { resetAudio(); });
  header.append(btn);
}

defineFeature({
  id: "audioReliability",
  category: "scenes",
  scope: "client",
  defaultEnabled: true,
  settings: {
    streamThreshold: { kind: "range", min: 0, max: 600, step: 5, default: 20 }
  },

  enable(feature) {
    setThreshold(feature.get("streamThreshold"));
    const Sound = soundClass();
    if (Sound?.prototype) {
      if (typeof Sound.prototype.load === "function") {
        feature.wrap(Sound.prototype, "load", async function (original, ...args) {
          if (this.failed) resetSoundInstance(this, Sound);
          try {
            const res = await original(...args);
            if (this.failed && !this._lucd20Retried) {
              this._lucd20Retried = true;
              resetSoundInstance(this, Sound);
              try { return await original(...args); } finally { this._lucd20Retried = false; }
            }
            return res;
          } catch (err) {
            if (this._lucd20Retried) throw err;
            this._lucd20Retried = true;
            resetSoundInstance(this, Sound);
            try { return await original(...args); } finally { this._lucd20Retried = false; }
          }
        });
      }
      if (typeof Sound.prototype.play === "function") {
        feature.wrap(Sound.prototype, "play", async function (original, ...args) {
          if (this.context?.state === "suspended") {
            try { await this.context.resume(); } catch {}
          }
          if (this.failed) resetSoundInstance(this, Sound);
          try {
            return await original(...args);
          } catch (err) {
            if (this._lucd20Retried) throw err;
            this._lucd20Retried = true;
            resetSoundInstance(this, Sound);
            try {
              if (typeof this.load === "function") await this.load();
              return await original(...args);
            } finally {
              this._lucd20Retried = false;
            }
          }
        });
      }
    }

    feature.onCleanup(watchDOM("audio-reliability-reset", addResetButton));
    feature.onCleanup(() => {
      restoreThreshold();
      document.querySelectorAll(".lucd20-audio-reset").forEach(el => el.remove());
    });
  },

  onSettingChange(feature) {
    setThreshold(feature.get("streamThreshold"));
  }
});
