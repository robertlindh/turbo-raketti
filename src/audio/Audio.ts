// Procedurally-generated retro SFX via the Web Audio API.
//
// No audio files required — each sound is synthesised on the fly with
// oscillators, noise buffers and envelopes. Audio context is lazily
// initialised so the page doesn't get blocked by autoplay policies; the
// first interaction (keydown or button click) resumes it.

import { SETTINGS } from "../game/Settings";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Get-or-create the audio context. Suspended until first user gesture. */
function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    // Some browsers still namespace it.
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = SETTINGS.masterVolume;
    master.connect(ctx.destination);
    // Pre-build a 1-second white-noise buffer for explosions / thrust hiss.
    const len = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

function refreshVolume(): void {
  if (master) master.gain.value = SETTINGS.masterVolume;
}

/** Wakes the audio context if it's suspended (autoplay policy). Call from
 *  any user gesture (keydown, click). Safe to call repeatedly. */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") {
    void c.resume();
  }
}

/** A short noise burst — explosion or hit sparks. */
export function playExplosion(intensity = 1): void {
  const c = getCtx();
  if (!c || !master || !noiseBuffer) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(2200, now);
  filt.frequency.exponentialRampToValueAtTime(120, now + 0.45);
  const gain = c.createGain();
  const peak = 0.6 * intensity;
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(master);
  src.start(now);
  src.stop(now + 0.55);
}

/** "Pew" — quick pitched zap when firing. Square sweep down. */
export function playShoot(): void {
  const c = getCtx();
  if (!c || !master) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 0.12);
}

/** Soft "doof" when a bullet hits a wall. */
export function playWallHit(): void {
  const c = getCtx();
  if (!c || !master || !noiseBuffer) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(800, now);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(master);
  src.start(now);
  src.stop(now + 0.15);
}

/** Bright two-note chime — played each time the player flies through a
 *  race gate. Two triangle waves a fifth apart, fast attack and short
 *  release so it punches without lingering. */
export function playGateChime(): void {
  const c = getCtx();
  if (!c || !master) return;
  const now = c.currentTime;
  const playNote = (freq: number, offset: number, peak: number) => {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + offset);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.linearRampToValueAtTime(peak, now + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
    osc.connect(gain);
    gain.connect(master!);
    osc.start(now + offset);
    osc.stop(now + offset + 0.4);
  };
  // Root + fifth, slight delay between them for a quick arpeggio.
  playNote(880, 0, 0.22);    // A5
  playNote(1320, 0.06, 0.18); // E6
}

/** Rising chime on respawn. */
export function playSpawn(): void {
  const c = getCtx();
  if (!c || !master) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 0.28);
}

// ──────────────────────────────────────────────────────────────────────────
// Thrust — a continuous noise-based jet loop per ship. Activate/deactivate
// via setThrust(index, on) so it tracks ship.thrustOn.
// ──────────────────────────────────────────────────────────────────────────

interface ThrustVoice {
  src: AudioBufferSourceNode;
  filt: BiquadFilterNode;
  gain: GainNode;
  started: boolean;
}

const thrustVoices = new Map<number, ThrustVoice>();

function ensureThrustVoice(index: number): ThrustVoice | null {
  const c = getCtx();
  if (!c || !master || !noiseBuffer) return null;
  let v = thrustVoices.get(index);
  if (v) return v;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  // Different "voice" per player so the two thrusters don't phase together.
  filt.frequency.value = 380 + index * 220;
  filt.Q.value = 2;
  const gain = c.createGain();
  gain.gain.value = 0;
  src.connect(filt);
  filt.connect(gain);
  gain.connect(master);
  v = { src, filt, gain, started: false };
  thrustVoices.set(index, v);
  return v;
}

/** Toggle thrust audio for a given ship index. Smoothly ramps gain so on/off
 *  doesn't click. */
export function setThrust(index: number, on: boolean): void {
  const c = getCtx();
  const v = ensureThrustVoice(index);
  if (!c || !v) return;
  const now = c.currentTime;
  if (on && !v.started) {
    try { v.src.start(now); } catch { /* already started */ }
    v.started = true;
  }
  const target = on ? 0.08 : 0.0001;
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setValueAtTime(v.gain.gain.value, now);
  v.gain.gain.exponentialRampToValueAtTime(target, now + 0.05);
}

/** Stop and clean up all thrust voices (used when a ship dies). */
export function killThrust(index: number): void {
  const v = thrustVoices.get(index);
  if (!v) return;
  setThrust(index, false);
}

// ──────────────────────────────────────────────────────────────────────────
// Volume hookup — read SETTINGS.masterVolume every time anything plays so
// slider drags are instant.
// ──────────────────────────────────────────────────────────────────────────

let volumeWatcher: number | null = null;
export function startVolumeWatcher(): void {
  if (volumeWatcher !== null) return;
  volumeWatcher = window.setInterval(refreshVolume, 100);
}

// ──────────────────────────────────────────────────────────────────────────
// Menu / loading music — a 4-bar chip-tune loop in A minor rendered offline
// once on first play and then looped as an AudioBufferSourceNode. Music is
// gated through its own GainNode under master so we can fade in/out without
// touching the SFX volume.
// ──────────────────────────────────────────────────────────────────────────

let musicBuffer: AudioBuffer | null = null;
let musicBufferPromise: Promise<AudioBuffer> | null = null;
let musicVoice: AudioBufferSourceNode | null = null;
let musicGain: GainNode | null = null;
/** User-controlled on/off flag — read by startMenuMusic so toggling it
 *  while music is off keeps it off until the user opts back in. */
let musicEnabled = (() => {
  try {
    const raw = localStorage.getItem("tr.music.enabled");
    return raw === null ? true : raw === "1";
  } catch { return true; }
})();

/** Convert MIDI note number (60 = middle C) to Hz. */
function noteHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// MIDI note constants for readability.
const E2 = 40, F2 = 41, G2 = 43, A2 = 45, B2 = 47;
const C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57, B3 = 59;
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71;
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, B5 = 83;
const C6 = 84, E6 = 88;

// Sections A and B each cover 4 bars; the full loop plays A, B, A', B'
// (A' is A with a richer counter-melody, B' is B with a higher lead).
// Total length = 16 bars, ~35.6s at 108 BPM.
const BPM = 108;
const SECONDS_PER_BEAT = 60 / BPM;
const BEATS_PER_BAR = 4;
const BARS_PER_SECTION = 4;
const SECTIONS = 4;
const BARS = BARS_PER_SECTION * SECTIONS;
const TOTAL_SECONDS = SECONDS_PER_BEAT * BEATS_PER_BAR * BARS;
const SIXTEENTH = SECONDS_PER_BEAT / 4;

/** Chord roots per bar across the full 16-bar loop.
 *  A (bars 0-3):  Am - F  - C  - G    (classic anchor)
 *  B (bars 4-7):  Dm - Am - E7 - Am   (turnaround tension)
 *  A' (8-11):     Am - F  - C  - G    (A repeats)
 *  B' (12-15):    F  - C  - G  - Am   (resolution back to home) */
const CHORD_ROOTS = [
  // Section A
  A2, F2, C3, G2,
  // Section B
  D3, A2, E2, A2,
  // Section A' (same as A)
  A2, F2, C3, G2,
  // Section B' — resolves back to Am
  F2, C3, G2, A2,
];

/** Bass pattern per bar — 8 eighth-notes per bar (root, fifth, root, octave,
 *  root, fifth, octave, fifth) gives a walking, slightly funky feel rather
 *  than the previous on-the-beat plod. */
function bassNotesForBar(root: number): number[] {
  const fifth = root + 7;
  const oct = root + 12;
  return [root, fifth, root, oct, root, fifth, oct, fifth];
}

/** Lead arpeggio per bar — 16th notes built from the chord's triad.
 *  Pattern shape varies by section index so the melody breathes instead of
 *  looping the same 4 notes 16× per bar.
 *
 *  Section A: rising 1-3-5-8 walk repeated
 *  Section B: 1-5-3-8 1-8-5-3 swing
 *  Section A': adds neighbour tones for variation (8-7-5-3)
 *  Section B': octave higher for climax */
function leadNotesForBar(root: number, sectionIndex: number): number[] {
  const third = root + (isMinor(root) ? 3 : 4);
  const fifth = root + 7;
  const oct = root + 12;
  const seventh = root + (isMinor(root) ? 10 : 11);

  switch (sectionIndex) {
    case 0: // A — straight 1-3-5-8 ×4
      return [root, third, fifth, oct, root, third, fifth, oct,
              root, third, fifth, oct, root, third, fifth, oct].map((n) => n + 24);
    case 1: // B — swung 1-5-3-8 1-8-5-3
      return [root, fifth, third, oct, root, oct, fifth, third,
              root, fifth, third, oct, root, oct, fifth, third].map((n) => n + 24);
    case 2: // A' — neighbour-tone variation
      return [root, third, fifth, oct, seventh, fifth, third, root,
              root, third, fifth, oct, seventh, fifth, third, root].map((n) => n + 24);
    case 3: // B' — octave up for climax
      return [root, fifth, oct, fifth, third, fifth, oct, fifth,
              root, fifth, oct, fifth, third, fifth, oct, fifth].map((n) => n + 36);
    default:
      return [root, third, fifth, oct].map((n) => n + 24);
  }
}

/** Quick lookup: which roots are minor in this loop. */
function isMinor(root: number): boolean {
  // A and D are minor; F, C, G, E are major in our progression.
  // (We treat E as the dominant E7 — major-third lead-tone.)
  const pc = ((root % 12) + 12) % 12;
  return pc === 9 /* A */ || pc === 2 /* D */;
}

/** Pad chord per bar — root, third, fifth, voiced up in the higher octave so
 *  it sits above the bass without muddying it. */
function padChordForBar(root: number): number[] {
  const third = root + (isMinor(root) ? 3 : 4);
  const fifth = root + 7;
  return [root + 12, third + 12, fifth + 12];
}

// Reference the named-note constants to satisfy the linter (they're used
// implicitly through CHORD_ROOTS / bassNotesForBar / leadNotesForBar's
// integer maths). Keeping the table makes future hand-tweaks readable.
void [B2, C3, D3, E3, G3, A3, B3, B4, B5, C4, C5, C6, D4, D5, E4, E5, E6,
      F3, F4, F5, G4, G5, A4, A5];

/** Render a single oscillator note with a simple ADSR-ish envelope into an
 *  offline context. Output node is whatever the caller has wired the returned
 *  gain into ahead of time. */
function scheduleVoice(
  offline: OfflineAudioContext,
  output: AudioNode,
  type: OscillatorType,
  freq: number,
  start: number,
  duration: number,
  peak: number,
  filterHz?: number,
): void {
  const osc = offline.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = offline.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.008);
  env.gain.exponentialRampToValueAtTime(Math.max(peak * 0.18, 0.001), start + Math.min(duration * 0.6, 0.18));
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  if (filterHz) {
    const filt = offline.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = filterHz;
    osc.connect(filt);
    filt.connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(output);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** A short kick drum via filtered noise + a pitch-dropping sine click. */
function scheduleKick(
  offline: OfflineAudioContext,
  output: AudioNode,
  start: number,
): void {
  // Body — sine swept from 110 → 45 Hz.
  const osc = offline.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, start);
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.08);
  const g = offline.createGain();
  g.gain.setValueAtTime(0.45, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
  osc.connect(g);
  g.connect(output);
  osc.start(start);
  osc.stop(start + 0.22);
}

/** Snare — filtered noise burst with a hint of tone. */
function scheduleSnare(
  offline: OfflineAudioContext,
  output: AudioNode,
  start: number,
): void {
  const sr = offline.sampleRate;
  const len = Math.floor(0.15 * sr);
  const buf = offline.createBuffer(1, len, sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = offline.createBufferSource();
  src.buffer = buf;
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  const g = offline.createGain();
  g.gain.setValueAtTime(0.35, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
  src.connect(hp); hp.connect(g); g.connect(output);
  src.start(start);
  src.stop(start + 0.16);
}

/** Hi-hat — ultra-short, very high-passed noise. */
function scheduleHat(
  offline: OfflineAudioContext,
  output: AudioNode,
  start: number,
  open = false,
): void {
  const sr = offline.sampleRate;
  const len = Math.floor((open ? 0.12 : 0.045) * sr);
  const buf = offline.createBuffer(1, len, sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = offline.createBufferSource();
  src.buffer = buf;
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = offline.createGain();
  g.gain.setValueAtTime(open ? 0.18 : 0.12, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + (open ? 0.13 : 0.05));
  src.connect(hp); hp.connect(g); g.connect(output);
  src.start(start);
  src.stop(start + (open ? 0.14 : 0.07));
}

/** Build the music buffer offline. Cached after first call. */
async function buildMusicBuffer(c: AudioContext): Promise<AudioBuffer> {
  if (musicBuffer) return musicBuffer;
  if (musicBufferPromise) return musicBufferPromise;
  const sr = c.sampleRate;
  const offline = new OfflineAudioContext(1, Math.ceil(TOTAL_SECONDS * sr), sr);
  const out = offline.destination;

  // Sub-bus gains so we can balance voices without affecting envelopes.
  const bassBus = offline.createGain(); bassBus.gain.value = 0.55; bassBus.connect(out);
  const leadBus = offline.createGain(); leadBus.gain.value = 0.16; leadBus.connect(out);
  const padBus  = offline.createGain(); padBus.gain.value  = 0.09; padBus.connect(out);
  const drumBus = offline.createGain(); drumBus.gain.value = 0.30; drumBus.connect(out);

  // Compose per-bar.
  for (let bar = 0; bar < BARS; bar++) {
    const root = CHORD_ROOTS[bar];
    const sectionIndex = Math.floor(bar / BARS_PER_SECTION);
    const barStart = bar * SECONDS_PER_BEAT * BEATS_PER_BAR;

    // Bass — 8 eighth-notes per bar following the chord's walking pattern.
    const bass = bassNotesForBar(root);
    for (let i = 0; i < bass.length; i++) {
      const t = barStart + i * (SECONDS_PER_BEAT / 2);
      scheduleVoice(offline, bassBus, "square", noteHz(bass[i] - 12),
        t, (SECONDS_PER_BEAT / 2) * 0.9, 0.7, 600);
    }

    // Lead — 16 sixteenth-notes, shape varies per section.
    const lead = leadNotesForBar(root, sectionIndex);
    for (let i = 0; i < lead.length; i++) {
      const t = barStart + i * SIXTEENTH;
      // Quieten the lead on the very first bar of section A so the intro
      // doesn't slap the listener — fades in across the loop.
      const fadeIn = bar === 0 ? Math.min(1, i / 8) : 1;
      scheduleVoice(offline, leadBus, "square", noteHz(lead[i]),
        t, SIXTEENTH * 0.9, 0.5 * fadeIn);
    }

    // Pad — sustained chord under the section.
    const pad = padChordForBar(root);
    const padDur = SECONDS_PER_BEAT * BEATS_PER_BAR * 0.95;
    for (const midi of pad) {
      scheduleVoice(offline, padBus, "triangle", noteHz(midi), barStart, padDur, 0.6);
    }

    // Drum kit — programmed per section so the groove evolves.
    //
    //   Section A: minimal — kick on 1+3, hat on every 8th.
    //   Section B: add snare on 2+4, open-hat on the "and" of 4.
    //   Section A': as B but with an extra kick on the "and" of 3.
    //   Section B': full kit + busier hat (16th-note pattern).
    scheduleKick(offline, drumBus, barStart);
    scheduleKick(offline, drumBus, barStart + SECONDS_PER_BEAT * 2);
    if (sectionIndex >= 2) {
      // Add ghost kick on the "and" of beat 3.
      scheduleKick(offline, drumBus, barStart + SECONDS_PER_BEAT * 2.5);
    }
    if (sectionIndex >= 1) {
      // Snare on beats 2 and 4.
      scheduleSnare(offline, drumBus, barStart + SECONDS_PER_BEAT);
      scheduleSnare(offline, drumBus, barStart + SECONDS_PER_BEAT * 3);
    }
    // Hi-hat — every 8th by default; section B' goes to 16ths for energy.
    const hatStep = sectionIndex === 3 ? SIXTEENTH : SECONDS_PER_BEAT / 2;
    for (let t = barStart; t < barStart + SECONDS_PER_BEAT * BEATS_PER_BAR; t += hatStep) {
      // Open hat on the very last hat of every bar in sections B+
      const isLast = t + hatStep >= barStart + SECONDS_PER_BEAT * BEATS_PER_BAR;
      scheduleHat(offline, drumBus, t, isLast && sectionIndex >= 1);
    }
  }

  musicBufferPromise = offline.startRendering().then((buf) => {
    musicBuffer = buf;
    return buf;
  });
  return musicBufferPromise;
}

/** Kick off the offline rendering of the menu music buffer ahead of time.
 *  This does NOT play anything — it just runs the OfflineAudioContext so
 *  the buffer is sitting in memory the moment the user gesture lets us
 *  actually play. Safe to call repeatedly; resolves immediately if the
 *  buffer is already built or rendering. Browsers happily create an
 *  AudioContext in suspended state without a gesture, so we can use its
 *  sampleRate for the offline render. */
export async function prebuildMusicBuffer(): Promise<void> {
  if (musicBuffer || musicBufferPromise) return;
  const c = getCtx();
  if (!c) return;
  await buildMusicBuffer(c);
}

/** Start the menu / loading music if it isn't already playing. Idempotent.
 *  Fades in over ~600ms; safe to call before the audio context exists.
 *  Respects the user's music-enabled toggle — if music is disabled, this
 *  is a no-op. */
export async function startMenuMusic(): Promise<void> {
  if (!musicEnabled) return;
  const c = getCtx();
  if (!c || !master) return;
  // Already playing — keep it going.
  if (musicVoice) return;
  const buffer = await buildMusicBuffer(c);
  if (musicVoice) return; // race: someone started in the meantime
  if (!musicEnabled) return; // toggled off while we were rendering

  musicGain = c.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);

  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(musicGain);
  src.start();
  musicVoice = src;

  const now = c.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(0, now);
  musicGain.gain.linearRampToValueAtTime(0.5, now + 0.6);
}

/** Whether menu music is currently allowed to play. UI reads this to render
 *  the on/off toggle. */
export function isMusicEnabled(): boolean {
  return musicEnabled;
}

/** Persistently flip the music on/off toggle. Stops the loop immediately
 *  when set to false; the next `startMenuMusic()` call will re-launch it
 *  when set back to true. */
export function setMusicEnabled(enabled: boolean): void {
  musicEnabled = enabled;
  try { localStorage.setItem("tr.music.enabled", enabled ? "1" : "0"); } catch { /* ignore */ }
  if (!enabled) stopMenuMusic();
}

/** Fade the music out and tear down. Idempotent. */
export function stopMenuMusic(): void {
  const c = getCtx();
  if (!c || !musicVoice || !musicGain) {
    musicVoice = null;
    musicGain = null;
    return;
  }
  const now = c.currentTime;
  const voice = musicVoice;
  const gain = musicGain;
  musicVoice = null;
  musicGain = null;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.4);
  setTimeout(() => {
    try { voice.stop(); } catch { /* already stopped */ }
    try { voice.disconnect(); } catch { /* already disconnected */ }
    try { gain.disconnect(); } catch { /* already disconnected */ }
  }, 500);
}
