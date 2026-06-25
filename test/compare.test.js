// compare.test.js — the A/B notable-moment curator (Phase 7B). Run: `node test/compare.test.js`.
//
// Verifies the curator finds genuine, ranked, non-spoiler divergences between two
// runs on the same level + seed, and stays quiet when the two runs are identical.

import { findMoments } from '../src/game/compare.js';
import { runSimulation } from '../src/engine/simulation.js';
import { getLevel } from '../src/game/levels.js';
import * as fcfs from '../src/reference/fcfs.js';
import * as look from '../src/reference/look.js';
import * as sstf from '../src/reference/sstf.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const track = (level, seed, ctrl, label) => ({
  frames: runSimulation(level, seed, ctrl, { record: true }).frames,
  metrics: runSimulation(level, seed, ctrl).metrics,
  label,
});

const L2 = getLevel('l2');

// --- 1. FCFS vs LOOK on L2: real divergences, ranked, timeline-ordered ------------
{
  const a = track(L2, 1, fcfs.createController, 'FCFS');
  const b = track(L2, 1, look.createController, 'LOOK');
  const moments = findMoments(a, b, L2);

  assert(moments.length > 0, 'finds at least one notable moment between FCFS and LOOK');
  assert(moments.length <= 5, 'curates to a handful (≤ 5), not every tick');

  const ticks = moments.map((m) => m.t);
  assert(ticks.every((t, i) => i === 0 || t >= ticks[i - 1]), 'moments are returned in timeline order');
  assert(ticks.every((t) => Number.isFinite(t) && t >= 0), 'every moment has a real tick to jump to');

  const wellFormed = moments.every(
    (m) => m.kind && m.title && typeof m.note === 'string' && m.note.length > 0
  );
  assert(wellFormed, 'every moment has a kind, title, and a note');

  // Non-spoiler: notes describe behavior and name labels, never code/API.
  const noCode = moments.every((m) => !/createController|MOVE_UP|state\.|return \[|serving:/.test(m.note));
  assert(noCode, 'notes contain no code/API tokens (non-spoiler)');

  // The notes should reference the two algorithms by their labels.
  const namesLabels = moments.some((m) => m.note.includes('FCFS') || m.note.includes('LOOK'));
  assert(namesLabels, 'notes name the algorithms being compared');
}

// --- 2. Identical runs (LOOK vs LOOK) → nothing notable ---------------------------
{
  const a = track(L2, 1, look.createController, 'LOOK A');
  const b = track(L2, 1, look.createController, 'LOOK B');
  const moments = findMoments(a, b, L2);
  assert(moments.length === 0, 'two identical runs produce no notable moments');
}

// --- 3. A proximity guard: no two moments crammed into the same instant -----------
{
  const a = track(L2, 1, fcfs.createController, 'FCFS');
  const b = track(L2, 1, sstf.createController, 'SSTF');
  const moments = findMoments(a, b, L2);
  const sweep = L2.numFloors * (L2.ticksPerFloor ?? 2);
  const prox = Math.max(4, Math.round(sweep * 0.5));
  let spread = true;
  for (let i = 1; i < moments.length; i++) if (moments[i].t - moments[i - 1].t < prox) spread = false;
  assert(spread, 'curated moments are spread out in time (no duplicates at one instant)');
}

// --- 4. Determinism: same inputs → same moments -----------------------------------
{
  const a = track(L2, 1, fcfs.createController, 'FCFS');
  const b = track(L2, 1, look.createController, 'LOOK');
  const m1 = findMoments(a, b, L2);
  const m2 = findMoments(a, b, L2);
  assert(JSON.stringify(m1) === JSON.stringify(m2), 'moment detection is deterministic');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
