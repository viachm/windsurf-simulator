# Windsurf Simulator — project rules

Static, no-build Three.js web app, live at `https://windsurfsimulator.com/`.
Repo: `viachm/windsurf-simulator`.

## 🥇 GOLDEN RULE — every new feature goes on the `develop` branch

Do ALL new feature/fix work on the **`develop`** branch, never directly on `main`.
Pushing to `develop` auto-deploys to the staging site
**https://dev.windsurfsimulator.com** (Cloudflare Pages) for review. Only once it's
verified there do you merge **`develop` → `main`**, which ships to production
(`windsurfsimulator.com` via GitHub Pages). `main` stays deploy-ready at all times.
Details in "Dev / staging environment" below.

## Project layout — the served site lives in `site/`

Everything that ships to the web is under **`site/`** (that folder is the deploy
root, so `site/index.html` → `/`, `site/uk/index.html` → `/uk/`, `site/src/…`,
`site/og/…`, `site/style.css`, `CNAME`, `.nojekyll`, etc.). GitHub Pages deploys
`site/` via the **GitHub Actions** workflow `.github/workflows/deploy.yml` (NOT
the legacy branch builder). The repo root holds only tooling/dev files —
`tools/` (og-card generator), `test/`, `serve.py`, `docs/` (README assets),
`README.md`, `CLAUDE.md`. The 19 `site/<lang>/index.html` landing pages and
`site/og/*.png` are **generated** by `tools/og-card/` (see its README) — edit the
English template / `l10n-v.mjs` and regenerate, don't hand-edit each locale.

## Ship every completed feature (commit → push → deploy)

When a feature or fix is **finished and verified**, deploy it automatically —
no need to ask first. "Verified" means: `node --check` passes on changed files,
and (for anything user-facing) it was exercised in the browser with **0 console
errors**. If verification fails, fix it before deploying; don't ship broken code.

The deploy flow, in order:

1. **Bump the cache-bust token** in sync across all served files (or browsers
   serve a stale/mixed JS graph — see below). The token now lives under `site/`,
   including the 19 generated localized pages:
   `sed -i '' 's/?b=[0-9][0-9]*/?b=NEXT/g' site/index.html site/src/*.js site/*/index.html`
2. **Commit** only the files this change touched. Do NOT bundle unrelated
   working-tree edits (the user often edits in parallel — check `git diff` first).
   End the message with the standard trailers:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: <session url>
   ```
3. **Push**: `git push origin main` — this **auto-triggers** the GitHub Actions
   deploy (`.github/workflows/deploy.yml`). No manual `pages/builds` POST anymore.
4. **Poll until deployed** (the Actions run publishes `site/`):
   `gh api repos/viachm/windsurf-simulator/pages/builds/latest --jq '.status + " " + .commit'`
   until it reads `built <sha>` (or watch the run: `gh run watch <id>`).
5. Report the built SHA and give a cache-bypass URL for iPhone/Safari:
   `https://windsurfsimulator.com/?fresh=<n>`.

## Dev / staging environment — `dev.windsurfsimulator.com`

A separate staging site mirrors prod but is fed by the **`develop`** branch and
hosted on **Cloudflare Pages** (project `windsurf-simulator-dev`), NOT GitHub Pages —
GitHub Pages allows only one custom domain per repo, which prod already owns.

- **Branch → URL:** push to `develop` → auto-deploys `site/` to
  `https://dev.windsurfsimulator.com`. Push to `main` → prod (unchanged).
  Normal flow: land changes on `develop`, verify on the dev domain, then merge
  `develop` → `main` to ship to prod.
- **Auto-deploy:** `.github/workflows/deploy-dev.yml` runs `wrangler pages deploy site`
  on every push to `develop`. It lives **only on the `develop` branch** and triggers
  only for `develop`, so it never fires on `main`. Needs repo secrets
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (already set).
- **noindex:** `develop` carries `site/_headers` (`X-Robots-Tag: noindex, nofollow`)
  so staging (and `*.pages.dev`) never gets indexed — keep it on `develop`, and do
  NOT let it merge into `main` (prod must stay indexable).
- **Cloudflare:** account `27a760b02276afc8a6fc2d5a21a300c9`; Pages project
  production branch is `develop`; the `dev` DNS record is a **proxied** CNAME →
  `windsurf-simulator-dev.pages.dev` (opposite of the apex GitHub Pages records,
  which must be DNS-only). A Pages-scoped API token is in Keychain:
  `security find-generic-password -a "$USER" -s cloudflare-pages-token -w`.
- **Manual deploy** (bypasses the Action, e.g. to ship develop content directly):
  `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=27a760b02276afc8a6fc2d5a21a300c9 \
   node <npx-cli.js> wrangler pages deploy site --project-name=windsurf-simulator-dev --branch=develop`
  (nvm shims break `npx` in non-interactive shells — call `npx-cli.js` via the
  absolute `node` binary; see Notes).

## Cache-bust token (`?b=N`)

Every module import carries a shared `?b=N` build token (`site/index.html` script
src **and the `style.css` link**, all `import` statements in `site/src/*.js`, AND
the asset refs in every `site/<lang>/index.html`). It MUST be identical
everywhere — if it drifts, `i18n.js` loads as two instances and language state
splits. Always bump it with the single `sed` above so all files stay in sync.
This is what prevents the recurring "new HTML + stale JS/CSS" breakage on Safari.

NB: `site/style.css` has no token of its own inside the file — its cache-bust
lives in the `<link rel="stylesheet" href="style.css?b=N">` in `site/index.html`,
which the `sed` updates. Without it, iOS Safari serves the **old cached CSS** even after a
deploy, so CSS-only fixes silently don't take (this bit us: a fixed layout
looked unchanged on the phone). Keep the token on the stylesheet link.

## Notes

- `node` in a non-interactive shell needs the absolute path:
  `/Users/viachm/.nvm/versions/node/v22.15.0/bin/node`.
- The app exposes `window.__sim`, `window.__ui`, `window.__world` for testing.
- Localise every user-facing string in both `en` and `uk` (`src/i18n.js`).
