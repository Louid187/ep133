/* LCD rendering */
(function (KO) {
  const W = 320, H = 160;
  const C = { bg: '#0b0b0b', fg: '#f2f2ee', dim: '#5d5d5a', mid: '#9a9a96', acc: '#ff5a1f', red: '#ff3b2a' };
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  class Display {
    constructor(canvas, app) {
      this.cv = canvas; this.app = app;
      this.g = canvas.getContext('2d');
      this.resize();
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
      this.sx = w / W; this.sy = h / H;
    }
    // map a client point to logical coordinates
    toLogical(cx, cy) {
      const r = this.cv.getBoundingClientRect();
      return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
    }

    txt(s, x, y, size, color, align, weight) {
      const g = this.g;
      g.font = `${weight || 600} ${size}px ${MONO}`;
      g.fillStyle = color || C.fg; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
      g.fillText(s, x, y);
    }
    rect(x, y, w, h, color) { this.g.fillStyle = color; this.g.fillRect(x, y, w, h); }
    stroke(x, y, w, h, color, lw) { const g = this.g; g.strokeStyle = color; g.lineWidth = lw || 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    bar(x, y, w, h, v, color) { this.stroke(x, y, w, h, C.dim); this.rect(x + 2, y + 2, Math.max(0, (w - 4) * KO.clamp(v, 0, 1)), h - 4, color || C.fg); }

    draw() {
      const g = this.g, a = this.app;
      g.setTransform(this.sx, 0, 0, this.sy, 0, 0);
      this.rect(0, 0, W, H, C.bg);
      this.header();
      const m = a.ui.screen();
      const fn = this['s_' + m] || this.s_main;
      fn.call(this);
      // popup
      const pop = a.ui.popup;
      if (pop && performance.now() < pop.until) {
        g.fillStyle = 'rgba(0,0,0,.85)'; g.fillRect(40, 52, 240, 76);
        this.stroke(40, 52, 240, 76, C.acc, 2);
        this.txt(pop.title, 160, 80, 14, C.mid, 'center');
        this.txt(pop.value, 160, 112, 26, C.fg, 'center', 700);
      }
    }

    header() {
      const a = this.app, P = a.proj, s = a.seq;
      this.rect(0, 0, W, 20, '#161616');
      this.txt('P' + a.slot, 6, 14, 11, C.mid);
      this.txt('S' + KO.pad2(P.scene + 1) + (s.song ? '♪' : ''), 30, 14, 11, s.pendingScene !== null ? C.acc : C.fg);
      const g = a.ui.group;
      this.txt(KO.GROUPS[g] + KO.pad2(P.scenes[P.scene].pat[g]), 78, 14, 11, C.acc, 'left', 700);
      if (P.groups[g].keys) this.txt('KEYS', 110, 14, 10, C.fg);
      this.txt(P.bpm.toFixed(1), 186, 14, 11, C.fg, 'right');
      // position bar.beat.16th
      const rel = s.playing ? s.relNow() : 0;
      const bar = Math.floor(rel / KO.BAR) + 1, beat = Math.floor(rel % KO.BAR / KO.PPQ) + 1, sx = Math.floor(rel % KO.PPQ / KO.STEP) + 1;
      this.txt(`${bar}.${beat}.${sx}`, 240, 14, 11, s.playing ? C.fg : C.dim, 'center');
      if (s.recording) this.circle(288, 10, 4, (!s.playing || (beat % 2)) ? C.red : '#701810');
      if (s.playing) this.tri(300, 5, 10, C.fg); else this.rect(298, 5, 9, 9, C.dim);
    }
    circle(x, y, r, c) { const g = this.g; g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    tri(x, y, s, c) { const g = this.g; g.fillStyle = c; g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * 0.9, y + s / 2); g.lineTo(x, y + s); g.fill(); }

    /* ---------- main: 4 group lanes ---------- */
    s_main() {
      const a = this.app, P = a.proj, s = a.seq, ui = a.ui;
      const rel = s.playing ? s.relNow() : -1;
      for (let gi = 0; gi < 4; gi++) {
        const y = 26 + gi * 24, grp = P.groups[gi];
        const n = P.scenes[P.scene].pat[gi], pat = P.patterns[gi][n];
        const cur = gi === ui.group;
        this.txt(KO.GROUPS[gi], 6, y + 14, 14, cur ? C.acc : (grp.mute ? C.dim : C.fg), 'left', 700);
        this.txt(KO.pad2(n), 22, y + 14, 11, grp.mute ? C.dim : C.mid);
        const x0 = 46, w = 268;
        this.rect(x0, y + 2, w, 18, cur ? '#1c1c1c' : '#121212');
        if (pat) {
          const L = pat.bars * KO.BAR;
          for (let b = 1; b < pat.bars; b++) this.rect(x0 + w * b / pat.bars, y + 2, 1, 18, '#333');
          pat.notes.forEach((nt) => {
            const x = x0 + (nt.t / L) * w;
            const hh = 4 + nt.v * 12;
            this.rect(x, y + 20 - hh, 2, hh, grp.mute || grp.mutePads[nt.p] ? C.dim : (cur ? C.fg : C.mid));
          });
          if (rel >= 0) { const px = x0 + (rel % L) / L * w; this.rect(px, y + 1, 1.5, 20, C.acc); }
          this.txt(pat.bars + 'B', 314, y + 14, 9, C.dim, 'right');
        }
        if (grp.mute) this.txt('MUTE', x0 + w / 2, y + 15, 11, C.acc, 'center', 700);
      }
      const grp = P.groups[ui.group], pad = grp.pads[grp.sel];
      this.txt(KO.PAD_LABELS[grp.sel] + ' ' + KO.SoundLib.name(pad.s), 6, 148, 11, C.fg);
      const pf = KO.FADER_PARAMS[grp.fader.param];
      this.txt('FADER ' + pf.name + ' ' + Math.round(grp.fader.values[pf.id] * 100), 314, 148, 10, C.dim, 'right');
      this.txt('X:PITCH  Y:LEVEL', 6, 158, 8, C.dim);
      if (s.pendingScene !== null) this.txt('NEXT S' + KO.pad2(s.pendingScene + 1), 314, 158, 9, C.acc, 'right');
    }

    /* ---------- pattern (group held) ---------- */
    s_pattern() {
      const a = this.app, P = a.proj, gi = a.ui.group;
      const n = P.scenes[P.scene].pat[gi], pat = P.patterns[gi][n];
      this.txt('GROUP ' + KO.GROUPS[gi] + ' PATTERN', 160, 44, 12, C.mid, 'center');
      this.txt(KO.pad2(n), 160, 92, 40, C.acc, 'center', 700);
      this.txt(pat ? pat.bars + (pat.bars > 1 ? ' BARS' : ' BAR') : 'EMPTY', 160, 116, 14, C.fg, 'center');
      this.txt(pat ? pat.notes.length + ' NOTES' : '', 160, 134, 10, C.dim, 'center');
      this.txt('−/+ PATTERN   X: LENGTH', 160, 154, 9, C.dim, 'center');
    }

    /* ---------- sound edit ---------- */
    s_sound() {
      const a = this.app, ui = a.ui, grp = a.proj.groups[ui.group], pad = grp.pads[grp.sel];
      const smp = KO.SoundLib.get(pad.s);
      this.txt(KO.GROUPS[ui.group] + ' ' + KO.PAD_LABELS[grp.sel], 6, 36, 12, C.acc, 'left', 700);
      this.txt(KO.SoundLib.name(pad.s), 50, 36, 12, C.fg);
      this.txt((ui.soundPage + 1) + '/' + KO.SOUND_PAGES.length, 314, 36, 10, C.dim, 'right');
      // waveform
      this.wave(smp, 6, 44, 308, 56, pad.st, pad.en, pad.rev);
      const pg = KO.SOUND_PAGES[ui.soundPage];
      pg.forEach((pid, i) => {
        const def = KO.SOUND_PARAMS[pid];
        const x = 6 + i * 158;
        this.txt((i ? 'Y ' : 'X ') + def.name, x, 118, 10, C.mid);
        this.txt(def.fmt(pad[def.key]), x, 144, 20, C.fg, 'left', 700);
        if (def.bar) this.bar(x, 148, 150, 8, def.bar(pad[def.key]), C.acc);
      });
    }
    wave(smp, x, y, w, h, st, en, rev) {
      this.rect(x, y, w, h, '#121212');
      if (!smp) { this.txt('NO SAMPLE', x + w / 2, y + h / 2 + 4, 11, C.dim, 'center'); return; }
      const d = smp.data, n = d.length, mid = y + h / 2, g = this.g;
      g.fillStyle = C.mid;
      for (let i = 0; i < w; i++) {
        const a0 = Math.floor(i / w * n), a1 = Math.max(a0 + 1, Math.floor((i + 1) / w * n));
        let mx = 0; for (let k = a0; k < a1; k += 4) mx = Math.max(mx, Math.abs(d[k]));
        const xi = rev ? x + w - 1 - i : x + i;
        const inside = (xi - x) / w >= st && (xi - x) / w <= en;
        g.fillStyle = inside ? C.fg : C.dim;
        g.fillRect(xi, mid - mx * h / 2, 1, Math.max(1, mx * h));
      }
      this.rect(x + st * w, y, 1.5, h, C.acc); this.rect(x + en * w - 1.5, y, 1.5, h, C.acc);
      this.txt((n / smp.sr).toFixed(2) + 's', x + w - 3, y + 10, 8, C.dim, 'right');
    }

    /* ---------- browse ---------- */
    s_browse() {
      const a = this.app, ui = a.ui, list = KO.SoundLib.list, grp = a.proj.groups[ui.group];
      const cur = list.findIndex((s) => s.id === grp.pads[grp.sel].s);
      this.txt('ASSIGN TO ' + KO.GROUPS[ui.group] + ' ' + KO.PAD_LABELS[grp.sel], 6, 36, 11, C.mid);
      this.txt((cur + 1) + '/' + list.length, 314, 36, 10, C.dim, 'right');
      for (let i = -2; i <= 2; i++) {
        const idx = cur + i; if (idx < 0 || idx >= list.length) continue;
        const y = 94 + i * 22, s = list[idx];
        if (i === 0) { this.rect(4, y - 16, 312, 22, '#2a2a2a'); this.stroke(4, y - 16, 312, 22, C.acc); }
        this.txt(KO.pad2(idx + 1), 12, y, 11, i === 0 ? C.acc : C.dim);
        this.txt(s.name + (s.factory ? '' : ' ●'), 40, y, i === 0 ? 14 : 12, i === 0 ? C.fg : C.mid, 'left', i === 0 ? 700 : 500);
      }
      this.txt('X / −+ BROWSE   ● = USER SAMPLE', 160, 156, 9, C.dim, 'center');
    }

    /* ---------- fx ---------- */
    s_fx() {
      const a = this.app, fx = a.proj.fx, t = KO.FX_TYPES[fx.type], grp = a.proj.groups[a.ui.group];
      this.txt('MASTER FX', 6, 38, 11, C.mid);
      this.txt('−/+', 314, 38, 10, C.dim, 'right');
      this.txt(t.name, 160, 72, 24, C.acc, 'center', 700);
      if (t.id !== 'off') {
        [['X ' + t.x, fx.x], ['Y ' + t.y, fx.y]].forEach(([n, v], i) => {
          const x = 6 + i * 158;
          let label = Math.round(v * 100) + '';
          if (t.id === 'delay' && i === 0) label = KO.DELAY_DIVS[Math.round(v * (KO.DELAY_DIVS.length - 1))].name;
          this.txt(n, x, 100, 10, C.mid); this.txt(label, x + 150, 100, 10, C.fg, 'right');
          this.bar(x, 106, 150, 10, v, C.fg);
        });
      }
      this.txt('FADER = SEND ' + KO.GROUPS[a.ui.group] + ' ' + Math.round(grp.fader.values.fx * 100), 6, 140, 11, C.fg);
      this.txt('HOLD FX + PAD = PUNCH-IN', 6, 156, 9, C.dim);
    }
    s_punch() {
      const a = this.app, ids = Object.keys(a.ui.punchHeld);
      this.txt('PUNCH-IN FX', 160, 44, 12, C.mid, 'center');
      if (!ids.length) { this.txt('PRESS A PAD', 160, 96, 18, C.dim, 'center'); return; }
      ids.slice(0, 3).forEach((p, i) => this.txt(KO.PUNCH[p].name, 160, 90 + i * 26, 22, C.acc, 'center', 700));
    }

    /* ---------- tempo ---------- */
    s_tempo() {
      const P = this.app.proj;
      this.txt('TEMPO', 6, 38, 11, C.mid);
      this.txt(P.bpm.toFixed(1), 160, 92, 44, C.fg, 'center', 700);
      this.txt('BPM', 160, 110, 11, C.dim, 'center');
      this.txt('X BPM', 6, 136, 10, C.mid);
      this.txt('Y SWING ' + Math.round(P.swing * 100), 120, 136, 10, C.mid);
      this.txt('METRO ' + (P.metronome ? 'ON' : 'OFF'), 314, 136, 10, P.metronome ? C.acc : C.dim, 'right');
      this.txt('TAP TEMPO KEY REPEATEDLY · SHIFT+TEMPO = METRO', 160, 156, 8, C.dim, 'center');
    }

    /* ---------- fader assign ---------- */
    s_fader() {
      const a = this.app, grp = a.proj.groups[a.ui.group];
      this.txt('FADER ASSIGN · GROUP ' + KO.GROUPS[a.ui.group], 6, 36, 11, C.mid);
      KO.PAD_LAYOUT.forEach((p, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = 60 + col * 70, y = 41 + row * 27, f = KO.FADER_PARAMS[p], on = grp.fader.param === p;
        this.rect(x, y, 64, 23, on ? C.acc : '#1d1d1d');
        this.txt(f.name, x + 32, y + 16, 11, on ? '#000' : C.fg, 'center', 700);
      });
      this.txt('PRESS A PAD', 160, 158, 9, C.dim, 'center');
    }

    /* ---------- timing ---------- */
    s_timing() {
      const P = this.app.proj;
      this.txt('TIMING', 6, 38, 11, C.mid);
      this.txt('X QUANTIZE', 6, 70, 11, C.mid); this.txt(KO.QUANT[P.quant].name, 6, 100, 26, C.fg, 'left', 700);
      this.txt('Y NOTE REPEAT', 170, 70, 11, C.mid); this.txt(KO.REPEAT[P.repeat].name, 170, 100, 26, C.fg, 'left', 700);
      this.txt('HOLD TIMING + PAD = NOTE REPEAT', 160, 136, 10, C.dim, 'center');
      this.txt('SHIFT + TIMING = STEP EDIT', 160, 152, 10, C.dim, 'center');
    }

    /* ---------- step editor ---------- */
    s_step() {
      const a = this.app, ui = a.ui, gi = ui.group, P = a.proj, grp = P.groups[gi];
      const n = P.scenes[P.scene].pat[gi], pat = P.patterns[gi][n];
      const bars = pat ? pat.bars : 1;
      ui.stepBar = KO.clamp(ui.stepBar, 0, bars - 1);
      this.txt('STEP ' + KO.GROUPS[gi] + KO.pad2(n) + ' · ' + KO.PAD_LABELS[grp.sel] + ' ' + KO.SoundLib.name(grp.pads[grp.sel].s), 6, 36, 10, C.mid);
      this.txt('BAR ' + (ui.stepBar + 1) + '/' + bars, 314, 36, 10, C.fg, 'right');
      const rel = a.seq.playing ? a.seq.relNow() : -1;
      const L = bars * KO.BAR;
      const play = rel >= 0 ? Math.floor((rel % L) / KO.STEP) : -1;
      for (let i = 0; i < 16; i++) {
        const st = ui.stepBar * 16 + i, x = 8 + (i % 8) * 38.5, y = 46 + Math.floor(i / 8) * 46;
        const has = pat && pat.notes.some((nt) => nt.p === grp.sel && nt.t >= st * KO.STEP && nt.t < (st + 1) * KO.STEP);
        const other = pat && !has && pat.notes.some((nt) => nt.t >= st * KO.STEP && nt.t < (st + 1) * KO.STEP);
        this.rect(x, y, 34, 40, has ? C.fg : (i % 4 === 0 ? '#222' : '#181818'));
        if (other) this.rect(x + 14, y + 34, 6, 3, C.dim);
        if (st === play) this.stroke(x, y, 34, 40, C.acc, 2);
        if (i === ui.stepCursor) this.rect(x, y + 41, 34, 2, C.acc);
        this.txt(String(i + 1), x + 17, y + 24, 10, has ? '#000' : C.dim, 'center');
      }
      this.txt('TAP STEPS · PAD = SOUND · X CURSOR · Y BAR · ● TOGGLE', 160, 156, 8, C.dim, 'center');
    }

    /* ---------- sampling ---------- */
    s_sample() {
      const a = this.app, ui = a.ui, e = a.engine;
      this.txt('SAMPLE', 6, 38, 11, C.mid);
      this.txt('X SRC: ' + (ui.sampleSrc === 'mic' ? 'MIC IN' : 'RESAMPLE'), 6, 58, 11, C.fg);
      this.txt('Y GAIN ' + ui.sampleGain.toFixed(1) + 'x', 314, 58, 11, C.fg, 'right');
      const lvl = e.inputLevel(ui.sampleSrc) * (ui.sampleSrc === 'mic' ? ui.sampleGain : 1);
      this.bar(6, 66, 308, 14, lvl, lvl > 0.95 ? C.red : C.acc);
      if (e.recorder) {
        this.circle(20, 108, 7, C.red);
        this.txt('REC ' + KO.GROUPS[ui.group] + ' ' + KO.PAD_LABELS[ui.sampleTarget] + '  ' + e.captureSeconds().toFixed(1) + 's', 36, 114, 18, C.fg, 'left', 700);
      } else if (ui.micError) {
        this.txt(ui.micError, 160, 112, 10, C.red, 'center');
      } else {
        this.txt('HOLD A PAD TO RECORD', 160, 112, 16, C.fg, 'center', 700);
      }
      this.txt('RELEASE TO STOP · AUTO TRIM + NORMALIZE', 160, 140, 9, C.dim, 'center');
      this.txt('SHIFT + SAMPLE = IMPORT FILE', 160, 154, 9, C.dim, 'center');
    }

    /* ---------- project ---------- */
    s_project() {
      const a = this.app;
      this.txt('PROJECTS · PRESS 1–9', 6, 36, 11, C.mid);
      [7, 8, 9, 4, 5, 6, 1, 2, 3].forEach((n, i) => {
        const x = 70 + (i % 3) * 62, y = 44 + Math.floor(i / 3) * 34;
        const on = n === a.slot, ex = KO.Store.exists(n);
        this.rect(x, y, 56, 30, on ? C.acc : (ex ? '#2a2a2a' : '#141414'));
        this.txt(String(n), x + 28, y + 21, 15, on ? '#000' : (ex ? C.fg : C.dim), 'center', 700);
      });
      this.txt('AUTO-SAVED IN THIS BROWSER', 160, 158, 9, C.dim, 'center');
    }

    /* ---------- copy ---------- */
    s_copy() {
      const ui = this.app.ui;
      this.txt('COPY SOUND', 160, 50, 12, C.mid, 'center');
      if (ui.copySrc === null) this.txt('PRESS SOURCE PAD', 160, 100, 18, C.fg, 'center', 700);
      else {
        this.txt('FROM ' + KO.GROUPS[ui.copySrc.g] + ' ' + KO.PAD_LABELS[ui.copySrc.p], 160, 92, 16, C.acc, 'center', 700);
        this.txt('PRESS DESTINATION PAD', 160, 120, 14, C.fg, 'center');
      }
      this.txt('(SWITCH GROUP TO COPY ACROSS)', 160, 152, 9, C.dim, 'center');
    }

    s_erase() {
      this.txt('ERASE', 160, 54, 14, C.acc, 'center', 700);
      this.txt('+ PAD   = ERASE PAD NOTES', 160, 88, 12, C.fg, 'center');
      this.txt('+ GROUP = CLEAR PATTERN', 160, 108, 12, C.fg, 'center');
      this.txt('SHIFT + ERASE = UNDO', 160, 134, 11, C.mid, 'center');
    }
    s_shift() {
      this.txt('SHIFT', 160, 50, 14, C.acc, 'center', 700);
      ['+ PAD / GROUP = MUTE', '+ PLAY = SONG MODE', '+ SOUND = BROWSE   + SAMPLE = IMPORT', '+ TIMING = STEP   + COPY = DUP PATTERN', '+ MAIN = PROJECT  + TEMPO = METRO'].forEach((s, i) =>
        this.txt(s, 160, 76 + i * 17, 10, i ? C.mid : C.fg, 'center'));
    }
  }

  KO.Display = Display;
})(window.KO);
