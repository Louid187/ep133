/* Factory sound library — every sound is synthesised offline at start-up.
   Each recipe schedules nodes on an (Offline)AudioContext at time t into `out`. */
(function (KO) {
  const SR = 44100;

  function noiseBuf(ctx, dur, seed) {
    const len = Math.max(1, Math.ceil(dur * ctx.sampleRate));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = KO.mulberry(seed || 1);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    return b;
  }
  function noise(ctx, t, dur, seed) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf(ctx, dur + 0.05, seed);
    s.start(t); s.stop(t + dur + 0.05);
    return s;
  }
  function osc(ctx, type, f, t, dur) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; return g; }
  function filt(ctx, type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q === undefined ? 0.7 : q; return b; }
  // percussive envelope
  function perc(param, t, peak, a, d) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // ADSR-ish envelope: attack, hold for len, release
  function ahr(param, t, peak, a, len, r) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + Math.max(a, len));
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(a, len) + r);
  }
  function shaper(ctx, amt) {
    const ws = ctx.createWaveShaper();
    const n = 1024, c = new Float32Array(n), k = amt * 50 + 1;
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
    ws.curve = c; return ws;
  }
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------------- drums ---------------- */
  const R = {};
  R.kick = (ctx, out, t, o = {}) => {
    const f0 = o.f0 || 160, f1 = o.f1 || 48, dec = o.dec || 0.45;
    const s = osc(ctx, 'sine', f0, t, dec + 0.1);
    s.frequency.exponentialRampToValueAtTime(f1, t + (o.sweep || 0.07));
    const g = gain(ctx, 0); perc(g.gain, t, 1, 0.002, dec);
    if (o.drive) chain(s, shaper(ctx, o.drive), g, out); else chain(s, g, out);
    const n = noise(ctx, t, 0.02, 7), ng = gain(ctx, 0); perc(ng.gain, t, (o.click || 0.4), 0.001, 0.012);
    chain(n, filt(ctx, 'highpass', 2500), ng, out);
  };
  R.snare = (ctx, out, t, o = {}) => {
    const tone = osc(ctx, 'triangle', o.f || 190, t, 0.2);
    tone.frequency.exponentialRampToValueAtTime((o.f || 190) * 0.75, t + 0.08);
    const tg = gain(ctx, 0); perc(tg.gain, t, 0.7, 0.001, 0.11); chain(tone, tg, out);
    const n = noise(ctx, t, 0.35, o.seed || 11), ng = gain(ctx, 0); perc(ng.gain, t, o.snap || 0.8, 0.001, o.dec || 0.2);
    chain(n, filt(ctx, 'highpass', 1200), filt(ctx, 'peaking', 5000, 1), ng, out);
  };
  R.clap = (ctx, out, t, o = {}) => {
    const n = noise(ctx, t, 0.5, 23), g = gain(ctx, 0);
    const p = g.gain; p.setValueAtTime(0.0001, t);
    [0, 0.011, 0.022].forEach((dt) => { p.setValueAtTime(0.9, t + dt); p.exponentialRampToValueAtTime(0.1, t + dt + 0.009); });
    p.setValueAtTime(0.7, t + 0.032); p.exponentialRampToValueAtTime(0.0001, t + 0.032 + (o.dec || 0.22));
    chain(n, filt(ctx, 'bandpass', o.f || 1300, 1.2), g, out);
  };
  function metal(ctx, t, dur) {
    const mix = gain(ctx, 0.2);
    [205.3, 304.4, 369.6, 522.7, 540, 800].forEach((f) => { const o = osc(ctx, 'square', f * 1.7, t, dur); o.connect(mix); });
    return mix;
  }
  R.hat = (ctx, out, t, o = {}) => {
    const dec = o.dec || 0.05;
    const m = metal(ctx, t, dec + 0.1), n = noise(ctx, t, dec + 0.1, 31);
    const g = gain(ctx, 0); perc(g.gain, t, 0.9, 0.001, dec);
    const hp = filt(ctx, 'highpass', o.f || 7500); const ng = gain(ctx, 0.5);
    m.connect(hp); chain(n, ng, hp); chain(hp, g, out);
  };
  R.cymbal = (ctx, out, t, o = {}) => {
    const dec = o.dec || 1.6;
    const m = metal(ctx, t, dec + 0.1), n = noise(ctx, t, dec + 0.1, 37);
    const g = gain(ctx, 0); perc(g.gain, t, 0.8, 0.003, dec);
    const hp = filt(ctx, 'highpass', 4500); m.connect(hp); chain(n, gain(ctx, 0.8), hp); chain(hp, filt(ctx, 'peaking', 9000, 1), g, out);
  };
  R.tom = (ctx, out, t, o = {}) => {
    const f = o.f || 120;
    const s = osc(ctx, 'sine', f * 1.6, t, 0.6); s.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = gain(ctx, 0); perc(g.gain, t, 1, 0.002, o.dec || 0.4); chain(s, g, out);
    const n = noise(ctx, t, 0.05, 41), ng = gain(ctx, 0); perc(ng.gain, t, 0.15, 0.001, 0.03); chain(n, filt(ctx, 'lowpass', 3000), ng, out);
  };
  R.rim = (ctx, out, t) => {
    const s = osc(ctx, 'triangle', 1700, t, 0.05), g = gain(ctx, 0); perc(g.gain, t, 0.8, 0.0005, 0.03); chain(s, g, out);
    const s2 = osc(ctx, 'square', 480, t, 0.05), g2 = gain(ctx, 0); perc(g2.gain, t, 0.3, 0.0005, 0.02); chain(s2, filt(ctx, 'bandpass', 900, 3), g2, out);
  };
  R.shaker = (ctx, out, t, o = {}) => {
    const n = noise(ctx, t, 0.2, 53), g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + (o.a || 0.025)); g.gain.exponentialRampToValueAtTime(0.0001, t + (o.a || 0.025) + 0.09);
    chain(n, filt(ctx, 'bandpass', 7000, 1.5), g, out);
  };
  R.cowbell = (ctx, out, t) => {
    const m = gain(ctx, 0.5); osc(ctx, 'square', 540, t, 0.5).connect(m); osc(ctx, 'square', 800, t, 0.5).connect(m);
    const g = gain(ctx, 0); perc(g.gain, t, 0.8, 0.001, 0.35); chain(m, filt(ctx, 'bandpass', 800, 2), g, out);
  };
  R.conga = (ctx, out, t, o = {}) => {
    const f = o.f || 330;
    const s = osc(ctx, 'sine', f * 1.3, t, 0.4); s.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = gain(ctx, 0); perc(g.gain, t, 1, 0.001, 0.22); chain(s, g, out);
  };
  R.snap = (ctx, out, t) => {
    const n = noise(ctx, t, 0.1, 61), g = gain(ctx, 0); perc(g.gain, t, 1, 0.0005, 0.04);
    chain(n, filt(ctx, 'bandpass', 2400, 4), g, out);
  };

  /* ---------------- tonal ---------------- */
  // generic subtractive voice
  R.sub = (ctx, out, t, o = {}) => {
    const f = o.f || mtof(o.note || 36), len = o.len || 0.4;
    const mix = gain(ctx, 1);
    (o.osc || [['sawtooth', 0, 1]]).forEach(([type, det, lvl]) => {
      const v = osc(ctx, type, f * Math.pow(2, det / 1200), t, len + (o.r || 0.2) + 0.2);
      if (o.vib) { const l = osc(ctx, 'sine', o.vibRate || 5.5, t, len + 1); const lg = gain(ctx, f * o.vib); chain(l, lg, v.frequency); }
      if (o.glide) { v.frequency.setValueAtTime(f * o.glide, t); v.frequency.exponentialRampToValueAtTime(f * Math.pow(2, det / 1200), t + 0.08); }
      chain(v, gain(ctx, lvl), mix);
    });
    const lp = filt(ctx, 'lowpass', o.cut || 800, o.q || 1);
    const fe = o.fenv || 0;
    if (fe) { lp.frequency.setValueAtTime((o.cut || 800) + fe, t); lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.cut || 800), t + (o.fdec || 0.2)); }
    const g = gain(ctx, 0); ahr(g.gain, t, o.lvl || 0.8, o.a || 0.003, len, o.r || 0.15);
    let last = chain(mix, lp);
    if (o.drive) last = chain(last, shaper(ctx, o.drive));
    chain(last, g, out);
  };
  // 2-op FM voice
  R.fm = (ctx, out, t, o = {}) => {
    const f = o.f || mtof(o.note || 60), len = o.len || 0.5;
    const car = osc(ctx, o.cType || 'sine', f, t, len + (o.r || 0.5) + 0.2);
    const mod = osc(ctx, 'sine', f * (o.ratio || 1), t, len + (o.r || 0.5) + 0.2);
    const mg = gain(ctx, 0); const idx = (o.index || 2) * f;
    mg.gain.setValueAtTime(idx, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * (o.indexEnd || 0.1)), t + (o.idec || 0.4));
    chain(mod, mg, car.frequency);
    const g = gain(ctx, 0); ahr(g.gain, t, o.lvl || 0.7, o.a || 0.002, len, o.r || 0.5);
    chain(car, g, out);
    if (o.bell) { // extra inharmonic partial
      const b = osc(ctx, 'sine', f * o.bell, t, 1.5), bg = gain(ctx, 0); perc(bg.gain, t, 0.2, 0.001, 0.6); chain(b, bg, out);
    }
  };
  R.organ = (ctx, out, t, o = {}) => {
    const f = mtof(o.note || 60), len = o.len || 0.8;
    const mix = gain(ctx, 0.25);
    [[1, 1], [2, 0.6], [3, 0.4], [4, 0.25], [6, 0.12]].forEach(([h, l]) => chain(osc(ctx, 'sine', f * h, t, len + 0.3), gain(ctx, l), mix));
    const g = gain(ctx, 0); ahr(g.gain, t, 0.9, 0.01, len, 0.08); chain(mix, g, out);
  };
  R.chord = (ctx, out, t, o = {}) => {
    (o.notes || [60, 63, 67, 70]).forEach((n) => (o.voice || R.sub)(ctx, out, t, Object.assign({}, o.v || {}, { note: n, lvl: (o.v && o.v.lvl || 0.6) / 2 })));
  };
  R.marimba = (ctx, out, t, o = {}) => {
    const f = mtof(o.note || 60);
    const a = osc(ctx, 'sine', f, t, 1), ag = gain(ctx, 0); perc(ag.gain, t, 0.8, 0.001, 0.5); chain(a, ag, out);
    const b = osc(ctx, 'sine', f * 3.93, t, 0.3), bg = gain(ctx, 0); perc(bg.gain, t, 0.25, 0.001, 0.08); chain(b, bg, out);
    const c = osc(ctx, 'sine', f * 9.2, t, 0.1), cg = gain(ctx, 0); perc(cg.gain, t, 0.1, 0.0005, 0.02); chain(c, cg, out);
  };
  R.vox = (ctx, out, t, o = {}) => {
    const f = mtof(o.note || 52), len = o.len || 0.7;
    const src = osc(ctx, 'sawtooth', f, t, len + 0.5);
    const l = osc(ctx, 'sine', 5, t, len + 0.5), lg = gain(ctx, 0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.02, t + 0.4); chain(l, lg, src.frequency);
    const g = gain(ctx, 0); ahr(g.gain, t, 1, 0.06, len, 0.25);
    const forms = o.formants || [[800, 1, 8], [1150, 0.5, 10], [2900, 0.25, 12]];
    forms.forEach(([ff, fl, q]) => chain(src, filt(ctx, 'bandpass', ff, q), gain(ctx, fl * 3), g));
    g.connect(out);
  };

  /* ---------------- fx ---------------- */
  R.riser = (ctx, out, t, o = {}) => {
    const d = o.len || 2;
    const n = noise(ctx, t, d, 71), bp = filt(ctx, 'bandpass', 200, 4);
    bp.frequency.setValueAtTime(o.down ? 8000 : 200, t); bp.frequency.exponentialRampToValueAtTime(o.down ? 150 : 9000, t + d);
    const g = gain(ctx, 0);
    if (o.down) { g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    else { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + d * 0.95); g.gain.linearRampToValueAtTime(0, t + d); }
    chain(n, bp, g, out);
    const s = osc(ctx, 'sawtooth', o.down ? 800 : 100, t, d); s.frequency.exponentialRampToValueAtTime(o.down ? 60 : 1200, t + d);
    chain(s, gain(ctx, 0.15), g);
  };
  R.zap = (ctx, out, t, o = {}) => {
    const s = osc(ctx, o.type || 'sine', o.f0 || 2500, t, o.len || 0.25); s.frequency.exponentialRampToValueAtTime(o.f1 || 60, t + (o.len || 0.25));
    const g = gain(ctx, 0); perc(g.gain, t, 0.9, 0.001, o.len || 0.25); chain(s, g, out);
  };
  R.laser = (ctx, out, t) => {
    const s = osc(ctx, 'square', 3000, t, 0.5); s.frequency.exponentialRampToValueAtTime(150, t + 0.4);
    const l = osc(ctx, 'square', 30, t, 0.5), lg = gain(ctx, 400); chain(l, lg, s.frequency);
    const g = gain(ctx, 0); perc(g.gain, t, 0.5, 0.001, 0.4); chain(s, filt(ctx, 'lowpass', 5000), g, out);
  };
  R.impact = (ctx, out, t) => {
    const s = osc(ctx, 'sine', 90, t, 2.5); s.frequency.exponentialRampToValueAtTime(30, t + 1.5);
    const g = gain(ctx, 0); perc(g.gain, t, 1, 0.002, 2); chain(s, shaper(ctx, 0.05), g, out);
    const n = noise(ctx, t, 2, 83), lp = filt(ctx, 'lowpass', 6000); lp.frequency.exponentialRampToValueAtTime(200, t + 1.5);
    const ng = gain(ctx, 0); perc(ng.gain, t, 0.6, 0.002, 1.4); chain(n, lp, ng, out);
  };
  R.vinyl = (ctx, out, t, o = {}) => {
    const d = o.len || 2;
    const n = noise(ctx, t, d, 91); chain(n, filt(ctx, 'bandpass', 1500, 0.5), gain(ctx, 0.05), out);
    const r = KO.mulberry(5);
    for (let i = 0; i < 40; i++) {
      const tt = t + r() * d; const c = noise(ctx, tt, 0.004, 100 + i), cg = gain(ctx, 0); perc(cg.gain, tt, 0.3 + r() * 0.6, 0.0002, 0.003); chain(c, filt(ctx, 'highpass', 1000), cg, out);
    }
  };
  R.glitch = (ctx, out, t) => {
    const r = KO.mulberry(17);
    let tt = t;
    for (let i = 0; i < 14; i++) {
      const len = 0.015 + r() * 0.05;
      const s = osc(ctx, r() > 0.5 ? 'square' : 'sawtooth', 100 + r() * 3000, tt, len), g = gain(ctx, 0);
      g.gain.setValueAtTime(0.4, tt); g.gain.setValueAtTime(0, tt + len); chain(s, g, out);
      tt += len + r() * 0.02;
    }
  };
  R.drumloop = (ctx, out, t, o = {}) => {
    const bpm = 120, s16 = 60 / bpm / 4;
    const k = o.kick || [0, 6, 10], sn = [4, 12], h = [0, 2, 4, 6, 8, 10, 12, 14];
    k.forEach((i) => R.kick(ctx, out, t + i * s16, { dec: 0.3 }));
    sn.forEach((i) => R.snare(ctx, out, t + i * s16, {}));
    h.forEach((i, n) => { const g = gain(ctx, n % 2 ? 0.35 : 0.6); g.connect(out); R.hat(ctx, g, t + i * s16, {}); });
    if (o.ghost) [7, 15].forEach((i) => { const g = gain(ctx, 0.3); g.connect(out); R.snare(ctx, g, t + i * s16, {}); });
  };
  R.percloop = (ctx, out, t) => {
    const s16 = 60 / 120 / 4;
    for (let i = 0; i < 16; i++) { const g = gain(ctx, i % 4 === 0 ? 0.7 : 0.35); g.connect(out); R.shaker(ctx, g, t + i * s16, {}); }
    [0, 3, 6, 10, 13].forEach((i, n) => R.conga(ctx, out, t + i * s16, { f: n % 2 ? 330 : 240 }));
    [8].forEach((i) => R.rim(ctx, out, t + i * s16));
  };
  R.arp = (ctx, out, t, o = {}) => {
    const s16 = 60 / 120 / 4, notes = o.notes || [48, 55, 60, 63, 67, 63, 60, 55];
    for (let i = 0; i < 16; i++) R.sub(ctx, out, t + i * s16, { note: notes[i % notes.length], len: 0.06, r: 0.08, cut: 900, fenv: 3000, fdec: 0.1, q: 6, osc: [['sawtooth', 0, 1]], lvl: 0.6 });
  };

  /* ---------------- library definition ---------------- */
  // [id, name, duration, recipe, options, rootMidi]
  const DEF = {
    A: [
      ['a.cowbell', 'COWBELL', 0.5, 'cowbell', {}],
      ['a.crash', 'CRASH', 2.0, 'cymbal', {}],
      ['a.conga', 'CONGA', 0.4, 'conga', {}],
      ['a.kick', 'KICK', 0.6, 'kick', {}],
      ['a.snare', 'SNARE', 0.4, 'snare', {}],
      ['a.chh', 'HAT CL', 0.15, 'hat', { dec: 0.045 }],
      ['a.kick2', 'KICK 808', 1.4, 'kick', { f0: 120, f1: 42, dec: 1.2, sweep: 0.12, click: 0.15, drive: 0.03 }],
      ['a.clap', 'CLAP', 0.4, 'clap', {}],
      ['a.ohh', 'HAT OP', 0.6, 'hat', { dec: 0.4 }],
      ['a.tomlo', 'TOM LO', 0.6, 'tom', { f: 95 }],
      ['a.rim', 'RIM', 0.1, 'rim', {}],
      ['a.shaker', 'SHAKER', 0.2, 'shaker', {}],
    ],
    B: [
      ['b.sub', 'SUB', 1.0, 'sub', { note: 36, len: 0.7, osc: [['sine', 0, 1], ['triangle', 0, 0.3]], cut: 400 }, 36],
      ['b.saw', 'SAW BASS', 0.8, 'sub', { note: 36, len: 0.5, osc: [['sawtooth', 0, 1], ['sawtooth', 8, 0.6]], cut: 300, fenv: 1800, fdec: 0.25, q: 3 }, 36],
      ['b.sqr', 'SQR BASS', 0.8, 'sub', { note: 36, len: 0.5, osc: [['square', 0, 0.8], ['sine', -1200, 0.6]], cut: 500, fenv: 1200, fdec: 0.2 }, 36],
      ['b.acid', 'ACID', 0.6, 'sub', { note: 36, len: 0.25, osc: [['sawtooth', 0, 1]], cut: 300, fenv: 3500, fdec: 0.18, q: 14, drive: 0.15 }, 36],
      ['b.fm', 'FM BASS', 0.8, 'fm', { note: 36, len: 0.4, ratio: 1, index: 4, idec: 0.25, r: 0.25, lvl: 0.8 }, 36],
      ['b.pluck', 'PLUCK BS', 0.6, 'sub', { note: 36, len: 0.05, r: 0.4, osc: [['sawtooth', 0, 1], ['square', -1200, 0.4]], cut: 200, fenv: 2500, fdec: 0.12 }, 36],
      ['b.reese', 'REESE', 1.6, 'sub', { note: 36, len: 1.2, osc: [['sawtooth', -18, 1], ['sawtooth', 18, 1], ['sine', -1200, 0.5]], cut: 700, q: 2, r: 0.3 }, 36],
      ['b.808', '808 BASS', 1.8, 'kick', { f0: 110, f1: 65.4, dec: 1.6, sweep: 0.05, click: 0.1, drive: 0.06 }, 36],
      ['b.wob', 'WOBBLE', 1.2, 'sub', { note: 36, len: 0.9, osc: [['sawtooth', 0, 1], ['square', 7, 0.6]], cut: 300, vib: 0.006, vibRate: 3, fenv: 1500, fdec: 0.6, q: 8 }, 36],
      ['b.rubber', 'RUBBER', 0.7, 'sub', { note: 36, len: 0.3, osc: [['triangle', 0, 1]], glide: 2, cut: 1200 }, 36],
      ['b.dist', 'DIRT BASS', 0.8, 'sub', { note: 36, len: 0.4, osc: [['square', 0, 1], ['sawtooth', 5, 0.7]], cut: 900, fenv: 1500, fdec: 0.2, drive: 0.4, q: 2 }, 36],
      ['b.mono', 'MONO SYN', 0.8, 'sub', { note: 48, len: 0.4, osc: [['sawtooth', 0, 1], ['square', -5, 0.5]], cut: 600, fenv: 2500, fdec: 0.3, q: 5 }, 48],
    ],
    C: [
      ['c.epiano', 'E.PIANO', 1.6, 'fm', { note: 60, len: 0.2, ratio: 1, index: 1.5, idec: 0.6, r: 1.2, bell: 14, lvl: 0.7 }, 60],
      ['c.organ', 'ORGAN', 1.0, 'organ', { note: 60, len: 0.8 }, 60],
      ['c.pluck', 'PLUCK', 0.8, 'sub', { note: 60, len: 0.03, r: 0.6, osc: [['sawtooth', 0, 1], ['sawtooth', 7, 0.5]], cut: 500, fenv: 5000, fdec: 0.15, q: 2 }, 60],
      ['c.pad', 'PAD', 3.0, 'sub', { note: 60, len: 1.8, a: 0.6, r: 1.0, osc: [['sawtooth', -12, 0.6], ['sawtooth', 12, 0.6], ['triangle', 1200, 0.3]], cut: 1500, q: 1, vib: 0.003, vibRate: 0.6 }, 60],
      ['c.bell', 'BELL', 2.2, 'fm', { note: 72, len: 0.05, ratio: 3.5, index: 3, idec: 1.5, r: 2, lvl: 0.5 }, 72],
      ['c.str', 'STRINGS', 2.6, 'sub', { note: 60, len: 1.6, a: 0.3, r: 0.8, osc: [['sawtooth', -8, 0.6], ['sawtooth', 8, 0.6], ['sawtooth', 1200, 0.2]], cut: 2500, vib: 0.004, vibRate: 5 }, 60],
      ['c.lead', 'LEAD', 1.0, 'sub', { note: 72, len: 0.6, r: 0.2, osc: [['square', 0, 0.7], ['sawtooth', 5, 0.6]], cut: 3000, q: 2, vib: 0.006, vibRate: 5.5 }, 72],
      ['c.min7', 'CHORD MIN', 1.4, 'chord', { notes: [60, 63, 67, 70], v: { len: 0.25, r: 0.7, osc: [['sawtooth', 0, 1], ['sawtooth', 9, 0.5]], cut: 700, fenv: 3000, fdec: 0.3, lvl: 0.8 } }, 60],
      ['c.maj7', 'CHORD MAJ', 1.4, 'chord', { notes: [60, 64, 67, 71], voice: R.fm, v: { len: 0.2, ratio: 1, index: 1.2, idec: 0.5, r: 1, lvl: 0.9 } }, 60],
      ['c.marimba', 'MARIMBA', 1.0, 'marimba', { note: 60 }, 60],
      ['c.brass', 'BRASS', 1.2, 'sub', { note: 60, len: 0.6, a: 0.04, r: 0.25, osc: [['sawtooth', 0, 1], ['sawtooth', 6, 0.7]], cut: 600, fenv: 2500, fdec: 0.35, q: 1.5 }, 60],
      ['c.keys', 'KEYS', 1.2, 'fm', { note: 60, len: 0.3, ratio: 2, index: 1, idec: 0.3, r: 0.8, cType: 'triangle', lvl: 0.7 }, 60],
    ],
    D: [
      ['d.vah', 'VOX AH', 1.0, 'vox', { note: 52 }, 52],
      ['d.voh', 'VOX OH', 1.0, 'vox', { note: 55, formants: [[450, 1, 8], [800, 0.5, 10], [2830, 0.2, 12]] }, 55],
      ['d.vee', 'VOX EE', 1.0, 'vox', { note: 59, formants: [[300, 1, 8], [2300, 0.5, 12], [3000, 0.25, 12]] }, 59],
      ['d.loop1', 'LOOP BEAT', 2.0, 'drumloop', {}, 60],
      ['d.loop2', 'LOOP PERC', 2.0, 'percloop', {}, 60],
      ['d.arp', 'LOOP ARP', 2.0, 'arp', {}, 60],
      ['d.riser', 'RISER', 2.2, 'riser', { len: 2 }],
      ['d.down', 'DOWNLIFT', 2.0, 'riser', { len: 1.8, down: true }],
      ['d.impact', 'IMPACT', 2.5, 'impact', {}],
      ['d.zap', 'ZAP', 0.3, 'zap', {}],
      ['d.laser', 'LASER', 0.5, 'laser', {}],
      ['d.vinyl', 'VINYL', 2.0, 'vinyl', { len: 2 }],
    ],
  };
  const EXTRA = [
    ['x.kick3', 'KICK HARD', 0.5, 'kick', { f0: 220, f1: 55, dec: 0.3, click: 0.8, drive: 0.25 }],
    ['x.snare2', 'SNARE 2', 0.4, 'snare', { f: 240, snap: 1, dec: 0.15, seed: 13 }],
    ['x.snap', 'SNAP', 0.15, 'snap', {}],
    ['x.tommid', 'TOM MID', 0.5, 'tom', { f: 140 }],
    ['x.tomhi', 'TOM HI', 0.5, 'tom', { f: 190 }],
    ['x.ride', 'RIDE', 1.4, 'cymbal', { dec: 1.2 }],
    ['x.congahi', 'CONGA HI', 0.4, 'conga', { f: 440 }],
    ['x.glitch', 'GLITCH', 0.8, 'glitch', {}],
    ['x.zapdn', 'ZAP LOW', 0.4, 'zap', { f0: 800, f1: 40, len: 0.35, type: 'triangle' }],
    ['x.loop3', 'LOOP BEAT 2', 2.0, 'drumloop', { kick: [0, 3, 8, 11], ghost: true }, 60],
  ];

  KO.SoundLib = {
    list: [],          // [{id,name,root,factory:true}]
    data: {},          // id -> {sr, data:Float32Array, name, root}
    kits: { A: [], B: [], C: [], D: [] }, // default sample id per pad index

    async build(onProgress) {
      const all = [];
      KO.GROUPS.forEach((g) => DEF[g].forEach((d) => { all.push(d); this.kits[g].push(d[0]); }));
      EXTRA.forEach((d) => all.push(d));
      let done = 0;
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      // render in small batches to keep the UI responsive on phones
      for (let i = 0; i < all.length; i += 6) {
        await Promise.all(all.slice(i, i + 6).map(async ([id, name, dur, rec, opts, root]) => {
          const len = Math.ceil(dur * SR);
          const ctx = new Offline(1, len, SR);
          const out = ctx.createGain(); out.connect(ctx.destination);
          R[rec](ctx, out, 0, opts);
          const buf = await new Promise((res, rej) => {
            const p = ctx.startRendering();
            if (p && p.then) p.then(res, rej); else ctx.oncomplete = (e) => res(e.renderedBuffer);
          });
          const d = new Float32Array(buf.getChannelData(0));
          let peak = 0; for (let k = 0; k < d.length; k++) peak = Math.max(peak, Math.abs(d[k]));
          if (peak > 0) { const s = 0.89 / peak; for (let k = 0; k < d.length; k++) d[k] *= s; }
          // tiny fade-out to avoid clicks
          const fl = Math.min(256, d.length); for (let k = 0; k < fl; k++) d[d.length - 1 - k] *= k / fl;
          this.data[id] = { sr: SR, data: d, name, root: root || 60, factory: true };
          done++; onProgress && onProgress(done / all.length);
        }));
      }
      this.list = all.map(([id, name]) => ({ id, name, factory: true }));
    },

    add(id, name, sr, data, root) {
      this.data[id] = { sr, data, name, root: root || 60, factory: false };
      if (!this.list.find((s) => s.id === id)) this.list.push({ id, name, factory: false });
    },
    remove(id) {
      delete this.data[id];
      this.list = this.list.filter((s) => s.id !== id);
    },
    get(id) { return this.data[id]; },
    name(id) { return this.data[id] ? this.data[id].name : '—'; },
  };
})(window.KO);
