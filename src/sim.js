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
    this.baseWind = 14 / KN;         // m/s
    this.planing = false;
    this.crashed = false;
    this.crashReason = '';
    this.crashLesson = '';
    this.crashTimer = 0;
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

  startTack() {
    const b = this.beta();
    if (this.crashed || this.maneuver) return false;
    if (this.v < 1.2) return false;
    if (Math.abs(b) > 100 * DEG) return false; // too far downwind, gybe instead
    const delta = 2 * b; // rotate so beta -> -beta
    this.maneuver = { type: 'tack', delta, done: 0, dur: clamp(Math.abs(delta) / (1.1), 1.2, 3.2), t: 0 };
    return true;
  }

  startGybe() {
    const b = this.beta();
    if (this.crashed || this.maneuver) return false;
    if (this.v < 1.5) return false;
    if (Math.abs(b) < 75 * DEG) return false; // head downwind first
    const sign = b > 0 ? -1 : 1; // turn away from the wind
    const delta = sign * 2 * (Math.PI - Math.abs(b));
    this.maneuver = { type: 'gybe', delta, done: 0, dur: clamp(Math.abs(delta) / 0.9, 1.4, 3.6), t: 0 };
    return true;
  }

  crash(reason, lesson) {
    this.crashed = true;
    this.crashReason = reason;
    this.crashLesson = lesson;
    this.crashTimer = 3.2;
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
      this.crashTimer -= dt;
      this.v *= Math.pow(0.2, dt);
      this.yawVel *= Math.pow(0.1, dt);
      if (this.crashTimer <= 0) this.recover();
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
      m.t += dt;
      const s = clamp(m.t / m.dur, 0, 1);
      // bell-shaped rate: ∫ 6s(1-s) ds over [0,1] = 1, so the turn still sums to delta
      const rate = (m.delta / m.dur) * 6 * s * (1 - s);
      this.yawVel = rate;
      const dpsi = rate * dt;
      this.heading += dpsi;
      m.done += dpsi;
      // A committed tack/gybe is carved on the loaded rail: most of the velocity
      // is redirected WITH the hull, only a fraction escapes as sideways slip
      // (free-body rotation here would stack on the decay below and end the
      // maneuver moving backwards).
      const dpsiFree = dpsi * 0.2;
      const v0 = this.v, u0 = this.u;
      this.v = v0 * Math.cos(dpsiFree) - u0 * Math.sin(dpsiFree);
      this.u = (v0 * Math.sin(dpsiFree) + u0 * Math.cos(dpsiFree)) * Math.pow(0.25, dt);
      const decay = m.type === 'tack' ? 0.45 : (this.planing ? 0.82 : 0.62);
      this.v *= Math.pow(decay, dt);
      if (m.type === 'gybe' && this.v < 3.8) this.planing = false;
      if (m.t >= m.dur) {
        this.maneuver = null;
        if (m.type === 'tack' && this.v < 0.4) {
          this.stuckInIrons = true;
        }
      }
      const f2 = this.fwd(), r2 = this.right();
      this.pos.x += (f2.x * this.v + r2.x * this.u) * dt;
      this.pos.z += (f2.z * this.v + r2.z * this.u) * dt;
      return this.snapshot(inputs, warnings, {
        power01: 0.15, required01: 0.1, trim: 'good',
        sheetOpt: 45, maneuverProgress: m.t / m.dur, maneuverType: m.type,
      });
    }

    // ------- sail trim -------
    // Optimal boom angle grows as the (apparent) wind moves aft.
    const sheetOpt = clamp(0.55 * absBetaAppDeg - 12, 8, 82);
    const diff = inputs.sheetDeg - sheetOpt;    // >0 let out too far, <0 pulled in too much

    let trim = 'good';
    if (diff > 22) trim = 'luff';
    else if (diff < -20) trim = 'stall';

    let effDrive = Math.exp(-(diff / 26) * (diff / 26));
    const stallExtra = smoothstep(-18, -45, -Math.abs(Math.min(diff, 0))) * 0
      + smoothstep(18, 45, -diff) * 0.55; // extra heel force when badly oversheeted
    if (diff > 40) effDrive = 0;          // fully luffing

    // Point-of-sail factor: no drive in the no-go zone, slightly soft dead-run.
    const pointFactor = smoothstep(36, 55, absBetaDeg) * (1 - 0.25 * smoothstep(150, 180, absBetaDeg));
    // As you accelerate the APPARENT wind swings forward; when it gets too close
    // to the bow the sail cannot drive any more -> natural top-speed limit.
    const apparentGate = smoothstep(16, 32, absBetaAppDeg);

    const pressure = clamp((awSpeed / 10.0) * (awSpeed / 10.0), 0, 1.6);
    const power01 = clamp(pressure * effDrive * pointFactor * apparentGate, 0, 1.35);
    const heel01 = clamp(pressure * (effDrive + stallExtra) * Math.max(pointFactor, 0.25 * smoothstep(15, 40, absBetaDeg)), 0, 1.6);

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

    // ------- planing state -------
    if (!this.planing) {
      if (this.v > 4.2 && power01 > 0.72 && absBetaDeg > 70 && trim === 'good') this.planing = true;
    } else if (this.v < 3.6 || power01 < 0.28) {
      this.planing = false;
    }

    // ------- drag -------
    let drag;
    if (this.planing) {
      drag = 2.2 * this.v * Math.abs(this.v);
      if (inputs.stance === 'mid') drag *= 1.4;           // not in the straps
      if (inputs.dagger) drag *= 1.5;                     // board wants to rail over
    } else {
      drag = 12.0 * this.v * Math.abs(this.v) * 0.5 + 9 * this.v;
      if (inputs.stance === 'back' && this.v < 3.5) {
        drag *= 1.9;                                      // tail sinks
        warnings.push('warn.tailSink');
      }
    }
    if (inputs.dagger && !this.planing) drag += 0.25 * this.v * this.v;
    drag *= 1 + 1.8 * Math.abs(this.yawVel);   // carving scrubs speed
    drag += 14 * this.u * this.u;              // slip (sideways flow) drag

    // ------- thrust & integrate speed -------
    const thrust = power01 * 260;
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
