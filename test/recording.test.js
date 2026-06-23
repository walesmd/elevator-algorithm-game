// recording.test.js — guarantees for the Phase-2 frame recording used by the
// renderer. Run: `node test/recording.test.js` (also runs via `npm test`).
//
// The renderer is throwaway-replaceable, but the *recording contract* it depends on
// is load-bearing: frames must be deterministic, must not perturb scoring, and must
// describe smooth, legal motion (no teleporting cars, no over-capacity, monotonic
// delivery). These run headless in Node with no canvas.

import { runSimulation } from '../src/engine/simulation.js';
import * as fcfs from '../src/reference/fcfs.js';
import * as look from '../src/reference/look.js';
import { getLevel } from '../src/game/levels.js';

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

// --- 1. Recording is opt-in and deterministic ------------------------------
{
  const plain = runSimulation(L1, 1, fcfs.createController);
  assert(Array.isArray(plain.frames) && plain.frames.length === 0, 'no frames recorded unless opts.record is set');

  const a = runSimulation(L1, 1, fcfs.createController, { record: true });
  const b = runSimulation(L1, 1, fcfs.createController, { record: true });
  assert(a.frames.length > 0, 'recording produces frames');
  assert(JSON.stringify(a.frames) === JSON.stringify(b.frames), 'same (level, seed, controller) → identical frames');
}

// --- 2. Recording does not change the score --------------------------------
{
  const withRec = runSimulation(L2, 3, look.createController, { record: true });
  const without = runSimulation(L2, 3, look.createController);
  assert(
    JSON.stringify(withRec.metrics) === JSON.stringify(without.metrics),
    'recording leaves metrics byte-identical (no observer effect)'
  );
}

// --- 3. One frame per tick, aligned with the run length --------------------
{
  const r = runSimulation(L1, 2, fcfs.createController, { record: true });
  assert(r.frames.length === r.metrics.endTick, 'exactly one frame per simulated tick');
  assert(r.frames[0].t === 0, 'first frame is tick 0');
  assert(r.frames[r.frames.length - 1].t === r.metrics.endTick - 1, 'last frame is the final tick');
}

// --- 4. Frames are independent snapshots (no shared mutable refs) -----------
{
  // If frames aliased live passenger objects, every frame's waiting list would
  // collapse to the final (empty) state. Check an early frame still has waiters.
  const r = runSimulation(L1, 1, fcfs.createController, { record: true });
  const sawWaiters = r.frames.some((f) => f.waiting.length > 0);
  assert(sawWaiters, 'early frames retain their own waiting snapshots (deep copied)');
}

// --- 5. Per-frame invariants: legal, smooth, monotonic ---------------------
{
  const r = runSimulation(L2, 4, fcfs.createController, { record: true });
  const tpf = L2.ticksPerFloor ?? 2;
  const maxStep = 1 / tpf + 1e-9;

  let posLegal = true;
  let posSmooth = true;
  let loadLegal = true;
  let callsTidy = true;
  let waitsNonNeg = true;
  let deliveredMonotonic = true;
  let prevDelivered = 0;
  const prevPos = new Map();

  for (const f of r.frames) {
    if (f.delivered < prevDelivered) deliveredMonotonic = false;
    prevDelivered = f.delivered;
    for (const w of f.waiting) if (w.wait < 0) waitsNonNeg = false;
    for (const ev of f.elevators) {
      if (ev.pos < 0 || ev.pos > L2.numFloors - 1) posLegal = false;
      if (ev.load > ev.capacity) loadLegal = false;
      const sorted = ev.carCalls.every((v, k) => k === 0 || v > ev.carCalls[k - 1]);
      if (!sorted) callsTidy = false;
      if (prevPos.has(ev.index) && Math.abs(ev.pos - prevPos.get(ev.index)) > maxStep) posSmooth = false;
      prevPos.set(ev.index, ev.pos);
    }
  }

  assert(posLegal, 'car position stays within the building');
  assert(posSmooth, `car never moves more than 1/ticksPerFloor (${(1 / tpf).toFixed(2)}) per tick — no teleporting`);
  assert(loadLegal, 'recorded load never exceeds capacity');
  assert(callsTidy, 'carCalls are sorted and de-duplicated');
  assert(waitsNonNeg, 'recorded wait times are non-negative');
  assert(deliveredMonotonic, 'delivered count never decreases over the run');

  const lastL1 = runSimulation(L1, 1, fcfs.createController, { record: true }).frames.slice(-1)[0];
  assert(lastL1.delivered === lastL1.total, 'final frame shows everyone delivered (FCFS clears L1)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
