// Shortest Seek Time First (SSTF) — reference controller (INTERNAL, spoiler-gated).
//
// Greedy nearest-stop scheduling: always serve the closest pending request — locally optimal, but it can thrash direction and starve far-away calls.
//
// Single source of truth: `createController` is compiled from `source` (the exact
// editor-insertable code), so the scored controller and the code shown to the
// player can never drift apart.

import { compileController } from "../sandbox/compile.js";

export const meta = {
  id: "sstf",
  name: "Shortest Seek Time First (SSTF)",
  concept: "Greedy nearest-stop scheduling: always serve the closest pending request — locally optimal, but it can thrash direction and starve far-away calls.",
  blurb: "A greedy dispatcher that always heads to the nearest pending stop, drop-off or pickup. Quick wins up close, but watch what it does when calls are spread out — this is Shortest Seek Time First (SSTF).",
  spoiler: true,
};

export const source = `// Shortest Seek Time First (SSTF) — a greedy "nearest-first" dispatcher.
//
// The strategy in one line: at every decision, look at all the floors you
// still owe a stop to, and head toward whichever one is CLOSEST right now.
//
// Why that's tempting: serving the nearest request always feels like the
// cheapest next move, so the car never wastes steps walking past something it
// could have handled. On clustered traffic it can look great.
//
// Why it's only *locally* optimal: "nearest right now" has no memory of
// direction or of who's been waiting longest. As fresh calls appear, the
// closest target keeps changing, so the car can flip up/down/up/down chasing
// whatever happens to be one floor away (thrashing) — and a lone call far at
// the other end of the building can sit ignored for ages (starvation), because
// there's always something nearer to do. Greedy locally, not globally.
//
// Contract: createController(config) -> { step(state) -> [command, ...] }.
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];

      // The car is mid-move or its doors are still cycling: it can't take a new
      // command this tick, so just let the physics finish.
      if (!e.ready) return [{ action: 'IDLE' }];

      // Collect every floor that counts as a PENDING STOP right now:
      //  - e.carCalls: drop-off floors of riders already aboard (we owe these), and
      //  - hall-call floors: people waiting to be picked up — but only worth
      //    targeting if we actually have room to take anyone on. (A STOP boards
      //    everyone waiting there regardless of their direction, so all we decide
      //    is WHERE to stop; capacity is the one thing that can make a pickup moot.)
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }

      // Nothing to do anywhere: hold position.
      if (stops.size === 0) return [{ action: 'IDLE' }];

      // The heart of SSTF: choose the nearest pending stop by absolute distance.
      // Ties are broken toward the lower floor number, just so the choice is
      // deterministic (the engine is seeded; the controller should be too).
      let target = null;
      let bestDist = Infinity;
      for (const f of stops) {
        const d = Math.abs(f - e.floor);
        if (d < bestDist) {
          bestDist = d;
          target = f;
        }
      }

      // Drive toward that nearest target; if we're already on it, STOP to service
      // it (the engine alights anyone bound here, then boards those waiting here).
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP' }];
    },
  };
}`;

export const createController = compileController(source);
