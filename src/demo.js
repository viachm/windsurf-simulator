// Guided demo / auto-tour: an on-rails "director" that sails the board through a
// teaching route while the beginner autopilot (autotrim) handles the rig and
// body, so every control animates on its own. The director only STEERS (mast
// rake toward a target point of sail), triggers tacks/gybes and ramps the true
// wind — the board's tail-trail draws the route as it goes.
//
// It deliberately reuses the existing systems instead of driving the physics
// directly: autotrim = full autopilot (never crashes), sim.startTack/startGybe
// carry the turns, and the rake steering is quantised to the five on-screen
// buttons so the controls visibly "press" while it sails.

import { t } from './i18n.js';

const KN = 1.94384; // m/s -> knots

// Each mode sets its wind ONCE at start (a sensible speed for the tour) and then
// leaves it stable — the user can still drag the wind slider mid-demo without
// ending it. The wind never varies on its own.
//
// A route is a list of segments, each holding the board on a target point of
// sail (|beta| in degrees: 45 close-hauled, 62 close reach, 95 beam, 120 broad,
// 150 run) long enough to accelerate to that course's top speed, then optionally
// turning through the wind (which scrubs speed — the board rebuilds it after).
//   segment: { cap, beta, dur(s), turn?: 'tack'|'gybe' }
export const DEMO_MODES = ['beginner', 'freeride', 'chill'];

const SCRIPTS = {
  // Every point of sail, one tack, one gybe — slow and narrated, gentle wind.
  beginner: {
    wind: 12,
    segments: [
      { cap: 'demo.b.beam',   beta: 95,  dur: 8 },
      { cap: 'demo.b.headup', beta: 60,  dur: 9 },
      { cap: 'demo.b.tack',   beta: 52,  dur: 9, turn: 'tack' },
      { cap: 'demo.b.bear',   beta: 120, dur: 9 },
      { cap: 'demo.b.broad',  beta: 135, dur: 8 },
      { cap: 'demo.b.gybe',   beta: 140, dur: 9, turn: 'gybe' },
      { cap: 'demo.b.settle', beta: 95,  dur: 8 },
    ],
  },
  // Strong wind, planing, footstraps, fast transitions: blast, turn, blast.
  freeride: {
    wind: 24,
    segments: [
      { cap: 'demo.f.power',  beta: 115, dur: 7 },
      { cap: 'demo.f.plane',  beta: 105, dur: 8 },
      { cap: 'demo.f.gybe',   beta: 138, dur: 9, turn: 'gybe' },
      { cap: 'demo.f.blast',  beta: 125, dur: 7 },
      { cap: 'demo.f.upwind', beta: 62,  dur: 8 },
      { cap: 'demo.f.tack',   beta: 52,  dur: 9, turn: 'tack' },
      { cap: 'demo.f.back',   beta: 115, dur: 6 },
    ],
  },
  // Calm, endless cruise — a screensaver. No maneuvers.
  chill: {
    wind: 11,
    segments: [
      { cap: 'demo.c.cruise', beta: 95,  dur: 14 },
      { cap: 'demo.c.up',     beta: 72,  dur: 12 },
      { cap: 'demo.c.down',   beta: 118, dur: 12 },
    ],
  },
};

export class DemoDirector {
  constructor(sim, ui) {
    this.sim = sim;
    this.ui = ui;
    this.active = false;
    this.mode = null;
    this.script = null;
    this.i = 0;
    this.segT = 0;
    this.turned = false;
    this.settleT = 0;
    this.onCaption = null; // (text|null) => void
    this.onState = null;   // (mode|null) => void
  }

  get running() { return this.active; }

  start(mode) {
    if (!SCRIPTS[mode]) return;
    this.mode = mode;
    this.script = SCRIPTS[mode].segments;
    this.i = 0; this.segT = 0; this.turned = false; this.settleT = 0;
    this.active = true;
    // set a sensible wind for the tour ONCE, then leave it stable (the user can
    // still adjust it with the slider mid-demo)
    this.sim.baseWind = SCRIPTS[mode].wind / KN;
    this.ui.syncWindControl();
    // full autopilot so the rig/body trim themselves and never crash
    this.ui.setAutotrim(true);
    this.#caption();
    if (this.onState) this.onState(mode);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.mode = null;
    this.script = null;
    this.ui.setRake(0);
    if (this.onCaption) this.onCaption(null);
    if (this.onState) this.onState(null);
  }

  #caption() {
    if (this.onCaption) this.onCaption(t(this.script[this.i].cap));
  }

  // Re-render the current caption (e.g. after a language switch).
  refresh() { if (this.active) this.#caption(); }

  #advance() {
    this.i = (this.i + 1) % this.script.length;
    this.segT = 0; this.turned = false; this.settleT = 0;
    this.#caption();
  }

  // Called once per frame BEFORE sim.update, with the previous frame's state.
  tick(dt, st) {
    if (!this.active || !st) return;
    if (st.crashed) return;                 // let recovery run; resume after
    const seg = this.script[this.i];
    this.segT += dt;

    // steering + turns (wind is left stable — set once at start)
    if (st.maneuver) {
      // a tack/gybe is auto-steering — don't fight the rake
    } else if (seg.turn && !this.turned) {
      // hold the entry angle, then fire the turn as soon as the sim allows it
      this.#steer(seg.beta, st);
      const res = seg.turn === 'tack' ? this.sim.startTack() : this.sim.startGybe();
      if (res.ok) this.turned = true;
      else if (this.segT > seg.dur) this.#advance();   // give up, move on
      return;
    } else {
      this.#steer(seg.beta, st);
    }

    // advance to the next segment
    if (seg.turn) {
      if (this.turned && !st.maneuver) {
        this.settleT += dt;
        if (this.settleT > 1.4) this.#advance();
      }
    } else if (this.segT >= seg.dur) {
      this.#advance();
    }
  }

  // Proportional steering: rake toward the target |beta|, quantised to the five
  // rake buttons so the on-screen control visibly presses as it steers. (rake<0
  // heads up / reduces |beta|; rake>0 bears away / increases it.)
  #steer(targetBeta, st) {
    const err = targetBeta - st.absBetaDeg;   // +ve -> need to bear away
    let rake = 0;
    if (Math.abs(err) > 3) rake = Math.max(-1, Math.min(1, err / 22));
    rake = Math.round(rake * 2) / 2;          // -> {-1,-0.5,0,0.5,1}
    this.ui.setRake(rake);
  }
}
