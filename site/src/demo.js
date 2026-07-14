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

import { t } from './i18n.js?b=119';

const KN = 1.94384; // m/s -> knots
const DEG = Math.PI / 180;

// ---- route preview (world-anchored chevrons the board sails through) ----
// Each frame we predict the route forward in TIME from the board's real state
// (so the board always rides it) and re-fit chevrons to fixed world-distance
// slots. The prediction is ONE continuous line that curves through any upcoming
// OR in-progress tack/gybe (a shortest-arc sweep onto the new tack's settle
// course), so the route is drawn all the way through a turn and never blinks out.
// To stop the chevrons JUMPING as the course bends, a slot's stored position
// EASES toward its fresh target instead of snapping — so on a straight it sits
// dead still, and through a turn it glides. Each chevron is consumed at the near
// end as the board passes it.
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
    this.routeMarks = [];  // FROZEN world chevrons {k,x,z,angle}; placed once, never moved
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
    this.routeMarks = [];                   // drop any frozen chevrons from a prior run
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
    this.routeMarks = [];
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
    if (st.crashed) { this.routeMarks = []; this.ui.showRoutePreview(null); return; } // resume after recovery
    const seg = this.script[this.i];
    this.segT += dt;

    // route preview: chevrons pinned to world positions the board sails through.
    // The timeline keeps advancing during an override so we rejoin the CURRENT
    // target course, not a stale one, once the user lets go. #buildMarkers draws
    // ONE continuous line through any upcoming or in-progress turn, so the route
    // never blinks out and doesn't jump as a tack/gybe starts or ends.
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
      // Maneuver finished -> advance straight onto the next leg. Don't dwell on
      // the turn seg's entry beta: a gybe's entry is deeper than its exit, so
      // steering to it bears the boat away and then heads it back up — which
      // reads as the route arrows swinging out and back right after the gybe.
      if (this.turned && !st.maneuver) this.#advance();
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
  // always on it), then re-fit chevrons to world-distance slots each frame and
  // EASE each slot toward its target. The slots are tied to the board's
  // cumulative distance, so on a straight they're rock-steady and consumed at
  // the near end; through course changes the easing glides them instead of
  // letting the predicted tail snap frame-to-frame.
  #buildMarkers(st) {
    return this.#fitMarks(this.#predictRoute(st));
  }

  // ONE continuous forward prediction that curves smoothly through any upcoming
  // OR in-progress tack/gybe — no cap, no hide, no separate maneuver path. Both
  // an approaching turn and a live one are drawn with the same shortest-arc sweep
  // onto the new tack's settle course, so the line never blinks out at the turn
  // and doesn't jump as the real turn starts or ends (the geometry is identical
  // before, during, and after). The board still rides it because the prediction
  // starts from the board's true state and the near slots track it closely.
  #predictRoute(st) {
    const wa = st.windFromAngle;
    const EXIT = { tack: 52, gybe: 130 };   // deg — new-tack settle angle, mirrors sim
    const pts = [{ x: st.pos.x, z: st.pos.z, along: 0, h: st.heading }];
    let x = st.pos.x, z = st.pos.z, h = st.heading, along = 0;
    let v = Math.min(12, Math.max(1.4, Math.abs(st.v)));
    const vCruise = Math.min(12, Math.max(3, Math.abs(st.v)));
    let i = this.i, segT = this.segT, turned = this.turned;
    let s = st.beta >= 0 ? 1 : -1;

    // A turn whose maneuver has already completed: the boat is settling onto the
    // NEW tack. Predict from the SETTLE leg, not the just-finished turn seg — its
    // beta is the deep ENTRY/setup angle (for a gybe, deeper than the exit), so
    // aiming the route at it bulges the chevrons out and then swings them back
    // once the director advances a beat later. That swing-out-then-back right
    // after a gybe is exactly the arrow flicker we must avoid.
    if (turned && !st.maneuver && this.script[i % this.script.length].turn) {
      i = (i + 1) % this.script.length; segT = 0; turned = false;
    }

    // if a tack/gybe is already sweeping, seed the arc straight away — steering the
    // live heading onto the NEW tack's settle course (m.s is the entry tack sign).
    // turnDir LOCKS the sweep direction for the whole turn. A tack carries the
    // bow UP through the eye (heading rotates by +s), a gybe carries the stern
    // DOWN through the run (rotates by -s) — matching sim's turnDH sign. We must
    // NOT re-pick the direction each frame via a shortest-arc test: through a
    // ~180° turn the remaining angle sits near ±π, and the tiny wind-angle wobble
    // flips Math.sign() frame-to-frame, so the chevrons swing one way then the
    // other then back. Locking the direction once kills that flicker.
    let inTurn = false, turnTargetH = 0, turnSign = s, turnDir = s;
    if (st.maneuver) {
      const m = st.maneuver;
      turnSign = -m.s;
      turnTargetH = wa - turnSign * EXIT[m.type] * DEG;
      turnDir = Math.sign(m.turnDH) || (m.type === 'tack' ? m.s : -m.s);
      inTurn = true;
    }

    for (let t = 0; t < HORIZON; t += PDT) {
      const seg = this.script[i % this.script.length];
      // begin an upcoming turn the moment the prediction reaches its segment
      if (!inTurn && seg.turn && !turned) {
        turnSign = -s;
        turnTargetH = wa - turnSign * EXIT[seg.turn] * DEG;
        turnDir = seg.turn === 'tack' ? s : -s;   // tack up through the eye, gybe down through the run
        inTurn = true;
      }
      if (inTurn) {
        // sweep onto the new tack in the LOCKED direction. Measure the remaining
        // angle the intended way round: if the shortest arc points opposite to
        // turnDir, take the long way (subtract a full turn) so we never reverse.
        let rem = wrapAngle(turnTargetH - h);
        if (rem !== 0 && Math.sign(rem) !== turnDir) rem -= turnDir * 2 * Math.PI;
        h += turnDir * Math.min(Math.abs(rem), ARC_RATE * PDT);
        v *= Math.pow(0.72, PDT);              // scrub speed through the carve
        if (Math.abs(rem) < 0.04) {
          inTurn = false; s = turnSign;        // settled on the new tack
          i++; segT = 0; turned = false;       // move on to the next leg
        }
      } else {
        // steer toward the target course for this point of sail
        const th = wa - s * seg.beta * DEG;
        const dh = wrapAngle(th - h);
        h += Math.sign(dh) * Math.min(Math.abs(dh), STEER_RATE * PDT);
        v += (vCruise - v) * 0.1;              // rebuild speed on the straight
        segT += PDT;
        if (segT >= seg.dur) { i++; segT = 0; turned = false; }
      }
      const vv = Math.max(0.6, v);
      x += Math.sin(h) * vv * PDT; z += Math.cos(h) * vv * PDT; along += vv * PDT;
      pts.push({ x, z, along, h });
    }
    return pts;
  }

  // Re-fit chevrons to world-anchored slots each frame, but EASE each slot's
  // stored world position toward its fresh target instead of snapping. Each slot k
  // sits at absolute board-distance k*MARKER_SP, so on a straight its target is
  // rock-steady frame-to-frame and the chevron sits still. Through a tack/gybe the
  // predicted tail swings — easing turns that swing into a smooth glide instead of
  // the hard per-frame JUMP a snap-every-frame would produce. The board still
  // rides the line because the targets are the accurate re-fit and the near slots
  // track it closely.
  #fitMarks(pts) {
    const total = pts.length ? pts[pts.length - 1].along : 0;
    const SP = MARKER_SP;
    const EASE = 0.12;         // per-frame glide of a slot toward its fresh target
    const kMin = Math.floor(this.dist / SP) + 1;                 // nearest slot ahead
    const kMax = Math.min(Math.floor((this.dist + total - 0.5) / SP), kMin + MAX_MARKERS - 1);
    const targets = new Map();
    let j = 0;
    for (let k = kMin; k <= kMax; k++) {
      const A = k * SP - this.dist;           // metres ahead along the predicted route
      if (A < 0 || A > total) continue;
      while (j < pts.length - 1 && pts[j + 1].along < A) j++;
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      const f = (A - a.along) / ((b.along - a.along) || 1);
      targets.set(k, { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, angle: a.h });
    }
    // drop slots that scrolled off (passed at the near end, or past the far cap)
    this.routeMarks = this.routeMarks.filter((mk) => targets.has(mk.k));
    const have = new Map(this.routeMarks.map((mk) => [mk.k, mk]));
    for (const [k, tg] of targets) {
      const mk = have.get(k);
      if (!mk) {
        // first time this slot is drawn — place it AT the target, no glide-in
        this.routeMarks.push({ k, x: tg.x, z: tg.z, angle: tg.angle });
      } else {
        mk.x += (tg.x - mk.x) * EASE;
        mk.z += (tg.z - mk.z) * EASE;
        let da = tg.angle - mk.angle;
        while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        mk.angle += da * EASE;
      }
    }
    // render near -> far with a gentle size taper (index-based, not stored)
    return this.#renderMarks();
  }

  // Sort the frozen chevrons near->far and map them to render instances with a
  // gentle size taper. Used both after a re-fit (straight sailing) and, during a
  // tack/gybe, to keep the already-placed chevrons on screen without rebuilding.
  //
  // The nearest chevrons also DUCK under the board: as one reaches the hull it
  // shrinks to nothing over the board's nose (BOARD_NOSE metres ahead of centre),
  // so it slides visually "under" the board instead of being drawn on top of the
  // deck or popping out at the board's midpoint. (The board floats only ~0.1m
  // proud of the water, so real depth occlusion is unreliable — shrinking is.)
  #renderMarks() {
    this.routeMarks.sort((p, q) => p.k - q.k);
    const BOARD_NOSE = 1.0, DUCK_FADE = 0.9;   // metres: hidden by the nose, full a bit further out
    return this.routeMarks.map((mk, idx) => {
      const ahead = mk.k * MARKER_SP - this.dist;                 // metres ahead of the board centre
      const duck = Math.max(0, Math.min(1, (ahead - BOARD_NOSE) / DUCK_FADE));
      return {
        x: mk.x, z: mk.z, angle: mk.angle,
        scale: Math.max(0.6, 1 - idx * 0.03) * duck,
      };
    });
  }
}
