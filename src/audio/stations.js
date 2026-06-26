// stations.js — the six "radio stations" as data, plus a pure note generator.
//
// Phase 9 doctrine: every station is SYNTHESIZED, never a recording — so each one is
// just a recipe (key, tempo, chord progression, voice palette, drum pattern) that the
// audio engine realizes live. Names are generic and non-trademarkable. This module is
// DOM- and Web-Audio-free: `generateBar()` is a pure function from (station, bar index)
// to a list of note events, so the generative music is deterministic and unit-testable
// in Node; the engine (engine.js) just schedules those events on the audio clock.

import { mulberry32 } from '../engine/rng.js';

// Semitone patterns (relative to the station's root note).
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  majPent: [0, 2, 4, 7, 9],
  minPent: [0, 3, 5, 7, 10],
};

// A chord = scale degrees (indices into the scale) stacked; the engine turns degrees
// into frequencies. Progressions are written as arrays of root-degree per bar; the
// generator builds a triad (root, third, fifth) up the scale from that degree.
//
// Each station: a distinct genre realized purely from synthesis. `voices` selects the
// oscillator/character per part; `drums` is a 16-step pattern of k(ick)/s(nare)/h(at).
const STATIONS = [
  {
    id: 'lobby-lounge',
    name: 'Lobby Lounge',
    genre: 'Easy-listening “elevator” muzak',
    root: 60, // middle C
    scale: 'major',
    bpm: 84,
    swing: 0.12,
    progression: [0, 5, 3, 4], // I–vi–IV–V, the comfiest loop there is
    voices: { pad: 'sine', bass: 'sine', lead: 'triangle' },
    arp: { density: 2, octave: 1 },
    drums: { k: '1...............', s: '........1.......', h: '..1...1...1...1.', gain: 0.18 },
    seed: 11,
  },
  {
    id: 'velvet-hour',
    name: 'Velvet Hour',
    genre: 'Smooth jazz / bossa',
    root: 57,
    scale: 'dorian',
    bpm: 96,
    swing: 0.18,
    progression: [0, 3, 1, 4],
    voices: { pad: 'triangle', bass: 'sine', lead: 'sine' },
    arp: { density: 3, octave: 1 },
    drums: { k: '1.......1.......', s: '....1.......1...', h: '1.1.1.1.1.1.1.1.', gain: 0.16 },
    seed: 23,
  },
  {
    id: 'corner-pocket',
    name: 'Corner Pocket',
    genre: 'Boom-bap hip-hop',
    root: 55,
    scale: 'minPent',
    bpm: 86,
    swing: 0.22,
    progression: [0, 0, 3, 2],
    voices: { pad: 'triangle', bass: 'sine', lead: 'square' },
    arp: { density: 2, octave: 1 },
    drums: { k: '1.....1...1.....', s: '....1.......1...', h: '1.1.1.1.1.1.1.1.', gain: 0.3 },
    seed: 37,
  },
  {
    id: 'night-circuit',
    name: 'Night Circuit',
    genre: 'Synthwave / electronic',
    root: 50,
    scale: 'minor',
    bpm: 118,
    swing: 0,
    progression: [0, 5, 3, 4],
    voices: { pad: 'sawtooth', bass: 'sawtooth', lead: 'square' },
    arp: { density: 4, octave: 2 },
    drums: { k: '1...1...1...1...', s: '....1.......1...', h: '..1...1...1...1.', gain: 0.26 },
    seed: 41,
  },
  {
    id: 'big-hair-boulevard',
    name: 'Big Hair Boulevard',
    genre: '’80s hair-rock',
    root: 52,
    scale: 'minPent',
    bpm: 138,
    swing: 0,
    progression: [0, 3, 4, 3],
    voices: { pad: 'sawtooth', bass: 'sawtooth', lead: 'sawtooth', distort: true },
    arp: { density: 4, octave: 2 },
    drums: { k: '1...1...1...1...', s: '....1.......1...', h: '1.1.1.1.1.1.1.1.', gain: 0.32 },
    seed: 53,
  },
  {
    id: 'eight-bit-express',
    name: 'Eight-Bit Express',
    genre: 'Chiptune',
    root: 60,
    scale: 'majPent',
    bpm: 132,
    swing: 0,
    progression: [0, 4, 3, 4],
    voices: { pad: 'square', bass: 'square', lead: 'square' },
    arp: { density: 4, octave: 2 },
    drums: { k: '1...1...1...1...', s: '....1.......1...', h: '1111111111111111', gain: 0.2 },
    seed: 67,
  },
];

export function getStations() {
  return STATIONS;
}

export function getStation(id) {
  return STATIONS.find((s) => s.id === id) || STATIONS[0];
}

// MIDI note number -> frequency in Hz (A4 = MIDI 69 = 440 Hz).
export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Build a chord's MIDI notes from a scale degree (triad up the scale, with octave wrap).
function chordNotes(station, degree) {
  const scale = SCALES[station.scale] || SCALES.major;
  const at = (i) => station.root + scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length);
  return [at(degree), at(degree + 2), at(degree + 4)];
}

/**
 * Pure: the note events for one bar. Deterministic given the station and bar index, so
 * a station improvises endlessly (the arp/melody vary per bar) without ever repeating a
 * short loop — and so it can be tested without any audio. Times are in BEATS from the
 * start of the bar; the engine converts beats→seconds via bpm and applies swing.
 *
 * @returns {Array<{beat:number, dur:number, midi:number, voice:string, gain:number}>}
 */
export function generateBar(station, barIndex) {
  const rng = mulberry32(station.seed + barIndex * 2654435761);
  const beatsPerBar = 4;
  const events = [];
  const degree = station.progression[barIndex % station.progression.length];
  const chord = chordNotes(station, degree);

  // Bass: chord root, an octave down, on the downbeat (and a push on beat 3).
  events.push({ beat: 0, dur: 1.8, midi: chord[0] - 12, voice: 'bass', gain: 0.5 });
  if (rng() < 0.7) events.push({ beat: 2, dur: 1.6, midi: chord[0] - 12, voice: 'bass', gain: 0.42 });

  // Pad: the held chord under everything.
  for (const n of chord) events.push({ beat: 0, dur: beatsPerBar - 0.1, midi: n, voice: 'pad', gain: 0.16 });

  // Arp / melody: notes drawn from the chord (plus an occasional passing tone), spread
  // across the bar at the station's density, lifted by its octave.
  const density = station.arp.density || 2;
  const steps = beatsPerBar * density;
  const lift = 12 * (station.arp.octave || 1);
  for (let s = 0; s < steps; s++) {
    if (rng() < 0.32) continue; // rests keep it from feeling mechanical
    const pick = chord[Math.floor(rng() * chord.length)] + lift + (rng() < 0.15 ? 2 : 0);
    events.push({ beat: s / density, dur: 1 / density, midi: pick, voice: 'lead', gain: 0.22 });
  }

  // Drums: decode the 16-step patterns into events on the 16th-note grid.
  const d = station.drums;
  const decode = (pat, voice, g) => {
    if (!pat) return;
    for (let i = 0; i < pat.length; i++) if (pat[i] === '1') events.push({ beat: (i / pat.length) * beatsPerBar, dur: 0.1, voice, gain: g });
  };
  decode(d.k, 'kick', (d.gain ?? 0.25) * 1.0);
  decode(d.s, 'snare', (d.gain ?? 0.25) * 0.9);
  decode(d.h, 'hat', (d.gain ?? 0.25) * 0.5);

  return events;
}
