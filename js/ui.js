/* Input handling + mode logic + DOM state */
(function (KO) {
  const fmtPct = (v) => Math.round(v * 100) + '';
  KO.SOUND_PARAMS = {
    vol: { key: 'vol', name: 'LEVEL', fmt: fmtPct, bar: (v) => v, step: 0.01, min: 0, max: 1 },
    pit: { key: 'pit', name: 'PITCH', fmt: (v) => (v > 0 ? '+' : '') + (Math.abs(v % 1) > 0.001 ? v.toFixed(1) : v.toFixed(0)), bar: (v) => (v + 24) / 48, step: 1, fine: 0.1, min: -24, max: 24 },
    pan: { key: 'pan', name: 'PAN', fmt: (v) => Math.abs(v) < 0.01 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100), bar: (v) => (v + 1) / 2, step: 0.02, min: -1, max: 1 },
    atk: { key: 'atk', name: 'ATTACK', fmt: (v) => Math.round(v * 1500) + 'ms', bar: (v) => v, step: 0.005, min: 0, max: 1 },
    rel: { key: 'rel', name: 'RELEASE', fmt: (v) => Math.round(Math.max(0.005, v * 3) * 1000) + 'ms', bar: (v) => v, step: 0.005, min: 0, max: 1 },
    st: { key: 'st', name: 'START', fmt: fmtPct, bar: (v) => v, step: 0.005, min: 0, max: 0.99 },
    en: { key: 'en', name: 'END', fmt: fmtPct, bar: (v) => v, step: 0.005, min: 0.01, max: 1 },
    mode: { key: 'mode', name: 'PLAY MODE', fmt: (v) => v, enumOf: KO.PLAY_MODES },
    choke: { key: 'choke', name: 'CHOKE GRP', fmt: (v) => v ? String(v) : 'OFF', enumOf: [0, 1, 2, 3, 4] },
    rev: { key: 'rev', name: 'REVERSE', fmt: (v) => v ? 'ON' : 'OFF', enumOf: [false, true] },
  };
  KO.SOUND_PAGES = [['vol', 'pit'], ['pan', 'mode'], ['atk', 'rel'], ['st', 'en'], ['choke', 'rev']];

  const KEYMAP = {
    Digit7: 'p9', Digit8: 'p10', Digit9: 'p11', KeyU: 'p6', KeyI: 'p7', KeyO: 'p8', KeyJ: 'p3', KeyK: 'p4', KeyL: 'p5', KeyM: 'p0', Comma: 'p1', Period: 'p2',
    Numpad7: 'p9', Numpad8: 'p10', Numpad9: 'p11', Numpad4: 'p6', Numpad5: 'p7', Numpad6: 'p8', Numpad1: 'p3', Numpad2: 'p4', Numpad3: 'p5', NumpadDecimal: 'p0', Numpad0: 'p1', NumpadEnter: 'p2',
    Digit1: 'grp0', Digit2: 'grp1', Digit3: 'grp2', Digit4: 'grp3',
    Space: 'play', KeyR: 'record', ShiftLeft: 'shift', ShiftRight: 'shift', Backspace: 'erase', Delete: 'erase',
    KeyQ: 'sound', KeyW: 'main', KeyE: 'tempo', KeyT: 'fader', KeyY: 'copy', BracketLeft: 'minus', BracketRight: 'plus',
    KeyF: 'fx', KeyG: 'keys', KeyH: 'timing', KeyB: 'sample',
  };
  const KNOBKEYS = { KeyZ: ['x', -1], KeyX: ['x', 1], KeyC: ['y', -1], KeyV: ['y', 1] };
  const PAD_KEYS = ['M', ',', '.', 'J', 'K', 'L', 'U', 'I', 'O', '7', '8', '9'];

  class UI {
    constructor(app) {
      this.app = app;
      this.mode = 'main';
      this.group = 0;
      this.held = {};
      this.popup = null;
      this.soundPage = 0;
      this.stepBar = 0; this.stepCursor = 0;
      this.copySrc = null;
      this.sampleSrc = 'mic'; this.sampleGain = 1; this.sampleTarget = 0; this.micError = '';
      this.punchHeld = {};
      this.padState = {};
      this.hitUntil = new Array(12).fill(0);
      this.enumAcc = { x: 0, y: 0 };
      this.taps = [];
      this.velMode = KO.Store.getSetting('velMode', 'fixed');
      this.cache = new Map();
    }

    /* ================= DOM setup ================= */
    build() {
      const padsEl = document.getElementById('pads');
      this.padEls = [];
      KO.PAD_LAYOUT.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'pad'; b.dataset.pad = p; b.dataset.key = PAD_KEYS[p];
        const lab = KO.PAD_LABELS[p];
        b.innerHTML = `<span class="num${lab === 'ENTER' ? ' ent' : ''}">${lab}</span><span class="sub"></span><span class="dot"></span>`;
        padsEl.appendChild(b);
        this.padEls[p] = b;
      });
      this.btnEls = {};
      document.querySelectorAll('[data-btn]').forEach((el) => (this.btnEls[el.dataset.btn] = el));

      // pointer input for pads & buttons (multi-touch)
      const active = new Map();
      const down = (e) => {
        const el = e.target.closest('[data-btn],[data-pad]');
        if (!el) return;
        e.preventDefault();
        this.app.unlock();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        active.set(e.pointerId, el);
        el.classList.add('down');
        if (el.dataset.pad !== undefined) {
          const r = el.getBoundingClientRect();
          const vel = this.velMode === 'position' ? KO.clamp(0.25 + 0.75 * (1 - (e.clientY - r.top) / r.height), 0.1, 1) : null;
          this.padDown(+el.dataset.pad, vel);
        } else this.btnDown(el.dataset.btn);
      };
      const up = (e) => {
        const el = active.get(e.pointerId); if (!el) return;
        active.delete(e.pointerId);
        // another pointer may still hold the same element
        for (const v of active.values()) if (v === el) return;
        el.classList.remove('down');
        if (el.dataset.pad !== undefined) this.padUp(+el.dataset.pad); else this.btnUp(el.dataset.btn);
      };
      const dev = document.getElementById('device');
      dev.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      dev.addEventListener('contextmenu', (e) => e.preventDefault());

      this.setupKnobs();
      this.setupFader();
      this.setupDisplay();
      this.setupKeyboard();
    }

    setupKnobs() {
      this.knobAngle = { x: 0, y: 0 };
      document.querySelectorAll('.knob').forEach((el) => {
        const which = el.dataset.knob;
        let last = null, acc = 0;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation(); this.app.unlock();
          el.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY }; acc = 0; el.classList.add('active');
        });
        el.addEventListener('pointermove', (e) => {
          if (!last) return;
          acc += (last.y - e.clientY) + (e.clientX - last.x) * 0.6;
          last = { x: e.clientX, y: e.clientY };
          const th = 5;
          while (Math.abs(acc) >= th) { const s = Math.sign(acc); acc -= s * th; this.knob(which, s); }
        });
        const end = () => { last = null; el.classList.remove('active'); };
        el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
        el.addEventListener('wheel', (e) => { e.preventDefault(); this.knob(which, e.deltaY < 0 ? 1 : -1); }, { passive: false });
      });
    }

    setupFader() {
      const el = document.getElementById('fader'), track = el.querySelector('.fader-track');
      let on = false;
      const set = (e) => {
        const r = track.getBoundingClientRect();
        this.app.setFader(KO.clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
      };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.app.unlock(); el.setPointerCapture(e.pointerId); on = true; set(e); });
      el.addEventListener('pointermove', (e) => on && set(e));
      el.addEventListener('pointerup', () => (on = false));
      el.addEventListener('pointercancel', () => (on = false));
      el.addEventListener('wheel', (e) => { e.preventDefault(); this.app.nudgeFader(e.deltaY < 0 ? 0.03 : -0.03); }, { passive: false });
    }

    setupDisplay() {
      const cv = document.getElementById('lcd');
      cv.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); this.app.unlock();
        const pt = this.app.display.toLogical(e.clientX, e.clientY);
        const scr = this.screen();
        if (scr === 'step') {
          for (let i = 0; i < 16; i++) {
            const x = 8 + (i % 8) * 38.5, y = 46 + Math.floor(i / 8) * 46;
            if (pt.x >= x && pt.x <= x + 36 && pt.y >= y && pt.y <= y + 42) { this.stepCursor = i; this.toggleStep(i); return; }
          }
        } else if (scr === 'main') {
          for (let gi = 0; gi < 4; gi++) if (pt.y >= 26 + gi * 24 && pt.y < 50 + gi * 24) { this.selectGroup(gi); return; }
        } else if (scr === 'sound') {
          if (pt.y > 40 && pt.y < 104) this.app.previewSel();
        }
      });
    }

    setupKeyboard() {
      const overlayOpen = () => document.querySelector('.overlay.show');
      window.addEventListener('keydown', (e) => {
        if (overlayOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
        const k = KNOBKEYS[e.code];
        if (k) { e.preventDefault(); this.app.unlock(); this.knob(k[0], k[1]); return; }
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); this.app.nudgeFader(e.code === 'ArrowUp' ? 0.05 : -0.05); return; }
        const m = KEYMAP[e.code]; if (!m) return;
        e.preventDefault(); if (e.repeat) return;
        this.app.unlock();
        if (/^p\d/.test(m)) { this.padEls[+m.slice(1)].classList.add('down'); this.padDown(+m.slice(1), null); }
        else { this.btnEls[m] && this.btnEls[m].classList.add('down'); this.btnDown(m); }
      });
      window.addEventListener('keyup', (e) => {
        const m = KEYMAP[e.code]; if (!m) return;
        e.preventDefault();
        if (/^p\d/.test(m)) { this.padEls[+m.slice(1)].classList.remove('down'); this.padUp(+m.slice(1)); }
        else { this.btnEls[m] && this.btnEls[m].classList.remove('down'); this.btnUp(m); }
      });
      window.addEventListener('blur', () => {
        Object.keys(this.padState).forEach((p) => this.padUp(+p));
        Object.keys(this.held).forEach((b) => this.btnUp(b));
        document.querySelectorAll('.down').forEach((el) => el.classList.remove('down'));
      });
    }

    /* ================= helpers ================= */
    get P() { return this.app.proj; }
    get grp() { return this.app.proj.groups[this.group]; }
    show(title, value, ms) { this.popup = { title, value: String(value), until: performance.now() + (ms || 900) }; }
    heldGroup() { for (let i = 0; i < 4; i++) if (this.held['grp' + i]) return i; return -1; }

    screen() {
      const H = this.held, now = performance.now();
      if (this.heldGroup() >= 0 && this.mode !== 'copy') return 'pattern';
      if (H.fx && (Object.keys(this.punchHeld).length || now - H.fx.t > 220)) return 'punch';
      if (H.erase && now - H.erase.t > 220) return 'erase';
      if (H.shift && !H.shift.used && now - H.shift.t > 350 && this.mode === 'main') return 'shift';
      return this.mode;
    }

    setMode(m) {
      if (this.mode === m) return;
      if (this.mode === 'sample') { this.app.engine.closeMic(); }
      this.mode = m;
      if (m === 'sample') this.prepareMic();
      if (m === 'copy') this.copySrc = null;
    }
    toggleMode(m) { this.setMode(this.mode === m ? 'main' : m); }

    selectGroup(gi) {
      this.group = gi;
      this.app.applyFaderUI();
    }

    async prepareMic() {
      this.micError = '';
      if (this.sampleSrc !== 'mic') return true;
      try { await this.app.engine.openMic(); this.app.engine.micGain.gain.value = this.sampleGain; return true; }
      catch (e) { this.micError = (e && e.name === 'NotAllowedError') ? 'MIC PERMISSION DENIED' : 'MIC UNAVAILABLE (USE HTTPS)'; return false; }
    }

    /* ================= buttons ================= */
    btnDown(name) {
      const H = this.held, shift = !!H.shift, app = this.app, P = this.P;
      H[name] = { t: performance.now(), used: false, shift };
      if (name !== 'shift' && H.shift) H.shift.used = true;

      if (name.startsWith('grp')) {
        const gi = +name[3];
        if (shift) { P.groups[gi].mute = !P.groups[gi].mute; app.engine.applyGroup(gi, P.groups[gi]); this.show('GROUP ' + KO.GROUPS[gi], P.groups[gi].mute ? 'MUTED' : 'UNMUTED'); app.dirty(); return; }
        if (H.erase) { H.erase.used = true; app.clearPattern(gi); this.show('CLEAR ' + KO.GROUPS[gi] + KO.pad2(P.scenes[P.scene].pat[gi]), 'ERASED'); return; }
        if (this.mode === 'copy') { this.selectGroup(gi); return; }
        this.selectGroup(gi);
        return;
      }
      switch (name) {
        case 'shift': break;
        case 'play': if (shift) app.toggleSong(); else app.togglePlay(); break;
        case 'record':
          if (this.mode === 'step') { this.toggleStep(this.stepCursor); break; }
          app.toggleRecord(); break;
        case 'erase': if (shift) { H.erase.used = true; app.undo(); } break;
        case 'sound': this.setMode(shift ? (this.mode === 'browse' ? 'main' : 'browse') : (this.mode === 'sound' ? 'main' : 'sound')); break;
        case 'main': this.setMode(shift ? (this.mode === 'project' ? 'main' : 'project') : 'main'); break;
        case 'tempo':
          if (shift) { P.metronome = !P.metronome; this.show('METRONOME', P.metronome ? 'ON' : 'OFF'); app.dirty(); break; }
          if (this.mode === 'tempo') this.tapTempo(); else { this.taps = [performance.now()]; this.setMode('tempo'); }
          break;
        case 'fader': this.toggleMode('fader'); break;
        case 'copy':
          if (shift) { app.duplicatePattern(this.group); break; }
          this.toggleMode('copy'); break;
        case 'minus': this.inc(-1); break;
        case 'plus': this.inc(1); break;
        case 'keys': {
          const g = this.grp; g.keys = !g.keys; this.show('KEYS ' + KO.GROUPS[this.group], g.keys ? 'ON' : 'OFF'); app.dirty(); break;
        }
        case 'timing': if (shift) this.toggleMode('step'); break;
        case 'sample': if (shift) { H.sample.used = true; app.importAudio(); } break;
        case 'fx': break;
      }
    }

    btnUp(name) {
      const h = this.held[name]; if (!h) return;
      delete this.held[name];
      if (name === 'timing') this.app.seq.repeats.clear();
      if (h.used || h.shift) return;
      switch (name) {
        case 'fx': this.toggleMode('fx'); break;
        case 'timing': this.toggleMode('timing'); break;
        case 'sample': this.toggleMode('sample'); break;
      }
    }

    tapTempo() {
      const now = performance.now();
      if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
      this.taps.push(now);
      if (this.taps.length > 5) this.taps.shift();
      if (this.taps.length >= 3) {
        let s = 0; for (let i = 1; i < this.taps.length; i++) s += this.taps[i] - this.taps[i - 1];
        const bpm = Math.round(600 / (s / (this.taps.length - 1) / 1000)) / 10;
        this.app.setBpm(bpm);
        this.show('TAP TEMPO', this.P.bpm.toFixed(1));
      }
    }

    /* ================= −/+ ================= */
    inc(d) {
      const app = this.app, P = this.P, g = this.grp;
      const gh = this.heldGroup();
      if (gh >= 0) {
        this.held['grp' + gh].used = true;
        const cur = P.scenes[P.scene].pat[gh];
        app.setPattern(gh, KO.clamp(cur + d, 1, 99));
        return;
      }
      switch (this.mode) {
        case 'sound': this.soundPage = KO.mod(this.soundPage + d, KO.SOUND_PAGES.length); break;
        case 'browse': this.browse(d); break;
        case 'fx': P.fx.type = KO.mod(P.fx.type + d, KO.FX_TYPES.length); app.engine.setFx(P.fx); app.dirty(); break;
        case 'tempo': app.setBpm(P.bpm + d); break;
        case 'timing': P.quant = KO.clamp(P.quant + d, 0, KO.QUANT.length - 1); app.dirty(); break;
        case 'step': this.stepBar += d; break;
        case 'sample': this.switchSampleSrc(); break;
        default:
          if (g.keys) { g.octave = KO.clamp(g.octave + d, -3, 3); this.show('OCTAVE', (g.octave > 0 ? '+' : '') + g.octave); app.dirty(); }
          else app.changeScene(d);
      }
    }

    switchSampleSrc() {
      this.sampleSrc = this.sampleSrc === 'mic' ? 'resample' : 'mic';
      if (this.sampleSrc === 'mic') this.prepareMic(); else { this.app.engine.closeMic(); this.micError = ''; }
    }

    enumStep(which, steps) {
      this.enumAcc[which] = (this.enumAcc[which] || 0) + steps;
      if (Math.abs(this.enumAcc[which]) < 3) return 0;
      const s = Math.sign(this.enumAcc[which]); this.enumAcc[which] = 0; return s;
    }

    /* ================= knobs ================= */
    knob(which, steps) {
      const app = this.app, P = this.P, g = this.grp, fine = !!this.held.shift;
      if (this.held.shift) this.held.shift.used = true;
      this.knobAngle[which] += steps * 7;
      const gh = this.heldGroup();
      if (gh >= 0) {
        this.held['grp' + gh].used = true;
        if (which === 'x') { const s = this.enumStep('x', steps); if (s) app.setBars(gh, s); }
        return;
      }
      switch (this.mode) {
        case 'sound': return this.editSoundParam(KO.SOUND_PAGES[this.soundPage][which === 'x' ? 0 : 1], steps, fine);
        case 'browse': { const s = this.enumStep(which, steps); if (s) this.browse(which === 'x' ? s : s * 5); return; }
        case 'fx': P.fx[which] = KO.clamp(P.fx[which] + steps * 0.01, 0, 1); app.engine.setFx(P.fx); app.dirty(); return;
        case 'tempo':
          if (which === 'x') app.setBpm(P.bpm + steps * (fine ? 0.1 : 0.5));
          else { P.swing = KO.clamp(P.swing + steps * 0.01, 0, 1); this.show('SWING', Math.round(P.swing * 100)); app.dirty(); }
          return;
        case 'timing': {
          const s = this.enumStep(which, steps); if (!s) return;
          if (which === 'x') P.quant = KO.clamp(P.quant + s, 0, KO.QUANT.length - 1);
          else P.repeat = KO.clamp(P.repeat + s, 0, KO.REPEAT.length - 1);
          app.dirty(); return;
        }
        case 'step': {
          const s = this.enumStep(which, steps); if (!s) return;
          if (which === 'x') this.stepCursor = KO.mod(this.stepCursor + s, 16); else this.stepBar += s;
          return;
        }
        case 'sample':
          if (which === 'x') { const s = this.enumStep('x', steps); if (s) this.switchSampleSrc(); }
          else { this.sampleGain = KO.clamp(this.sampleGain + steps * 0.05, 0.25, 6); if (app.engine.micGain) app.engine.micGain.gain.value = this.sampleGain; }
          return;
        default:
          this.editSoundParam(which === 'x' ? 'pit' : 'vol', steps, fine);
      }
    }

    editSoundParam(pid, steps, fine) {
      const def = KO.SOUND_PARAMS[pid], pad = this.grp.pads[this.grp.sel];
      if (def.enumOf) {
        const s = this.enumStep('e' + pid, steps); if (!s) return;
        const i = def.enumOf.indexOf(pad[def.key]);
        pad[def.key] = def.enumOf[KO.clamp(i + s, 0, def.enumOf.length - 1)];
      } else {
        const st = fine && def.fine ? def.fine : (fine ? def.step / 5 : def.step);
        let v = KO.clamp(pad[def.key] + steps * st, def.min, def.max);
        v = Math.round(v * 1000) / 1000;
        if (pid === 'st') v = Math.min(v, pad.en - 0.01);
        if (pid === 'en') v = Math.max(v, pad.st + 0.01);
        pad[def.key] = v;
      }
      if (this.mode !== 'sound') this.show(def.name, def.fmt(pad[def.key]), 700);
      this.app.dirty();
    }
    browse(d) {
      const list = KO.SoundLib.list, g = this.grp, pad = g.pads[g.sel];
      let i = list.findIndex((s) => s.id === pad.s);
      i = KO.clamp(i + d, 0, list.length - 1);
      pad.s = list[i].id;
      this.app.previewSel();
      this.app.dirty();
    }

    toggleStep(i) {
      const app = this.app, gi = this.group, g = this.grp;
      const pat = app.seq.ensurePattern(gi);
      const st = (this.stepBar * 16 + i) * KO.STEP;
      if (st >= pat.bars * KO.BAR) return;
      app.pushUndo(gi);
      const idx = pat.notes.findIndex((n) => n.p === g.sel && n.t >= st && n.t < st + KO.STEP);
      if (idx >= 0) pat.notes = pat.notes.filter((n) => !(n.p === g.sel && n.t >= st && n.t < st + KO.STEP));
      else { pat.notes.push({ t: st, p: g.sel, v: g.fader.values.vel, l: KO.STEP, k: 0 }); if (!app.seq.playing) app.previewSel(); }
      app.dirty();
    }

    /* ================= pads ================= */
    padDown(p, velPos) {
      const app = this.app, P = this.P, gi = this.group, g = this.grp, H = this.held;
      this.padUp(p); // safety
      const st = this.padState[p] = {};

      if (H.fx) { H.fx.used = true; this.punchOn(p); st.punch = true; return; }
      if (H.erase) { H.erase.used = true; app.erasePad(gi, p); this.show('ERASE NOTES', KO.GROUPS[gi] + ' ' + KO.PAD_LABELS[p]); return; }
      if (H.shift) { H.shift.used = true; g.mutePads[p] = !g.mutePads[p]; this.show('PAD ' + KO.GROUPS[gi] + ' ' + KO.PAD_LABELS[p], g.mutePads[p] ? 'MUTED' : 'UNMUTED'); app.dirty(); return; }
      if (H.sample || this.mode === 'sample') { if (H.sample) H.sample.used = true; st.sampling = true; this.startSampling(p, st); return; }

      switch (this.mode) {
        case 'fader': g.fader.param = p; this.show('FADER', KO.FADER_PARAMS[p].name); this.setMode('main'); app.applyFaderUI(); app.dirty(); return;
        case 'project': if (p >= 3) { app.loadProject(p - 2); this.setMode('main'); } return;
        case 'copy':
          if (this.copySrc === null) { this.copySrc = { g: gi, p }; app.preview(gi, p); }
          else { app.copySound(this.copySrc, { g: gi, p }); this.show('COPIED', KO.GROUPS[gi] + ' ' + KO.PAD_LABELS[p]); this.setMode('main'); }
          return;
        case 'step': g.sel = p; app.preview(gi, p); return;
      }

      const vel = velPos === null || velPos === undefined ? g.fader.values.vel : velPos;
      let pad = p, semi = 0;
      if (g.keys) { pad = g.sel; semi = p + g.octave * 12; } else g.sel = p;

      if (H.timing) {
        H.timing.used = true;
        app.seq.repeats.set(p, { group: gi, pad, semi, vel });
        st.repeat = true;
        return;
      }
      st.voice = app.playNote(gi, pad, vel, semi, 0, null, false, p);
      if (app.seq.recording && app.seq.playing) { app.pushUndoOnce(gi); st.note = app.seq.recordNote(gi, pad, vel, semi); }
    }

    padUp(p) {
      const st = this.padState[p]; if (!st) return;
      delete this.padState[p];
      if (st.punch) this.punchOff(p);
      if (st.sampling) this.stopSampling(st);
      if (st.repeat) this.app.seq.repeats.delete(p);
      if (st.voice) this.app.engine.release(st.voice);
      if (st.note) this.app.seq.releaseNote(st.note);
    }

    punchOn(p) {
      const def = KO.PUNCH[p];
      this.punchHeld[p] = true;
      if (def.ticks) this.app.seq.loop = { len: def.ticks, anchor: null };
      else this.app.engine.punchOn(def.id);
    }
    punchOff(p) {
      const def = KO.PUNCH[p];
      delete this.punchHeld[p];
      if (def.ticks) { if (this.app.seq.loop && this.app.seq.loop.len === def.ticks) this.app.seq.loop = null; }
      else this.app.engine.punchOff(def.id);
    }

    async startSampling(p, st) {
      const e = this.app.engine;
      if (e.recorder) return;
      this.sampleTarget = p;
      if (this.mode !== 'sample') this.setMode('sample');
      if (this.sampleSrc === 'mic') {
        const ok = await this.prepareMic();
        if (!ok || this.padState[p] !== st) return;
      }
      e.startCapture(this.sampleSrc);
      st.capturing = true;
    }
    stopSampling(st) {
      const e = this.app.engine;
      if (!st.capturing || !e.recorder) return;
      const res = e.stopCapture();
      const data = KO.Engine.trimAndNormalize(res.data, this.sampleSrc === 'mic' ? 0.015 : 0.003);
      if (!data) { this.show('SAMPLE', 'TOO QUIET'); return; }
      this.app.assignNewSample(this.group, this.sampleTarget, (this.sampleSrc === 'mic' ? 'MIC ' : 'RSMP ') + KO.GROUPS[this.group] + KO.PAD_LABELS[this.sampleTarget], res.sr, data);
      this.show('SAMPLED', (data.length / res.sr).toFixed(2) + 's');
    }

    /* ================= DOM refresh (diffed) ================= */
    set(el, prop, val) {
      const k = el; let c = this.cache.get(k); if (!c) { c = {}; this.cache.set(k, c); }
      if (c[prop] === val) return;
      c[prop] = val;
      if (prop === 'text') el.textContent = val;
      else if (prop.startsWith('cls:')) el.classList.toggle(prop.slice(4), val);
      else if (prop.startsWith('style:')) el.style[prop.slice(6)] = val;
    }

    refresh() {
      const app = this.app, P = this.P, g = this.grp, H = this.held, now = performance.now(), seq = app.seq;
      for (let i = 0; i < 4; i++) {
        const el = this.btnEls['grp' + i];
        this.set(el, 'cls:on', i === this.group);
        this.set(el, 'cls:muted', P.groups[i].mute);
      }
      const B = this.btnEls, m = this.mode;
      this.set(B.shift, 'cls:on', !!H.shift);
      this.set(B.record, 'cls:on', seq.recording);
      this.set(B.record, 'cls:blink', seq.recording && seq.playing && Math.floor(seq.relNow() / KO.PPQ) % 2 === 1);
      this.set(B.play, 'cls:on', seq.playing);
      this.set(B.keys, 'cls:on', g.keys);
      this.set(B.fx, 'cls:on', m === 'fx' || !!H.fx);
      this.set(B.sound, 'cls:on', m === 'sound' || m === 'browse');
      this.set(B.timing, 'cls:on', m === 'timing' || m === 'step');
      this.set(B.sample, 'cls:on', m === 'sample');
      this.set(B.tempo, 'cls:on', m === 'tempo');
      this.set(B.fader, 'cls:on', m === 'fader');
      this.set(B.copy, 'cls:on', m === 'copy');
      this.set(B.main, 'cls:on', m === 'project');
      this.set(B.erase, 'cls:on', !!H.erase);

      const pat = P.patterns[this.group][P.scenes[P.scene].pat[this.group]];
      const used = new Array(12).fill(false);
      if (pat) pat.notes.forEach((n) => (used[n.p] = true));
      for (let p = 0; p < 12; p++) {
        const el = this.padEls[p], sub = el.children[1];
        let txt, ctx = false;
        if (H.fx) { txt = KO.PUNCH[p].name; ctx = true; }
        else if (m === 'fader') { txt = KO.FADER_PARAMS[p].name; ctx = true; }
        else if (m === 'project') { txt = p >= 3 ? (KO.Store.exists(p - 2) ? 'project' : 'empty') : ''; ctx = true; }
        else if (g.keys && m !== 'step') {
          const pad = g.pads[g.sel], root = (KO.SoundLib.get(pad.s) || { root: 60 }).root;
          const n = Math.round(root + pad.pit + p + g.octave * 12);
          txt = KO.NOTE_NAMES[KO.mod(n, 12)] + (Math.floor(n / 12) - 1); ctx = true;
        } else txt = KO.SoundLib.name(g.pads[p].s);
        this.set(sub, 'text', txt);
        this.set(el, 'cls:ctx', ctx);
        this.set(el, 'cls:sel', !g.keys && g.sel === p && !ctx);
        this.set(el, 'cls:muted', g.mutePads[p] && !ctx);
        this.set(el, 'cls:hasnotes', used[p]);
        this.set(el, 'cls:hit', now < this.hitUntil[p]);
      }
      // fader
      const fp = KO.FADER_PARAMS[g.fader.param], v = g.fader.values[fp.id];
      this.set(this.faderLabel || (this.faderLabel = document.getElementById('fader-label')), 'text', fp.name);
      const thumb = this.faderThumb || (this.faderThumb = document.querySelector('.fader-thumb'));
      const fill = this.faderFill || (this.faderFill = document.querySelector('.fader-fill'));
      this.set(thumb, 'style:top', ((1 - v) * 100).toFixed(1) + '%');
      this.set(fill, 'style:height', (v * 100).toFixed(1) + '%');
      // knobs
      document.querySelectorAll('.knob-cap').forEach((el) => {
        const w = el.parentNode.dataset.knob;
        this.set(el, 'style:transform', `rotate(${this.knobAngle[w]}deg)`);
      });
    }
  }
  KO.UI = UI;
})(window.KO);
