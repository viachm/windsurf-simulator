// HUD, control panel, keyboard bindings and "smart interlock" rules.

import { t, toggleLang, onLangChange } from './i18n.js?v=__BUILD__';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

export class UI {
  constructor(sim, world = null) {
    this.sim = sim;
    this.world = world;
    this.inputs = {
      sheetDeg: 55,
      rake: 0,
      stance: 'mid',
      lean: 25,
      dagger: true,
      harness: false,
      autotrim: false,
    };
    this.keysHeld = new Set();
    this.flash = { msg: '', until: 0 };
    this.#bindPanel();
    this.#bindKeys();
    this.compassCtx = $('compass').getContext('2d');

    // keep the framing centred if the viewport changes (rotate / URL bar)
    addEventListener('resize', () => this.#applyFramingLift());

    // Static markup (incl. the windset readout) is re-templated on language
    // change; re-sync the readouts that aren't refreshed every frame.
    onLangChange(() => {
      $('windset-val').textContent = `${$('windset').value} ${t('unit.kn')}`;
    });
  }

  // ---------------- panel bindings ----------------
  #bindPanel() {
    $('sheet').addEventListener('input', (e) => {
      this.inputs.sheetDeg = +e.target.value;
      if (this.inputs.autotrim) { // manual override switches assist off
        this.inputs.autotrim = false;
        $('autotrim').checked = false;
        this.flashMsg(t('flash.autotrimOff'));
      }
    });
    $('autotrim').addEventListener('change', (e) => { this.inputs.autotrim = e.target.checked; });

    $('rake-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setRake(parseFloat(b.dataset.rake));
    });

    $('stance-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setStance(b.dataset.stance);
    });

    $('lean').addEventListener('input', (e) => this.setLean(+e.target.value));

    $('dagger').addEventListener('change', (e) => { this.inputs.dagger = e.target.checked; });

    $('harness').addEventListener('change', (e) => this.setHarness(e.target.checked));

    $('btn-tack').addEventListener('click', () => this.tryTack());
    $('btn-gybe').addEventListener('click', () => this.tryGybe());
    $('btn-reset').addEventListener('click', () => { this.sim.reset(); this.resetInputs(); });

    $('windset').addEventListener('input', (e) => {
      this.sim.baseWind = (+e.target.value) / 1.94384;
      $('windset-val').textContent = `${e.target.value} ${t('unit.kn')}`;
    });

    $('welcome-close').addEventListener('click', () => {
      $('welcome-overlay').classList.add('off');
    });

    // tapping anywhere on the header toggles — a bigger, touch-friendly target
    $('panel').querySelector('.panel-header').addEventListener('click', () => {
      this.setPanelCollapsed(!$('panel').classList.contains('collapsed'));
    });

    // on phones, start collapsed so the water is visible; the header sits as a bottom bar
    if (this.#isMobile()) this.setPanelCollapsed(true);

    $('lang-toggle').addEventListener('click', () => toggleLang());
  }

  #isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

  // Single source of truth for the control sheet's open/closed state. Also lifts
  // the 3D framing on mobile so the rider stays centred in the open state.
  setPanelCollapsed(collapsed) {
    const p = $('panel');
    p.classList.toggle('collapsed', collapsed);
    $('panel-toggle').textContent = collapsed ? '+' : '–';
    this.#applyFramingLift();
  }

  // Centre the rider in the clear band between the top overlays (HUD + meters)
  // and the open control sheet: shift up by half the difference of the two
  // insets, so it isn't pushed too high (which ignoring the top overlay did).
  #applyFramingLift() {
    if (!this.world) return;
    const collapsed = $('panel').classList.contains('collapsed');
    if (!this.#isMobile() || collapsed) { this.world.setFramingLift(0); return; }
    const H = innerHeight;
    const bottomInset = Math.max(0, H - $('panel').getBoundingClientRect().top);
    const topInset = $('meters').getBoundingClientRect().bottom;  // lowest top overlay edge
    this.world.setFramingLift((bottomInset - topInset) / H);
  }

  // -------- interlocked setters (the "smart logic") --------
  setRake(v) {
    this.inputs.rake = v;
    for (const b of $('rake-seg').children) {
      b.classList.toggle('active', parseFloat(b.dataset.rake) === v);
    }
  }

  setStance(s) {
    const st = this.sim.lastState;
    // interlock: can't run to the back straps with no speed — you'd sink the tail instantly
    if (s === 'back' && st && st.v < 1.5 && !st.planing) {
      this.flashMsg(t('flash.noBackStraps'));
      this.#markBlocked('stance-seg', s);
      return;
    }
    this.inputs.stance = s;
    for (const b of $('stance-seg').children) b.classList.toggle('active', b.dataset.stance === s);
    // interlock: moving to the very front unhooks the harness (the lines can't reach)
    if (s === 'front' && this.inputs.harness) {
      this.setHarness(false);
      this.flashMsg(t('flash.unhookFront'));
    }
  }

  setLean(v) {
    this.inputs.lean = Math.max(0, Math.min(100, Math.round(v)));
    $('lean').value = this.inputs.lean;
    // interlock: harness needs constant tension — dropping lean below 20 unhooks you
    if (this.inputs.harness && this.inputs.lean < 20) {
      this.setHarness(false);
      this.flashMsg(t('flash.unhookUpright'));
    }
  }

  setHarness(on) {
    if (on) {
      const st = this.sim.lastState;
      // interlock: you can only hook in when the sail is actually pulling
      if (!st || st.power01 < 0.25) {
        this.flashMsg(t('flash.noPull'));
        $('harness').checked = false;
        return;
      }
      if (this.inputs.stance === 'front') {
        this.flashMsg(t('flash.hookFromMast'));
        $('harness').checked = false;
        return;
      }
      if (this.inputs.lean < 30) this.setLean(40); // hooking in commits your weight
    }
    this.inputs.harness = on;
    $('harness').checked = on;
  }

  tryTack() {
    const st = this.sim.lastState;
    if (this.sim.maneuver) return;
    if (st && Math.abs(st.beta) > 100 * DEG) {
      this.flashMsg(t('flash.tooDownwind'));
      return;
    }
    if (!this.sim.startTack()) {
      this.flashMsg(t('flash.tackNeedSpeed'));
      return;
    }
    // maneuver housekeeping: sheet out, unhook, step to neutral
    if (this.inputs.harness) this.setHarness(false);
    this.setStance('mid');
    this.setLean(15);
    this.setRake(0);
  }

  tryGybe() {
    const st = this.sim.lastState;
    if (this.sim.maneuver) return;
    if (st && Math.abs(st.beta) < 75 * DEG) {
      this.flashMsg(t('flash.gybeFromBroad'));
      return;
    }
    if (!this.sim.startGybe()) {
      this.flashMsg(t('flash.gybeNeedSpeed'));
      return;
    }
    if (this.inputs.harness) this.setHarness(false);
    this.setStance('mid');
    this.setLean(15);
    this.setRake(0);
  }

  resetInputs() {
    this.setRake(0);
    this.setStance('mid');
    this.setLean(25);
    this.inputs.sheetDeg = 55; $('sheet').value = 55;
    this.setHarness(false);
  }

  #markBlocked(segId, key) {
    for (const b of $(segId).children) {
      if (b.dataset.stance === key || b.dataset.rake === key) {
        b.classList.add('blocked');
        setTimeout(() => b.classList.remove('blocked'), 900);
      }
    }
  }

  flashMsg(msg) { this.flash = { msg, until: performance.now() + 2800 }; }

  // ---------------- keyboard ----------------
  #bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keysHeld.add(e.code);
      switch (e.code) {
        case 'Digit1': this.setStance('front'); break;
        case 'Digit2': this.setStance('mid'); break;
        case 'Digit3': this.setStance('back'); break;
        case 'KeyD': $('dagger').checked = !$('dagger').checked; this.inputs.dagger = $('dagger').checked; break;
        case 'KeyH': this.setHarness(!this.inputs.harness); break;
        case 'KeyT': this.tryTack(); break;
        case 'KeyG': this.tryGybe(); break;
        case 'KeyR': this.sim.reset(); this.resetInputs(); break;
      }
    });
    addEventListener('keyup', (e) => {
      this.keysHeld.delete(e.code);
      // arrow steering is momentary: snap rake back to neutral on release
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight')
        && !this.keysHeld.has('ArrowLeft') && !this.keysHeld.has('ArrowRight')) {
        this.setRake(0);
      }
    });
  }

  /** continuous key handling + auto-trim; call every frame before sim.update */
  tickInputs(dt, lastState) {
    const held = this.keysHeld;
    if (held.has('ArrowLeft')) this.setRake(1);    // forward → downwind
    if (held.has('ArrowRight')) this.setRake(-1);  // back → upwind
    if (held.has('KeyW')) { this.inputs.sheetDeg = Math.max(0, this.inputs.sheetDeg - 35 * dt); $('sheet').value = this.inputs.sheetDeg; }
    if (held.has('KeyS')) { this.inputs.sheetDeg = Math.min(90, this.inputs.sheetDeg + 35 * dt); $('sheet').value = this.inputs.sheetDeg; }
    if (held.has('KeyQ')) this.setLean(this.inputs.lean - 55 * dt);
    if (held.has('KeyE')) this.setLean(this.inputs.lean + 55 * dt);

    if (this.inputs.autotrim && lastState && !lastState.crashed) {
      const target = lastState.sheetOpt ?? 45;
      this.inputs.sheetDeg += (target - this.inputs.sheetDeg) * Math.min(dt * 3, 1);
      $('sheet').value = this.inputs.sheetDeg;
    }
    return this.inputs;
  }

  // ---------------- HUD ----------------
  updateHUD(st) {
    $('speed-val').textContent = st.speedKn.toFixed(1);
    $('planing-badge').classList.toggle('on', st.planing);
    $('pos-val').textContent = st.maneuver
      ? (st.maneuver.type === 'tack' ? t('man.tacking') : t('man.gybing'))
      : t(st.pointOfSailKey);
    $('tack-val').textContent = t(st.tackKey);
    $('wind-val').textContent = st.windKn.toFixed(0);
    $('gust-val').textContent = st.gustKn > 0.8
      ? t('hud.gust', { n: st.gustKn.toFixed(0), unit: t('unit.kn') })
      : '';

    // sheet readout + optimal marker
    $('sheet-val').textContent = `${Math.round(st.inputs.sheetDeg)}°`;
    $('sheet-optimal').style.left = `${(st.sheetOpt / 90) * 100}%`;
    $('lean-val').textContent = `${Math.round(st.inputs.lean)}%`;

    // power meter
    $('power-fill').style.width = `${Math.min(100, st.power01 * 100)}%`;
    const trimEl = $('trim-state');
    trimEl.textContent = { luff: t('trim.luff'), good: t('trim.good'), stall: t('trim.stall') }[st.trim] || '';
    trimEl.className = st.trim;

    // balance meter: band = required lean (with tolerance), diamond = effective lean
    const req = Math.min(1.25, st.required01 || 0);
    const band = $('required-band');
    band.style.left = `${Math.max(0, (req - 0.3) / 1.3) * 100}%`;
    band.style.width = `${(0.6 / 1.3) * 100}%`;
    $('lean-marker').style.left = `${Math.min(1.3, st.eff01 || 0) / 1.3 * 100}%`;
    $('lean-marker').style.background = st.danger > 0.4 ? '#ff7043' : '#4fc3f7';

    // hint bar: flash messages take priority, then sim warnings
    const hintEl = $('hint-text');
    if (performance.now() < this.flash.until) {
      hintEl.textContent = this.flash.msg;
      hintEl.classList.remove('warn');
    } else if (st.warnings.length) {
      hintEl.textContent = t(st.warnings[0]);
      hintEl.classList.toggle('warn', st.danger > 0.25);
    } else {
      hintEl.textContent = '';
      hintEl.classList.remove('warn');
    }

    // crash overlay
    const ov = $('crash-overlay');
    ov.classList.toggle('on', st.crashed);
    if (st.crashed) {
      $('crash-reason').textContent = t(st.crashReason);
      $('crash-lesson').textContent = t(st.crashLesson);
      $('crash-timer').textContent = t('crash.timer', { n: Math.max(0, st.crashTimer).toFixed(0) });
    }

    // action buttons enabled state
    $('btn-tack').disabled = !!st.maneuver || st.crashed;
    $('btn-gybe').disabled = !!st.maneuver || st.crashed;

    this.#drawCompass(st);
  }

  #drawCompass(st) {
    const ctx = this.compassCtx;
    const S = 120, c = S / 2, R = 48;
    ctx.clearRect(0, 0, S, S);

    // ring
    ctx.strokeStyle = 'rgba(143,184,212,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();

    // screen mapping: world angle a (0 = +Z = up on compass, increasing toward +X = left)
    const pt = (a, r) => [c - Math.sin(a) * r, c - Math.cos(a) * r];

    // no-go zone wedge around wind-from
    const wa = st.windFromAngle;
    ctx.fillStyle = 'rgba(255,112,67,0.18)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const a = wa - 45 * DEG + (90 * DEG * i) / steps;
      const [x, y] = pt(a, R);
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();

    // wind arrow (points DOWNWIND, from the edge toward centre)
    const [wx, wy] = pt(wa, R + 8);
    const [wx2, wy2] = pt(wa, R - 14);
    ctx.strokeStyle = '#ffd54f'; ctx.fillStyle = '#ffd54f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx2, wy2); ctx.stroke();
    const ah = Math.atan2(wx2 - wx, wy2 - wy);
    ctx.beginPath();
    ctx.moveTo(wx2, wy2);
    ctx.lineTo(wx2 - Math.sin(ah - 0.4) * 8, wy2 - Math.cos(ah - 0.4) * 8);
    ctx.lineTo(wx2 - Math.sin(ah + 0.4) * 8, wy2 - Math.cos(ah + 0.4) * 8);
    ctx.closePath(); ctx.fill();
    ctx.font = '9px monospace';
    ctx.fillText('WIND', wx - 12 + (wx < c ? -14 : 6), wy + (wy < c ? -4 : 10));

    // board heading triangle
    const h = st.heading;
    const [nx, ny] = pt(h, 20);
    const [t1x, t1y] = pt(h + 150 * DEG, 12);
    const [t2x, t2y] = pt(h - 150 * DEG, 12);
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(t1x, t1y); ctx.lineTo(t2x, t2y); ctx.closePath(); ctx.fill();

    // boom line (sail direction, to leeward)
    const side = st.beta >= 0 ? 1 : -1;
    const boomA = h + Math.PI + side * (st.inputs.sheetDeg || 45) * DEG; // aft, swung leeward
    const [sx, sy] = pt(boomA, 26);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(sx, sy); ctx.stroke();
  }
}
