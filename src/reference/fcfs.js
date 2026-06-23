// fcfs.js — First-Come, First-Served reference controller.
//
// INTERNAL REFERENCE. The naive baseline the game measures against (1 star =
// "beat FCFS"). Deliberately simple and deliberately not great: it serves one
// request at a time and ignores riders it passes along the way. That weakness is
// the point — it's the strawman later algorithms beat. FCFS is the sanctioned
// starting strategy, so it is NOT spoiler-gated.
//
// Single source of truth: `source` is the exact, editor-insertable code (what the
// "insert into editor" button pastes); `createController` is compiled from it, so
// the scored controller and the shown code can never drift apart.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'fcfs',
  name: 'First-Come, First-Served (FCFS)',
  concept: 'Greedy baseline — serve calls strictly in arrival order.',
  blurb:
    'The simplest fair rule: handle one request at a time, in the order it arrived. ' +
    'Easy to reason about, but it backtracks across the building a lot.',
  spoiler: false, // the sanctioned strawman, not a solution
};

export const source = `// First-Come, First-Served (FCFS): the naive baseline.
// Pick ONE target and drive straight to it, ignoring everyone you pass:
//   - if you're carrying riders, go drop the nearest one off;
//   - otherwise, go answer the OLDEST waiting hall call.
// Simple and obviously fair — but it wastes whole trips, because it never serves
// the people it sails past on the way.
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }]; // busy: let the physics finish

      let target = null;
      if (e.load > 0) {
        target = nearest(e.floor, e.carCalls);   // drop a rider we already have
      } else if (state.hallCalls.length > 0) {
        target = state.hallCalls[0].floor;        // else answer the oldest call
      }

      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP' }]; // arrived: drop off and/or pick up here
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
}`;

export const createController = compileController(source);
