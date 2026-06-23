// fcfs.js — First-Come, First-Served reference controller.
//
// INTERNAL REFERENCE ONLY. This is the naive baseline the game measures against
// (1 star = "beat FCFS"). It is deliberately simple and deliberately not great:
// it serves one request at a time and ignores riders it passes along the way.
// That weakness is the whole point — it's the strawman later algorithms beat.
//
// Per the project doctrine, this file is engine/scoring infrastructure. The
// solving algorithms (LOOK and beyond) are spoiler-gated and never shown to the
// player by default.
//
// Contract: createController(config) -> { step(state) -> [command, ...] }

export function createController() {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }]; // busy: let physics finish

      // Pick the single target we're currently committed to:
      //  - if we have riders aboard, go drop the nearest one;
      //  - otherwise go answer the oldest waiting hall call.
      let target = null;
      if (e.load > 0) {
        target = nearest(e.floor, e.carCalls);
      } else if (state.hallCalls.length > 0) {
        target = state.hallCalls[0].floor; // hallCalls are in arrival order
      }

      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP' }]; // arrived: drop and/or pick up here
    },
  };
}

function nearest(from, floors) {
  let best = floors[0];
  let bestDist = Math.abs(from - best);
  for (const f of floors) {
    const d = Math.abs(from - f);
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}
