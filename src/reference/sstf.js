// Shortest Seek Time First (SSTF) — reference controller (INTERNAL, spoiler-gated).
//
// Greedy nearest-stop scheduling: always serve the closest pending request —
// locally optimal, but it can thrash direction and starve far-away calls.
//
// Single source of truth: `createController` is compiled from `source` (the exact
// editor-insertable code), so the scored controller and the code shown to the
// player can never drift apart.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'sstf',
  name: 'Shortest Seek Time First (SSTF)',
  concept: 'Greedy nearest-stop scheduling: always serve the closest pending request — locally optimal, but it can thrash and starve far-away calls.',
  blurb:
    'A greedy dispatcher that always heads to the nearest pending stop, drop-off or pickup. ' +
    'Quick wins up close, but watch what it does when calls are spread out.',
  spoiler: true,
};

export const source = `// Shortest Seek Time First (SSTF) — a greedy "nearest-first" dispatcher.
//
// At every decision, head toward whichever pending stop is CLOSEST right now. It
// feels cheap (never walk past something you could have handled), but "nearest"
// has no sense of direction or fairness: as new calls land the closest target
// keeps changing, so the car flip-flops (thrashing) and a lone far-away call can
// wait a long time (starvation).
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      // Every floor we still owe a stop to: drop-offs, plus pick-ups if we have room.
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }
      if (stops.size === 0) return [{ action: 'IDLE' }];

      // Pick the nearest pending stop (ties toward the lower floor, for determinism).
      let target = null;
      let bestDist = Infinity;
      for (const f of stops) {
        const d = Math.abs(f - e.floor);
        if (d < bestDist) { bestDist = d; target = f; }
      }

      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];

      // Arrived: open the doors serving a direction that has a rider here (a real car
      // shows an arrow, so only that direction boards). Drop-offs alight either way.
      const upHere = state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'up');
      const serving = upHere ? 'up' : 'down';
      return [{ action: 'STOP', serving }];
    },
  };
}`;

export const createController = compileController(source);
