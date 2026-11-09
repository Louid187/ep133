/* Audio engine: voices, group buses, master FX, punch-in FX, sampling */
(function (KO) {
  class Engine {
    constructor() {
      this.ctx = null;
      this.buffers = {};      // sampleId -> AudioBuffer
      this.revBuffers = {};
      this.voices = [];       // active voices
      this.punch = {};        // active punch-in effects (id -> true)
      this.bpm = 120;
    }

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;

      this.mix = c.createGain();             // sum of groups + fx return
      this.master = c.createGain(); this.master.gain.value = 0.9;
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -3; this.limiter.knee.value = 2; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
      this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024;
      this.out = c.createGain();             // final tap (for resampling / wav recording)

      // punch-in chain: mix -> pLP -> pHP -> crusher -> master; + punch delay send
      this.pLP = c.createBiquadFilter(); this.pLP.type = 'lowpass'; this.pLP.frequency.value = 20000; this.pLP.Q.value = 0.7;
      this.pHP = c.createBiquadFilter(); this.pHP.type = 'highpass'; this.pHP.frequency.value = 10; this.pHP.Q.value = 0.7;
      this.crusher = c.createWaveShaper();
      this.mix.connect(this.pLP); this.pLP.connect(this.pHP); this.pHP.connect(this.crusher); this.crusher.connect(this.master);
      this.pDelaySend = c.createGain(); this.pDelaySend.gain.value = 0;
      this.pDelay = c.createDelay(2.0); this.pDelayFb = c.createGain(); this.pDelayFb.gain.value = 0.55;
      this.pHP.connect(this.pDelaySend); this.pDelaySend.connect(this.pDelay); this.pDelay.connect(this.pDelayFb); this.pDelayFb.connect(this.pDelay);
      this.pDelay.connect(this.master);

      this.master.connect(this.limiter); this.limiter.connect(this.out);
      this.out.connect(this.analyser); this.out.connect(c.destination);

      // master send fx
      this.fxIn = c.createGain();
      this.fxOut = c.createGain();
      this.fxOut.connect(this.mix);
      this.buildFx();

      // groups
      this.groups = KO.GROUPS.map(() => {
        const g = {
          input: c.createGain(),
          hp: c.createBiquadFilter(), lp: c.createBiquadFilter(),
          pan: c.createStereoPanner ? c.createStereoPanner() : null,
          vol: c.createGain(), send: c.createGain(),
          meter: c.createAnalyser(),
        };
        g.hp.type = 'highpass'; g.hp.frequency.value = 10; g.lp.type = 'lowpass'; g.lp.frequency.value = 20000;
        g.input.connect(g.hp); g.hp.connect(g.lp);
        let last = g.lp; if (g.pan) { last.connect(g.pan); last = g.pan; }
        last.connect(g.vol); g.vol.connect(this.mix); g.vol.connect(g.send); g.send.connect(this.fxIn);
        g.meter.fftSize = 256; g.vol.connect(g.meter);
        g.send.gain.value = 0;
        return g;
      });

      this.metGain = c.createGain(); this.metGain.gain.value = 0.35; this.metGain.connect(this.master);
    }

    resume() {
      if (!this.ctx) this.init();
      if (this.ctx.state !== 'running') this.ctx.resume();
      // play one silent buffer — unlocks iOS
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    }

    get now() { return this.ctx.currentTime; }

    /* ---------- buffers ---------- */
    bufferFor(id, reverse) {
      let b = this.buffers[id];
      const src = KO.SoundLib.get(id);
      if (!src) return null;
      if (!b || b._srcData !== src.data) {
        b = this.ctx.createBuffer(1, src.data.length, src.sr);
        b.copyToChannel ? b.copyToChannel(src.data, 0) : b.getChannelData(0).set(src.data);
        b._srcData = src.data;
        this.buffers[id] = b; delete this.revBuffers[id];
      }
      if (!reverse) return b;
      let r = this.revBuffers[id];
      if (!r) {
        r = this.ctx.createBuffer(1, src.data.length, src.sr);
        const d = r.getChannelData(0), s = src.data, n = s.length;
        for (let i = 0; i < n; i++) d[i] = s[n - 1 - i];
        this.revBuffers[id] = r;
      }
      return r;
    }
    invalidate(id) { delete this.buffers[id]; delete this.revBuffers[id]; }

    /* ---------- group mix (fader values) ---------- */
    applyGroup(gi, grp) {
      if (!this.ctx) return;
      const g = this.groups[gi], v = grp.fader.values, t = this.ctx.currentTime;
      const vol = grp.mute ? 0 : Math.pow(v.lvl, 1.6) * 1.25;
      g.vol.gain.setTargetAtTime(vol, t, 0.015);
      g.send.gain.setTargetAtTime(v.fx * v.fx, t, 0.02);
      g.lp.frequency.setTargetAtTime(60 * Math.pow(20000 / 60, v.lpf), t, 0.02);
      g.hp.frequency.setTargetAtTime(10 * Math.pow(8000 / 10, v.hpf), t, 0.02);
      if (g.pan) g.pan.pan.setTargetAtTime((v.pan - 0.5) * 2, t, 0.02);
    }

    /* ---------- voices ---------- */
    // opts: {when, group, padIndex, pad, vel, semi, len(seconds|null), gv(group fader values)}
    trigger(o) {
      const c = this.ctx; if (!c) return null;
      const pad = o.pad, gv = o.gv;
      const reverse = !!pad.rev !== !!this.punch.rev;
      const buf = this.bufferFor(pad.s, reverse);
      if (!buf) return null;
      const when = Math.max(o.when || 0, c.currentTime);

      // choke groups (same group, same choke number)
      if (pad.choke) this.voices.forEach((v) => { if (v.group === o.group && v.choke === pad.choke && v.padIndex !== o.padIndex) this.stopVoice(v, when, 0.01); });

      const src = c.createBufferSource(); src.buffer = buf;
      let semis = pad.pit + (o.semi || 0) + (gv.ptc - 0.5) * 24 + (gv.tune - 0.5) * 2;
      if (this.punch.oct) semis -= 12;
      const rate = Math.pow(2, semis / 12);
      src.playbackRate.value = rate;

      const dur = buf.duration;
      let st = KO.clamp(pad.st + gv.trim * (1 - pad.st) * 0.9, 0, 0.999), en = KO.clamp(pad.en, st + 0.001, 1);
      if (reverse) { const s2 = 1 - en, e2 = 1 - st; st = s2; en = e2; }
      const off = st * dur, regionDur = (en - st) * dur;

      const g = c.createGain();
      const vel = o.vel === undefined ? 1 : o.vel;
      const level = Math.pow(pad.vol, 1.5) * 1.1 * (0.15 + 0.85 * vel);
      const atk = pad.atk * 1.5 + gv.atk * 1.5;
      const rel = Math.max(0.005, pad.rel * 3 + gv.rel * 3);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(level, when + Math.max(0.002, atk));

      let pan = null;
      if (c.createStereoPanner && pad.pan) { pan = c.createStereoPanner(); pan.pan.value = pad.pan; }
      src.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.groups[o.group].input); } else g.connect(this.groups[o.group].input);

      const realDur = regionDur / rate;
      const v = { src, g, group: o.group, padIndex: o.padIndex, choke: pad.choke, start: when, ended: false, level, rel, mode: pad.mode, key: o.key };
      if (pad.mode === 'LOOP') {
        src.loop = true; src.loopStart = off; src.loopEnd = off + regionDur;
        src.start(when, off);
      } else {
        src.start(when, off, regionDur + 0.005);
        // fade at region end so trims don't click
        const endT = when + realDur;
        const fadeStart = Math.max(when + Math.max(0.002, atk), endT - Math.min(rel, realDur * 0.5, 0.05));
        g.gain.setValueAtTime(level, fadeStart);
        g.gain.linearRampToValueAtTime(0, endT);
        v.endT = endT;
      }
      if ((pad.mode === 'GATE' || pad.mode === 'LOOP') && o.len) this.stopVoice(v, when + o.len, rel);
      src.onended = () => { v.ended = true; const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); try { g.disconnect(); pan && pan.disconnect(); } catch (e) {} };
      this.voices.push(v);
      if (this.voices.length > 48) this.stopVoice(this.voices[0], c.currentTime, 0.01);
      return v;
    }

    stopVoice(v, when, rel) {
      if (!v || v.ended || v.stopping) return;
      const t = Math.max(when, this.ctx.currentTime);
      v.stopping = true;
      const r = rel === undefined ? v.rel : rel;
      try {
        v.g.gain.cancelScheduledValues(t);
        // hold current scheduled value then ramp down
        v.g.gain.setTargetAtTime(0, t, Math.max(0.002, r / 4));
        v.src.stop(t + r + 0.05);
      } catch (e) {}
    }
    // release gated voices (pad up)
    release(v) { if (v && (v.mode === 'GATE' || v.mode === 'LOOP')) this.stopVoice(v, this.ctx.currentTime); }
    stopAll() { this.voices.slice().forEach((v) => this.stopVoice(v, this.ctx.currentTime, 0.02)); }

    click(when, accent) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.value = accent ? 1760 : 1100; o.type = 'square';
      g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
      o.connect(g); g.connect(this.metGain); o.start(when); o.stop(when + 0.05);
    }

    /* ---------- master FX (send) ---------- */
    buildFx() {
      const c = this.ctx;
      const fx = this.fx = {};
      // delay
      fx.delay = { in: c.createGain(), d: c.createDelay(3), fb: c.createGain(), lp: c.createBiquadFilter(), out: c.createGain() };
      fx.delay.lp.type = 'lowpass'; fx.delay.lp.frequency.value = 5000;
      fx.delay.in.connect(fx.delay.d); fx.delay.d.connect(fx.delay.lp); fx.delay.lp.connect(fx.delay.fb); fx.delay.fb.connect(fx.delay.d);
      fx.delay.lp.connect(fx.delay.out);
      // reverb
      fx.reverb = { in: c.createGain(), conv: c.createConvolver(), lp: c.createBiquadFilter(), out: c.createGain() };
      fx.reverb.lp.type = 'lowpass';
      fx.reverb.in.connect(fx.reverb.conv); fx.reverb.conv.connect(fx.reverb.lp); fx.reverb.lp.connect(fx.reverb.out);
      // distortion
      fx.dist = { in: c.createGain(), ws: c.createWaveShaper(), lp: c.createBiquadFilter(), out: c.createGain() };
      fx.dist.ws.oversample = '2x'; fx.dist.lp.type = 'lowpass';
      fx.dist.in.connect(fx.dist.ws); fx.dist.ws.connect(fx.dist.lp); fx.dist.lp.connect(fx.dist.out);
      // chorus: two modulated delay lines
      fx.chorus = { in: c.createGain(), out: c.createGain(), lines: [] };
      for (let i = 0; i < 2; i++) {
        const d = c.createDelay(0.1), lfo = c.createOscillator(), lg = c.createGain();
        const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
        if (p.pan) p.pan.value = i ? 0.8 : -0.8;
        d.delayTime.value = 0.015 + i * 0.007; lfo.frequency.value = 0.6 + i * 0.13; lfo.start();
        lfo.connect(lg); lg.connect(d.delayTime);
        fx.chorus.in.connect(d); d.connect(p); p.connect(fx.chorus.out);
        fx.chorus.lines.push({ d, lfo, lg });
      }
      // filter
      fx.filter = { in: c.createGain(), f: c.createBiquadFilter(), out: c.createGain() };
      fx.filter.f.type = 'lowpass'; fx.filter.in.connect(fx.filter.f); fx.filter.f.connect(fx.filter.out);
      // compressor (parallel)
      fx.comp = { in: c.createGain(), cmp: c.createDynamicsCompressor(), out: c.createGain() };
      fx.comp.cmp.attack.value = 0.003; fx.comp.cmp.release.value = 0.15;
      fx.comp.in.connect(fx.comp.cmp); fx.comp.cmp.connect(fx.comp.out);

      Object.values(fx).forEach((f) => f.out.connect(this.fxOut));
      this.fxType = null;
      this._revKey = '';
    }

    setFx(fxState) {
      if (!this.ctx) return;
      this._fxState = fxState;
      const type = KO.FX_TYPES[fxState.type].id;
      if (type !== this.fxType) {
        try { this.fxIn.disconnect(); } catch (e) {}
        if (type !== 'off') this.fxIn.connect(this.fx[type].in);
        this.fxType = type;
      }
      const x = fxState.x, y = fxState.y, t = this.ctx.currentTime, fx = this.fx;
      switch (type) {
        case 'delay': {
          const div = KO.DELAY_DIVS[Math.round(x * (KO.DELAY_DIVS.length - 1))];
          fx.delay.d.delayTime.setTargetAtTime(Math.min(2.9, div.b * 60 / this.bpm), t, 0.05);
          fx.delay.fb.gain.setTargetAtTime(y * 0.9, t, 0.02);
          fx.delay.out.gain.value = 1;
          break;
        }
        case 'reverb': {
          const size = 0.4 + x * 4.6;
          const key = size.toFixed(1);
          if (key !== this._revKey) { this._revKey = key; clearTimeout(this._revT); this._revT = setTimeout(() => { fx.reverb.conv.buffer = this.makeIR(size); }, 80); }
          fx.reverb.lp.frequency.setTargetAtTime(800 * Math.pow(18000 / 800, y), t, 0.02);
          fx.reverb.out.gain.value = 1.4;
          break;
        }
        case 'dist': {
          const k = Math.round(x * 40);
          if (this._distK !== k) { this._distK = k; fx.dist.ws.curve = this.distCurve(x); }
          fx.dist.lp.frequency.setTargetAtTime(600 * Math.pow(18000 / 600, y), t, 0.02);
          fx.dist.out.gain.value = 0.7;
          break;
        }
        case 'chorus':
          fx.chorus.lines.forEach((l, i) => { l.lg.gain.setTargetAtTime(0.0005 + x * 0.006, t, 0.02); l.lfo.frequency.setTargetAtTime(0.1 + y * 4 + i * 0.13, t, 0.02); });
          fx.chorus.out.gain.value = 1;
          break;
        case 'filter':
          fx.filter.f.frequency.setTargetAtTime(80 * Math.pow(16000 / 80, x), t, 0.02);
          fx.filter.f.Q.setTargetAtTime(0.5 + y * 18, t, 0.02);
          fx.filter.out.gain.value = 1;
          break;
        case 'comp':
          fx.comp.cmp.threshold.setTargetAtTime(-5 - x * 45, t, 0.02);
          fx.comp.cmp.ratio.setTargetAtTime(2 + x * 18, t, 0.02);
          fx.comp.out.gain.setTargetAtTime(0.5 + y * 3, t, 0.02);
          break;
      }
    }
    setTempo(bpm) {
      this.bpm = bpm;
      if (this._fxState) this.setFx(this._fxState);
    }

    makeIR(seconds) {
      const c = this.ctx, len = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch), r = KO.mulberry(ch + 3);
        for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1);
      }
      return b;
    }
    distCurve(x) {
      const n = 2048, cv = new Float32Array(n), k = 1 + x * 120;
      for (let i = 0; i < n; i++) { const v = i * 2 / n - 1; cv[i] = (1 + k) * v / (1 + k * Math.abs(v)) * 0.8; }
      return cv;
    }

    /* ---------- punch-in FX ---------- */
    punchOn(id) {
      const c = this.ctx, t = c.currentTime;
      this.punch[id] = true;
      const beat = 60 / this.bpm;
      switch (id) {
        case 'lpf': this.pLP.frequency.cancelScheduledValues(t); this.pLP.frequency.setValueAtTime(this.pLP.frequency.value, t); this.pLP.frequency.exponentialRampToValueAtTime(350, t + beat * 2); this.pLP.Q.setTargetAtTime(8, t, 0.05); break;
        case 'hpf': this.pHP.frequency.cancelScheduledValues(t); this.pHP.frequency.setValueAtTime(Math.max(10, this.pHP.frequency.value), t); this.pHP.frequency.exponentialRampToValueAtTime(2500, t + beat * 2); this.pHP.Q.setTargetAtTime(6, t, 0.05); break;
        case 'crush': {
          const n = 4096, cv = new Float32Array(n), steps = 7;
          for (let i = 0; i < n; i++) { const v = i * 2 / n - 1; cv[i] = Math.round(v * 1.6 * steps) / steps; }
          this.crusher.curve = cv; break;
        }
        case 'dly16': case 'dly8': case 'dly4': case 'dlyT': {
          const b = { dly16: 0.25, dly8: 0.5, dly4: 1, dlyT: 1 / 3 }[id];
          this.pDelay.delayTime.setValueAtTime(b * beat, t);
          this.pDelaySend.gain.setTargetAtTime(0.85, t, 0.01);
          break;
        }
      }
    }
    punchOff(id) {
      const c = this.ctx, t = c.currentTime;
      delete this.punch[id];
      switch (id) {
        case 'lpf': this.pLP.frequency.cancelScheduledValues(t); this.pLP.frequency.setValueAtTime(this.pLP.frequency.value, t); this.pLP.frequency.exponentialRampToValueAtTime(20000, t + 0.15); this.pLP.Q.setTargetAtTime(0.7, t, 0.05); break;
        case 'hpf': this.pHP.frequency.cancelScheduledValues(t); this.pHP.frequency.setValueAtTime(Math.max(10, this.pHP.frequency.value), t); this.pHP.frequency.exponentialRampToValueAtTime(10, t + 0.15); this.pHP.Q.setTargetAtTime(0.7, t, 0.05); break;
        case 'crush': this.crusher.curve = null; break;
        case 'dly16': case 'dly8': case 'dly4': case 'dlyT':
          if (!this.punch.dly16 && !this.punch.dly8 && !this.punch.dly4 && !this.punch.dlyT) this.pDelaySend.gain.setTargetAtTime(0, t, 0.01);
          break;
      }
    }

    /* ---------- sampling ---------- */
    async openMic() {
      if (this.micStream) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Microphone not available (needs HTTPS)');
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.micSrc = this.ctx.createMediaStreamSource(this.micStream);
      this.micGain = this.ctx.createGain(); this.micGain.gain.value = 1;
      this.micSrc.connect(this.micGain);
      this.inMeter = this.ctx.createAnalyser(); this.inMeter.fftSize = 512;
      this.micGain.connect(this.inMeter);
      return true;
    }
    closeMic() {
      if (this.recorder) return;
      if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; }
      try { this.micSrc && this.micSrc.disconnect(); } catch (e) {}
      this.micSrc = null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    }
    inputLevel(source) {
      const an = source === 'resample' ? this.analyser : this.inMeter;
      if (!an) return 0;
      const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
      let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
      return p;
    }
    // start capturing raw PCM from mic or main output
    startCapture(source) {
      const c = this.ctx;
      const node = c.createScriptProcessor(4096, 2, 2);
      const chunks = [];
      node.onaudioprocess = (e) => {
        const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : a;
        const m = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) * 0.5;
        chunks.push(m);
        const out = e.outputBuffer; for (let ch = 0; ch < out.numberOfChannels; ch++) out.getChannelData(ch).fill(0);
      };
      const inp = source === 'resample' ? this.out : this.micGain;
      inp.connect(node);
      const sink = c.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(c.destination);
      this.recorder = { node, chunks, inp, sink, t0: c.currentTime };
    }
    stopCapture() {
      const r = this.recorder; if (!r) return null;
      try { r.inp.disconnect(r.node); } catch (e) {}
      r.node.disconnect(); r.sink.disconnect();
      this.recorder = null;
      let n = 0; r.chunks.forEach((ch) => (n += ch.length));
      const data = new Float32Array(n); let o = 0;
      r.chunks.forEach((ch) => { data.set(ch, o); o += ch.length; });
      return { sr: this.ctx.sampleRate, data };
    }
    captureSeconds() { return this.recorder ? this.ctx.currentTime - this.recorder.t0 : 0; }

    static trimAndNormalize(data, thresh) {
      thresh = thresh || 0.02;
      let s = 0, e = data.length - 1;
      while (s < data.length && Math.abs(data[s]) < thresh) s++;
      while (e > s && Math.abs(data[e]) < thresh * 0.5) e--;
      s = Math.max(0, s - 64); e = Math.min(data.length - 1, e + 2048);
      if (e - s < 256) return null;
      const out = data.slice(s, e + 1);
      let peak = 0; for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
      if (peak > 0.0001) { const k = 0.9 / peak; for (let i = 0; i < out.length; i++) out[i] *= k; }
      const f = Math.min(256, out.length); for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
      return out;
    }

    async decodeFile(file) {
      const ab = await file.arrayBuffer();
      const buf = await new Promise((res, rej) => {
        const p = this.ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const n = Math.min(buf.length, buf.sampleRate * 30);
      const data = new Float32Array(n);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) data[i] += d[i] / buf.numberOfChannels;
      }
      return { sr: buf.sampleRate, data };
    }
  }
  KO.Engine = Engine;
})(window.KO);
