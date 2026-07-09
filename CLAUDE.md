# Windsurf Simulator — project rules

Static, no-build Three.js web app deployed on GitHub Pages
(`https://viachm.github.io/windsurf-simulator/`). Repo: `viachm/windsurf-simulator`.

## Ship every completed feature (commit → push → deploy)

When a feature or fix is **finished and verified**, deploy it automatically —
no need to ask first. "Verified" means: `node --check` passes on changed files,
and (for anything user-facing) it was exercised in the browser with **0 console
errors**. If verification fails, fix it before deploying; don't ship broken code.

The deploy flow, in order:

1. **Bump the cache-bust token** in sync across all module URLs (or browsers
   serve a stale/mixed JS graph — see below):
   `sed -i '' 's/?b=[0-9][0-9]*/?b=NEXT/g' index.html src/*.js`
2. **Commit** only the files this change touched. Do NOT bundle unrelated
   working-tree edits (the user often edits in parallel — check `git diff` first).
   End the message with the standard trailers:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: <session url>
   ```
3. **Push**: `git push origin main`
4. **Trigger the Pages rebuild** (legacy builder):
   `gh api -X POST repos/viachm/windsurf-simulator/pages/builds`
5. **Poll until built**:
   `gh api repos/viachm/windsurf-simulator/pages/builds/latest --jq '.status + " " + .commit'`
   until it reads `built <sha>`.
6. Report the built SHA and give a cache-bypass URL for iPhone/Safari:
   `https://viachm.github.io/windsurf-simulator/?fresh=<n>`.

## Cache-bust token (`?b=N`)

Every module import carries a shared `?b=N` build token (`index.html` script src
plus all `import` statements in `src/main.js`, `src/ui.js`, `src/demo.js`). It
MUST be identical everywhere — if it drifts, `i18n.js` loads as two instances
and language state splits. Always bump it with the single `sed` above so all
files stay in sync. This is what prevents the recurring "new HTML + stale JS"
breakage on GitHub Pages / Safari.

## Notes

- `node` in a non-interactive shell needs the absolute path:
  `/Users/viachm/.nvm/versions/node/v22.15.0/bin/node`.
- The app exposes `window.__sim`, `window.__ui`, `window.__world` for testing.
- Localise every user-facing string in both `en` and `uk` (`src/i18n.js`).
