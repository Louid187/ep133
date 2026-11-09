# KO Sim — an EP-133 K.O. II style sampler in the browser

An unofficial, dependency-free web simulator of the teenage engineering EP-133 K.O. II
workflow, built so you can try the "12 pads × 4 groups + sequencer + punch-in FX" way of
working before buying the real thing. Not affiliated with teenage engineering. All sounds are
synthesised in the browser, and the real device's controls and features differ in places.

Works on iPhone, iPad (portrait + landscape) and desktop browsers. Multi-touch, keyboard
shortcuts and "Add to Home Screen" (full-screen PWA, offline after first load) are supported.

## Run it

It's a static site, so there's no build step.

* **GitHub Pages (easiest for iPhone/iPad):** repo → Settings → Pages → deploy from branch
  (root). Then open the URL in Safari and use *Share → Add to Home Screen*.
* **Locally:** `python3 -m http.server 8000` and open http://localhost:8000.
  Opening `index.html` directly also works, but the microphone sampling needs HTTPS or localhost.

On iOS, if you hear nothing, raise the volume. The app also tries to play through the silent switch.

## Features

* 4 groups (A drums, B bass, C melodic, D vox/fx/loops) × 12 pads, 58 factory sounds
* Live recording with quantise (off … 1/4, triplets), overdub, undo, swing, metronome, tap tempo
* Note repeat (hold TIMING + pad), step editor (SHIFT + TIMING, tap the screen)
* 99 patterns per group, 1–16 bars, scenes, song mode (SHIFT + ▶), duplicate pattern
* KEYS mode: play any sound chromatically with octave shift
* Sound edit: level, pitch (fine with SHIFT), pan, attack, release, start/end trim,
  play mode (one-shot / gate / loop), choke groups, reverse; library browser
* Sampling from the microphone or resampling the main output (hold a pad), with auto trim and normalise;
  audio file import
* Master send FX: delay (tempo-synced), reverb, distortion, chorus, filter, compressor
* 12 punch-in FX (hold FX + pad): loop 1/4, 1/8, 1/16; delay 1/4, 1/8, 1/16, 1/8T; LPF and HPF sweeps;
  crush; octave down; reverse
* Fader assignable per group (FADER + pad): level, pitch, LPF, HPF, FX send, pan, attack, release,
  trim, swing, velocity, tune
* 9 projects auto-saved in the browser (SHIFT + MAIN); export and import project JSON; record output to WAV

The in-app **?** button has the full control reference.

## Keyboard (desktop)

| Keys | Function |
|---|---|
| `7 8 9` / `U I O` / `J K L` / `M , .` (or numpad) | pads |
| `1`–`4` | groups A–D |
| `Space` / `R` / `Shift` / `Backspace` | play / record / shift / erase |
| `Q` `W` `E` `T` `Y` | sound, main, tempo, fader, copy |
| `[` `]` | − / + |
| `F` `G` `H` `B` | fx, keys, timing, sample |
| `Z`/`X`, `C`/`V` | knob X, knob Y |
| `↑` / `↓` | fader |
