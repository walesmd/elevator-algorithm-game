// references.test.js — the reference-algorithm gallery (Phase 4). Run: `node test/references.test.js`.
//
// Guarantees the comparison/insert feature can rely on: there are five well-formed
// references, each compiles from its `source` (the editor-insertable text is the
// SAME thing that gets scored — no drift), each delivers everyone on L1 and L2, and
// the spoiler gating is set as the doctrine requires (FCFS open, solvers gated).

import { gallery } from '../src/reference/gallery.js';
import { compileController } from '../src/sandbox/compile.js';
import { runSimulation } from '../src/engine/simulation.js';
import { scoreLevel } from '../src/game/scoring.js';
import { getLevel, levels } from '../src/game/levels.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const L1 = getLevel('l1');
const L2 = getLevel('l2');

// --- 1. Roster shape --------------------------------------------------------
{
  assert(gallery.length === 5, 'gallery has five reference algorithms');
  const ids = gallery.map((g) => g.id);
  assert(new Set(ids).size === 5, 'ids are unique');
  assert(['fcfs', 'sstf', 'scan', 'look', 'cscan'].every((id) => ids.includes(id)), 'has FCFS, SSTF, SCAN, LOOK, C-SCAN');

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

// --- 4. Every reference delivers everyone on EVERY level (refs must work) ----
{
  for (const L of levels) {
    for (const g of gallery) {
      const ok = L.seeds.every((s) => runSimulation(L, s, g.createController).metrics.deliveredAll);
      assert(ok, `${g.id} delivers everyone on ${L.id} (all seeds)`);
    }
  }
}

// --- 4b. Par is sane on every level: FCFS clears (>=1 star) and is beaten by ---
// LOOK (3 stars), so the 1-star baseline and 3-star par bracket every level.
{
  for (const L of levels) {
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

  // C-SCAN never STOPs while deadheading down — i.e. it is genuinely one-directional.
  // (Structural: its source has a single STOP, inside the up-sweep branch.)
  const cscanSrc = gallery.find((g) => g.id === 'cscan').source;
  const stopCount = (cscanSrc.match(/["']STOP["']/g) || []).length;
  assert(stopCount === 1, 'C-SCAN issues STOP from exactly one place (up-sweep only)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
