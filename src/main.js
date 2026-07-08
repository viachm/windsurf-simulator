import { WindsurfSim } from './sim.js?v=__BUILD__';
import { World } from './world.js?v=__BUILD__';
import { UI } from './ui.js?v=__BUILD__';
import { t, applyStatic } from './i18n.js?v=__BUILD__';

applyStatic(); // localise the static markup for the saved/default language

const sim = new WindsurfSim();
const world = new World(document.getElementById('scene'));
const ui = new UI(sim, world);

let last = performance.now();
let wasCrashed = false;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const inputs = ui.tickInputs(dt, sim.lastState);
  const state = sim.update(dt, inputs);

  // crash just happened -> splash + drop the rig-dependent inputs
  if (state.crashed && !wasCrashed) {
    world.triggerSplash(state.pos.x, 0.3, state.pos.z);
    if (inputs.harness) ui.setHarness(false);
    ui.setRake(0);
  }
  // recovered -> sensible restart posture
  if (!state.crashed && wasCrashed) {
    ui.resetInputs();
    ui.inputs.sheetDeg = 70;
    document.getElementById('sheet').value = 70;
    ui.flashMsg(t('main.recovered'));
  }
  wasCrashed = state.crashed;

  world.update(state, dt);
  ui.updateHUD(state);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

console.log('[windsurf-sim] started');
// debug handles
window.__sim = sim; window.__world = world; window.__ui = ui;
