// "Kostia" easter-egg sail — a red IQFoil race sail (Ukraine flag, "UKR 5"),
// matching Oleksandr Mendelenko's real rig. It replaces the normal warm icon
// sail when the site is opened at /kostia (a tiny redirect page bounces that to
// ?kostia). Kept in its own module so world.js only calls into it — the whole
// race-sail graphic and its wiring live here.
import * as THREE from 'three';

// True when the page was opened as the Kostia variant (/kostia or ?kostia).
export function isKostia() {
  return /(^|\/)kostia(\/|$)/i.test(location.pathname) ||
    new URLSearchParams(location.search).has('kostia');
}

// Repaint an already-built sail as the Kostia race sail: remap the sail
// geometry's UVs onto the texture's 0..1 box and swap the material over to the
// painted canvas texture. Mutates sailMat / sailGeo in place (no return).
export function applyKostiaSail(sailMat, sailGeo) {
  // The whole race-sail graphic lives in one canvas texture. ShapeGeometry
  // bakes the raw shape (x,y) as UVs, so normalise them to 0..1 across the
  // sail's bounding box (x:0..2.05, y:0.55..4.45) to map the texture cleanly.
  const uv = sailGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / 2.05, (uv.getY(i) - 0.55) / 3.9);
  }
  uv.needsUpdate = true;
  const tex = kostiaSailTexture();
  sailMat.map = tex;
  sailMat.emissiveMap = tex;             // keep the red vivid under the sea light
  sailMat.color.set(0xffffff);           // let the texture's own colours show
  sailMat.emissive.set(0xffffff);
  sailMat.emissiveIntensity = 0.35;
  sailMat.roughness = 0.5;
  sailMat.opacity = 0.98;
  sailMat.needsUpdate = true;
  // No separate panel/batten meshes — the seams and battens are painted
  // straight into the texture.
}

// Paint the "Kostia" race sail (red monofilm, IQFoil badge, Ukraine flag,
// UKR 5) into a canvas and hand it back as a texture. Canvas is laid out so
// the top row is the sail head and the left edge is the mast; the visible
// area is only the triangular sail, so anything painted past the leech curve
// is simply never shown.
function kostiaSailTexture() {
    const W = 512, H = 1024;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');

    // --- red monofilm base with a glossy left-to-right gradient ---
    const base = g.createLinearGradient(0, 0, W, 0);
    base.addColorStop(0, '#ff4038');   // brighter near the mast
    base.addColorStop(0.55, '#f5141d');
    base.addColorStop(1, '#d80f18');   // a touch deeper toward the leech
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    // vertical shade so the head reads a touch deeper than the foot
    const vshade = g.createLinearGradient(0, 0, 0, H);
    vshade.addColorStop(0, 'rgba(120,0,8,0.18)');
    vshade.addColorStop(0.35, 'rgba(0,0,0,0)');
    vshade.addColorStop(1, 'rgba(150,20,20,0.10)');
    g.fillStyle = vshade;
    g.fillRect(0, 0, W, H);

    // diagonal gloss streaks, like sun on tensioned monofilm
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, w, a] of [[40, 60, 0.10], [170, 40, 0.07], [300, 70, 0.06]]) {
      const gr = g.createLinearGradient(x, 0, x + 140, H);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - w, 0, w * 2, H);
    }
    g.restore();
    // a couple of darker reflection sweeps
    g.save();
    g.globalCompositeOperation = 'multiply';
    for (const [x0, y0, x1, y1] of [[0, 300, 512, 520], [0, 640, 460, 900]]) {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(150,10,14,0)');
      gr.addColorStop(0.5, 'rgba(150,10,14,0.16)');
      gr.addColorStop(1, 'rgba(150,10,14,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    g.restore();

    // --- horizontal panel seams (the "полосочки") ---
    g.strokeStyle = 'rgba(90,4,10,0.45)';
    g.lineWidth = 2;
    for (let i = 1; i < 9; i++) {
      const y = (H / 9) * i;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + 26);        // slight slant, following the battens
      g.stroke();
    }
    // three thicker batten lines
    g.strokeStyle = 'rgba(60,2,8,0.55)';
    g.lineWidth = 5;
    for (const y of [300, 560, 800]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + 26);
      g.stroke();
    }

    // ---- IQFoil badge, near the head ----
    const iqCX = 78, iqCY = 128, iqW = 128, iqH = 58;
    g.save();
    g.translate(iqCX, iqCY);
    roundRect(g, -iqW / 2, -iqH / 2, iqW, iqH, 12);
    g.fillStyle = '#0f2a53';       // IQFoil navy
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('iQFOiL', 0, 2);
    g.restore();

    // ---- Ukraine flag (hugged toward the mast so the leech curve never clips it) ----
    const fX = 190, fY = 300, fW = 205, fH = 118;
    g.fillStyle = '#0057b7';                 // blue
    g.fillRect(fX, fY, fW, fH / 2);
    g.fillStyle = '#ffd700';                 // yellow
    g.fillRect(fX, fY + fH / 2, fW, fH / 2);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.strokeRect(fX, fY, fW, fH);

    // ---- UKR 5 ----
    const pX = 40, pY = 520, pW = 396, pH = 128;
    roundRect(g, pX, pY, pW, pH, 14);
    g.fillStyle = '#101418';                 // dark plate, like the real sail
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '800 92px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UKR 5', pX + pW / 2, pY + pH / 2 + 4);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // Mirror horizontally so the numbers read the RIGHT way round on the face
    // the default 3/4-rear camera looks at (starboard tack). The far side is
    // then mirrored — unavoidable on a single double-sided plane, and true to a
    // real sail where only one side reads cleanly.
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    tex.offset.x = 1;
    return tex;
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
