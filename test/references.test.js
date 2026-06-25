// references.test.js — the reference-algorithm gallery (Phase 4). Run: `node test/references.test.js`.
//
// Guarantees the comparison/insert feature can rely on: the well-formed references
// each compile from their `source` (the editor-insertable text is the SAME thing
// that gets scored — no drift), each delivers everyone on every level (across a
// broad seed range, not just the scoring seeds), and the spoiler gating is set as
// the doctrine requires (FCFS open, solvers gated).

import { gallery } from '../src/reference/gallery.js';
import { compileController } from '../src/sandbox/compile.js';
import { runSimulation } from '../src/engine/simulation.js';
import { scoreLevel } from '../src/game/scoring.js';
import { getLevel, levels } from '../src/game/levels.js';
import { STARTER_CODE } from '../src/game/starter.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const L1 = getLevel('l1');
const L2 = getLevel('l2');

// The gallery references (FCFS/SSTF/SCAN/LOOK) only move up and down, so they apply to
// the one-dimensional curriculum levels. The 2-D "sideways" bonus levels anchor on
// their own grid references (see grid.test.js); exclude them from the 1-D checks.
const curriculum = levels.filter((L) => !((L.numCols ?? 1) > 1));
const starterFor = (L) => compileController(L.starter || STARTER_CODE);

// --- 1. Roster shape --------------------------------------------------------
{
  assert(gallery.length === 4, 'gallery has four reference algorithms');
  const ids = gallery.map((g) => g.id);
  assert(new Set(ids).size === 4, 'ids are unique');
  assert(['fcfs', 'sstf', 'scan', 'look'].every((id) => ids.includes(id)), 'has FCFS, SSTF, SCAN, LOOK');
  assert(!ids.includes('cscan'), 'C-SCAN dropped (cannot serve a real bidirectional tower under directional boarding)');

  const wellFormed = gallery.every(
    (g) =>
      typeof g.name === 'string' && g.name &&
      typeof g.concept === 'string' && g.concept &&
      typeof g.blurb === 'string' && g.blurb &&
      typeof g.source === 'string' && g.source.includes('createController') &&
      typeof g.createController === 'function'
  );
  assert(wellFormed, 'every entry has name/concept/blurb/source/createController');
}

// --- 2. Spoiler gating ------------------------------------------------------
{
  const fcfs = gallery.find((g) => g.id === 'fcfs');
  assert(fcfs.spoiler === false, 'FCFS is the sanctioned strawman (not spoiler-gated)');
  const solvers = gallery.filter((g) => g.id !== 'fcfs');
  assert(solvers.every((g) => g.spoiler === true), 'the four solving algorithms are spoiler-gated');
}

// --- 3. Source is the source of truth (compiles to the scored controller) ---
{
  let allMatch = true;
  for (const g of gallery) {
    const fromSource = compileController(g.source);
    const a = runSimulation(L2, 2, fromSource).metrics;
    const b = runSimulation(L2, 2, g.createController).metrics;
    if (JSON.stringify(a) !== JSON.stringify(b)) { allMatch = false; console.error('   drift in', g.id); }
  }
  assert(allMatch, 'each `source` recompiles to the same behavior as its createController (no drift)');
}

// --- 4. Every reference delivers everyone on every curriculum level (refs must work) -
{
  for (const L of curriculum) {
    for (const g of gallery) {
      const ok = L.seeds.every((s) => runSimulation(L, s, g.createController).metrics.deliveredAll);
      assert(ok, `${g.id} delivers everyone on ${L.id} (all seeds)`);
    }
  }
}

// --- 4a. BROAD-seed delivery (regression guard against direction-aware livelocks) -
// The fixed scoring seeds [1-5] are a tiny sample; a livelock/strand can hide on
// "unlucky" seeds (a directional LOOK once oscillated forever on L1 seed 26). Sweep
// many seeds for the references AND the shipped starter — a reference that strands
// anyone violates the doctrine, and the starter must never break a player's run.
{
  const starter = compileController(STARTER_CODE);
  const controllers = [...gallery.map((g) => ({ id: g.id, c: g.createController })), { id: 'starter', c: starter }];
  let stranded = 0;
  for (const L of curriculum) {
    for (const { c } of controllers) {
      for (let s = 1; s <= 60; s++) if (!runSimulation(L, s, c).metrics.deliveredAll) stranded++;
    }
  }
  assert(stranded === 0, `references + starter deliver everyone across seeds 1-60 on every curriculum level (${curriculum.length * controllers.length * 60} runs)`);
  // The shipped starter (whichever variant the level uses) must clear EVERY level,
  // bonus levels included, so a player's first run never strands anyone.
  let starterClears = true;
  for (const L of levels) if (scoreLevel(L, starterFor(L)).stars < 1) starterClears = false;
  assert(starterClears, 'the per-level starter clears (>= 1 star) on every level (curriculum + bonus)');
}

// --- 4b. Par is sane on every curriculum level: FCFS clears (>=1 star) and is beaten
// by LOOK (3 stars), so the 1-star baseline and 3-star par bracket every level.
{
  for (const L of curriculum) {
    const fcfs = scoreLevel(L, gallery.find((g) => g.id === 'fcfs').createController);
    const look = scoreLevel(L, gallery.find((g) => g.id === 'look').createController);
    assert(fcfs.stars >= 1, `${L.id}: FCFS clears the level (>= 1 star)`);
    assert(look.stars === 3, `${L.id}: LOOK reaches par (3 stars)`);
    assert(fcfs.composite > look.composite, `${L.id}: FCFS composite is worse than LOOK (meaningful par)`);
  }
}

// --- 5. Sanity on the named behavior ---------------------------------------
{
  // SCAN should run to the building's physical ends; trace floor 0 and numFloors-1.
  const tr = runSimulation(L2, 1, gallery.find((g) => g.id === 'scan').createController, { trace: true }).trace;
  const floors = new Set(tr.map((x) => x.floor));
  assert(floors.has(0) && floors.has(L2.numFloors - 1), 'SCAN reaches both building ends');

  // The directional sweeps declare a serving direction on STOP; FCFS/SSTF do too.
  for (const id of ['look', 'scan']) {
    assert(/serving/.test(gallery.find((g) => g.id === id).source), `${id} declares a serving direction (directional)`);
  }
}

// --- 6. N-car awareness: every reference + the starter drive all cars (6B) ---
// Today's curriculum includes multi-car levels. A reference that only ever drives
// car 0 would leave the rest asleep; prove each one issues a real (non-IDLE)
// command for a car beyond index 0 at some tick on a multi-car level.
{
  const multi = curriculum.filter((L) => (L.numElevators ?? 1) > 1);
  assert(multi.length >= 1, 'the curriculum has at least one multi-elevator level');

  const drivesEveryCar = (factory, L) => {
    const tr = runSimulation(L, L.seeds[0], factory, { trace: true }).trace;
    return tr.some((x) => x.elevator > 0 && x.action !== 'IDLE');
  };

  // Pick the busiest multi-car level (most cars) for the strongest signal.
  const L = multi.reduce((a, b) => (b.numElevators > a.numElevators ? b : a));
  for (const g of gallery) {
    assert(drivesEveryCar(g.createController, L), `${g.id} drives cars beyond index 0 on ${L.id} (N-car aware)`);
  }
  assert(drivesEveryCar(compileController(STARTER_CODE), L), `the starter drives cars beyond index 0 on ${L.id} (multi-car starter)`);

  // The N=1 path is unchanged: each reference still drives the single car on L1.
  for (const g of gallery) {
    assert(
      runSimulation(L1, 1, g.createController).metrics.deliveredAll,
      `${g.id} still delivers everyone on the single-car L1 (N=1 path intact)`
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
