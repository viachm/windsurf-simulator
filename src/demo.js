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

// ---- route preview (world-anchored chevrons the board sails through) ----
// Each frame we predict the route forward in TIME from the board's real state
// (so the board is always on it), then drop chevrons at fixed WORLD-distance
// positions so they sit still and vanish as the board passes — rather than
// sliding along with it.
const PDT = 0.2;            // prediction timestep, seconds
const HORIZON = 8;          // seconds of route to predict ahead
const STEER_RATE = 0.7;     // rad/s — how fast the pen swings onto a new course
const ARC_RATE = 1.0;       // rad/s — sweep rate through a tack/gybe
const MARKER_SP = 3;        // metres between chevrons
const MAX_MARKERS = 22;     // chevrons shown at once
const OVERRIDE_SEC = 3;     // seconds the user's manual input holds before the tour re-corrects

function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

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
    sail: 6.5,          // universal all-round — gentle, docile for learning
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
    sail: 5.0,          // small strong-wind sail — planes hard yet stays controllable
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
    sail: 8.0,          // big light-wind sail — easy, relaxed cruising power
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
    this.dist = 0;         // cumulative board distance — anchors chevrons in world
    this.overrideT = 0;    // >0 while the user's manual input temporarily holds
    this.onCaption = null; // (text|null) => void
    this.onState = null;   // (mode|null) => void
  }

  get running() { return this.active; }
  // While overriding, the tour yields the helm: the director stops steering and
  // the autopilot stands down, so the user's manual inputs carry the board off
  // course. It re-corrects once the window lapses.
  get overriding() { return this.active && this.overrideT > 0; }

  // A manual touch of any control (except the wind) opens/refreshes the window.
  nudge() { if (this.active) this.overrideT = OVERRIDE_SEC; }

  start(mode) {
    if (!SCRIPTS[mode]) return;
    this.mode = mode;
    this.script = SCRIPTS[mode].segments;
    this.i = 0; this.segT = 0; this.turned = false; this.settleT = 0;
    this.dist = 0;                          // reset the chevron world-anchor
    this.overrideT = 0;
    this.active = true;
    // set a sensible wind AND sail for the tour ONCE, then leave them stable (the
    // user can still adjust both mid-demo). Small sail for the windy freeride,
    // big sail for the light-wind chill — each shown selected in settings.
    this.sim.baseWind = SCRIPTS[mode].wind / KN;
    this.ui.syncWindControl();
    if (SCRIPTS[mode].sail) this.ui.setSailArea(SCRIPTS[mode].sail);
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
    if (this.overrideT > 0) this.overrideT = Math.max(0, this.overrideT - dt);
    if (st.crashed) { this.ui.showRoutePreview(null); return; } // resume after recovery
    const seg = this.script[this.i];
    this.segT += dt;

    // route preview: chevrons pinned to world positions the board sails through.
    // The timeline keeps advancing during an override so we rejoin the CURRENT
    // target course, not a stale one, once the user lets go.
    this.dist += Math.abs(st.v) * dt;
    this.ui.showRoutePreview(this.#buildMarkers(st));

    const held = this.overriding;   // user has the helm for a moment

    // steering + turns (wind is left stable — set once at start)
    if (st.maneuver) {
      // a tack/gybe is auto-steering — don't fight the rake
    } else if (seg.turn && !this.turned) {
      if (!held) {
        // hold the entry angle, then fire the turn as soon as the sim allows it
        this.#steer(seg.beta, st);
        const res = seg.turn === 'tack' ? this.sim.startTack() : this.sim.startGybe();
        if (res.ok) this.turned = true;
        else if (this.segT > seg.dur) this.#advance();   // give up, move on
      }
      return;
    } else if (!held) {
      this.#steer(seg.beta, st);
    }

    // advance to the next segment (keeps ticking even during an override)
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

  // Predict the route forward from the board's ACTUAL state (so the board is
  // always on it), then place chevrons at fixed world-distance positions. The
  // marker phase is tied to the board's cumulative distance, so as the board
  // advances each chevron holds its world spot and is consumed at the near end.
  #buildMarkers(st) {
    // 1) forward prediction in time, mirroring the director's own logic
    const wa = st.windFromAngle;
    const pts = [{ x: st.pos.x, z: st.pos.z, along: 0, h: st.heading }];
    let x = st.pos.x, z = st.pos.z, h = st.heading, along = 0;
    let s = st.beta >= 0 ? 1 : -1, i = this.i, segT = this.segT, turned = this.turned, arc = 0;
    const v = Math.min(12, Math.max(2.2, Math.abs(st.v)));
    for (let t = 0; t < HORIZON; t += PDT) {
      const seg = this.script[i % this.script.length];
      if (arc) {
        // sweeping through a tack/gybe
        const dh = Math.sign(arc) * Math.min(Math.abs(arc), ARC_RATE * PDT);
        h += dh; arc -= dh;
        if (Math.abs(arc) < 1e-3) { arc = 0; i++; segT = 0; turned = false; }
      } else {
        segT += PDT;
        if (seg.turn && !turned && segT > 0.3) {
          // begin the turn: signed sweep through the wind (tack) or downwind (gybe)
          const B = seg.beta * DEG;
          arc = seg.turn === 'tack' ? s * 2 * B : -s * (2 * Math.PI - 2 * B);
          s = -s; turned = true;
        } else {
          // steer toward the target course for this point of sail
          const th = wa - s * seg.beta * DEG;
          let dh = wrapAngle(th - h);
          const mx = STEER_RATE * PDT;
          if (dh > mx) dh = mx; else if (dh < -mx) dh = -mx;
          h += dh;
          if (!seg.turn && segT >= seg.dur) { i++; segT = 0; turned = false; }
        }
      }
      const vv = arc ? v * 0.7 : v;          // ease off through the turns
      x += Math.sin(h) * vv * PDT; z += Math.cos(h) * vv * PDT; along += vv * PDT;
      pts.push({ x, z, along, h });
    }

    // 2) drop chevrons at world-anchored arc-length positions
    const total = along;
    const phase = MARKER_SP - (this.dist % MARKER_SP);   // shifts with the board
    const out = [];
    let j = 0;
    for (let A = phase; A < total - 0.5 && out.length < MAX_MARKERS; A += MARKER_SP) {
      while (j < pts.length - 1 && pts[j + 1].along < A) j++;
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      const f = (A - a.along) / ((b.along - a.along) || 1);
      out.push({
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        angle: a.h,
        scale: Math.max(0.6, 1 - out.length * 0.03),
      });
    }
    return out;
  }
}
