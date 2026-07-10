// Capture desktop + mobile HUD plates (localized) for the given languages.
// Scene backdrop is shared (plate-scene-en.png), so it is NOT re-captured here.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { launch } from './cdp.mjs';

const PLATES = dirname(fileURLToPath(import.meta.url)) + '/plates'; // tools/og-card/plates
const BASE = 'http://localhost:8752';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE = `#top-buttons,#demo-caption,#demo-cap,#hint-bar,#hint-text,#toast,#help-note`;

async function bootAndPlane(s) {
  for (let i = 0; i < 40; i++) { if (await s.eval(() => !!window.__sim)) break; await sleep(300); }
  await s.eval(() => { document.getElementById('welcome-close')?.click(); });
  await sleep(500);
  await s.eval(() => { document.getElementById('demo-toggle')?.click(); });
  await sleep(400);
  await s.eval(`() => { document.querySelector('.demo-mode[data-mode="freeride"]')?.click();
    const st=document.createElement('style'); st.textContent=${JSON.stringify(HIDE + '{visibility:hidden!important;opacity:0!important;display:none!important;}')}; document.head.appendChild(st); }`);
  let st = { v: 0, planing: false };
  for (let i = 0; i < 60; i++) { await sleep(400); st = await s.eval(() => ({ v: window.__sim?.v || 0, planing: !!window.__sim?.planing })); if (st.planing && st.v > 11) break; }
  return st;
}

const langs = process.argv.slice(2);
if (!langs.length) { console.error('usage: capture-hud.mjs <lang...>'); process.exit(1); }
const s = await launch({ width: 1600, height: 900 });
await s.newPage();
for (const lang of langs) {
  await s.setViewport(1440, 900, false, 2);
  await s.navigate(`${BASE}/`);
  await s.eval(`() => { try{localStorage.setItem('ws_lang','${lang}')}catch(e){} }`);
  await s.navigate(`${BASE}/`);
  const d = await bootAndPlane(s);
  await s.screenshot(`${PLATES}/plate-desktop-${lang}.png`);
  await s.setViewport(400, 860, true, 2);
  await s.navigate(`${BASE}/`);
  const m = await bootAndPlane(s);
  await s.screenshot(`${PLATES}/plate-mobile-${lang}.png`);
  console.log(`${lang}: d=${d.v.toFixed(1)}/${d.planing} m=${m.v.toFixed(1)}/${m.planing}`);
}
await s.close();
console.log('CAPTURE DONE');
