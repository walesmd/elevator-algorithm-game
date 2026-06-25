// analyzer.test.js — the local run-diagnosis rules (Phase 7). Run: `node test/analyzer.test.js`.
//
// Two layers: unit tests over hand-built frames (precise control of each anti-pattern)
// and integration tests over real reference runs (the naive FCFS should trip the
// "passes riders going its way" rule that the proper LOOK algorithm does not).

import { analyze } from '../src/game/analyzer.js';
import { runSimulation } from '../src/engine/simulation.js';
import { scoreLevel } from '../src/game/scoring.js';
import { getLevel } from '../src/game/levels.js';
import * as fcfs from '../src/reference/fcfs.js';
import * as look from '../src/reference/look.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const has = (a, id) => a.findings.some((f) => f.id === id);
const okMetrics = (over = {}) => ({ avgWait: 10, avgJourney: 20, maxWait: 30, distance: 100, delivered: 5, total: 5, deliveredAll: true, throughput: 1, ...over });
const par = { look: { avgWait: 10, avgJourney: 20, maxWait: 30, distance: 100 } };
const L = { numFloors: 10, ticksPerFloor: 2, weights: { wait: 1, journey: 0.5, distance: 0.1 } };

function car(over = {}) {
  return { index: 0, floor: 0, minFloor: 0, maxFloor: 9, pos: 0, dir: 'idle', doorOpen: 0, load: 0, capacity: 8, carCalls: [], ...over };
}
function frame(t, cars, waiting = []) {
  return { t, delivered: 0, total: 5, distance: 0, riding: 0, elevators: cars, waiting };
}
const rider = (floor, dir, wait = 0) => ({ id: floor, floor, dest: dir === 'up' ? floor + 2 : Math.max(0, floor - 2), dir, wait, transfer: false });

// --- 1. passedSameDir: leaves a floor (doors shut) the way a waiting rider wants --
{
  // Car sits at floor 1 (up-rider waiting, room), then moves up to floor 2 — never opened.
  const up = [rider(1, 'up')];
  const frames = [
    frame(0, [car({ floor: 1, dir: 'up', pos: 1 })], up),
    frame(1, [car({ floor: 1, dir: 'up', pos: 1 })], up),
    frame(2, [car({ floor: 2, dir: 'up', pos: 2 })], up),
  ];
  const a = analyze({ frames, metrics: okMetrics(), par, level: L });
  assert(has(a, 'passedSameDir'), 'flags a car that leaves a floor heading the way a waiting rider wants');

  // Same, but the doors DID open at floor 1 → it served them → no finding.
  const served = [
    frame(0, [car({ floor: 1, dir: 'up', pos: 1, doorOpen: 1 })], up),
    frame(1, [car({ floor: 2, dir: 'up', pos: 2 })], []),
  ];
  assert(!has(analyze({ frames: served, metrics: okMetrics(), par, level: L }), 'passedSameDir'),
    'does NOT flag when the car opened its doors (it served the rider)');

  // Car heads up past a DOWN-rider — that's correct directional behavior, not a pass.
  const down = [rider(1, 'down')];
  const opp = [
    frame(0, [car({ floor: 1, dir: 'up', pos: 1 })], down),
    frame(1, [car({ floor: 2, dir: 'up', pos: 2 })], down),
  ];
  assert(!has(analyze({ frames: opp, metrics: okMetrics(), par, level: L }), 'passedSameDir'),
    'does NOT flag passing an opposite-direction rider (serving them later is correct)');

  // Full car can't be blamed for passing someone — no room.
  const full = [
    frame(0, [car({ floor: 1, dir: 'up', pos: 1, load: 8 })], [rider(1, 'up')]),
    frame(1, [car({ floor: 2, dir: 'up', pos: 2, load: 8 })], [rider(1, 'up')]),
  ];
  assert(!has(analyze({ frames: full, metrics: okMetrics(), par, level: L }), 'passedSameDir'),
    'does NOT flag a full car (it had no room to pick anyone up)');
}

// --- 2. starvation: someone waits past the red threshold (sweep*4 = 80 here) ------
{
  const frames = [frame(0, [car()], [{ id: 1, floor: 7, dest: 0, dir: 'down', wait: 95, transfer: false }])];
  const a = analyze({ frames, metrics: okMetrics(), par, level: L });
  assert(has(a, 'starvation'), 'flags a rider who waited far past the fairness threshold');

  const okWait = [frame(0, [car()], [{ id: 1, floor: 7, dest: 0, dir: 'down', wait: 20, transfer: false }])];
  assert(!has(analyze({ frames: okWait, metrics: okMetrics(), par, level: L }), 'starvation'),
    'does NOT flag a normal wait');
}

// --- 3. idleWithPending: a car parked (idle, empty) while reachable riders wait ----
{
  const frames = [];
  for (let t = 0; t < 20; t++) frames.push(frame(t, [car({ dir: 'idle', load: 0 })], [rider(5, 'up')]));
  assert(has(analyze({ frames, metrics: okMetrics(), par, level: L }), 'idleWithPending'),
    'flags a car left idle for a sustained stretch while people wait');

  const brief = [];
  for (let t = 0; t < 5; t++) brief.push(frame(t, [car({ dir: 'idle' })], [rider(5, 'up')]));
  assert(!has(analyze({ frames: brief, metrics: okMetrics(), par, level: L }), 'idleWithPending'),
    'does NOT flag a brief pause between errands');
}

// --- 4. metric rules: stranded / highWait / overTravel ----------------------------
{
  const stranded = analyze({ frames: [], metrics: okMetrics({ delivered: 3, total: 5, deliveredAll: false }), par, level: L });
  assert(has(stranded, 'stranded'), 'flags undelivered riders');
  assert(stranded.findings[0].id === 'stranded', 'stranded is the top-priority finding');
  assert(/never (reached|arrived)/i.test(stranded.feedback), 'stranded feedback leads with the delivery problem');

  const slow = analyze({ frames: [], metrics: okMetrics({ avgWait: 18 }), par, level: L });
  assert(has(slow, 'highWait'), 'flags average wait well above par');

  const wander = analyze({ frames: [], metrics: okMetrics({ distance: 200 }), par, level: L });
  assert(has(wander, 'overTravel'), 'flags distance well above par');
}

// --- 5. feedback never reveals code, and stays encouraging ------------------------
{
  const a = analyze({ frames: [], metrics: okMetrics({ avgWait: 18 }), par, level: L, stars: 1 });
  assert(typeof a.feedback === 'string' && a.feedback.length > 0, 'produces a feedback line');
  assert(!/createController|MOVE_UP|state\.elevators|return \[/.test(a.feedback), 'feedback contains no code/API tokens (non-spoiler)');
  assert(typeof a.runHint === 'string' && a.runHint.length > 0, 'produces a run-specific hint (Hint 2)');
}

// --- 6. integration: naive FCFS trips the en-route rule; proper LOOK does not ------
{
  const L2 = getLevel('l2');
  const fScore = scoreLevel(L2, fcfs.createController);
  const fFrames = runSimulation(L2, 1, fcfs.createController, { record: true }).frames;
  const fcfsA = analyze({ frames: fFrames, metrics: fScore.metrics, par: fScore.par, level: L2, stars: fScore.stars });

  const lScore = scoreLevel(L2, look.createController);
  const lFrames = runSimulation(L2, 1, look.createController, { record: true }).frames;
  const lookA = analyze({ frames: lFrames, metrics: lScore.metrics, par: lScore.par, level: L2, stars: lScore.stars });

  assert(has(fcfsA, 'passedSameDir'), 'FCFS (ignores riders en route) trips "passes riders going its way" on L2');
  assert(!has(lookA, 'passedSameDir'), 'LOOK (serves en route) does NOT trip it on L2');
  assert(fcfsA.findings.length > lookA.findings.length, 'FCFS yields more findings than LOOK');
  assert(/par/i.test(lookA.feedback), 'LOOK (at par) gets par-level praise');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
