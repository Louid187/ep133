/* Project model + persistence (localStorage for projects, IndexedDB for user samples) */
(function (KO) {
  function defaultPad(sampleId, g, p) {
    const pad = { s: sampleId, vol: 0.8, pit: 0, pan: 0, atk: 0, rel: 0.02, st: 0, en: 1, mode: 'ONE', choke: 0, rev: false };
    if (g === 0 && (sampleId === 'a.chh' || sampleId === 'a.ohh')) pad.choke = 1;
    if (g === 1 || g === 2) pad.mode = 'GATE';
    if (g === 1 || g === 2) pad.rel = 0.15;
    if (sampleId && /loop/.test(sampleId)) pad.mode = 'ONE';
    return pad;
  }

  function defaultFader() {
    const v = {}; KO.FADER_PARAMS.forEach((f) => (v[f.id] = f.def));
    return { param: KO.faderIndex('lvl'), values: v };
  }

  // a little demo groove in pattern 1 so the first PLAY does something
  function demoPatterns() {
    const S = KO.STEP, n = (t, p, v = 1, l = S, k = 0) => ({ t: t * S, p, v, l, k });
    const A = [], B = [], C = [];
    [0, 6, 8, 11].forEach((s) => A.push(n(s, 3)));          // kick
    [4, 12].forEach((s) => A.push(n(s, 4)));                // snare
    for (let s = 0; s < 16; s += 2) A.push(n(s, 5, s % 4 ? 0.6 : 0.9)); // hats
    A.push(n(14, 8, 0.7));                                  // open hat
    [[0, 0], [3, 0], [6, 3], [8, 5], [10, 7], [14, 3]].forEach(([s, k]) => B.push(n(s, 1, 0.9, S * 2, k)));
    C.push(n(0, 7, 0.7, S * 6)); C.push(n(8, 7, 0.7, S * 6, -2));
    return [{ bars: 1, notes: A }, { bars: 1, notes: B }, { bars: 1, notes: C }, { bars: 1, notes: [] }];
  }

  KO.newProject = function (withDemo) {
    const demo = withDemo ? demoPatterns() : null;
    const proj = {
      v: 1,
      bpm: 120, swing: 0, quant: 3, repeat: 2, metronome: false,
      fx: { type: 1, x: 0.45, y: 0.35, params: {} },
      groups: KO.GROUPS.map((name, g) => ({
        pads: KO.SoundLib.kits[name].map((id, p) => defaultPad(id, g, p)),
        fader: defaultFader(),
        keys: false, octave: 0, mute: false, mutePads: new Array(12).fill(false), sel: g === 0 ? 3 : 0,
      })),
      patterns: KO.GROUPS.map((_, g) => ({ 1: demo ? demo[g] : { bars: 1, notes: [] } })),
      scenes: [{ pat: [1, 1, 1, 1] }],
      scene: 0,
    };
    proj.groups[0].fader.values.fx = 0.05;
    proj.groups[2].fader.values.fx = 0.25;
    proj.groups[3].fader.values.fx = 0.2;
    return proj;
  };

  // fill missing fields after loading older/foreign data
  KO.migrateProject = function (p) {
    const base = KO.newProject(false);
    for (const k in base) if (p[k] === undefined) p[k] = base[k];
    p.groups.forEach((g, i) => {
      for (const k in base.groups[i]) if (g[k] === undefined) g[k] = base.groups[i][k];
      for (const k in base.groups[i].fader.values) if (g.fader.values[k] === undefined) g.fader.values[k] = base.groups[i].fader.values[k];
      g.pads.forEach((pad, j) => { const d = base.groups[i].pads[j]; for (const k in d) if (pad[k] === undefined) pad[k] = d[k]; });
    });
    return p;
  };

  /* ---- localStorage projects ---- */
  const KEY = (slot) => 'kosim.project.' + slot;
  KO.Store = {
    slot: 1,
    load(slot) {
      try {
        const s = localStorage.getItem(KEY(slot));
        if (s) return KO.migrateProject(JSON.parse(s));
      } catch (e) { console.warn('load failed', e); }
      return null;
    },
    save(slot, proj) {
      try { localStorage.setItem(KEY(slot), JSON.stringify(proj, (k, v) => (k[0] === '_' ? undefined : v))); localStorage.setItem('kosim.slot', String(slot)); }
      catch (e) { console.warn('save failed', e); }
    },
    exists(slot) { try { return !!localStorage.getItem(KEY(slot)); } catch (e) { return false; } },
    remove(slot) { try { localStorage.removeItem(KEY(slot)); } catch (e) {} },
    lastSlot() { try { return parseInt(localStorage.getItem('kosim.slot') || '1', 10) || 1; } catch (e) { return 1; } },
    getSetting(k, d) { try { const v = localStorage.getItem('kosim.set.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    setSetting(k, v) { try { localStorage.setItem('kosim.set.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---- IndexedDB user samples ---- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no indexeddb'));
      const r = indexedDB.open('kosim', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('samples', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  KO.SampleDB = {
    async put(rec) {
      try {
        const d = await db();
        await new Promise((res, rej) => { const tx = d.transaction('samples', 'readwrite'); tx.objectStore('samples').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      } catch (e) { console.warn('sample save failed', e); }
    },
    async all() {
      try {
        const d = await db();
        return await new Promise((res, rej) => { const tx = d.transaction('samples', 'readonly'); const q = tx.objectStore('samples').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      } catch (e) { console.warn('sample load failed', e); return []; }
    },
  };
})(window.KO);
