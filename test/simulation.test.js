// simulation.test.js — plain-assertion tests, no framework. Run: `node test/simulation.test.js`
//
// Covers the load-bearing guarantees of the foundation: determinism, correct
// passenger generation, safe command resolution, capacity enforcement, that the
// FCFS baseline delivers everyone, that LOOK beats it, and that star scoring is
// sane. These run headless in Node and in the browser unchanged.

import { mulberry32, randInt } from '../src/engine/rng.js';
import { generatePassengers } from '../src/engine/passengers.js';
import { runSimulation } from '../src/engine/simulation.js';
import * as fcfs from '../src/reference/fcfs.js';
import * as look from '../src/reference/look.js';
import { getLevel } from '../src/game/levels.js';
import { scoreLevel, aggregate, compositeOf } from '../src/game/scoring.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ok   ' + msg);
  } else {
    failed++;
    console.error('  FAIL ' + msg);
  }
}

const L1 = getLevel('l1');
const L2 = getLevel('l2');

function avgOver(level, factory, key) {
  const vals = level.seeds.map((s) => runSimulation(level, s, factory).metrics[key]);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// --- 1. RNG determinism -----------------------------------------------------
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert(JSON.stringify(seqA) === JSON.stringify(seqB), 'same seed → identical sequence');
  assert(seqA[0] !== c(), 'different seed → different sequence');
  const r = mulberry32(7);
  let inRange = true;
  for (let i = 0; i < 1000; i++) {
    const n = randInt(r, 5);
    if (n < 0 || n >= 5 || !Number.isInteger(n)) inRange = false;
  }
  assert(inRange, 'randInt stays in [0, n)');
}

// --- 2. Passenger generation ------------------------------------------------
{
  const p1 = generatePassengers(L1, 3);
  const p2 = generatePassengers(L1, 3);
  assert(JSON.stringify(p1) === JSON.stringify(p2), 'passenger generation is deterministic');
  assert(p1.length === L1.spawn.count, `generates exactly ${L1.spawn.count} passengers`);
  const valid = p1.every(
    (p) =>
      p.origin >= 0 &&
      p.origin < L1.numFloors &&
      p.dest >= 0 &&
      p.dest < L1.numFloors &&
      p.origin !== p.dest &&
      p.spawnTick >= 0
  );
  assert(valid, 'every passenger has valid origin/dest/spawnTick');
  const sorted = p1.every((p, i) => i === 0 || p.spawnTick >= p1[i - 1].spawnTick);
  assert(sorted, 'passengers are sorted by spawn time');
}

// --- 2b. No passenger ever calls for the floor they're already on -----------
// Across every spawn shape (incl. up-peak/down-peak, which no shipped level uses
// yet) and a range of floor counts/seeds — a same-floor "trip" is a zero-distance
// request that should never exist.
{
  const configs = [
    L1,
    L2,
    { numFloors: 5, spawn: { type: 'up-peak', count: 60, firstTick: 0, lastTick: 200, lobbyBias: 0.7 }, timeLimit: 1000 },
    { numFloors: 10, spawn: { type: 'down-peak', count: 60, firstTick: 0, lastTick: 300, lobbyBias: 0.7 }, timeLimit: 2000 },
    { numFloors: 2, spawn: { type: 'uniform', count: 40, firstTick: 0, lastTick: 100 }, timeLimit: 500 },
  ];
  let sameFloor = 0;
  let total = 0;
  for (const L of configs) {
    for (let seed = 1; seed <= 40; seed++) {
      for (const p of generatePassengers(L, seed)) {
        total++;
        if (p.origin === p.dest) sameFloor++;
      }
    }
  }
  assert(sameFloor === 0, `no passenger has origin === dest across all spawn types (checked ${total})`);
}

// --- 3. Simulation determinism ---------------------------------------------
{
  const r1 = runSimulation(L2, 2, fcfs.createController);
  const r2 = runSimulation(L2, 2, fcfs.createController);
  assert(
    JSON.stringify(r1.metrics) === JSON.stringify(r2.metrics),
    'same (level, seed, controller) → identical metrics'
  );
}

// --- 4. FCFS delivers everyone ---------------------------------------------
{
  const okL1 = L1.seeds.every((s) => runSimulation(L1, s, fcfs.createController).metrics.deliveredAll);
  const okL2 = L2.seeds.every((s) => runSimulation(L2, s, fcfs.createController).metrics.deliveredAll);
  assert(okL1, 'FCFS delivers everyone on Level 1 (all seeds)');
  assert(okL2, 'FCFS delivers everyone on Level 2 (all seeds)');
}

// --- 5. LOOK delivers everyone and beats FCFS on wait ----------------------
{
  const okLook = L2.seeds.every((s) => runSimulation(L2, s, look.createController).metrics.deliveredAll);
  assert(okLook, 'LOOK delivers everyone on Level 2 (all seeds)');

  const fcfsWait = avgOver(L2, fcfs.createController, 'avgWait');
  const lookWait = avgOver(L2, look.createController, 'avgWait');
  assert(lookWait <= fcfsWait, `LOOK avg wait (${r1(lookWait)}) <= FCFS avg wait (${r1(fcfsWait)})`);

  const fcfsComp = compositeOf(aggregate(L2.seeds.map((s) => runSimulation(L2, s, fcfs.createController))), L2.weights);
  const lookComp = compositeOf(aggregate(L2.seeds.map((s) => runSimulation(L2, s, look.createController))), L2.weights);
  assert(lookComp <= fcfsComp, `LOOK composite (${r1(lookComp)}) <= FCFS composite (${r1(fcfsComp)})`);
}

// --- 6. Command resolution: illegal moves are non-fatal --------------------
{
  const alwaysUp = () => ({ step: () => [{ action: 'MOVE_UP' }] });
  const res = runSimulation(L1, 1, alwaysUp);
  assert(res.warnings.some((w) => /MOVE_UP ignored at top/.test(w)), 'MOVE_UP at top floor warns, no crash');
  assert(res.metrics.deliveredAll === false, 'a car that only goes up delivers no one (sanity)');

  const garbage = () => ({ step: () => [{ action: 'TELEPORT' }] });
  const res2 = runSimulation(L1, 1, garbage);
  assert(res2.warnings.some((w) => /Unknown command/.test(w)), 'unknown command warns, treated as IDLE');
}

// --- 7. Capacity is enforced ------------------------------------------------
{
  const tight = { ...L2, capacity: 2 };
  const probe = { max: 0 };
  const factory = (config) => {
    const inner = look.createController(config);
    return {
      step(state) {
        probe.max = Math.max(probe.max, state.elevators[0].load);
        return inner.step(state);
      },
    };
  };
  const res = tight.seeds.map((s) => runSimulation(tight, s, factory));
  assert(probe.max <= 2, `onboard load never exceeds capacity (saw max ${probe.max} with cap 2)`);
  assert(res.every((r) => r.metrics.deliveredAll), 'still delivers everyone with capacity 2');
}

// --- 8. Scoring and stars ---------------------------------------------------
{
  const fcfsScore = scoreLevel(L1, fcfs.createController);
  const lookScore = scoreLevel(L1, look.createController);
  assert(fcfsScore.metrics.deliveredAll && fcfsScore.stars >= 1, 'FCFS earns at least 1 star on L1');
  assert(lookScore.stars >= fcfsScore.stars, 'LOOK scores at least as many stars as FCFS');
  assert(lookScore.stars === 3, 'LOOK hits par (3 stars) on L1');

  const doNothing = () => ({ step: () => [{ action: 'IDLE' }] });
  const idleScore = scoreLevel(L1, doNothing);
  assert(idleScore.stars === 0 && !idleScore.metrics.deliveredAll, 'do-nothing controller earns 0 stars');
}

// --- 9. maxWarnings caps a flooding controller without changing the run -----
{
  const alwaysUp = () => ({ step: () => [{ action: 'MOVE_UP' }] }); // illegal at the top every tick
  const uncapped = runSimulation(L1, 1, alwaysUp);
  const capped = runSimulation(L1, 1, alwaysUp, { maxWarnings: 5 });
  assert(uncapped.warnings.length > 5, 'without a cap, a flooding controller produces many warnings');
  assert(capped.warnings.length === 5, 'maxWarnings caps the collected warnings');
  assert(
    JSON.stringify(capped.metrics) === JSON.stringify(uncapped.metrics),
    'maxWarnings affects only warnings, not the simulation/metrics'
  );
}

function r1(n) {
  return Math.round(n * 10) / 10;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
