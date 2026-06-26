// audio.test.js — the procedural radio's testable core (Phase 9). Run: `node test/audio.test.js`.
//
// Web Audio can't run in Node, so this covers everything that CAN: the station registry
// (six, unique generic names, complete recipes), the pure deterministic note generator,
// the settings persistence round-trip, the no-shipped-audio-files doctrine, and that the
// engine constructs without a browser as long as it stays muted.

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Minimal localStorage shim so progress.js can round-trip in Node.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
};

const { getStations, getStation, generateBar, midiToFreq } = await import('../src/audio/stations.js');
const { createRadio } = await import('../src/audio/engine.js');
const { getSetting, setSetting } = await import('../src/game/progress.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

// --- 1. Station registry -----------------------------------------------------------
{
  const st = getStations();
  assert(st.length === 6, 'there are six radio stations');
  assert(new Set(st.map((s) => s.id)).size === 6, 'station ids are unique');
  assert(new Set(st.map((s) => s.name)).size === 6, 'station names are unique');
  // Generic, non-trademarkable: no obvious real brands/labels/known station names.
  const banned = /spotify|pandora|apple|beats|sirius|iheart|vevo|mtv|billboard/i;
  assert(st.every((s) => !banned.test(s.name) && !banned.test(s.genre)), 'names/genres avoid real brands (non-trademarkable)');
  const complete = st.every(
    (s) => s.name && s.genre && Number.isFinite(s.root) && s.scale && s.bpm > 0 &&
      Array.isArray(s.progression) && s.progression.length > 0 && s.voices && s.drums && Number.isFinite(s.seed)
  );
  assert(complete, 'every station has a complete recipe (root/scale/bpm/progression/voices/drums/seed)');
  // Drum patterns are 16-step strings of hits/rests.
  const drumsOk = st.every((s) => ['k', 's', 'h'].every((d) => !s.drums[d] || /^[1.]{16}$/.test(s.drums[d])));
  assert(drumsOk, 'drum patterns are 16-step hit/rest strings');
  assert(getStation('nope').id === st[0].id, 'getStation falls back to the first station for an unknown id');
}

// --- 2. The note generator is pure, deterministic, and well-formed -----------------
{
  const s = getStation('night-circuit');
  const a = generateBar(s, 3);
  const b = generateBar(s, 3);
  assert(JSON.stringify(a) === JSON.stringify(b), 'generateBar is deterministic for a given (station, bar)');
  const c = generateBar(s, 4);
  assert(JSON.stringify(a) !== JSON.stringify(c), 'consecutive bars differ (it improvises, no short loop)');

  const voices = new Set(['pad', 'bass', 'lead', 'kick', 'snare', 'hat']);
  const wellFormed = a.every(
    (e) => e.beat >= 0 && e.beat < 4 && e.dur > 0 && voices.has(e.voice) &&
      e.gain > 0 && (['kick', 'snare', 'hat'].includes(e.voice) || Number.isFinite(e.midi))
  );
  assert(wellFormed, 'every note event is well-formed (in-bar beat, positive dur/gain, known voice)');
  assert(a.some((e) => e.voice === 'bass') && a.some((e) => e.voice === 'kick'), 'a bar has bass and drums');
}

// --- 3. midiToFreq sanity ----------------------------------------------------------
{
  assert(Math.abs(midiToFreq(69) - 440) < 1e-6, 'A4 (MIDI 69) is 440 Hz');
  assert(Math.abs(midiToFreq(81) - 880) < 1e-6, 'an octave up doubles the frequency');
}

// --- 4. Settings persistence round-trip --------------------------------------------
{
  assert(getSetting('audioMuted', true) === true, 'unset setting returns the fallback');
  setSetting('audioMuted', false);
  setSetting('audioStation', 'night-circuit');
  assert(getSetting('audioMuted', true) === false, 'a saved boolean setting round-trips');
  assert(getSetting('audioStation', 'lobby-lounge') === 'night-circuit', 'a saved string setting round-trips');
}

// --- 5. The engine constructs headless as long as it stays muted --------------------
{
  const r = createRadio({ stationId: 'corner-pocket', muted: true });
  assert(r.muted === true, 'radio starts muted when asked');
  assert(r.stationName === 'Corner Pocket', 'radio reports its station name');
  assert(r.stations.length === 6, 'radio exposes the six stations');
  const next = r.cycle(1); // changing station must not require an AudioContext
  assert(next && next.id !== 'corner-pocket', 'cycling stations works without audio');
}

// --- 6. No audio FILES are shipped (everything is synthesized) ----------------------
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const audioExt = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
  let found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (audioExt.test(name)) found.push(p);
    }
  };
  walk(join(root, 'src'));
  assert(found.length === 0, `no audio files under src/ — music is generated, not shipped (found: ${found.join(', ') || 'none'})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
