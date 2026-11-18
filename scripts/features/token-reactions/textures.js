/**
 * Token Reactions: the small white textures every effect is built from (drawn once on 2D canvases, tinted when
 * used), as in the owner's chosen mockup (docs/mockups/token-reactions-fable.html).
 */

const TAU = Math.PI * 2, PI = Math.PI;
const rnd = (a, b) => a + Math.random() * (b - a);

/** name → PIXI.Texture, filled by `textures()`. */
export const TX = {};
let built = false;

function cv(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  fn(c.getContext("2d"), w, h);
  return PIXI.Texture.from(c);
}

function radial(x, w, stops, cx, cy, r0, r1) {
  const g = x.createRadialGradient(cx ?? w / 2, cy ?? w / 2, r0 ?? 0, cx ?? w / 2, cy ?? w / 2, r1 ?? w / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Build the textures (first reaction on this client). */
export function textures() {
  if (built) return TX;
  built = true;
  TX.dot = cv(64, 64, (x, w) => { x.fillStyle = radial(x, w, [[0, "#fff"], [.35, "rgba(255,255,255,.75)"], [1, "rgba(255,255,255,0)"]]); x.fillRect(0, 0, w, w); });
  TX.spark = cv(96, 16, (x) => {
    const g = x.createLinearGradient(0, 0, 96, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.7, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.ellipse(48, 8, 48, 4.5, 0, 0, TAU); x.fill();
  });
  TX.shard = cv(32, 48, (x) => {
    const g = x.createLinearGradient(0, 0, 32, 48); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,.45)");
    x.fillStyle = g; x.beginPath(); x.moveTo(14, 0); x.lineTo(32, 20); x.lineTo(20, 48); x.lineTo(0, 30); x.closePath(); x.fill();
  });
  TX.rock = cv(32, 32, (x) => {
    x.fillStyle = "#fff"; x.beginPath(); x.moveTo(6, 4); x.lineTo(24, 2); x.lineTo(30, 16); x.lineTo(20, 30); x.lineTo(5, 24); x.lineTo(1, 12); x.closePath(); x.fill();
    x.fillStyle = "rgba(0,0,0,.3)"; x.beginPath(); x.moveTo(20, 30); x.lineTo(5, 24); x.lineTo(1, 12); x.lineTo(16, 18); x.closePath(); x.fill();
  });
  TX.smoke = cv(96, 96, (x) => {
    for (let i = 0; i < 7; i++) {
      const cx = 48 + rnd(-18, 18), cy = 48 + rnd(-18, 18), r = rnd(18, 28);
      x.fillStyle = radial(x, 0, [[0, "rgba(255,255,255,.5)"], [1, "rgba(255,255,255,0)"]], cx, cy, 0, r); x.fillRect(0, 0, 96, 96);
    }
  });
  TX.ring = cv(160, 160, (x) => { x.strokeStyle = "#fff"; x.lineWidth = 7; x.shadowColor = "#fff"; x.shadowBlur = 10; x.beginPath(); x.arc(80, 80, 64, 0, TAU); x.stroke(); });
  TX.star = cv(64, 64, (x) => {
    x.fillStyle = radial(x, 64, [[0, "#fff"], [1, "rgba(255,255,255,0)"]]); x.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, r = i % 2 ? 6 : 32; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
  });
  TX.rays = cv(256, 256, (x) => {
    x.translate(128, 128);
    x.fillStyle = radial(x, 0, [[0, "rgba(255,255,255,.95)"], [.5, "rgba(255,255,255,.5)"], [1, "rgba(255,255,255,0)"]], 0, 0, 0, 128);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU + rnd(-.08, .08), w = rnd(.05, .12), r = rnd(90, 128);
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a - w) * r, Math.sin(a - w) * r); x.lineTo(Math.cos(a + w) * r, Math.sin(a + w) * r); x.closePath(); x.fill();
    }
  });
  TX.pillar = cv(64, 256, (x) => {
    const g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 256);
    x.globalCompositeOperation = "destination-in";
    const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, "rgba(0,0,0,0)"); h.addColorStop(.5, "#000"); h.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  });
  TX.shadow = cv(128, 128, (x) => { x.fillStyle = radial(x, 128, [[0, "rgba(0,0,0,.85)"], [.6, "rgba(0,0,0,.55)"], [1, "rgba(0,0,0,0)"]]); x.fillRect(0, 0, 128, 128); });
  // Round stand-ins for the token's outline, when it can't be read from its art.
  TX.disc = cv(128, 128, (x) => { x.fillStyle = radial(x, 128, [[0, "#fff"], [.9, "#fff"], [.97, "rgba(255,255,255,0)"]]); x.fillRect(0, 0, 128, 128); });
  TX.frost = cv(256, 256, (x) => {
    x.beginPath(); x.arc(128, 128, 124, 0, TAU); x.clip();
    x.fillStyle = radial(x, 256, [[0, "rgba(190,230,255,.35)"], [.7, "rgba(200,236,255,.6)"], [1, "rgba(240,250,255,.95)"]]); x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "rgba(255,255,255,.75)"; x.lineCap = "round";
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, TAU), r = 124, px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r, len = rnd(40, 100);
      const ia = a + PI + rnd(-.5, .5); x.lineWidth = rnd(1.5, 3.5); x.beginPath(); x.moveTo(px, py);
      for (let k = 1; k <= 4; k++) {
        const qx = px + Math.cos(ia) * len * k / 4, qy = py + Math.sin(ia) * len * k / 4; x.lineTo(qx, qy);
        for (const s of [-1, 1]) { x.moveTo(qx, qy); x.lineTo(qx + Math.cos(ia + s * .9) * 14, qy + Math.sin(ia + s * .9) * 14); }
        x.moveTo(qx, qy);
      }
      x.stroke();
    }
  });
  // On the back of a token dropped to 0 HP.
  TX.skull = cv(128, 128, (x) => {
    x.fillStyle = "#d9cfb8"; x.strokeStyle = "#1a120c"; x.lineWidth = 3;
    x.beginPath(); x.arc(64, 54, 40, 0, TAU); x.fill(); x.stroke(); x.beginPath(); x.rect(43, 82, 42, 26); x.fill(); x.stroke();
    x.fillStyle = "#17100b"; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(64 + s * 16, 54, 10, 12, 0, 0, TAU); x.fill(); }
    x.beginPath(); x.moveTo(64, 66); x.lineTo(58, 79); x.lineTo(70, 79); x.closePath(); x.fill();
    for (let i = 0; i < 4; i++) x.fillRect(48 + i * 10, 89, 3, 18);
  });
  return TX;
}

/** Free them (feature switched off). */
export function destroyTextures() {
  for (const key of Object.keys(TX)) {
    try { TX[key].destroy(true); } catch { /* already gone */ }
    delete TX[key];
  }
  built = false;
}
