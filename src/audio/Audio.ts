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

/** Convert MIDI note number (60 = middle C) to Hz. */
function noteHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// MIDI note constants for readability.
const A2 = 45, C3 = 48, E3 = 52, F2 = 41, C2 = 36, G2 = 43, D3 = 50;
const A4 = 69, C5 = 72, E5 = 76, A5 = 81;
const F4 = 65, F5 = 77;
const C4 = 60, E4 = 64, G4 = 67;
const G3 = 55, B4 = 71, D5 = 74, G5 = 79;

/** Bass pattern — one quarter-note per beat, 4 beats × 4 bars = 16 notes. */
const BASS_NOTES = [
  // Am bar
  A2, E3, A2, E3,
  // F bar
  F2, C3, F2, C3,
  // C bar
  C2, G2, C2, G2,
  // G bar
  G2, D3, G2, D3,
];

/** Lead arpeggio — one 16th-note per step, 16 × 4 = 64 notes. Each bar
 *  walks up its chord and repeats four times. */
const LEAD_NOTES = [
  // Am: A4 C5 E5 A5 ×4
  A4, C5, E5, A5, A4, C5, E5, A5, A4, C5, E5, A5, A4, C5, E5, A5,
  // F: F4 A4 C5 F5 ×4
  F4, A4, C5, F5, F4, A4, C5, F5, F4, A4, C5, F5, F4, A4, C5, F5,
  // C: C4 E4 G4 C5 ×4
  C4, E4, G4, C5, C4, E4, G4, C5, C4, E4, G4, C5, C4, E4, G4, C5,
  // G: G3 B4 D5 G5 ×4 — root low for variety, then upper chord
  G3, B4, D5, G5, G3, B4, D5, G5, G3, B4, D5, G5, G3, B4, D5, G5,
];

/** Pad chord per bar: root, third, fifth. */
const PAD_CHORDS = [
  [A2, C3, E3],   // Am
  [F2, A2 + 12, C3], // F (A3 is third)
  [C3, E3, G3 + 12 - 12], // C (G3)
  [G2, B4 - 12, D3], // G (B3)
];

const BPM = 108;
const SECONDS_PER_BEAT = 60 / BPM;
const BEATS_PER_BAR = 4;
const BARS = 4;
const TOTAL_SECONDS = SECONDS_PER_BEAT * BEATS_PER_BAR * BARS;
const SIXTEENTH = SECONDS_PER_BEAT / 4;

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

/** Build the music buffer offline. Cached after first call. */
async function buildMusicBuffer(c: AudioContext): Promise<AudioBuffer> {
  if (musicBuffer) return musicBuffer;
  if (musicBufferPromise) return musicBufferPromise;
  const sr = c.sampleRate;
  const offline = new OfflineAudioContext(1, Math.ceil(TOTAL_SECONDS * sr), sr);
  const out = offline.destination;

  // Sub-bus gains so we can balance voices without affecting envelopes.
  const bassBus = offline.createGain(); bassBus.gain.value = 0.55; bassBus.connect(out);
  const leadBus = offline.createGain(); leadBus.gain.value = 0.18; leadBus.connect(out);
  const padBus  = offline.createGain(); padBus.gain.value  = 0.10; padBus.connect(out);
  const drumBus = offline.createGain(); drumBus.gain.value = 0.30; drumBus.connect(out);

  // Bass — quarter notes, square through lowpass for warmth.
  for (let i = 0; i < BASS_NOTES.length; i++) {
    const t = i * SECONDS_PER_BEAT;
    scheduleVoice(offline, bassBus, "square", noteHz(BASS_NOTES[i] - 12),
      t, SECONDS_PER_BEAT * 0.85, 0.7, 600);
  }

  // Lead — 16th notes, square with no filter so it cuts through.
  for (let i = 0; i < LEAD_NOTES.length; i++) {
    const t = i * SIXTEENTH;
    scheduleVoice(offline, leadBus, "square", noteHz(LEAD_NOTES[i]),
      t, SIXTEENTH * 0.9, 0.5);
  }

  // Pad — triangle chord held for an entire bar.
  for (let bar = 0; bar < BARS; bar++) {
    const t = bar * SECONDS_PER_BEAT * BEATS_PER_BAR;
    const dur = SECONDS_PER_BEAT * BEATS_PER_BAR * 0.95;
    for (const midi of PAD_CHORDS[bar]) {
      scheduleVoice(offline, padBus, "triangle", noteHz(midi), t, dur, 0.6);
    }
  }

  // Drums — kick on beats 1 and 3 of every bar (four-on-the-half).
  for (let bar = 0; bar < BARS; bar++) {
    const barStart = bar * SECONDS_PER_BEAT * BEATS_PER_BAR;
    scheduleKick(offline, drumBus, barStart);
    scheduleKick(offline, drumBus, barStart + SECONDS_PER_BEAT * 2);
  }

  musicBufferPromise = offline.startRendering().then((buf) => {
    musicBuffer = buf;
    return buf;
  });
  return musicBufferPromise;
}

/** Start the menu / loading music if it isn't already playing. Idempotent.
 *  Fades in over ~600ms; safe to call before the audio context exists. */
export async function startMenuMusic(): Promise<void> {
  const c = getCtx();
  if (!c || !master) return;
  // Already playing — keep it going.
  if (musicVoice) return;
  const buffer = await buildMusicBuffer(c);
  if (musicVoice) return; // race: someone started in the meantime

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
