// Windsurf physics simulation (simplified but faithful to real mechanics).
//
// Conventions:
//  - World plane is XZ, +Y up. Heading theta=0 means the nose points +Z.
//  - Increasing theta turns the bow toward +X, which is the PORT side of the rider.
//  - beta = signed angle from the bow to the direction the TRUE wind comes FROM.
//    beta > 0  -> wind over the PORT side (port tack).
//  - betaApp = same but for APPARENT wind (true wind minus board velocity).

const DEG = Math.PI / 180;
const KN = 1.94384; // m/s -> knots
const THRUST_N = 340;      // sail thrust scale, N at drive01=1
const THRUST_CLAMP = 2.05; // thrust saturates later than the UI power meter's 1.35
const K_WALL = 1.4;        // displacement-hull wave-drag wall strength

// ---- maneuver geometry (|beta| targets, radians) ----
// A tack/gybe runs in two phases: SETUP auto-steers the bow to the ideal entry
// angle, then TURN carries it through the wind. Entry/exit are the |beta| the
// board holds just before and after the turn.
const TACK_ENTRY = 42 * DEG;   // close-hauled: how tight we come up before crossing
const TACK_EXIT  = 52 * DEG;   // close reach we settle onto on the new tack
const GYBE_ENTRY = 148 * DEG;  // deep broad reach we bear away to before carving
const GYBE_EXIT  = 130 * DEG;  // broad reach we settle onto on the new tack
const TACK_VMIN  = 1.4;        // need this much way on to coast through the no-go
const GYBE_VMIN  = 1.6;        // need this much to carry the carve through the run
const TACK_MAX_BETA = 112 * DEG; // beyond this you're downwind -> must gybe
const GYBE_MIN_BETA = 68 * DEG;  // inside this you're upwind   -> must tack

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function signedAngle(ax, az, bx, bz) {
  return Math.atan2(az * bx - ax * bz, ax * bx + az * bz);
}

// `key` is an i18n key resolved at render time (see i18n.js / ui.js).
export const POINTS_OF_SAIL = [
  { max: 45,  key: 'pos.irons' },
  { max: 65,  key: 'pos.close' },
  { max: 105, key: 'pos.beam' },
  { max: 150, key: 'pos.broad' },
  { max: 181, key: 'pos.run' },
];

export class WindsurfSim {
  constructor() {
    this.reset();
  }

  reset() {
    this.t = 0;
    this.pos = { x: 0, z: 0 };
    this.heading = 100 * DEG;        // wind comes from +Z (0deg); start on a beam reach
    this.v = 1.2;                    // forward speed m/s
    this.u = 0;                      // leeway (drift) speed toward starboard, m/s
    this.yawVel = 0;                 // yaw rate, rad/s, +ve = turning toward port
    this.windFromAngle0 = 0;         // wind FROM +Z direction
    this.baseWind = 7;               // m/s (default true wind)
    this.planing = false;
    this.crashed = false;
    this.crashReason = '';
    this.crashLesson = '';
    this.crashTimer = 0;
    this.recoverHold = false;
    this.maneuver = null;            // {type:'tack'|'gybe', from, to, dur, t}
    // danger accumulators (seconds spent in a hazardous condition)
    this.acc = { catapult: 0, backFall: 0, spinout: 0, pearl: 0 };
    this.stuckInIrons = false;
    this.lastState = null;
  }

  // ---- helpers ----
  fwd()  { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }
  right() { const f = this.fwd(); return { x: -f.z, z: f.x }; } // starboard side

  windFromAngle() {
    return this.windFromAngle0 + 6 * DEG * Math.sin(0.017 * this.t);
  }
  windSpeed() {
    const g = 1 + 0.14 * Math.sin(0.13 * this.t) + 0.09 * Math.sin(0.041 * this.t + 2)
      + 0.05 * Math.sin(0.53 * this.t + 1);
    return this.baseWind * g;
  }
  windFromDir() {
    const a = this.windFromAngle();
    return { x: Math.sin(a), z: Math.cos(a) };
  }
  windVel() { // velocity of the air (blows AWAY from windFromDir)
    const d = this.windFromDir(), s = this.windSpeed();
    return { x: -d.x * s, z: -d.z * s };
  }

  beta() { // signed angle bow -> true-wind-FROM
    const f = this.fwd(), w = this.windFromDir();
    return signedAngle(f.x, f.z, w.x, w.z);
  }

  // Returns { ok:true } or { ok:false, reason } so the UI can explain a block.
  // Note: dHeading = -dBeta (rotating the bow to port/+heading swings the wind
  // FROM-angle the other way). All phase deltas below are in HEADING space.
  startTack() {
    if (this.crashed || this.maneuver) return { ok: false, reason: 'busy' };
    const b = this.beta();
    if (Math.abs(b) > TACK_MAX_BETA) return { ok: false, reason: 'downwind' };
    if (this.v < TACK_VMIN) return { ok: false, reason: 'slow' };
    const s = b >= 0 ? 1 : -1;              // current tack (wind side)
    // SETUP: head up to close-hauled on the current tack (reduce |beta| to entry).
    const setupDH = (Math.abs(b) - TACK_ENTRY) * s;
    // TURN: carry the bow up through the eye of the wind onto the other tack.
    const turnDH = (TACK_ENTRY + TACK_EXIT) * s;
    this.maneuver = this.#buildManeuver('tack', s, setupDH, turnDH);
    return { ok: true };
  }

  startGybe() {
    if (this.crashed || this.maneuver) return { ok: false, reason: 'busy' };
    const b = this.beta();
    if (Math.abs(b) < GYBE_MIN_BETA) return { ok: false, reason: 'upwind' };
    if (this.v < GYBE_VMIN) return { ok: false, reason: 'slow' };
    const s = b >= 0 ? 1 : -1;
    // SETUP: bear away to a deep broad reach (increase |beta| to entry).
    const setupDH = -(GYBE_ENTRY - Math.abs(b)) * s;
    // TURN: carry the stern through dead-downwind onto the other tack.
    const turnDH = -((Math.PI - GYBE_ENTRY) + (Math.PI - GYBE_EXIT)) * s;
    this.maneuver = this.#buildManeuver('gybe', s, setupDH, turnDH);
    return { ok: true };
  }

  #buildManeuver(type, s, setupDH, turnDH) {
    const turnRate = type === 'tack' ? 1.15 : 0.98;       // rad/s nominal
    const setupRate = type === 'tack' ? 0.95 : 0.85;
    const setupDur = clamp(Math.abs(setupDH) / setupRate, 0, 2.2);
    const turnDur = clamp(Math.abs(turnDH) / turnRate, 1.2, 3.4);
    const hasSetup = setupDur > 0.15;
    return {
      type, s, setupDH, turnDH, setupDur, turnDur,
      phase: hasSetup ? 'setup' : 'turn',
      tPhase: 0, tTotal: 0,
      totalDur: (hasSetup ? setupDur : 0) + turnDur,
      turn01: 0, overall01: 0,     // progress fields read by the renderer
    };
  }

  crash(reason, lesson) {
    this.crashed = true;
    this.crashReason = reason;
    this.crashLesson = lesson;
    this.crashTimer = 3.2;
    this.recoverHold = false;   // set true while the player holds the crash popup to read it
    this.maneuver = null;
    this.planing = false;
    this.yawVel = 0;
    this.acc = { catapult: 0, backFall: 0, spinout: 0, pearl: 0 };
  }

  recover() {
    this.crashed = false;
    this.v = 0.6;
    this.u = 0;
    this.yawVel = 0;
    // stand up pointing across the wind again
    const w = this.windFromAngle();
    const b = this.beta();
    this.heading = w + (b >= 0 ? 100 * DEG : -100 * DEG);
  }

  /**
   * inputs: { sheetDeg 0..90, rake -1..1 (back..fwd), stance 'front'|'mid'|'back',
   *           lean 0..100, dagger bool, harness bool, autotrim bool }
   */
  update(dt, inputs) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const warnings = [];

    // ------- crashed: float and count down -------
    if (this.crashed) {
      // while the player holds the popup to read it, freeze the countdown and
      // don't auto-recover — recovery happens on release (see UI).
      if (!this.recoverHold) {
        this.crashTimer -= dt;
        if (this.crashTimer <= 0) this.recover();
      }
      this.v *= Math.pow(0.2, dt);
      this.yawVel *= Math.pow(0.1, dt);
      return this.snapshot(inputs, warnings, { power01: 0, required01: 0, trim: 'luff', sheetOpt: 45 });
    }

    // ------- wind & geometry -------
    const ws = this.windSpeed();
    const W = this.windVel();
    const f = this.fwd(), r = this.right();
    const beta = this.beta();
    const absBetaDeg = Math.abs(beta) / DEG;

    // apparent wind
    const Vx = f.x * this.v + r.x * this.u;
    const Vz = f.z * this.v + r.z * this.u;
    const Ax = W.x - Vx, Az = W.z - Vz;
    const awSpeed = Math.hypot(Ax, Az);
    // direction apparent wind comes FROM
    const afx = -Ax / (awSpeed || 1), afz = -Az / (awSpeed || 1);
    const betaApp = signedAngle(f.x, f.z, afx, afz);
    const absBetaAppDeg = Math.abs(betaApp) / DEG;

    // ------- maneuver (tack / gybe) overrides steering -------
    if (this.maneuver) {
      const m = this.maneuver;
      m.tPhase += dt; m.tTotal += dt;
      let power01 = 0.12;

      if (m.phase === 'setup') {
        // Phase 1 — auto-steer to the ideal entry angle while still driving.
        // Bell-shaped rate over the phase so ∫ = setupDH exactly.
        const s01 = clamp(m.tPhase / m.setupDur, 0, 1);
        const dH = (m.setupDH / m.setupDur) * 6 * s01 * (1 - s01) * dt;
        this.yawVel = dt > 0 ? dH / dt : 0;
        this.heading += dH;
        // Board is powered and carving normally here: rotate velocity with the
        // hull and let the fin bleed the slip.
        const v0 = this.v, u0 = this.u;
        this.v = v0 * Math.cos(dH) - u0 * Math.sin(dH);
        this.u = (v0 * Math.sin(dH) + u0 * Math.cos(dH)) * Math.pow(0.2, dt);
        this.v *= Math.pow(m.type === 'gybe' ? 0.97 : 0.9, dt); // gybe bears away, keeps speed
        power01 = 0.4;
        if (m.tPhase >= m.setupDur) { m.phase = 'turn'; m.tPhase = 0; }
      } else {
        // Phase 2 — carry the bow/stern through the wind.
        const s01 = clamp(m.tPhase / m.turnDur, 0, 1);
        m.turn01 = s01;
        const dH = (m.turnDH / m.turnDur) * 6 * s01 * (1 - s01) * dt;
        this.yawVel = dt > 0 ? dH / dt : 0;
        this.heading += dH;
        // Carved on the loaded rail: most velocity follows the hull, a little
        // escapes as slip (a free-body spin here would end the turn backwards).
        const dHFree = dH * 0.2;
        const v0 = this.v, u0 = this.u;
        this.v = v0 * Math.cos(dHFree) - u0 * Math.sin(dHFree);
        this.u = (v0 * Math.sin(dHFree) + u0 * Math.cos(dHFree)) * Math.pow(0.25, dt);
        const decay = m.type === 'tack' ? 0.5 : (this.planing ? 0.85 : 0.66);
        this.v *= Math.pow(decay, dt);
        if (m.type === 'gybe' && this.v < 3.8) this.planing = false;
        // Stalled head-to-wind mid-tack: the way ran out before the bow crossed.
        // Bail into irons instead of drifting backwards through the eye.
        if (m.type === 'tack' && s01 > 0.35 && s01 < 0.85 && this.v < 0.25) {
          this.maneuver = null; this.stuckInIrons = true; this.yawVel = 0;
          warnings.push('warn.irons');
        } else if (m.tPhase >= m.turnDur) {
          this.maneuver = null;
          if (m.type === 'tack' && this.v < 0.4) this.stuckInIrons = true;
        }
      }

      if (this.maneuver) this.maneuver.overall01 = clamp(m.tTotal / m.totalDur, 0, 1);
      const f2 = this.fwd(), r2 = this.right();
      this.pos.x += (f2.x * this.v + r2.x * this.u) * dt;
      this.pos.z += (f2.z * this.v + r2.z * this.u) * dt;
      return this.snapshot(inputs, warnings, {
        power01, required01: 0.1, trim: 'good', sheetOpt: 45,
      });
    }

    // ------- sail trim (lift/drag decomposed along the apparent wind) -------
    // Optimal boom angle grows as the (apparent) wind moves aft.
    const sheetOpt = clamp(0.55 * absBetaAppDeg - 12, 8, 82);
    const diff = inputs.sheetDeg - sheetOpt;    // >0 let out too far, <0 pulled in too much

    let trim = 'good';
    if (diff > 22) trim = 'luff';
    else if (diff < -20) trim = 'stall';

    let effDrive = Math.exp(-(diff / 26) * (diff / 26));
    if (diff > 40) effDrive = 0;          // fully luffing

    // A sail is an aerofoil: decompose its force into lift (perpendicular to the
    // APPARENT wind) and drag (along it), then resolve both onto the boat's own
    // heading to get drive (forward) and side (heel/leeway) components. This is
    // why upwind sailing works at all: at a tight apparent angle lift dominates
    // and a fast, low-drag rig still nets forward thrust; downwind lift collapses
    // (flow can't stay attached past a dead run) and a squared-off sail drives
    // like a barn door on drag alone.
    const bA = Math.abs(betaApp);            // apparent wind angle off the bow, rad
    const bAdeg = absBetaAppDeg;
    const q = (awSpeed / 10) ** 2;           // normalized dynamic pressure
    // Lift needs attached flow: dies approaching head-to-wind AND approaching dead run.
    // The forward fade is deliberately wide (out to ~55deg apparent): as the board
    // accelerates the apparent wind swings toward the bow, lift collapses and the
    // boat self-limits — which is exactly why a beam reach tops out below a broad
    // reach despite seeing MORE apparent wind.
    const CL = 1.85 * effDrive * smoothstep(24, 55, bAdeg) * smoothstep(180, 150, bAdeg);
    // A well-trimmed sail squared off to the apparent wind pushes like a barn door downwind.
    // Onset starts near apparent-beam (cos~0, drag neither helps nor hurts there)
    // so it never fights the lift term forward of the beam.
    const CD = 0.10 + 6.0 * effDrive * smoothstep(90, 125, bAdeg);
    // Oversheeted stalled sail: lots of sideways heel, little drive.
    const sideStall = 0.55 * smoothstep(18, 45, -diff);
    const drive01 = q * (CL * Math.sin(bA) - CD * Math.cos(bA));  // cos<0 aft of beam -> drag drives you
    const side01 = q * (Math.max(0, CL * Math.cos(bA)) + 0.08 * CD * Math.sin(bA) + sideStall);
    const power01 = clamp(drive01, 0, 1.35);
    const heel01 = clamp(side01 + 0.22 * Math.max(0, drive01), 0, 1.6); // rig tension hangs on downwind too

    // ------- steering (mast rake moves the centre of effort) -------
    // Rake steering needs water flow over the fin: authority fades to nothing as
    // the board stops, and a powered sail steers far harder than a luffing one.
    const steerAuthority = (0.10 + 0.50 * power01) * smoothstep(0.25, 1.4, Math.abs(this.v))
      + 0.035 * Math.abs(this.v);
    const betaSign = beta >= 0 ? 1 : -1;
    // rake back (-1) turns upwind, rake fwd (+1) bears away
    let yawTarget = (-inputs.rake) * betaSign * steerAuthority;
    // You cannot rake yourself through the eye of the wind — the sail luffs and
    // the turn stalls just inside the no-go cone (turning through it is a TACK).
    // Without this gate the wind-side sign flips every frame at beta=0 and the
    // sail slams left-right endlessly.
    if (inputs.rake < 0) yawTarget *= smoothstep(5, 16, absBetaDeg);
    // The same trap exists at the OTHER end: bearing away hard runs the bow
    // through dead-downwind, beta wraps +180 -> -180, betaSign flips every frame
    // and the tack readout jumps port<->starboard ("by the lee"). Stall the
    // bear-away just short of dead-run — crossing it cleanly is a GYBE.
    if (inputs.rake > 0) yawTarget *= smoothstep(178, 165, absBetaDeg);
    // The hull cannot carve tighter than ~minR metres however hard you rake.
    const minR = this.planing ? 7 : 3;
    const maxYaw = Math.abs(this.v) / minR + 0.05;
    yawTarget = clamp(yawTarget, -maxYaw, maxYaw);
    // Yaw inertia: a turn takes a moment to build and a moment to die away.
    this.yawVel += (yawTarget - this.yawVel) * clamp(dt / 0.35, 0, 1);
    const dpsi = this.yawVel * dt;
    this.heading += dpsi;
    // Momentum: rotating the nose does not rotate the hull's velocity. Re-decompose
    // the unchanged world velocity in the new body frame; the resulting sideways
    // slip is then bled off by the fin (leeway relaxation below), so turn radius
    // emerges from fin grip rather than being kinematic.
    {
      const v0 = this.v, u0 = this.u;
      this.v = v0 * Math.cos(dpsi) - u0 * Math.sin(dpsi);
      this.u = v0 * Math.sin(dpsi) + u0 * Math.cos(dpsi);
    }

    // ------- weathervane out of the no-go zone -------
    // A board head-to-wind is an UNSTABLE equilibrium: the flogging sail makes no
    // drive, so the fin has no flow to steer with — but the rig's windage still
    // swings the bow off the eye of the wind. Without this you sit pinned in irons
    // forever (you can't rake out with no speed). Fall off toward the current tack
    // so the board self-recovers to the edge of the no-go, where a trimmed sail
    // catches. It fades to nothing by ~46deg and whenever the sail is driving, so
    // it never fights a rider who is sailing (or deliberately pinching) with power.
    if (power01 < 0.12 && absBetaDeg < 46) {
      const wvRate = (-betaSign) * 0.30 * smoothstep(46, 6, absBetaDeg); // rad/s
      const dpsiWv = wvRate * dt;
      this.heading += dpsiWv;
      const v0 = this.v, u0 = this.u;
      this.v = v0 * Math.cos(dpsiWv) - u0 * Math.sin(dpsiWv);
      this.u = v0 * Math.sin(dpsiWv) + u0 * Math.cos(dpsiWv);
    }

    // ------- planing state -------
    if (!this.planing) {
      if (this.v > 3.8 && power01 > 0.26 && absBetaDeg > 70 && absBetaDeg < 162 && trim === 'good') this.planing = true;
    } else if (this.v < 3.6 || power01 < 0.20) {
      this.planing = false;
    }

    // ------- drag -------
    let drag;
    if (this.planing) {
      // Semi-planing ramp: a freshly-released hull still drags its tail through
      // the water; only at speed does it skim on the clean 2.4-ish coefficient.
      const cPlane = 4.0 - 1.6 * smoothstep(4, 7, this.v);
      drag = cPlane * this.v * Math.abs(this.v);
      if (inputs.stance === 'mid') drag *= 1.4;           // not in the straps
      if (inputs.dagger) drag *= 1.5;                     // board wants to rail over
    } else {
      drag = 12.0 * this.v * Math.abs(this.v) * 0.5 + 9 * this.v;
      if (inputs.stance === 'back' && this.v < 3.5) {
        drag *= 1.9;                                      // tail sinks
        warnings.push('warn.tailSink');
      }
      // Displacement hull hits its wave-making "wall": pushing harder barely
      // helps once you're near hull speed. Breaking onto the plane removes it.
      drag += K_WALL * smoothstep(4.0, 6.2, this.v) * this.v * this.v;
    }
    if (inputs.dagger && !this.planing) drag += 0.25 * this.v * this.v;
    drag *= 1 + 1.8 * Math.abs(this.yawVel);   // carving scrubs speed
    drag += 14 * this.u * this.u;              // slip (sideways flow) drag

    // ------- thrust & integrate speed -------
    // Thrust keeps scaling past the UI meter's 1.35 clamp (power01 stays 0..1.35
    // for the display, steering authority and planing thresholds) so stronger
    // wind keeps making a faster board instead of flat-lining the polar.
    const thrust = clamp(drive01, 0, THRUST_CLAMP) * THRUST_N;
    const mass = 97; // rider + board + rig
    this.v += ((thrust - drag) / mass) * dt;

    // stuck in irons: luffing sail in the no-go zone drifts you backwards
    if (absBetaDeg < 42 && power01 < 0.05) {
      this.v = Math.max(this.v - 0.5 * dt, -0.7);
      if (this.v < 0.2) {
        warnings.push('warn.irons');
        this.stuckInIrons = true;
      }
    } else {
      this.stuckInIrons = false;
    }
    if (this.v > -0.7 && this.v < 0 && absBetaDeg > 50) this.v = 0;

    // ------- leeway (sideways drift) -------
    const leewardSign = betaSign; // drift toward leeward = +starboard when wind over port... see note
    // wind over port (beta>0) pushes the board to starboard (+right)
    const finGrip = inputs.dagger ? 0.22 : (this.planing ? 0.25 : 0.85);
    const uTarget = leewardSign * heel01 * finGrip * (this.planing ? 0.5 : 1.6);
    const finTau = this.planing ? 0.25 : (inputs.dagger ? 0.35 : 0.55);
    this.u += (uTarget - this.u) * clamp(dt / finTau, 0, 1);

    // ------- balance: lean vs sail pull -------
    const required01 = clamp(heel01 * 0.78, 0, 1.3);
    const harnessBoost = inputs.harness ? 1.38 : 1.0;
    const eff01 = (inputs.lean / 100) * harnessBoost;

    const overPower = required01 - eff01;   // sail wins -> catapult
    const overLean = eff01 - required01;    // rider wins -> splash backwards

    if (overPower > 0.34) {
      this.acc.catapult += dt * (inputs.harness ? 1.5 : 1.0); // hooked in = flung faster
      warnings.push('warn.overpowered');
    } else this.acc.catapult = Math.max(0, this.acc.catapult - dt * 2);

    if (overLean > 0.4 && eff01 > 0.35) {
      this.acc.backFall += dt;
      warnings.push('warn.backfall');
    } else this.acc.backFall = Math.max(0, this.acc.backFall - dt * 2);

    if (this.planing && (inputs.dagger || Math.abs(this.u) > 1.3)) {
      this.acc.spinout += dt;
      warnings.push('warn.spinout');
    } else this.acc.spinout = Math.max(0, this.acc.spinout - dt * 2);

    if (inputs.stance === 'front' && this.v > 5.6) {
      this.acc.pearl += dt;
      warnings.push('warn.pearl');
    } else this.acc.pearl = Math.max(0, this.acc.pearl - dt * 2);

    // ------- crashes -------
    if (this.acc.catapult > 1.1) {
      this.crash('crash.catapult.reason', 'crash.catapult.lesson');
    } else if (this.acc.backFall > 1.0) {
      this.crash('crash.backfall.reason', 'crash.backfall.lesson');
    } else if (this.acc.spinout > 2.2) {
      this.crash('crash.spinout.reason', 'crash.spinout.lesson');
    } else if (this.acc.pearl > 1.2) {
      this.crash('crash.pearl.reason', 'crash.pearl.lesson');
    }

    // ------- coaching hints (non-fatal) -------
    if (!warnings.length) {
      if (absBetaDeg < 42) warnings.push('warn.nogo');
      else if (trim === 'luff') warnings.push('warn.luff');
      else if (trim === 'stall') warnings.push('warn.stall');
      else if (this.planing && inputs.stance !== 'back') warnings.push('warn.getStraps');
      else if (!this.planing && power01 > 0.72 && absBetaDeg > 70 && this.v > 3.2)
        warnings.push('warn.almostPlaning');
    }

    // ------- integrate position -------
    const f2 = this.fwd(), r2 = this.right();
    this.pos.x += (f2.x * this.v + r2.x * this.u) * dt;
    this.pos.z += (f2.z * this.v + r2.z * this.u) * dt;

    return this.snapshot(inputs, warnings, {
      power01, required01, eff01, trim, sheetOpt, heel01,
      awSpeed, betaApp,
    });
  }

  snapshot(inputs, warnings, extra) {
    const beta = this.beta();
    const absBetaDeg = Math.abs(beta) / DEG;
    let posKey = POINTS_OF_SAIL[POINTS_OF_SAIL.length - 1].key;
    for (const p of POINTS_OF_SAIL) { if (absBetaDeg <= p.max) { posKey = p.key; break; } }
    const ws = this.windSpeed();
    const s = {
      t: this.t,
      pos: { ...this.pos },
      heading: this.heading,
      v: this.v,
      u: this.u,
      yawVel: this.yawVel,
      speedKn: Math.abs(this.v) * KN,
      windKn: ws * KN,
      baseWindKn: this.baseWind * KN,
      gustKn: (ws - this.baseWind) * KN,
      windFromAngle: this.windFromAngle(),
      beta,
      absBetaDeg,
      tackKey: beta >= 0 ? 'tack.port' : 'tack.starboard',
      pointOfSailKey: posKey,
      planing: this.planing,
      crashed: this.crashed,
      crashReason: this.crashReason,
      crashLesson: this.crashLesson,
      crashTimer: this.crashTimer,
      maneuver: this.maneuver ? { ...this.maneuver } : null,
      stuckInIrons: this.stuckInIrons,
      warnings,
      power01: 0, required01: 0, eff01: 0, trim: 'good', sheetOpt: 45,
      heel01: 0, awSpeed: 0, betaApp: beta,
      danger: Math.max(this.acc.catapult / 1.1, this.acc.backFall / 1.0,
        this.acc.spinout / 2.2, this.acc.pearl / 1.2),
      inputs: { ...inputs },
      ...extra,
    };
    this.lastState = s;
    return s;
  }
}

// ---- tiny convention self-tests (visible in the console) ----
(function selfTest() {
  const s = new WindsurfSim();
  s.heading = 0; s.windFromAngle0 = 90 * DEG; s.t = 0;
  // wind from +X (port side when facing +Z) -> beta must be positive
  console.assert(s.beta() > 0, 'beta sign convention broken: wind over port should be beta>0');
  s.windFromAngle0 = -90 * DEG;
  console.assert(s.beta() < 0, 'beta sign convention broken: wind over starboard should be beta<0');
})();
