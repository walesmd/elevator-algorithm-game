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
// With more than one car, "nearest" cuts both ways: each waiting call is handed to
// the car that is closest to it (and has room), then each car drives to whichever of
// its stops is nearest right now. Still greedy, still no sense of direction — so it
// still thrashes and can leave a far-off call waiting.
function createController(config) {
  return {
    step(state) {
      const cars = state.elevators;

      // Assign each waiting call to the nearest car that has room and whose zone
      // covers it (ties -> lower index).
      const mine = cars.map(() => []);
      for (const call of state.hallCalls) {
        let pick = -1;
        let best = Infinity;
        cars.forEach((e, i) => {
          if (e.load >= e.capacity) return;
          if (!serves(e, call)) return;
          const d = Math.abs(e.floor - call.floor);
          if (d < best) { best = d; pick = i; }
        });
        if (pick !== -1) mine[pick].push(call);
      }

      return cars.map((e, i) => {
        if (!e.ready) return { action: 'IDLE' };

        // Every floor this car still owes a stop to: drop-offs, plus its pick-ups if it has room.
        const stops = new Set(e.carCalls);
        if (e.load < e.capacity) for (const c of mine[i]) stops.add(c.floor);
        if (stops.size === 0) return { action: 'IDLE' };

        // Head to the nearest pending stop (ties toward the lower floor, for determinism).
        let target = null;
        let bestDist = Infinity;
        for (const f of stops) {
          const d = Math.abs(f - e.floor);
          if (d < bestDist) { bestDist = d; target = f; }
        }

        if (e.floor < target) return { action: 'MOVE_UP' };
        if (e.floor > target) return { action: 'MOVE_DOWN' };

        // Arrived: open the doors serving a direction with a rider here (a real car
        // shows an arrow, so only that direction boards). Drop-offs alight either way.
        const upHere = state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'up');
        return { action: 'STOP', serving: upHere ? 'up' : 'down' };
      });
    },
  };
}

// On a zoned level a car only covers floors in [minFloor, maxFloor], and can only
// take a rider their way if there's room to move that way inside its range. On a
// full-height level this is always true, so behavior is unchanged.
function serves(e, call) {
  if (call.floor < e.minFloor || call.floor > e.maxFloor) return false;
  return call.direction === 'up' ? call.floor < e.maxFloor : call.floor > e.minFloor;
}`;

export const createController = compileController(source);
