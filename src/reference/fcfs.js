// fcfs.js — First-Come, First-Served reference controller.
//
// INTERNAL REFERENCE. The naive baseline the game measures against (1 star =
// "beat FCFS"). Deliberately simple and deliberately not great: it serves one
// request at a time and ignores riders it passes along the way. FCFS is the
// sanctioned starting strategy, so it is NOT spoiler-gated.
//
// Single source of truth: `createController` is compiled from `source`, the exact
// editor-insertable code, so the scored controller and the shown code can't drift.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'fcfs',
  name: 'First-Come, First-Served (FCFS)',
  concept: 'Naive baseline — each car drives one errand at a time, oldest calls first; extra cars just split the calls so two never chase the same one.',
  blurb:
    'The simplest fair rule: each car handles one request at a time, in the order it arrived, ' +
    'and a second car just takes the calls the first one isn\'t going for. Easy to reason about, ' +
    'but every car backtracks across the building a lot.',
  howItWorks:
    'FCFS keeps it simple: it serves whole requests one at a time, in the order they arrived. ' +
    'Each free car picks one errand — a drop-off it is already carrying, or the oldest waiting call — ' +
    'and drives straight there, ignoring everyone it passes on the way. With more than one car, the ' +
    'only coordination is that two cars never claim the same call. Because it never picks up the riders ' +
    'it drives past, those riders wait for an entirely separate trip, so the cars backtrack constantly.',
  spoiler: false, // the sanctioned strawman, not a solution
};

export const source = `// First-Come, First-Served (FCFS): the naive baseline.
// Each car picks ONE errand and drives straight to it, ignoring everyone it
// passes along the way:
//   - carrying riders? go drop the nearest one off;
//   - otherwise, go answer a waiting hall call — oldest calls first.
// With more than one car the only "coordination" is that two cars never claim
// the same call: each waiting call goes to the nearest car that is still free.
// When a car opens its doors it tells the engine which direction it's serving (a
// real car shows an arrow), so only riders going that way board.
function createController(config) {
  return {
    step(state) {
      const cars = state.elevators;

      // Each car's errand for this tick: a { floor, serving } target, or null.
      // A car already carrying riders is committed to dropping the nearest one.
      const target = cars.map((e) => {
        if (e.load === 0) return null;
        const floor = nearest(e.floor, e.carCalls);
        return { floor, serving: floor > e.floor ? 'up' : 'down' };
      });

      // Hand each still-free car a waiting call, oldest first, to its nearest car.
      // (Naive, but it keeps two cars from chasing the very same call.)
      for (const call of state.hallCalls) {
        let pick = -1;
        let bestDist = Infinity;
        cars.forEach((e, i) => {
          if (target[i]) return;                       // already busy with an errand
          if (!serves(e, call)) return;                // outside this car's zone
          const d = Math.abs(e.floor - call.floor);
          if (d < bestDist) { bestDist = d; pick = i; }
        });
        if (pick === -1) continue;                     // no free car can serve this call yet
        target[pick] = { floor: call.floor, serving: call.direction };
      }

      // Turn each car's errand into one command (drive toward it, then stop).
      return cars.map((e, i) => {
        if (!e.ready) return { action: 'IDLE' };       // busy: let the physics finish
        const t = target[i];
        if (!t) return { action: 'IDLE' };
        if (e.floor < t.floor) return { action: 'MOVE_UP' };
        if (e.floor > t.floor) return { action: 'MOVE_DOWN' };
        return { action: 'STOP', serving: t.serving }; // arrived: drop off and/or pick up
      });
    },
  };
}

function nearest(from, floors) {
  let best = floors[0];
  let bestDist = Math.abs(from - best);
  for (const f of floors) {
    const d = Math.abs(from - f);
    if (d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}

// On a zoned level a car only covers floors in [minFloor, maxFloor], and can only
// take a rider their way if there's room to move that way inside its range. On a
// full-height level this is always true, so behavior is unchanged.
function serves(e, call) {
  if (call.floor < e.minFloor || call.floor > e.maxFloor) return false;
  return call.direction === 'up' ? call.floor < e.maxFloor : call.floor > e.minFloor;
}`;

export const createController = compileController(source);
