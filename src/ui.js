// HUD, control panel, keyboard bindings and "smart interlock" rules.

import { t, setLang, getLang, onLangChange } from './i18n.js';
import { DemoDirector } from './demo.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const KMH = 1.852; // knots -> km/h
// keys that count as "taking the controls" (they end a running demo)
const GAME_KEYS = new Set([
  'Digit1', 'Digit2', 'Digit3', 'KeyW', 'KeyS', 'KeyQ', 'KeyE',
  'KeyD', 'KeyH', 'KeyT', 'KeyG', 'KeyR', 'ArrowLeft', 'ArrowRight',
]);

function loadUnits() {
  try { const u = localStorage.getItem('ws_units'); if (u === 'kn' || u === 'kmh') return u; } catch { /* ignore */ }
  return 'kmh'; // km/h by default
}

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
      autotrim: true,   // beginner assist on by default (full autopilot)
    };
    this.units = loadUnits();
    this.keysHeld = new Set();
    this.flash = { msg: '', until: 0 };

    // guided demo: an auto-tour director that steers while autotrim flies the rig
    this.demo = new DemoDirector(sim, this);
    this.demo.onCaption = (text) => this.#showCaption(text);
    this.demo.onState = (mode) => this.#setDemoState(mode);

    this.#bindPanel();
    this.#bindSettings();
    this.#bindDemo();
    this.#bindKeys();
    this.#bindCrashHold();
    this.compassCtx = $('compass').getContext('2d');

    // keep the framing centred if the viewport changes (rotate / URL bar)
    addEventListener('resize', () => this.#applyFramingLift());

    // Static markup (incl. the windset readout) is re-templated on language
    // change; re-sync the readouts that aren't refreshed every frame.
    onLangChange(() => {
      this.#refreshWindReadout();
      this.#syncLangButtons();
      this.demo.refresh();   // re-render the live caption in the new language
    });
  }

  // Speed conversion + unit label follow the current unit choice.
  #conv(kn) { return this.units === 'kmh' ? kn * KMH : kn; }
  #unitLabel() { return t(this.units === 'kmh' ? 'unit.kmh' : 'unit.kn'); }

  #refreshWindReadout() {
    // Read the actual base wind (m/s) so the label is exact even when it doesn't
    // land on a whole knot (e.g. 10 km/h ≈ 5.4 kn).
    const kn = this.sim.baseWind * 1.94384;
    $('windset-val').textContent = `${this.#conv(kn).toFixed(0)} ${this.#unitLabel()}`;
  }

  #syncLangButtons() {
    const cur = getLang();
    for (const b of $('lang-seg').children) b.classList.toggle('active', b.dataset.lang === cur);
  }

  // ---------------- panel bindings ----------------
  #bindPanel() {
    $('sheet').addEventListener('input', (e) => {
      this.#takeManualControl();          // grabbing the boom switches the assist off
      this.inputs.sheetDeg = +e.target.value;
    });
    $('autotrim').addEventListener('change', (e) => { this.inputs.autotrim = e.target.checked; });
    $('autotrim').checked = this.inputs.autotrim; // reflect the default (on)

    $('rake-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setRake(parseFloat(b.dataset.rake));
    });

    $('stance-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setStance(b.dataset.stance, true);
    });

    $('lean').addEventListener('input', (e) => { this.#takeManualControl(); this.setLean(+e.target.value); });

    $('dagger').addEventListener('change', (e) => { this.#takeManualControl(); this.inputs.dagger = e.target.checked; });

    $('harness').addEventListener('change', (e) => this.setHarness(e.target.checked));

    $('btn-tack').addEventListener('click', () => this.tryTack());
    $('btn-gybe').addEventListener('click', () => this.tryGybe());
    $('btn-reset').addEventListener('click', () => { this.sim.reset(); this.resetInputs(); });

    $('windset').addEventListener('input', (e) => {
      this.sim.baseWind = (+e.target.value) / 1.94384;
      this.#refreshWindReadout();
    });

    $('welcome-close').addEventListener('click', () => {
      $('welcome-overlay').classList.add('off');
      try { localStorage.setItem('ws_welcomeSeen', '1'); } catch (e) {} // don't show again next time
    });

    // "How to play" (in settings) reopens the how-to on demand
    $('info-toggle').addEventListener('click', () => {
      $('welcome-overlay').classList.remove('off');
      $('settings-panel').classList.add('off');
      $('settings-toggle').classList.remove('open');
    });

    // tapping anywhere on the header toggles — a bigger, touch-friendly target
    $('panel').querySelector('.panel-header').addEventListener('click', () => {
      this.setPanelCollapsed(!$('panel').classList.contains('collapsed'));
    });

    // Phone defaults: light wind (10 km/h), controls open from the start.
    if (this.#isMobile()) {
      this.sim.baseWind = 10 / 3.6;                 // 10 km/h — a gentle start
      $('windset').value = 5;                       // nearest whole knot for the thumb
      this.#refreshWindReadout();
      this.setPanelCollapsed(false);
    }
  }

  // ---------------- settings popover ----------------
  #bindSettings() {
    const panel = $('settings-panel');
    const btn = $('settings-toggle');
    const open = () => { panel.classList.remove('off'); btn.classList.add('open'); };
    const close = () => { panel.classList.add('off'); btn.classList.remove('open'); };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.contains('off') ? open() : close();
    });
    $('settings-close').addEventListener('click', close);
    // tap outside the popover closes it
    addEventListener('click', (e) => {
      if (!panel.classList.contains('off') && !panel.contains(e.target) && !btn.contains(e.target)) close();
    });

    $('units-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.setUnits(b.dataset.units);
    });

    $('lang-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      setLang(b.dataset.lang);
    });

    // initial state
    this.setUnits(this.units);
    this.#syncLangButtons();
    this.#refreshWindReadout();
  }

  setUnits(u) {
    this.units = (u === 'kn') ? 'kn' : 'kmh';
    try { localStorage.setItem('ws_units', this.units); } catch { /* ignore */ }
    for (const b of $('units-seg').children) b.classList.toggle('active', b.dataset.units === this.units);
    this.#refreshWindReadout();
  }

  // ---------------- guided demo ----------------
  #bindDemo() {
    const panel = $('demo-panel');
    const btn = $('demo-toggle');
    const open = () => {
      panel.classList.remove('off'); btn.classList.add('open');
      $('settings-panel').classList.add('off'); $('settings-toggle').classList.remove('open');
    };
    const close = () => { panel.classList.add('off'); btn.classList.remove('open'); };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.contains('off') ? open() : close();
    });
    $('demo-close').addEventListener('click', close);
    // tap outside the popover closes it
    addEventListener('click', (e) => {
      if (!panel.classList.contains('off') && !panel.contains(e.target) && !btn.contains(e.target)) close();
    });

    for (const b of panel.querySelectorAll('.demo-mode')) {
      b.addEventListener('click', () => { this.demo.start(b.dataset.mode); close(); });
    }
    $('demo-stop').addEventListener('click', () => { this.demo.stop(); close(); });

    // Any hands-on control ends the demo — like touching the wheel on cruise
    // control. Capture phase so it fires before the control's own handler. The
    // wind slider is exempt: the user may retune the (stable) wind mid-demo.
    $('panel').addEventListener('pointerdown', (e) => {
      if (e.target.closest('#windset')) return;
      this.demo.stop();
    }, true);
  }

  // Reflect the demo's live state on the button, popover and caption banner.
  #setDemoState(mode) {
    $('demo-toggle').classList.toggle('active', !!mode);
    $('demo-panel').classList.toggle('running', !!mode);
    for (const b of $('demo-panel').querySelectorAll('.demo-mode')) {
      b.classList.toggle('active', b.dataset.mode === mode);
    }
    $('demo-tag').textContent = mode ? t(`demo.mode.${mode}`) : '';
  }

  #showCaption(text) {
    const el = $('demo-caption');
    if (text) { $('demo-cap').textContent = text; el.classList.remove('off'); }
    else { el.classList.add('off'); }
  }

  // Turn the beginner autopilot on/off (used by the demo director).
  setAutotrim(on) {
    this.inputs.autotrim = !!on;
    $('autotrim').checked = this.inputs.autotrim;
  }

  // Keep the wind slider + readout in step with a scripted wind change.
  syncWindControl() {
    const kn = this.sim.baseWind * 1.94384;
    $('windset').value = Math.round(kn);
    this.#refreshWindReadout();
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

  // Press-and-hold the crash popup to read it: holding freezes the recovery
  // countdown; releasing recovers immediately and starts a fresh run.
  #bindCrashHold() {
    const ov = $('crash-overlay');
    const hold = (e) => {
      if (!this.sim.crashed) return;
      this.sim.recoverHold = true;
      e.preventDefault();
    };
    const release = () => {
      if (!this.sim.recoverHold) return;
      this.sim.recoverHold = false;
      if (this.sim.crashed) this.sim.recover();   // release -> back on the board
    };
    ov.addEventListener('pointerdown', hold);
    ov.addEventListener('pointerup', release);
    ov.addEventListener('pointercancel', release);
    // iOS starts a text selection / magnifier on long-press; suppress its default
    ov.addEventListener('touchstart', (e) => { if (this.sim.crashed) e.preventDefault(); }, { passive: false });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------- interlocked setters (the "smart logic") --------
  setRake(v) {
    this.inputs.rake = v;
    for (const b of $('rake-seg').children) {
      b.classList.toggle('active', parseFloat(b.dataset.rake) === v);
    }
  }

  setStance(s, userInitiated = false) {
    const st = this.sim.lastState;
    // interlock: can't run to the back straps with no speed — you'd sink the tail instantly
    if (s === 'back' && st && st.v < 1.5 && !st.planing) {
      this.flashMsg(t('flash.noBackStraps'));
      this.#markBlocked('stance-seg', s);
      return;
    }
    if (userInitiated) this.#takeManualControl(); // else the autopilot overrides it right back
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
    if (this.sim.maneuver) return;
    // The sim now auto-steers to the entry angle, so we only block when it is
    // truly impossible: no way on, or pointing downwind (gybe territory).
    const res = this.sim.startTack();
    if (!res.ok) {
      if (res.reason === 'downwind') this.flashMsg(t('flash.tooDownwind'));
      else if (res.reason === 'slow') this.flashMsg(t('flash.tackNeedSpeed'));
      return;
    }
    // maneuver housekeeping: sheet out, unhook, step to neutral
    if (this.inputs.harness) this.setHarness(false);
    this.setStance('mid');
    this.setLean(15);
    this.setRake(0);
  }

  tryGybe() {
    if (this.sim.maneuver) return;
    const res = this.sim.startGybe();
    if (!res.ok) {
      if (res.reason === 'upwind') this.flashMsg(t('flash.tooUpwind'));
      else if (res.reason === 'slow') this.flashMsg(t('flash.gybeNeedSpeed'));
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

  flashMsg(msg) { this.flash = { msg, until: performance.now() + 3300 }; this.#showToast(msg); }

  // Hand control back to the player: any manual input on a control the autopilot
  // manages switches the assist off (so the tap actually sticks) and says so.
  #takeManualControl() {
    if (!this.inputs.autotrim) return;
    this.inputs.autotrim = false;
    $('autotrim').checked = false;
    this.flashMsg(t('flash.manual'));
  }

  // Transient toast explaining why an action was blocked (or a state change).
  // On phones it floats just above the control sheet so it isn't hidden behind
  // it; on desktop it sits low-centre. Fades after a moment or on the next tap.
  #showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    if (this.#isMobile()) {
      const panelTop = $('panel').getBoundingClientRect().top;
      el.style.bottom = `${Math.round(innerHeight - panelTop + 10)}px`;
    } else {
      el.style.bottom = ''; // fall back to the CSS position
    }
    el.classList.add('on');

    clearTimeout(this._toastTimer);
    const hide = () => { el.classList.remove('on'); clearTimeout(this._toastTimer); };
    this._toastTimer = setTimeout(hide, 3300);
    // dismiss on the next interaction — deferred so the triggering tap doesn't count
    setTimeout(() => addEventListener('pointerdown', hide, { once: true }), 0);
  }

  // ---------------- keyboard ----------------
  #bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keysHeld.add(e.code);
      // any gameplay key hands control back to the player and ends the demo
      if (this.demo.running && GAME_KEYS.has(e.code)) this.demo.stop();
      switch (e.code) {
        case 'Digit1': this.setStance('front', true); break;
        case 'Digit2': this.setStance('mid', true); break;
        case 'Digit3': this.setStance('back', true); break;
        case 'KeyD': this.#takeManualControl(); $('dagger').checked = !$('dagger').checked; this.inputs.dagger = $('dagger').checked; break;
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
    // guided demo drives the steering + wind while autotrim flies the rig
    if (this.demo.running) this.demo.tick(dt, lastState);
    const held = this.keysHeld;
    // touching the sheet/lean keys takes over from the autopilot (arrows just steer)
    if (this.inputs.autotrim
      && (held.has('KeyW') || held.has('KeyS') || held.has('KeyQ') || held.has('KeyE'))) {
      this.#takeManualControl();
    }
    if (held.has('ArrowLeft')) this.setRake(1);    // forward → downwind
    if (held.has('ArrowRight')) this.setRake(-1);  // back → upwind
    if (held.has('KeyW')) { this.inputs.sheetDeg = Math.max(0, this.inputs.sheetDeg - 35 * dt); $('sheet').value = this.inputs.sheetDeg; }
    if (held.has('KeyS')) { this.inputs.sheetDeg = Math.min(90, this.inputs.sheetDeg + 35 * dt); $('sheet').value = this.inputs.sheetDeg; }
    if (held.has('KeyQ')) this.setLean(this.inputs.lean - 55 * dt);
    if (held.has('KeyE')) this.setLean(this.inputs.lean + 55 * dt);

    if (this.inputs.autotrim && lastState && !lastState.crashed) {
      // Full beginner autopilot: keep the rig, the rider's weight, the
      // daggerboard and the stance all managed so a passive sailor cruises (and
      // even planes) without ever being flung off. You just steer with the
      // arrows; turn it off to practise real balance yourself.
      const clamp01 = (v, a, b) => Math.max(a, Math.min(b, v));

      // 1) sheet -> the optimal boom angle for clean, maximum drive.
      const target = lastState.sheetOpt ?? 45;
      this.inputs.sheetDeg += (target - this.inputs.sheetDeg) * Math.min(dt * 3, 1);
      $('sheet').value = this.inputs.sheetDeg;

      // 2) lean -> hang exactly as hard as the sail pulls, a touch over, to sit
      //    in the safe band between catapult (sail wins) and back-fall (you win).
      const boost = this.inputs.harness ? 1.38 : 1.0;
      const wantLean = clamp01(((lastState.required01 ?? 0) + 0.12) / boost * 100, 0, 100);
      this.inputs.lean += (wantLean - this.inputs.lean) * Math.min(dt * 5, 1);
      this.inputs.lean = clamp01(this.inputs.lean, 0, 100);
      $('lean').value = Math.round(this.inputs.lean);

      // 3) daggerboard -> down for grip while displacing, retracted the instant
      //    you plane (a lowered board rails over and spins out at speed).
      this.inputs.dagger = !lastState.planing;
      $('dagger').checked = this.inputs.dagger;

      // 4) stance -> into the back straps once planing (less drag, no nose-dive),
      //    neutral otherwise.
      this.inputs.stance = lastState.planing ? 'back' : 'mid';
      for (const b of $('stance-seg').children) {
        b.classList.toggle('active', b.dataset.stance === this.inputs.stance);
      }
    }
    return this.inputs;
  }

  // ---------------- HUD ----------------
  updateHUD(st) {
    const unit = this.#unitLabel();
    $('speed-val').textContent = this.#conv(st.speedKn).toFixed(1);
    $('speed-unit').textContent = unit;
    $('planing-badge').classList.toggle('on', st.planing);
    $('pos-val').textContent = st.maneuver
      ? (st.maneuver.type === 'tack' ? t('man.tacking') : t('man.gybing'))
      : t(st.pointOfSailKey);
    $('tack-val').textContent = t(st.tackKey);
    $('wind-val').textContent = this.#conv(st.windKn).toFixed(0);
    $('wind-unit').textContent = unit;
    $('gust-val').textContent = st.gustKn > 0.8
      ? t('hud.gust', { n: this.#conv(st.gustKn).toFixed(0), unit })
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

    // hint bar: sim coaching warnings (flash/interlock messages go to the toast)
    const hintEl = $('hint-text');
    if (st.warnings.length) {
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
      // hold to keep reading; release to sail again (see #bindCrashHold)
      $('crash-timer').textContent = this.sim.recoverHold
        ? t('crash.release')
        : `${t('crash.timer', { n: Math.max(0, st.crashTimer).toFixed(0) })}  ·  ${t('crash.hold')}`;
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

    // ---- board (top-down windsurfer silhouette) ----
    const h = st.heading;
    const side = st.beta >= 0 ? 1 : -1;
    const sheet = (st.inputs.sheetDeg || 45) * DEG;

    // Drawn in a frame rotated to the heading: nose points to -y (up), tail +y.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-h);

    ctx.beginPath();
    ctx.moveTo(0, -26);                          // pointed nose
    ctx.bezierCurveTo(6, -20, 8, -2, 6.5, 10);   // right rail
    ctx.quadraticCurveTo(5.5, 20, 0, 21);        // rounded tail
    ctx.quadraticCurveTo(-5.5, 20, -6.5, 10);
    ctx.bezierCurveTo(-8, -2, -6, -20, 0, -26);  // left rail back to nose
    ctx.closePath();
    ctx.fillStyle = 'rgba(79,195,247,0.28)';
    ctx.fill();
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.6; ctx.stroke();

    // centre stringer
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, 18);
    ctx.strokeStyle = 'rgba(79,195,247,0.5)'; ctx.lineWidth = 1; ctx.stroke();

    // foot-strap ticks near the tail
    ctx.strokeStyle = 'rgba(232,244,253,0.7)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-4.6, 10.5); ctx.lineTo(-1.6, 12.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4.6, 10.5); ctx.lineTo(1.6, 12.5); ctx.stroke();

    // fin off the tail
    ctx.beginPath(); ctx.moveTo(0, 21); ctx.lineTo(0, 26);
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.4; ctx.stroke();

    ctx.restore();

    // ---- rig: mast stepped forward, sail bellied to leeward, tinted by trim ----
    const [mx, my] = pt(h, 8);                   // mast base, forward of centre
    const boomA = h + Math.PI + side * sheet;    // clew swings aft + leeward
    const clx = mx - Math.sin(boomA) * 30;
    const cly = my - Math.cos(boomA) * 30;
    const bellyA = boomA + side * 55 * DEG;       // bow the cloth to leeward
    const bx = mx - Math.sin(bellyA) * 20;
    const by = my - Math.cos(bellyA) * 20;

    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(bx, by, clx, cly);
    ctx.closePath();
    ctx.fillStyle = st.trim === 'good' ? 'rgba(102,187,106,0.35)'
      : st.trim === 'stall' ? 'rgba(255,112,67,0.35)'
        : 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo(bx, by, clx, cly); ctx.stroke();

    // mast base dot
    ctx.fillStyle = '#e8f4fd';
    ctx.beginPath(); ctx.arc(mx, my, 2.2, 0, Math.PI * 2); ctx.fill();
  }
}
