import { localize } from "../core/constants.js";
import { defineFeature } from "../core/registry.js";
import { watchDOM } from "../core/dom-watch.js";

/**
 * Scene Palette (replaces part of Monk's Little Details). GM only.
 *
 * In the scene's settings (V14: Basics → Current Level → Background color,
 * owner checked), five swatches taken from that level's background image sit
 * next to Foundry's color picker. Clicking one sets the color; the picker
 * stays for a custom color (Q10).
 *
 * Colors are worked out in the browser: the image is drawn small on a canvas
 * and quantized (k-means on the pixels). No dependencies.
 */

const SWATCHES = 5;
const cache = new Map(); // image src → Promise<string[]>

/* -------------------------------------------- */
/*  Palette from an image                       */
/* -------------------------------------------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const hex = ([r, g, b]) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** k-means with a deterministic, spread-out start (farthest-point). */
function quantize(pixels, k) {
  if (!pixels.length) return [];
  const centers = [pixels[Math.floor(pixels.length / 2)]];
  while (centers.length < k) {
    let best = null;
    let bestD = -1;
    for (let i = 0; i < pixels.length; i += 7) {
      const d = Math.min(...centers.map(c => dist2(c, pixels[i])));
      if (d > bestD) {
        bestD = d;
        best = pixels[i];
      }
    }
    if (!best || bestD === 0) break;
    centers.push(best);
  }
  let counts = [];
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of pixels) {
      let j = 0;
      let d = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const e = dist2(p, centers[c]);
        if (e < d) {
          d = e;
          j = c;
        }
      }
      sums[j][0] += p[0];
      sums[j][1] += p[1];
      sums[j][2] += p[2];
      counts[j]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c]) centers[c] = sums[c].map(v => v / counts[c]);
    }
  }
  // Most common first, then dark to light among similar counts.
  return centers
    .map((c, i) => ({ c, n: counts[i] }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || luminance(a.c) - luminance(b.c))
    .map(x => hex(x.c));
}

export async function paletteFromImage(src, k = SWATCHES) {
  const img = await loadImage(src);
  const size = 64;
  const scale = Math.min(1, size / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // transparent
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return quantize(pixels, k);
}

function palette(src) {
  if (!cache.has(src)) cache.set(src, paletteFromImage(src).catch(() => []));
  return cache.get(src);
}

/* -------------------------------------------- */
/*  Scene settings                              */
/* -------------------------------------------- */

const COLOR_FIELD = /background.*colou?r|backgroundColor/i;
const IMAGE_FIELD = /background.*(src|img|image)$/i;

/** The background color pickers inside open scene settings windows. */
function colorPickers() {
  const out = [];
  for (const el of document.querySelectorAll("color-picker[name], input[type=color][name], input[name][data-edit]")) {
    if (!COLOR_FIELD.test(el.name ?? el.getAttribute("name") ?? "")) continue;
    const form = el.closest("form");
    if (!form || !isSceneForm(form)) continue;
    out.push(el);
  }
  return out;
}

function isSceneForm(form) {
  const app = form.closest(".application, .app");
  if (!app) return false;
  return /scene/i.test(app.id ?? "") || app.classList.contains("scene-config") || !!form.querySelector("[name='navigation'], [name='navName']");
}

/** The background image field that belongs to this color field. */
function imageFieldFor(picker) {
  const name = picker.getAttribute("name") ?? "";
  const form = picker.closest("form");
  const fields = [...form.querySelectorAll("file-picker[name], input[name]")].filter(el => IMAGE_FIELD.test(el.getAttribute("name") ?? ""));
  if (!fields.length) return null;
  // Same prefix first (e.g. levels.abc.background.color ↔ levels.abc.background.src).
  const prefix = name.replace(/colou?r$/i, "");
  return fields.find(el => (el.getAttribute("name") ?? "").startsWith(prefix))
    ?? fields.find(el => picker.closest("fieldset, section, .tab")?.contains(el))
    ?? fields[0];
}

function imageSrc(field) {
  return (field?.value ?? field?.getAttribute("value") ?? "").trim();
}

function setColor(picker, color) {
  picker.value = color;
  const input = picker.querySelector?.("input[type=color], input[type=text]");
  if (input) input.value = color;
  picker.dispatchEvent(new Event("input", { bubbles: true }));
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fallback: the scene's own background image, from the settings window's document. */
function documentImage(picker) {
  const app = picker.closest(".application, .app");
  const instance = app?.id ? foundry.applications?.instances?.get?.(app.id) : null;
  const scene = instance?.document ?? null;
  return scene?.background?.src ?? scene?.img ?? "";
}

function drawSwatches(picker) {
  const field = imageFieldFor(picker);
  const src = imageSrc(field) || documentImage(picker);
  const group = picker.closest(".form-group") ?? picker.parentElement;
  let box = group.querySelector(".lucd20-palette");
  if (box?.dataset.src === src) return;
  if (!src) {
    box?.remove();
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.className = "lucd20-palette";
    // Inside the picker's row, after it: same line, same height.
    const fields = picker.closest(".form-fields");
    if (fields) fields.append(box);
    else picker.after(box);
  }
  box.dataset.src = src;
  box.innerHTML = "";
  box.title = localize("LUCD20.ScenePalette.Hint");
  palette(src).then(colors => {
    if (box.dataset.src !== src) return;
    box.innerHTML = "";
    for (const color of colors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "lucd20-swatch";
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.dataset.tooltip = color;
      swatch.setAttribute("aria-label", localize("LUCD20.ScenePalette.Use", { color }));
      swatch.addEventListener("click", event => {
        event.preventDefault();
        setColor(picker, color);
      });
      box.append(swatch);
    }
  });
}

function refresh() {
  if (!game.user.isGM) return;
  for (const picker of colorPickers()) drawSwatches(picker);
}

defineFeature({
  id: "scenePalette",
  category: "scenes",
  scope: "world",
  gmOnly: true,
  defaultEnabled: false,

  enable(feature) {
    feature.onCleanup(watchDOM("scene-palette", refresh));
    // A new background image picked in the form: re-draw the swatches.
    const onChange = event => {
      if (IMAGE_FIELD.test(event.target?.getAttribute?.("name") ?? "")) refresh();
    };
    document.addEventListener("change", onChange, true);
    feature.onCleanup(() => document.removeEventListener("change", onChange, true));
    feature.onCleanup(() => document.querySelectorAll(".lucd20-palette").forEach(el => el.remove()));
  }
});
