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
  concept: 'Greedy baseline — serve calls strictly in arrival order, one at a time.',
  blurb:
    'The simplest fair rule: handle one request at a time, in the order it arrived. ' +
    'Easy to reason about, but it backtracks across the building a lot.',
  spoiler: false, // the sanctioned strawman, not a solution
};

export const source = `// First-Come, First-Served (FCFS): the naive baseline.
// Pick ONE target and drive straight to it, ignoring everyone you pass:
//   - carrying riders? go drop the nearest one off;
//   - otherwise, go answer the OLDEST waiting hall call.
// When we open the doors we tell the engine which direction we're serving (the
// real car shows an arrow), so only riders going that way board.
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }]; // busy: let the physics finish

      let target = null;
      let serving = null;
      if (e.load > 0) {
        target = nearest(e.floor, e.carCalls);        // drop a rider we already have
        serving = target > e.floor ? 'up' : 'down';
      } else if (state.hallCalls.length > 0) {
        const call = state.hallCalls[0];               // answer the oldest call,
        target = call.floor;
        serving = call.direction;                      // serving the way they want to go
      }

      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP', serving }]; // arrived: drop off and/or pick up here
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
