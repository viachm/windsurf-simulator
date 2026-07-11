# Windsurf Simulator — project rules

Static, no-build Three.js web app, live at `https://windsurfsimulator.com/`.
Repo: `viachm/windsurf-simulator`.

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
