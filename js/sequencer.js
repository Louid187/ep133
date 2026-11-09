/* Look-ahead sequencer. The clock runs permanently (note repeat works while stopped);
   pattern playback only happens while `playing`. */
(function (KO) {
  class Sequencer {
    constructor(app) {
      this.app = app;
      this.playing = false;
      this.recording = false;
      this.song = false;
      this.tick = 0;          // next tick to be processed
      this.nextTime = 0;      // audio time of `tick`
      this.startTick = 0;     // tick at which the current scene started
      this.lookahead = 0.12;
      this.repeats = new Map();
      this.loop = null;       // loop punch-in {len, anchor}
      this.pendingScene = null;
    }
    get ctx() { return this.app.engine.ctx; }
    get spt() { return 60 / this.app.proj.bpm / KO.PPQ; }

    startClock() {
      this.nextTime = this.ctx.currentTime + 0.05;
      clearInterval(this._iv);
      this._iv = setInterval(() => this.run(), 20);
    }

    run() {
      const now = this.ctx.currentTime;
      if (this.nextTime < now - 0.25) this.nextTime = now + 0.02; // recover after suspension
      let guard = 0;
      while (this.nextTime < now + this.lookahead && guard++ < 2000) {
        this.process(this.tick, this.nextTime);
        this.tick++;
        this.nextTime += this.spt;
      }
    }

    /* ---------- transport ---------- */
    play() {
      if (this.playing) return;
      const now = this.ctx.currentTime;
      this.tick = 0; this.startTick = 0; this.nextTime = now + 0.04;
      this.playing = true; this.loop = null; this.pendingScene = null;
      this.run();
    }
    stop() {
      this.playing = false; this.pendingScene = null;
      this.app.engine.stopAll();
    }

    // absolute (fractional) tick at the moment the user hears "now"
    tickNow(compensate) {
      const c = this.ctx;
      let t = c.currentTime;
      if (compensate) t -= (c.outputLatency || 0) + (c.baseLatency || 0) * 0.5;
      return this.tick - (this.nextTime - t) / this.spt;
    }
    relNow() { return Math.max(0, this.tickNow(false) - this.startTick); }

    patternOf(gi) {
      const P = this.app.proj; const n = P.scenes[P.scene].pat[gi];
      return P.patterns[gi][n];
    }
    sceneLen(sceneIdx) {
      const P = this.app.proj, sc = P.scenes[sceneIdx];
      let m = 1;
      sc.pat.forEach((n, gi) => { const p = P.patterns[gi][n]; if (p && p.notes.length) m = Math.max(m, p.bars); });
      return m * KO.BAR;
    }

    /* ---------- the tick ---------- */
    process(tick, time) {
      const app = this.app, P = app.proj;
      if (this.playing) {
        let rel = tick - this.startTick;
        // song mode: advance scenes
        if (this.song && rel > 0 && rel >= this.sceneLen(P.scene)) {
          app.setScene((P.scene + 1) % P.scenes.length, true);
          this.startTick = tick; rel = 0;
        } else if (this.pendingScene !== null && rel > 0 && rel % KO.BAR === 0) {
          app.setScene(this.pendingScene, true);
          this.pendingScene = null; this.startTick = tick; rel = 0;
        }
        let eff = rel;
        if (this.loop) {
          if (this.loop.anchor === null) this.loop.anchor = Math.floor(rel / this.loop.len) * this.loop.len;
          if (rel >= this.loop.anchor) eff = this.loop.anchor + KO.mod(rel - this.loop.anchor, this.loop.len);
        }
        const spt = this.spt;
        for (let gi = 0; gi < 4; gi++) {
          const grp = P.groups[gi];
          const pat = this.patternOf(gi); if (!pat || !pat.notes.length) continue;
          const len = pat.bars * KO.BAR, pos = eff % len;
          const sw = KO.clamp(P.swing + grp.fader.values.swing, 0, 1) * 12;
          for (let i = 0; i < pat.notes.length; i++) {
            const n = pat.notes[i];
            if (n.t !== pos) continue;
            if (n._skipAt !== undefined) { const s = n._skipAt; delete n._skipAt; if (s === tick) continue; }
            if (grp.mute || grp.mutePads[n.p]) continue;
            const off = (n.t % 48 === 24) ? sw * spt : 0;
            app.playNote(gi, n.p, n.v, n.k || 0, time + off, n.l * spt, true);
          }
        }
        if (P.metronome && rel % KO.PPQ === 0) app.engine.click(time, rel % KO.BAR === 0);
      }
      // note repeat
      if (this.repeats.size) {
        const iv = KO.REPEAT[P.repeat].t;
        const base = this.playing ? tick - this.startTick : tick;
        if (base % iv === 0) {
          this.repeats.forEach((r) => {
            app.playNote(r.group, r.pad, r.vel, r.semi, time, iv * this.spt * 0.8, false);
            if (this.playing && this.recording) this.addNoteAt(r.group, r.pad, r.vel, r.semi, base, Math.round(iv * 0.8));
          });
        }
      }
    }

    /* ---------- recording ---------- */
    ensurePattern(gi) {
      const P = this.app.proj, n = P.scenes[P.scene].pat[gi];
      if (!P.patterns[gi][n]) P.patterns[gi][n] = { bars: 1, notes: [] };
      return P.patterns[gi][n];
    }
    addNoteAt(gi, pad, vel, semi, rel, len) {
      const pat = this.ensurePattern(gi), L = pat.bars * KO.BAR, t = KO.mod(rel, L);
      pat.notes = pat.notes.filter((n) => !(n.t === t && n.p === pad && (n.k || 0) === (semi || 0)));
      const note = { t, p: pad, v: vel, l: len || KO.STEP, k: semi || 0 };
      pat.notes.push(note);
      this.app.dirty();
      return note;
    }
    // live record a pad press; returns note (so the release can set its length)
    recordNote(gi, pad, vel, semi) {
      const P = this.app.proj;
      const pat = this.ensurePattern(gi), L = pat.bars * KO.BAR;
      const tn = this.tickNow(true), relF = tn - this.startTick;
      const pos = KO.mod(relF, L);
      const q = KO.QUANT[P.quant].t;
      const qp = q ? Math.round(pos / q) * q : Math.round(pos);
      const absQ = Math.round(tn - pos + qp);
      const t = KO.mod(qp, L);
      pat.notes = pat.notes.filter((n) => !(n.t === t && n.p === pad && (n.k || 0) === (semi || 0)));
      const note = { t, p: pad, v: vel, l: KO.STEP, k: semi || 0 };
      if (absQ >= this.tick) note._skipAt = absQ;   // already sounded live — don't double-trigger
      note._press = tn;
      pat.notes.push(note);
      this.app.dirty();
      return note;
    }
    releaseNote(note) {
      if (!note || note._press === undefined) return;
      note.l = Math.max(6, Math.round(this.tickNow(true) - note._press));
      delete note._press;
      this.app.dirty();
    }
  }
  KO.Sequencer = Sequencer;
})(window.KO);
