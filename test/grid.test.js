// grid.test.js — the 2-D "sideways" bonus levels (Phase 8). Run: `node test/grid.test.js`.
//
// Covers the new horizontal axis end to end: the engine moves cars left/right and
// delivers 2-D trips, the one-dimensional path is byte-identical to before, the bonus
// levels are solvable with an honest 1★/3★ bracket, and the shipped grid starter
// clears them.

import { runSimulation } from '../src/engine/simulation.js';
import { generatePassengers } from '../src/engine/passengers.js';
import { compileController } from '../src/sandbox/compile.js';
import { gridNaive, gridSmart } from '../src/reference/grid.js';
import { scoreLevel } from '../src/game/scoring.js';
import { getLevel, levels } from '../src/game/levels.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const bonus = levels.filter((L) => (L.numCols ?? 1) > 1);

// --- 1. There are bonus grid levels, and they're flagged always-open ---------------
{
  assert(bonus.length === 2, 'two 2-D bonus levels exist');
  assert(bonus.every((L) => L.bonus === true), 'bonus levels are flagged bonus:true (always open)');
  assert(bonus.every((L) => typeof L.starter === 'string' && /MOVE_LEFT|MOVE_RIGHT/.test(L.starter)), 'each bonus level ships a grid-aware starter');
}

// --- 2. The engine actually moves sideways and delivers 2-D trips -------------------
{
  const L = getLevel('b1');
  const r = runSimulation(L, 1, gridSmart, { record: true, trace: true });
  assert(r.metrics.deliveredAll, 'gridSmart delivers everyone on b1');
  const acts = new Set(r.trace.map((x) => x.action));
  assert(acts.has('MOVE_LEFT') || acts.has('MOVE_RIGHT'), 'cars move horizontally');
  assert(acts.has('MOVE_UP') || acts.has('MOVE_DOWN'), 'cars still move vertically');
  // Frames carry a 2-D position and cell-based carCalls.
  const f = r.frames.find((fr) => fr.elevators[0].load > 0) || r.frames[0];
  const ev = f.elevators[0];
  assert(typeof ev.col === 'number' && typeof ev.posC === 'number', 'grid frames carry a column + continuous posC');
  assert(ev.carCalls.every((c) => typeof c.floor === 'number' && typeof c.col === 'number'), 'carCalls are {floor,col} cells');

  // A car never leaves the grid.
  let inBounds = true;
  for (const fr of r.frames) for (const e of fr.elevators) {
    if (e.posC < -1e-9 || e.posC > L.numCols - 1 + 1e-9 || e.posF < -1e-9 || e.posF > L.numFloors - 1 + 1e-9) inBounds = false;
  }
  assert(inBounds, 'cars stay within the floors × columns grid');
}

// --- 3. Horizontal-only trips (same floor, different column) are allowed ------------
{
  const L = getLevel('b1');
  let sawHorizontalOnly = false;
  for (let s = 1; s <= 20 && !sawHorizontalOnly; s++) {
    for (const p of generatePassengers(L, s)) if (p.origin === p.dest && p.originCol !== p.destCol) sawHorizontalOnly = true;
  }
  assert(sawHorizontalOnly, 'grid traffic includes same-floor, different-column trips');
  // …and they get delivered.
  assert(runSimulation(L, 3, gridSmart).metrics.deliveredAll, 'those trips are delivered too');
}

// --- 4. Determinism ----------------------------------------------------------------
{
  const a = JSON.stringify(runSimulation(getLevel('b2'), 2, gridSmart).metrics);
  const b = JSON.stringify(runSimulation(getLevel('b2'), 2, gridSmart).metrics);
  assert(a === b, 'a grid run is deterministic');
}

// --- 5. Honest stars: naive baseline ~1★, smart ~3★, and the bracket is meaningful --
{
  for (const L of bonus) {
    const naive = scoreLevel(L, gridNaive);
    const smart = scoreLevel(L, gridSmart);
    assert(naive.stars >= 1, `${L.id}: naive baseline clears (>= 1 star)`);
    assert(smart.stars === 3, `${L.id}: smart reference reaches par (3 stars)`);
    assert(naive.composite > smart.composite, `${L.id}: naive composite worse than smart (meaningful par)`);
    assert(scoreLevel(L, compileController(L.starter)).stars >= 1, `${L.id}: the grid starter clears (>= 1 star)`);
  }
}

// --- 6. Broad-seed delivery: references + starter never strand on the bonus levels --
{
  let stranded = 0;
  for (const L of bonus) {
    const starter = compileController(L.starter);
    for (const c of [gridNaive, gridSmart, starter]) {
      for (let s = 1; s <= 60; s++) if (!runSimulation(L, s, c).metrics.deliveredAll) stranded++;
    }
  }
  assert(stranded === 0, `grid references + starter deliver everyone across seeds 1-60 on both bonus levels (${bonus.length * 3 * 60} runs)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
