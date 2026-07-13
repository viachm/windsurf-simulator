import { WindsurfSim } from './sim.js?b=107';
import { World } from './world.js?b=107';
import { UI } from './ui.js?b=107';
import { t, applyStatic } from './i18n.js?b=107';
import { initAnalytics, tickPlayTime, track, trackOnce } from './analytics.js?b=107';

applyStatic(); // localise the static markup for the saved/default language

const sim = new WindsurfSim();
const world = new World(document.getElementById('scene'));
const ui = new UI(sim, world);

let last = performance.now();
let wasCrashed = false;
let wasPlaning = false;
let wasFoiling = false;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // Pause button: freeze the SIM, but keep the camera, OrbitControls (which has
  // damping — it needs controls.update() every frame) and the renderer live.
  // Re-render the last frozen state with dt=0 so nothing moves, yet the player
  // can still orbit/zoom while paused and resuming doesn't jump the camera.
  // Keep the render loop alive no matter what — a per-frame exception (e.g. a
  // missing HUD element from a bad locale) must never stop scheduling frames,
  // or the whole app appears to "freeze".
  try {
    if (ui.paused) {
      if (sim.lastState) world.update(sim.lastState, 0);
    } else {
      const inputs = ui.tickInputs(dt, sim.lastState);
      const state = sim.update(dt, inputs);

      // crash just happened -> splash + drop the rig-dependent inputs
      if (state.crashed && !wasCrashed) {
        world.triggerSplash(state.pos.x, 0.3, state.pos.z);
        if (inputs.harness) ui.setHarness(false);
        ui.setRake(0);
        // reason keys look like 'crash.catapult.reason' -> report just 'catapult'
        track('crash', { reason: (state.crashReason || '').split('.')[1] || 'unknown' });
      }
      // recovered -> sensible restart posture
      if (!state.crashed && wasCrashed) {
        ui.resetInputs();
        ui.inputs.sheetDeg = 70;
        document.getElementById('sheet').value = 70;
        ui.flashMsg(t('main.recovered'));
        track('recover');
      }
      wasCrashed = state.crashed;

      // planing rising edge: count each time the rider gets up on the plane, and
      // flag the first plane of the session as an engagement milestone.
      if (state.planing && !wasPlaning) { track('plane'); trackOnce('first_plane'); }
      wasPlaning = state.planing;

      // foil takeoff milestone (mirrors planing) — count each flight, flag the first.
      if (state.foiling && !wasFoiling) { track('foil_up'); trackOnce('first_foil'); }
      wasFoiling = state.foiling;

      tickPlayTime(dt);   // session-depth milestones (how long people last)
      world.update(state, dt);
      ui.updateHUD(state);
    }
  } catch (e) {
    console.error('[windsurf-sim] frame error', e);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Scene + UI are built and localised — fade out the boot loader.
const bootLoader = document.getElementById('boot-loader');
if (bootLoader) {
  bootLoader.classList.add('off');
  setTimeout(() => bootLoader.remove(), 400);
}

console.log('[windsurf-sim] started');
initAnalytics();   // GA4 gameplay/settings events (best-effort; no-op if blocked)
// debug handles
window.__sim = sim; window.__world = world; window.__ui = ui;
