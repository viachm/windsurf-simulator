// Render the Aurora Glass OG card for each language: write _v1-<lang>.html, screenshot
// at 2x with headless Chrome, downscale to 1200x630 with sips. en -> og-cover.png.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { L10N, LANGS } from './l10n-v.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // tools/og-card
const REPO = resolve(HERE, '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function cardHTML(lang) {
  const L = L10N[lang];
  const title = L.htmlTitle.map((s) => s).join('<br>');
  const pills = L.pills.map((p) => `<div class="pill">${p}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  :root{--ink:#eaf3fb;--gold:#ffb437;--orange:#ff8a45;--blue:#7cc0f0}
  #card{position:relative;width:1200px;height:630px;font-family:-apple-system,"Helvetica Neue",Arial,"Noto Sans","Noto Sans CJK SC","Noto Sans CJK JP","Noto Sans CJK KR",sans-serif;background:#071a2c;overflow:hidden}
  #sea{position:absolute;inset:0;background:url('plates/plate-scene-en.png') center 40%/cover no-repeat}
  #grade{position:absolute;inset:0;background:
     linear-gradient(180deg, rgba(255,180,120,.10) 0%, rgba(7,26,44,0) 22%, rgba(7,26,44,.15) 60%, rgba(4,14,26,.7) 100%),
     linear-gradient(100deg, rgba(6,20,36,.985) 0%, rgba(6,20,36,.93) 34%, rgba(8,32,52,.5) 60%, rgba(9,40,62,.06) 82%, transparent 100%)}
  #vign{position:absolute;inset:0;background:radial-gradient(125% 95% at 46% 40%, transparent 52%, rgba(2,10,20,.6) 100%);pointer-events:none}
  #glow{position:absolute;right:150px;top:120px;width:660px;height:440px;background:radial-gradient(closest-side, rgba(255,130,66,.4), rgba(255,130,66,.1) 46%, transparent 72%);filter:blur(8px)}
  .laptop{position:absolute;right:40px;top:104px;width:590px;filter:drop-shadow(0 44px 66px rgba(0,0,0,.6))}
  .laptop .screen{background:#0b0f15;padding:11px 11px 9px;border-radius:16px 16px 4px 4px;border:1px solid rgba(255,255,255,.08);position:relative}
  .laptop .screen .cam{position:absolute;top:5px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#2a3038}
  .laptop .screen img{display:block;width:100%;border-radius:4px}
  .laptop .glassrim{position:absolute;inset:11px 11px 9px;border-radius:4px;background:linear-gradient(120deg,rgba(120,180,255,.14),transparent 45%);pointer-events:none}
  .laptop .deck{height:15px;margin:0 -27px;background:linear-gradient(180deg,#e2e8ee,#bcc6d0 55%,#96a3ae);border-radius:0 0 11px 11px;box-shadow:inset 0 2px 2px rgba(255,255,255,.6),0 12px 20px rgba(0,0,0,.45);position:relative}
  .laptop .deck::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:100px;height:7px;background:linear-gradient(#8f9aa5,#a5afb9);border-radius:0 0 9px 9px}
  .phone{position:absolute;right:474px;bottom:24px;width:162px;transform:rotate(-7deg);transform-origin:bottom center;border-radius:27px;padding:7px;background:#0a1420;box-shadow:0 32px 58px rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.14);z-index:4}
  .phone .screen{border-radius:21px;overflow:hidden}
  .phone img{display:block;width:100%}
  .phone .notch{position:absolute;top:13px;left:50%;transform:translateX(-50%);width:50px;height:5px;border-radius:3px;background:rgba(255,255,255,.32)}
  #left{position:absolute;top:0;left:76px;width:452px;height:630px;display:flex;flex-direction:column;justify-content:center;z-index:6}
  .kick{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  .kick .rule{width:34px;height:2px;background:linear-gradient(90deg,var(--gold),transparent);flex:none}
  .kick span{color:var(--gold);font-weight:800;font-size:16px;letter-spacing:3px}
  #icon{width:66px;height:66px;border-radius:17px;box-shadow:0 8px 26px rgba(0,0,0,.5);margin-bottom:24px}
  h1{font-weight:800;font-size:78px;line-height:1.0;letter-spacing:-1.6px;margin-bottom:22px;white-space:nowrap;background:linear-gradient(180deg,#ffffff 40%,#bcd8f2);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 2px 24px rgba(0,0,0,.3)}
  #sub{color:var(--ink);font-weight:500;font-size:29px;line-height:1.32;margin-bottom:24px}
  #sub .hl{color:var(--orange);font-weight:700}
  .pills{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:26px}
  .pill{padding:8px 15px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:#dbe9f6;font-weight:600;font-size:15px;letter-spacing:.3px;white-space:nowrap}
  .cta{display:flex;align-items:center;gap:16px}
  .btn{padding:14px 26px;border-radius:14px;background:linear-gradient(180deg,#ff9a4d,#ff7a3c);color:#2a1400;font-weight:800;font-size:20px;box-shadow:0 12px 30px rgba(255,122,60,.45);white-space:nowrap}
  </style></head><body><div id="card">
  <div id="sea"></div><div id="grade"></div><div id="vign"></div><div id="glow"></div>
  <div class="laptop"><div class="screen"><span class="cam"></span><img src="plates/plate-desktop-${lang}.png"><div class="glassrim"></div></div><div class="deck"></div></div>
  <div class="phone"><div class="screen"><img src="plates/plate-mobile-${lang}.png"></div><div class="notch"></div></div>
  <div id="left">
    <img id="icon" src="../../docs/app-icon.png">
    <div class="kick"><span class="rule"></span><span>${L.kicker}</span></div>
    <h1>${title}</h1>
    <div id="sub">${L.subheadHTML}</div>
    <div class="pills">${pills}</div>
    <div class="cta"><div class="btn">${L.cta}</div></div>
  </div>
  <script>(function(){var zone=document.getElementById('left').clientWidth;
    function fit(el,max,min){var s=max;el.style.fontSize=s+'px';while(el.scrollWidth>zone&&s>min){s-=1;el.style.fontSize=s+'px';}}
    fit(document.querySelector('h1'),78,44);fit(document.getElementById('sub'),29,20);})();</script>
  </div></body></html>`;
}

const langs = process.argv.slice(2).length ? process.argv.slice(2) : LANGS;
for (const lang of langs) {
  const htmlPath = `${HERE}/_v1-${lang}.html`;
  writeFileSync(htmlPath, cardHTML(lang));
  const raw = `${HERE}/.raw-${lang}.png`;
  execFileSync(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars',
    '--force-device-scale-factor=2','--window-size=1200,630','--allow-file-access-from-files',
    `--screenshot=${raw}`, `file://${htmlPath}`], { stdio: 'ignore' });
  const out = lang === 'en' ? `${REPO}/site/og/og-cover.png` : `${REPO}/site/og/og-cover-${lang}.png`;
  execFileSync('sips', ['-z','630','1200', raw, '--out', out], { stdio: 'ignore' });
  console.log('rendered', lang, '->', out.split('/').pop());
}
console.log('RENDER DONE');
