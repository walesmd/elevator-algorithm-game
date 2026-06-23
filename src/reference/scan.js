// SCAN (the disk "elevator" algorithm) — reference controller (INTERNAL, spoiler-gated).
//
// SCAN ("elevator algorithm"): sweep fully end-to-end, serving every call en route, reversing only at the building's extremes.
//
// Single source of truth: `createController` is compiled from `source` (the exact
// editor-insertable code), so the scored controller and the code shown to the
// player can never drift apart.

import { compileController } from "../sandbox/compile.js";

export const meta = {
  id: "scan",
  name: "SCAN (the disk \"elevator\" algorithm)",
  concept: "SCAN (\"elevator algorithm\"): sweep fully end-to-end, serving every call en route, reversing only at the building's extremes.",
  blurb: "A controller built on the classic SCAN disk-scheduling strategy: pick a direction, stop for everyone you pass, and only turn around once you reach the very top or bottom of the building.",
  spoiler: true,
};

export const source = `function createController(config) {
  // SCAN — the disk-scheduling "elevator algorithm."
  //
  // The strategy is one stubborn rule: pick a direction and keep going that
  // way, stopping for EVERY call you meet along the route — riders getting off
  // (car calls) and riders waiting to get on (hall calls) alike. Only when you
  // hit the very end of the building do you turn around and sweep back. So a
  // full cycle is just: bottom -> top -> bottom, servicing whatever you pass.
  //
  // What separates SCAN from its leaner cousin (which turns around as soon as
  // nothing is left ahead) is that SCAN always runs to the physical extreme —
  // floor 0 at the bottom, the top floor at the top — before reversing, even
  // when there is nothing waiting out there. That guarantee of a complete sweep
  // keeps the policy simple and gives every floor a predictable "the car will
  // be back around soon" rhythm, at the cost of some empty travel to the ends.

  const topFloor = config.numFloors - 1; // highest reachable floor index
  const bottomFloor = 0;                 // lowest reachable floor index
  let dir = 1;                           // +1 = sweeping up, -1 = sweeping down

  return {
    step(state) {
      const e = state.elevators[0];

      // If the car isn't free (mid-move, or doors still cycling), any command
      // we send is ignored by the engine — so just wait one tick.
      if (!e.ready) return [{ action: 'IDLE' }];

      // Should we stop right here? Two reasons to open the doors:
      //   1) a rider aboard wants off at this floor (a car call), or
      //   2) someone is waiting here and we still have room to take them.
      // The engine handles WHO boards/alights on a STOP; we only decide WHEN
      // and WHERE to stop. Stopping picks up everyone waiting here, so we only
      // bother if we aren't already full.
      const alightHere = e.carCalls.includes(e.floor);
      const boardHere = e.load < e.capacity &&
        state.hallCalls.some((h) => h.floor === e.floor);
      if (alightHere || boardHere) return [{ action: 'STOP' }];

      // Are there any outstanding jobs at all? Collect every floor that matters:
      // all drop-offs, plus pick-ups if we have spare capacity.
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }

      // Nothing to do anywhere: park and wait for the next button press. (We
      // don't sprint to an end with zero work pending — that would burn travel
      // for no one. SCAN's "always run to the end" rule is about not turning
      // around early while a sweep is in progress, not about pacing an empty
      // building.)
      if (stops.size === 0) return [{ action: 'IDLE' }];

      // The defining SCAN move: keep heading the current direction until the
      // car physically reaches the end of the building, THEN reverse — even if
      // every remaining call is already behind us. We don't peek ahead to see
      // whether anything is left in our direction (that early turnaround is the
      // LOOK optimization SCAN deliberately forgoes); we just march to the wall.
      if (dir > 0) {
        if (e.floor < topFloor) return [{ action: 'MOVE_UP' }];
        // Reached the top: flip and start sweeping down.
        dir = -1;
        return [{ action: 'MOVE_DOWN' }];
      } else {
        if (e.floor > bottomFloor) return [{ action: 'MOVE_DOWN' }];
        // Reached the bottom: flip and start sweeping up.
        dir = 1;
        return [{ action: 'MOVE_UP' }];
      }
    },
  };
}`;

export const createController = compileController(source);
