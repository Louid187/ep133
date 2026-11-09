/* Shared helpers and constants */
window.KO = window.KO || {};

(function (KO) {
  KO.PPQ = 96;                 // ticks per quarter note
  KO.STEP = KO.PPQ / 4;        // one 16th
  KO.BAR = KO.PPQ * 4;         // one 4/4 bar
  KO.GROUPS = ['A', 'B', 'C', 'D'];

  // Pad index p (0..11) is ordered bottom-left -> top-right, so that keys mode is chromatic
  // upwards. Physical layout (top to bottom):  7 8 9 / 4 5 6 / 1 2 3 / . 0 ENTER
  KO.PAD_LABELS = ['.', '0', 'ENTER', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  KO.PAD_LAYOUT = [9, 10, 11, 6, 7, 8, 3, 4, 5, 0, 1, 2]; // DOM order -> pad index

  KO.NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  KO.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  KO.mod = (a, n) => ((a % n) + n) % n;
  KO.lerp = (a, b, t) => a + (b - a) * t;
  KO.deepCopy = (o) => JSON.parse(JSON.stringify(o));
  KO.pad2 = (n) => String(n).padStart(2, '0');

  KO.mulberry = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  KO.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // quantize options (ticks); 0 = off
  KO.QUANT = [
    { name: 'OFF', t: 0 }, { name: '1/32', t: 12 }, { name: '1/16T', t: 16 }, { name: '1/16', t: 24 },
    { name: '1/8T', t: 32 }, { name: '1/8', t: 48 }, { name: '1/4', t: 96 }
  ];
  KO.REPEAT = [
    { name: '1/32', t: 12 }, { name: '1/16T', t: 16 }, { name: '1/16', t: 24 }, { name: '1/8T', t: 32 },
    { name: '1/8', t: 48 }, { name: '1/4', t: 96 }
  ];

  KO.FADER_PARAMS = [
    // index = pad index (bottom-left first) -> shown on pads in FADER mode
    { id: 'vel', name: 'VEL', def: 1 },
    { id: 'tune', name: 'TUNE', def: 0.5 },
    { id: 'swing', name: 'SWG', def: 0 },
    { id: 'atk', name: 'ATK', def: 0 },
    { id: 'rel', name: 'REL', def: 0 },
    { id: 'trim', name: 'TRIM', def: 0 },
    { id: 'fx', name: 'FX', def: 0 },
    { id: 'pan', name: 'PAN', def: 0.5 },
    { id: 'hpf', name: 'HPF', def: 0 },
    { id: 'lvl', name: 'LVL', def: 0.8 },
    { id: 'ptc', name: 'PTC', def: 0.5 },
    { id: 'lpf', name: 'LPF', def: 1 },
  ];
  KO.faderIndex = (id) => KO.FADER_PARAMS.findIndex(f => f.id === id);

  KO.PUNCH = [
    // index = pad index (bottom-left first)
    { id: 'crush', name: 'CRUSH' },
    { id: 'oct', name: 'OCT DN' },
    { id: 'rev', name: 'REVERSE' },
    { id: 'dly16', name: 'DLY 1/16' },
    { id: 'dly8', name: 'DLY 1/8' },
    { id: 'dly4', name: 'DLY 1/4' },
    { id: 'lpf', name: 'LPF' },
    { id: 'hpf', name: 'HPF' },
    { id: 'dlyT', name: 'DLY 1/8T' },
    { id: 'loop4', name: 'LOOP 1/4', ticks: 96 },
    { id: 'loop8', name: 'LOOP 1/8', ticks: 48 },
    { id: 'loop16', name: 'LOOP 1/16', ticks: 24 },
  ];

  KO.FX_TYPES = [
    { id: 'off', name: 'OFF', x: '', y: '' },
    { id: 'delay', name: 'DELAY', x: 'TIME', y: 'FDBK' },
    { id: 'reverb', name: 'REVERB', x: 'SIZE', y: 'TONE' },
    { id: 'dist', name: 'DISTORTION', x: 'DRIVE', y: 'TONE' },
    { id: 'chorus', name: 'CHORUS', x: 'DEPTH', y: 'RATE' },
    { id: 'filter', name: 'FILTER', x: 'FREQ', y: 'RES' },
    { id: 'comp', name: 'COMPRESSOR', x: 'AMOUNT', y: 'MAKEUP' },
  ];
  KO.DELAY_DIVS = [
    { name: '1/32', b: 0.125 }, { name: '1/16', b: 0.25 }, { name: '1/8T', b: 1 / 3 }, { name: '1/16D', b: 0.375 },
    { name: '1/8', b: 0.5 }, { name: '1/4T', b: 2 / 3 }, { name: '1/8D', b: 0.75 }, { name: '1/4', b: 1 },
    { name: '1/4D', b: 1.5 }, { name: '1/2', b: 2 }
  ];

  KO.PLAY_MODES = ['ONE', 'GATE', 'LOOP'];

  KO.debounce = function (fn, ms) {
    let id = 0;
    return function () { clearTimeout(id); id = setTimeout(fn, ms); };
  };
})(window.KO);
