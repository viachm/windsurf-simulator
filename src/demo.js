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
const DEG = Math.PI / 180;
const PREVIEW_PHASES = 4;   // how many upcoming steps the dashed route shows
const PREVIEW_LEG = 16;     // world-metres drawn per upcoming step

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
  // Segment durations are tuned so one full lap runs ~60s, then it repeats.
  beginner: {
    wind: 12,
    segments: [
      { cap: 'demo.b.beam',   beta: 95,  dur: 10 },
      { cap: 'demo.b.headup', beta: 60,  dur: 11 },
      { cap: 'demo.b.tack',   beta: 52,  dur: 9, turn: 'tack' },
      { cap: 'demo.b.bear',   beta: 120, dur: 11 },
      { cap: 'demo.b.broad',  beta: 135, dur: 10 },
      { cap: 'demo.b.gybe',   beta: 140, dur: 9, turn: 'gybe' },
      { cap: 'demo.b.settle', beta: 95,  dur: 10 },
    ],
  },
  // Strong wind, planing, footstraps, fast transitions: blast, turn, blast.
  freeride: {
    wind: 24,
    segments: [
      { cap: 'demo.f.power',  beta: 115, dur: 9 },
      { cap: 'demo.f.plane',  beta: 105, dur: 11 },
      { cap: 'demo.f.gybe',   beta: 138, dur: 9, turn: 'gybe' },
      { cap: 'demo.f.blast',  beta: 125, dur: 10 },
      { cap: 'demo.f.upwind', beta: 62,  dur: 10 },
      { cap: 'demo.f.tack',   beta: 52,  dur: 9, turn: 'tack' },
      { cap: 'demo.f.back',   beta: 115, dur: 9 },
    ],
  },
  // Calm, endless cruise — a screensaver. No maneuvers.
  chill: {
    wind: 11,
    segments: [
      { cap: 'demo.c.cruise', beta: 95,  dur: 20 },
      { cap: 'demo.c.up',     beta: 72,  dur: 18 },
      { cap: 'demo.c.down',   beta: 118, dur: 18 },
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
    this.ui.showRoutePreview(null);
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
    if (st.crashed) { this.ui.showRoutePreview(null); return; } // resume after recovery
    const seg = this.script[this.i];
    this.segT += dt;

    // dashed preview of the route ahead (current + next few steps)
    this.ui.showRoutePreview(this.#buildPreview(st));

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

  // Project the planned route a few steps ahead as world-space nodes, starting at
  // the board. The board heading that yields a given |beta| B on tack sign s is
  // h = windFromAngle - s*B (since beta = windFromAngle - heading). Each upcoming
  // segment becomes a straight leg at its target course; a tack/gybe flips the
  // tack, so the path kinks into a V through the wind — exactly what's coming.
  #buildPreview(st) {
    const wa = st.windFromAngle;
    let s = st.beta >= 0 ? 1 : -1;                 // current tack sign
    const nodes = [{ x: st.pos.x, z: st.pos.z }];
    const run = (h, len) => {
      const p = nodes[nodes.length - 1];
      nodes.push({ x: p.x + Math.sin(h) * len, z: p.z + Math.cos(h) * len });
    };
    let idx = this.i;
    for (let k = 0; k < PREVIEW_PHASES; k++) {
      const seg = this.script[idx % this.script.length];
      // remaining length shrinks as we progress through the current leg
      const rem = k === 0 ? Math.max(4, PREVIEW_LEG * (1 - this.segT / seg.dur)) : PREVIEW_LEG;
      const isTurn = seg.turn && !(k === 0 && this.turned);
      if (isTurn) {
        run(wa - s * seg.beta * DEG, rem * 0.5); // approach on the current tack
        s = -s;                                  // turn crosses the wind
        run(wa - s * seg.beta * DEG, PREVIEW_LEG); // exit on the new tack
      } else {
        run(wa - s * seg.beta * DEG, rem);
      }
      idx++;
    }
    return nodes;
  }
}
