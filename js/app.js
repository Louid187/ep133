/* App glue: boot, layout, project management, actions used by UI + sequencer */
(function (KO) {
  const app = {
    engine: new KO.Engine(),
    proj: null,
    slot: 1,
    undoStack: [],
    started: false,

    /* ---------- boot ---------- */
    async boot() {
      this.ui = new KO.UI(this);
      this.seq = new KO.Sequencer(this);
      this.ui.build();
      this.layout();
      window.addEventListener('resize', () => this.layout());
      window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
      document.addEventListener('gesturestart', (e) => e.preventDefault());
      document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

      const status = document.getElementById('start-status');
      const btn = document.getElementById('start-btn');
      btn.disabled = true; btn.textContent = 'Loading sounds…';
      try {
        await KO.SoundLib.build((f) => (status.textContent = 'Synthesising sounds ' + Math.round(f * 100) + '%'));
      } catch (e) {
        status.textContent = 'Could not build sounds: ' + e.message; console.error(e); return;
      }
      const user = await KO.SampleDB.all();
      user.forEach((r) => KO.SoundLib.add(r.id, r.name, r.sr, r.data instanceof Float32Array ? r.data : new Float32Array(r.data), r.root));
      status.textContent = '';
      btn.disabled = false; btn.textContent = 'Tap to start';

      this.slot = KO.Store.lastSlot();
      this.proj = KO.Store.load(this.slot) || KO.newProject(true);
      this.sanitize();
      this.display = new KO.Display(document.getElementById('lcd'), this);
      this.saveSoon = KO.debounce(() => KO.Store.save(this.slot, this.proj), 800);
      document.getElementById('vel-mode').textContent = this.ui.velMode;

      btn.addEventListener('click', () => this.start());
      this.bindMenus();
      requestAnimationFrame(() => this.frame());
      if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    },

    start() {
      if (this.started) return;
      this.started = true;
      this.unlock();
      document.getElementById('start').classList.remove('show');
      this.engine.setTempo(this.proj.bpm);
      this.engine.setFx(this.proj.fx);
      this.proj.groups.forEach((g, i) => this.engine.applyGroup(i, g));
      this.seq.startClock();
      this.layout();
    },

    // must run inside a user gesture (iOS)
    unlock() {
      if (!this.started) return;
      this.engine.resume();
      if (!this._silent) {
        try { if (navigator.audioSession && !this.engine.micStream) navigator.audioSession.type = 'playback'; } catch (e) {}
        // a silent looping <audio> lets Web Audio play with the iOS ring/silent switch on
        const a = document.createElement('audio');
        a.setAttribute('x-webkit-airplay', 'deny'); a.loop = true; a.preload = 'auto';
        const sz = 4000, sb = new Float32Array(sz);
        a.src = URL.createObjectURL(this.encodeWav([sb], [sb], 8000));
        const p = a.play(); if (p && p.catch) p.catch(() => {});
        this._silent = a;
      }
    },

    sanitize() {
      const P = this.proj;
      P.groups.forEach((g) => g.pads.forEach((pad, i) => { if (!KO.SoundLib.get(pad.s)) pad.s = KO.SoundLib.kits.A[i] || 'a.kick'; }));
      if (P.scene >= P.scenes.length) P.scene = 0;
    },

    /* ---------- layout scaling ---------- */
    layout() {
      const stage = document.getElementById('stage'), dev = document.getElementById('device');
      const w = stage.clientWidth, h = stage.clientHeight;
      const landscape = w / h > 1.3;
      dev.className = landscape ? 'landscape' : 'portrait';
      const U = landscape ? { w: 162, h: 73 } : { w: 102, h: 114 };
      const u = Math.max(2, Math.min((w - 16) / U.w, (h - 16) / U.h, 9));
      document.documentElement.style.setProperty('--u', u.toFixed(3) + 'px');
      if (this.display) requestAnimationFrame(() => this.display.resize());
    },

    /* ---------- render loop ---------- */
    frame() {
      requestAnimationFrame(() => this.frame());
      if (!this.proj) return;
      // pad flashes from scheduled notes
      if (this.started) {
        const now = this.engine.ctx.currentTime;
        while (this.visQ && this.visQ.length && this.visQ[0].t <= now) {
          const v = this.visQ.shift();
          if (v.g === this.ui.group) this.ui.hitUntil[v.p] = performance.now() + 90;
        }
        // safety stop for long recordings
        if (this.engine.recorder && this.engine.captureSeconds() > 20) Object.keys(this.ui.padState).forEach((p) => this.ui.padUp(+p));
      }
      this.ui.refresh();
      this.display.draw();
    },

    /* ---------- sound ---------- */
    playNote(gi, padIdx, vel, semi, when, lenSec, fromSeq, visPad) {
      const g = this.proj.groups[gi], pad = g.pads[padIdx];
      const v = this.engine.trigger({ when, group: gi, padIndex: padIdx, pad, vel, semi, len: lenSec, gv: g.fader.values });
      const vp = visPad !== undefined ? visPad : (g.keys && semi ? KO.mod(semi, 12) : padIdx);
      if (fromSeq) { (this.visQ || (this.visQ = [])).push({ t: when, g: gi, p: vp }); if (this.visQ.length > 256) this.visQ.splice(0, 128); }
      else if (gi === this.ui.group) this.ui.hitUntil[vp] = performance.now() + 90;
      return v;
    },
    preview(gi, p) {
      if (!this.started) return;
      const v = this.playNote(gi, p, 1, 0, 0, 0.4, false);
      return v;
    },
    previewSel() { const g = this.proj.groups[this.ui.group]; this.preview(this.ui.group, g.sel); },

    /* ---------- transport ---------- */
    togglePlay() {
      if (this.seq.playing) { this.seq.stop(); this.seq.song = false; }
      else this.seq.play();
    },
    toggleRecord() {
      this.seq.recording = !this.seq.recording;
      this._undoArmed = {};
    },
    toggleSong() {
      if (this.seq.song) { this.seq.song = false; this.ui.show('SONG MODE', 'OFF'); return; }
      this.seq.stop();
      this.setScene(0, true);
      this.seq.song = true;
      this.seq.play();
      this.ui.show('SONG MODE', this.proj.scenes.length + ' SCENES');
    },
    setBpm(b) {
      this.proj.bpm = Math.round(KO.clamp(b, 40, 240) * 10) / 10;
      this.engine.setTempo(this.proj.bpm);
      this.dirty();
    },

    /* ---------- fader ---------- */
    setFader(v) {
      const g = this.proj.groups[this.ui.group], fp = KO.FADER_PARAMS[g.fader.param];
      g.fader.values[fp.id] = v;
      this.engine.applyGroup(this.ui.group, g);
      let disp = Math.round(v * 100);
      if (fp.id === 'ptc') disp = ((v - 0.5) * 24).toFixed(1);
      if (fp.id === 'pan') disp = Math.round((v - 0.5) * 200);
      this.ui.show('FADER ' + KO.GROUPS[this.ui.group] + ' ' + fp.name, disp, 600);
      this.dirty();
    },
    nudgeFader(d) {
      const g = this.proj.groups[this.ui.group], fp = KO.FADER_PARAMS[g.fader.param];
      this.setFader(KO.clamp(g.fader.values[fp.id] + d, 0, 1));
    },
    applyFaderUI() { /* fader is drawn from state in ui.refresh */ },

    /* ---------- patterns & scenes ---------- */
    setPattern(gi, n) {
      const P = this.proj;
      P.scenes[P.scene].pat[gi] = n;
      const exists = !!P.patterns[gi][n];
      this.ui.show(KO.GROUPS[gi] + ' PATTERN', KO.pad2(n) + (exists ? '' : ' NEW'), 700);
      this.dirty();
    },
    setBars(gi, d) {
      const pat = this.seq.ensurePattern(gi);
      const opts = [1, 2, 3, 4, 6, 8, 12, 16];
      let i = opts.indexOf(pat.bars); if (i < 0) i = 0;
      const nb = opts[KO.clamp(i + d, 0, opts.length - 1)];
      if (nb > pat.bars && pat.notes.length) {
        // extend by repeating the existing content
        const L = pat.bars * KO.BAR, add = [];
        for (let k = 1; k * pat.bars < nb; k++) pat.notes.forEach((n) => { if (n.t + k * L < nb * KO.BAR) add.push(Object.assign({}, n, { t: n.t + k * L })); });
        pat.notes = pat.notes.concat(add);
      } else if (nb < pat.bars) pat.notes = pat.notes.filter((n) => n.t < nb * KO.BAR);
      pat.bars = nb;
      this.ui.show(KO.GROUPS[gi] + ' LENGTH', nb + (nb > 1 ? ' BARS' : ' BAR'), 700);
      this.dirty();
    },
    setScene(i, immediate) {
      const P = this.proj;
      P.scene = KO.clamp(i, 0, P.scenes.length - 1);
      this.dirty();
    },
    changeScene(d) {
      const P = this.proj;
      const base = this.seq.pendingScene !== null ? this.seq.pendingScene : P.scene;
      let n = base + d;
      if (n < 0) return;
      if (n >= P.scenes.length) {
        if (P.scenes.length >= 99) return;
        P.scenes.push(KO.deepCopy(P.scenes[P.scenes.length - 1]));
        n = P.scenes.length - 1;
        this.ui.show('SCENE', KO.pad2(n + 1) + ' NEW');
      } else this.ui.show('SCENE', KO.pad2(n + 1));
      if (this.seq.playing) this.seq.pendingScene = n; else P.scene = n;
      this.dirty();
    },
    duplicatePattern(gi) {
      const P = this.proj, cur = P.scenes[P.scene].pat[gi];
      let n = 1; while (P.patterns[gi][n] && n < 99) n++;
      if (P.patterns[gi][n]) { this.ui.show('DUPLICATE', 'FULL'); return; }
      P.patterns[gi][n] = KO.deepCopy(P.patterns[gi][cur] || { bars: 1, notes: [] });
      P.scenes[P.scene].pat[gi] = n;
      this.ui.show('DUPLICATED TO', KO.GROUPS[gi] + KO.pad2(n));
      this.dirty();
    },

    /* ---------- editing ---------- */
    pushUndo(gi) {
      const P = this.proj, n = P.scenes[P.scene].pat[gi];
      this.undoStack.push({ gi, n, data: P.patterns[gi][n] ? KO.deepCopy(P.patterns[gi][n]) : null });
      if (this.undoStack.length > 40) this.undoStack.shift();
    },
    // one undo snapshot per group per record pass
    pushUndoOnce(gi) {
      this._undoArmed = this._undoArmed || {};
      if (this._undoArmed[gi]) return;
      this._undoArmed[gi] = true; this.pushUndo(gi);
    },
    undo() {
      const u = this.undoStack.pop();
      if (!u) { this.ui.show('UNDO', 'NOTHING'); return; }
      if (u.data) this.proj.patterns[u.gi][u.n] = u.data; else delete this.proj.patterns[u.gi][u.n];
      this._undoArmed = {};
      this.ui.show('UNDO', KO.GROUPS[u.gi] + KO.pad2(u.n));
      this.dirty();
    },
    erasePad(gi, p) {
      const pat = this.seq.patternOf(gi); if (!pat) return;
      this.pushUndo(gi);
      const g = this.proj.groups[gi];
      pat.notes = pat.notes.filter((n) => g.keys ? !(n.p === g.sel && KO.mod(n.k, 12) === p) : n.p !== p);
      this.dirty();
    },
    clearPattern(gi) {
      const pat = this.seq.patternOf(gi); if (!pat) return;
      this.pushUndo(gi);
      pat.notes = [];
      this.dirty();
    },
    copySound(src, dst) {
      const P = this.proj;
      P.groups[dst.g].pads[dst.p] = KO.deepCopy(P.groups[src.g].pads[src.p]);
      this.dirty();
    },

    /* ---------- samples ---------- */
    assignNewSample(gi, p, name, sr, data) {
      const id = 'u.' + KO.uid();
      KO.SoundLib.add(id, name, sr, data, 60);
      KO.SampleDB.put({ id, name, sr, data, root: 60 });
      const pad = this.proj.groups[gi].pads[p];
      Object.assign(pad, { s: id, st: 0, en: 1, pit: 0, rev: false, mode: 'ONE' });
      this.proj.groups[gi].sel = p;
      this.dirty();
    },
    importAudio() {
      const inp = document.getElementById('file-audio');
      inp.value = '';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        try {
          if (!this.started) this.start();
          const res = await this.engine.decodeFile(f);
          const name = f.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 12);
          const g = this.proj.groups[this.ui.group];
          this.assignNewSample(this.ui.group, g.sel, name, res.sr, res.data);
          this.ui.show('IMPORTED', name, 1200);
          this.previewSel();
        } catch (e) { console.error(e); this.ui.show('IMPORT', 'FAILED', 1500); }
      };
      inp.click();
    },

    /* ---------- projects ---------- */
    dirty() { this.saveSoon && this.saveSoon(); },
    loadProject(n) {
      KO.Store.save(this.slot, this.proj);
      this.seq.stop(); this.seq.recording = false; this.seq.song = false;
      this.slot = n;
      this.proj = KO.Store.load(n) || KO.newProject(false);
      this.sanitize();
      this.undoStack = [];
      KO.Store.save(n, this.proj);
      this.engine.setTempo(this.proj.bpm); this.engine.setFx(this.proj.fx);
      this.proj.groups.forEach((g, i) => this.engine.applyGroup(i, g));
      this.ui.show('PROJECT', String(n));
    },

    bindMenus() {
      const open = (id) => document.getElementById(id).classList.add('show');
      document.getElementById('btn-help').onclick = () => open('help');
      document.getElementById('btn-menu').onclick = () => open('menu');
      const kh = document.getElementById('btn-keys-hint');
      kh.onclick = () => { document.body.classList.toggle('show-keys'); kh.classList.toggle('on'); };
      document.querySelectorAll('.overlay [data-close]').forEach((b) => (b.onclick = () => b.closest('.overlay').classList.remove('show')));
      document.querySelectorAll('.overlay:not(#start)').forEach((o) => o.addEventListener('pointerdown', (e) => { if (e.target === o) o.classList.remove('show'); }));
      const close = () => document.getElementById('menu').classList.remove('show');
      document.querySelectorAll('#menu [data-action]').forEach((b) => (b.onclick = () => {
        const a = b.dataset.action;
        if (a === 'import-sample') { close(); this.importAudio(); }
        else if (a === 'export-project') { this.exportProject(); close(); }
        else if (a === 'import-project') { close(); this.importProject(); }
        else if (a === 'render-wav') { this.toggleWav(b); }
        else if (a === 'velocity') {
          this.ui.velMode = this.ui.velMode === 'fixed' ? 'position' : 'fixed';
          KO.Store.setSetting('velMode', this.ui.velMode);
          document.getElementById('vel-mode').textContent = this.ui.velMode === 'fixed' ? 'fixed (fader VEL)' : 'by touch position (top = loud)';
        } else if (a === 'reset-project') {
          if (confirm('Reset project ' + this.slot + '? This cannot be undone.')) {
            this.seq.stop(); this.proj = KO.newProject(true); this.undoStack = [];
            KO.Store.save(this.slot, this.proj); this.engine.setFx(this.proj.fx); this.proj.groups.forEach((g, i) => this.engine.applyGroup(i, g)); close();
          }
        }
      }));
    },

    exportProject() {
      const blob = new Blob([JSON.stringify(this.proj, (k, v) => (k[0] === '_' ? undefined : v), 1)], { type: 'application/json' });
      this.download(blob, 'ko-sim-project-' + this.slot + '.json');
    },
    importProject() {
      const inp = document.getElementById('file-project');
      inp.value = '';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        try {
          const p = KO.migrateProject(JSON.parse(await f.text()));
          this.seq.stop(); this.proj = p; this.sanitize(); this.undoStack = [];
          KO.Store.save(this.slot, p); this.engine.setTempo(p.bpm); this.engine.setFx(p.fx); p.groups.forEach((g, i) => this.engine.applyGroup(i, g));
          this.ui.show('PROJECT', 'IMPORTED');
        } catch (e) { alert('Could not read project: ' + e.message); }
      };
      inp.click();
    },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    // record master output to a stereo WAV file
    toggleWav(btn) {
      if (!this.started) return;
      const e = this.engine, c = e.ctx;
      if (this._wav) {
        const w = this._wav; this._wav = null;
        e.out.disconnect(w.node); w.node.disconnect();
        btn.classList.remove('on'); btn.textContent = 'Record output to WAV (start / stop)';
        this.download(this.encodeWav(w.L, w.R, c.sampleRate), 'ko-sim-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.wav');
        return;
      }
      const node = c.createScriptProcessor(4096, 2, 2), L = [], R = [];
      node.onaudioprocess = (ev) => {
        const ib = ev.inputBuffer;
        L.push(new Float32Array(ib.getChannelData(0))); R.push(new Float32Array(ib.numberOfChannels > 1 ? ib.getChannelData(1) : ib.getChannelData(0)));
        for (let ch = 0; ch < ev.outputBuffer.numberOfChannels; ch++) ev.outputBuffer.getChannelData(ch).fill(0);
      };
      e.out.connect(node); const sink = c.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(c.destination);
      this._wav = { node, L, R };
      btn.classList.add('on'); btn.textContent = '● Recording… tap to stop and save WAV';
    },
    encodeWav(L, R, sr) {
      let n = 0; L.forEach((a) => (n += a.length));
      const buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
      ws(36, 'data'); v.setUint32(40, n * 4, true);
      let o = 44;
      for (let c = 0; c < L.length; c++) for (let i = 0; i < L[c].length; i++) {
        v.setInt16(o, KO.clamp(L[c][i], -1, 1) * 32767, true); v.setInt16(o + 2, KO.clamp(R[c][i], -1, 1) * 32767, true); o += 4;
      }
      return new Blob([buf], { type: 'audio/wav' });
    },
  };

  KO.app = app;
  window.addEventListener('DOMContentLoaded', () => app.boot());
})(window.KO);
