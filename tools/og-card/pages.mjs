// Generate per-language landing pages (site/<xx>/index.html), inject hreflang into
// the site root (site/index.html), and rebuild site/sitemap.xml.  Root (/) is English — no /en/.
// Meta text stays free-less (docTitle + tagline); the marketing "free" lives only on the image.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { L10N, LANGS, plain, DESC, GAME, SEO } from './l10n-v.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const ORIGIN = 'https://windsurfsimulator.com';
const LASTMOD = process.argv[2] || '2026-07-10';
const NONEN = LANGS.filter((l) => l !== 'en');

const stripEnd = (s) => s.replace(/[.。]\s*$/, '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tagOf = (lang) => plain(L10N[lang].subheadHTML);

function hreflangBlock(indent = '  ') {
  const lines = [`${indent}<link rel="alternate" hreflang="en" href="${ORIGIN}/" />`];
  for (const l of NONEN) lines.push(`${indent}<link rel="alternate" hreflang="${l}" href="${ORIGIN}/${l}/" />`);
  lines.push(`${indent}<link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`);
  return lines.join('\n');
}

// Crawlable, localised copy for the visually-hidden #seo-content block. Built
// statically per page so search engines index real keyword-rich text in each
// language without executing JS. Bounded by the <!--SEO:START/END--> markers.
function seoBlock(lang) {
  const S = SEO[lang];
  return [
    `<h1>${esc(S.h1)}</h1>`,
    `<p>${esc(S.p1)}</p>`,
    `<h2>${esc(S.h2a)}</h2>`,
    `<p>${esc(S.p2)}</p>`,
    `<h2>${esc(S.h2b)}</h2>`,
    `<p>${esc(S.p3)}</p>`,
  ].map((l) => `    ${l}`).join('\n');
}

function buildPage(tpl, lang) {
  const L = L10N[lang];
  const S = SEO[lang];
  const tag = tagOf(lang);
  const title = esc(S?.title || `${L.docTitle} — ${stripEnd(tag)}`); // keyword-rich SEO <title>
  const ogTitle = esc(`${L.docTitle} — ${GAME[lang]}`);   // e.g. "Симулятор віндсерфінгу — 3D-гра"
  const desc = esc(DESC[lang]);                           // keyword-rich meta description
  const url = `${ORIGIN}/${lang}/`;
  const img = `${ORIGIN}/og/og-cover-${lang}.png?v=3`;
  let h = tpl;

  h = h.replace('<html lang="en" translate="no">', `<html lang="${lang}" translate="no">`);
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  h = h.replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`);
  h = h.replace(/(<meta name="keywords" content=")[^"]*(")/, `$1${esc(S.keywords)}$2`);
  // Strip the template's own hreflang alternates before re-injecting a fresh set,
  // so localized pages don't inherit a duplicate block (the root already carries one).
  h = h.replace(/^\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>\n/gm, '');
  h = h.replace('<link rel="canonical" href="https://windsurfsimulator.com/" />',
    `<link rel="canonical" href="${url}" />\n${hreflangBlock()}`);
  h = h.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${ogTitle}$2`);
  h = h.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`);
  h = h.replace('<meta property="og:url" content="https://windsurfsimulator.com/" />',
    `<meta property="og:url" content="${url}" />`);
  h = h.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`);
  h = h.replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${desc}$2`);
  h = h.replace('<meta property="og:locale" content="en_US" />',
    `<meta property="og:locale" content="${L.ogLocale}" />`);
  h = h.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${ogTitle}$2`);
  h = h.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);
  h = h.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`);
  h = h.replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/, `$1${desc}$2`);

  h = h.replace('"url": "https://windsurfsimulator.com/",', `"url": "${url}",`);
  h = h.replace('"name": "Windsurf Simulator",', `"name": ${JSON.stringify(L.docTitle)},`);
  // JSON-LD strings use the "key": "value" form; meta tags use content="…", so
  // these anchored replaces only ever hit the structured-data block.
  h = h.replace(/"description": "[^"]*",/, `"description": ${JSON.stringify(DESC[lang])},`);
  h = h.replace(/"keywords": "[^"]*",/, `"keywords": ${JSON.stringify(S.keywords)},`);
  h = h.replace(/"image": "https:\/\/windsurfsimulator\.com\/og\/og-cover[^"]*",/, `"image": "${img}",`);
  h = h.replace(/"screenshot": "https:\/\/windsurfsimulator\.com\/og\/og-cover[^"]*",/, `"screenshot": "${img}",`);

  // Swap the English SEO copy for this language's (between the markers).
  h = h.replace(/<!--SEO:START-->[\s\S]*?<!--SEO:END-->/,
    `<!--SEO:START-->\n${seoBlock(lang)}\n    <!--SEO:END-->`);

  h = h.replace('href="apple-touch-icon.png', 'href="/apple-touch-icon.png');
  h = h.replace('href="icon-192.png', 'href="/icon-192.png');
  h = h.replace('href="icon-512.png', 'href="/icon-512.png');
  h = h.replace('href="site.webmanifest', 'href="/site.webmanifest');
  h = h.replace('href="style.css', 'href="/style.css');
  h = h.replace('src="docs/app-icon.png', 'src="/docs/app-icon.png');
  h = h.replace("from './src/i18n.js", "from '/src/i18n.js");
  h = h.replace('src="src/main.js', 'src="/src/main.js');

  h = h.replace('  <script type="module">\n    import { applyStatic }',
    `  <script>try{localStorage.setItem('ws_lang','${lang}')}catch(e){}</script>\n  <script type="module">\n    import { applyStatic }`);
  return h;
}

const tpl = readFileSync(`${REPO}/site/index.html`, 'utf8');
for (const lang of NONEN) {
  mkdirSync(`${REPO}/site/${lang}`, { recursive: true });
  writeFileSync(`${REPO}/site/${lang}/index.html`, buildPage(tpl, lang));
  console.log('page', `/${lang}/`);
}

let root = readFileSync(`${REPO}/site/index.html`, 'utf8');
if (!root.includes('hreflang="x-default"')) {
  root = root.replace('<link rel="canonical" href="https://windsurfsimulator.com/" />',
    `<link rel="canonical" href="${ORIGIN}/" />\n${hreflangBlock()}`);
  writeFileSync(`${REPO}/site/index.html`, root);
  console.log('root hreflang injected');
} else console.log('root hreflang already present');

const altLines = (loc) => ['en" href="' + ORIGIN + '/', ...NONEN.map((l) => `${l}" href="${ORIGIN}/${l}/`)]
  .map((a) => `      <xhtml:link rel="alternate" hreflang="${a}" />`).join('\n')
  + `\n      <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`;
const urlEntry = (loc, pr) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${LASTMOD}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${pr}</priority>\n${altLines(loc)}\n  </url>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[urlEntry(`${ORIGIN}/`, '1.0'), ...NONEN.map((l) => urlEntry(`${ORIGIN}/${l}/`, '0.8'))].join('\n')}\n</urlset>\n`;
writeFileSync(`${REPO}/site/sitemap.xml`, sitemap);
console.log('sitemap rebuilt with', NONEN.length + 1, 'urls');
