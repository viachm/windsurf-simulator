// Safe, minimal GA4 (gtag) event layer.
//
// The base gtag.js snippet in index.html already sends page_view + the native
// engagement-time metric. This module adds the GAMEPLAY + SETTINGS events GA
// needs to answer the questions the raw pageview can't: how long people actually
// last, which settings they pick (sail, wind, camera, units, language), which
// features they use (demo, autotrim, harness, tacks/gybes) and why they crash.
//
// Every call is guarded: a blocked or absent gtag (ad-blocker, consent tool,
// offline, or a locale that failed to load the snippet) can NEVER throw into the
// sim. Analytics is strictly best-effort — the game runs identically without it.

const gtagFn = () => (typeof window !== 'undefined' ? window.gtag : undefined);

/** Send one GA4 event. No-ops (never throws) when gtag is unavailable. */
export function track(name, params) {
  const fn = gtagFn();
  if (typeof fn !== 'function') return;
  try { fn('event', name, params || {}); } catch { /* never break the game for analytics */ }
}

const _seen = new Set();
/** Fire an event at most once per page load (first-plane, session milestones…). */
export function trackOnce(name, params) {
  if (_seen.has(name)) return;
  _seen.add(name);
  track(name, params);
}

const _timers = new Map();
/**
 * Coalesce a rapidly-changing control into a single event once it settles, so a
 * dragged slider (wind) sends ONE event with its final value, not one per tick.
 */
export function trackDebounced(name, params, delay = 800) {
  const h = _timers.get(name);
  if (h) clearTimeout(h);
  _timers.set(name, setTimeout(() => { _timers.delete(name); track(name, params); }, delay));
}

// ---- play-time milestones ------------------------------------------------
// Emit a `play_time` event as the live (un-paused) session crosses each mark, so
// GA can chart session DEPTH — what share of visitors reach 1 min, 5 min, 10 min
// — as a retention funnel, without leaning only on the native engagement metric.
const MILESTONES = [15, 30, 60, 180, 300, 600, 1200];
let _played = 0;
let _mi = 0;

/** Call every frame from the main loop with the frame dt while the sim is live. */
export function tickPlayTime(dt) {
  if (!(dt > 0)) return;
  _played += dt;
  while (_mi < MILESTONES.length && _played >= MILESTONES[_mi]) {
    track('play_time', { seconds: MILESTONES[_mi] });
    _mi++;
  }
}

// ---- first interaction + device tag --------------------------------------
let _interacted = false;
/** One-shot: the first real control gesture, tagged by input kind. */
function markInteraction(kind) {
  if (_interacted) return;
  _interacted = true;
  track('first_interaction', { input: kind });
}

/**
 * Tag the session with the device kind and wire the first-interaction detector.
 * `first_interaction` separates real players from instant bounces and shows the
 * keyboard/touch/mouse split. Call once at startup.
 */
export function initAnalytics() {
  const isTouch = matchMedia('(max-width: 768px)').matches || ('ontouchstart' in window);
  track('app_ready', { device: isTouch ? 'mobile' : 'desktop' });
  addEventListener('keydown', () => markInteraction('keyboard'), { once: true });
  addEventListener('pointerdown',
    (e) => markInteraction(e.pointerType === 'touch' ? 'touch' : 'mouse'), { once: true });
}
