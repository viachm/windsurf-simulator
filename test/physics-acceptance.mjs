// Acceptance tests: does the sim's physics match real windsurfing behaviour?
// Exit code 0 = all pass. Run with:
//   /Users/viachm/.nvm/versions/node/v22.15.0/bin/node test/physics-acceptance.mjs
import { WindsurfSim } from '../site/src/sim.js';

const DEG = Math.PI / 180;
const KN = 1.94384;

function makeSim(windKn) {
  const s = new WindsurfSim();
  s.baseWind = windKn / KN;
  s.windFromAngle = () => 0;   // steady wind for clean measurements
  s.windSpeed = () => s.baseWind;
  return s;
}

// a "perfect rider": always optimal sheet, lean matched to required, harness
// when loaded, straps when planing
function bestInputs(s, st, dagger) {
  const sheetDeg = st ? st.sheetOpt : 45;
  const required = st ? st.required01 : 0.3;
  const harness = required > 0.5;
  const boost = harness ? 1.38 : 1.0;
  const lean = Math.max(0, Math.min(100, (required / boost) * 100));
  const stance = s.planing ? 'back' : 'mid';
  return { sheetDeg, rake: 0, stance, lean, dagger, harness, autotrim: true };
}

function steady(windKn, absBetaDeg, { dagger = false, seconds = 120 } = {}) {
  const s = makeSim(windKn);
  const heading = -absBetaDeg * DEG;
  s.heading = heading;
  s.v = 2.0;
  const dt = 1 / 60;
  let st = null, sum = 0, n = 0, sumU = 0, sumReq = 0, plan = 0, crashed = false, nan = false;
  for (let t = 0; t < seconds; t += dt) {
    st = s.update(dt, bestInputs(s, st, dagger));
    s.heading = heading; s.yawVel = 0;
    if (st.crashed) { crashed = true; s.crashed = false; s.crashTimer = 0; }
    if (!Number.isFinite(st.v) || !Number.isFinite(st.u)) { nan = true; break; }
    if (t > seconds - 30) {
      sum += st.v; sumU += Math.abs(st.u); sumReq += st.required01; n++;
      if (st.planing) plan++;
    }
  }
  return {
    kn: (sum / n) * KN,
    leewayKn: (sumU / n) * KN,
    required: sumReq / n,
    planing: plan / n > 0.5,
    crashed, nan,
  };
}

function turnResponse(windKn, fromBeta, toBeta) {
  const s = makeSim(windKn);
  s.heading = -fromBeta * DEG;
  s.v = 2;
  const dt = 1 / 60;
  let st = null;
  for (let t = 0; t < 90; t += dt) {
    st = s.update(dt, bestInputs(s, st, false));
    s.heading = -fromBeta * DEG; s.yawVel = 0;
    if (st.crashed) { s.crashed = false; s.crashTimer = 0; }
  }
  const v0 = st.v * KN;
  let heading = -fromBeta * DEG;
  const target = -toBeta * DEG;
  let v10 = 0, v20 = 0;
  for (let t = 0; t < 21; t += dt) {
    if (t < 2) heading += (target - (-fromBeta * DEG)) * (dt / 2);
    else heading = target;
    s.heading = heading; s.yawVel = 0;
    st = s.update(dt, bestInputs(s, st, false));
    s.heading = heading; s.yawVel = 0;
    if (st.crashed) { s.crashed = false; s.crashTimer = 0; }
    if (Math.abs(t - 10) < dt / 2) v10 = st.v * KN;
    if (Math.abs(t - 20) < dt / 2) v20 = st.v * KN;
  }
  return { v0, v10, v20 };
}

// ---------------- run everything ----------------
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}

console.log('--- polar sweep @ 14 kn (dagger up) ---');
const betas = [45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 179];
const P = {};
for (const b of betas) P[b] = steady(14, b);
for (const b of betas) {
  const r = P[b];
  console.log(`  ${String(b).padStart(3)}°  ${r.kn.toFixed(1).padStart(5)} kn` +
    `${r.planing ? '  PLANING' : '         '}  leeway ${r.leewayKn.toFixed(1)} kn` +
    `  req ${r.required.toFixed(2)}${r.crashed ? '  CRASHED' : ''}${r.nan ? '  NaN!' : ''}`);
}

const vmaxBeta = betas.reduce((a, b) => (P[b].kn > P[a].kn ? b : a));

console.log('\n--- A. polar shape @ 14 kn ---');
check('no NaN / no crash for perfect rider', betas.every((b) => !P[b].nan && !P[b].crashed));
check('upwind slower than beam: v(55) < v(90)', P[55].kn < P[90].kn, `${P[55].kn.toFixed(1)} < ${P[90].kn.toFixed(1)}`);
check('beam slower than broad: v(90) < v(120)', P[90].kn < P[120].kn, `${P[90].kn.toFixed(1)} < ${P[120].kn.toFixed(1)}`);
check('fastest point of sail in 100..150°', vmaxBeta >= 100 && vmaxBeta <= 150, `argmax=${vmaxBeta}°`);
check('broad-reach top speed 14..24 kn', P[vmaxBeta].kn >= 14 && P[vmaxBeta].kn <= 24, P[vmaxBeta].kn.toFixed(1));
check('planing on a broad reach @ 14 kn', [100, 110, 120, 130, 140].some((b) => P[b].planing));
check('dead run 4..9 kn and well below max', P[179].kn >= 4 && P[179].kn <= 9 && P[179].kn < 0.6 * P[vmaxBeta].kn, P[179].kn.toFixed(1));
check('close-hauled (55°) 4..9 kn', P[55].kn >= 4 && P[55].kn <= 9, P[55].kn.toFixed(1));
check('no cliff: adjacent polar points differ < 8 kn',
  betas.slice(1).every((b, i) => Math.abs(P[b].kn - P[betas[i]].kn) < 8));
const vmg = Math.max(...[45, 50, 55, 60, 70].map((b) => P[b].kn * Math.cos(b * DEG)));
check('useful upwind VMG >= 2.5 kn', vmg >= 2.5, vmg.toFixed(1));

console.log('\n--- B. dynamic response @ 14 kn ---');
const bear = turnResponse(14, 90, 125);
check('bearing away accelerates: v(+20s) > v(0)', bear.v20 > bear.v0 + 0.5,
  `${bear.v0.toFixed(1)} -> ${bear.v10.toFixed(1)} -> ${bear.v20.toFixed(1)} kn`);
const head = turnResponse(14, 90, 55);
check('heading up decelerates: v(+20s) < v(0)', head.v20 < head.v0 - 0.5,
  `${head.v0.toFixed(1)} -> ${head.v10.toFixed(1)} -> ${head.v20.toFixed(1)} kn`);

console.log('\n--- C. light wind 8 kn ---');
const L = {};
for (const b of [60, 90, 120, 150]) L[b] = steady(8, b);
check('no planing anywhere @ 8 kn', Object.values(L).every((r) => !r.planing));
check('displacement speeds 1.5..7 kn', Object.values(L).every((r) => r.kn >= 1.5 && r.kn <= 7),
  Object.entries(L).map(([b, r]) => `${b}°:${r.kn.toFixed(1)}`).join(' '));

console.log('\n--- D. strong wind 20 kn ---');
const S = {};
for (const b of [60, 90, 110, 130, 150, 179]) S[b] = steady(20, b);
for (const [b, r] of Object.entries(S)) console.log(`  ${b}°  ${r.kn.toFixed(1)} kn${r.planing ? ' PLANING' : ''}`);
check('planing at beam and broad @ 20 kn', S[90].planing && S[130].planing);
check('broad >= beam @ 20 kn', S[130].kn >= S[90].kn - 0.5, `${S[130].kn.toFixed(1)} vs ${S[90].kn.toFixed(1)}`);
check('top speed <= 30 kn @ 20 kn wind', Math.max(...Object.values(S).map((r) => r.kn)) <= 30);
check('run speed <= wind speed', S[179].kn <= 20);

console.log('\n--- E. leeway & balance ---');
const up = steady(14, 55), down = steady(14, 150);
check('leeway upwind >> downwind', up.leewayKn > 2.5 * down.leewayKn,
  `${up.leewayKn.toFixed(1)} vs ${down.leewayKn.toFixed(1)}`);
const upD = steady(14, 55, { dagger: true });
check('daggerboard cuts upwind leeway >= 40%', upD.leewayKn < 0.6 * up.leewayKn,
  `${upD.leewayKn.toFixed(1)} vs ${up.leewayKn.toFixed(1)}`);
check('more counter-lean needed at beam than on a run', P[90].required > P[170].required + 0.1,
  `${P[90].required.toFixed(2)} vs ${P[170].required.toFixed(2)}`);
check('harness matters somewhere upwind/beam (required >= 0.5)',
  [60, 70, 80, 90].some((b) => P[b].required >= 0.5));

console.log('\n--- F. wind scaling ---');
const maxAt = (w) => Math.max(...[90, 110, 130].map((b) => steady(w, b).kn));
const m12 = maxAt(12), m17 = maxAt(17), m25 = maxAt(25);
check('faster wind -> faster board (12 < 17 < 25 kn wind)', m12 < m17 && m17 < m25,
  `${m12.toFixed(1)} / ${m17.toFixed(1)} / ${m25.toFixed(1)} kn`);
check('max speed sane @ 25 kn wind (<= 34 kn)', m25 <= 34, m25.toFixed(1));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
