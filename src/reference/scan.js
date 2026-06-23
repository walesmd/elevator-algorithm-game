// SCAN (the disk "elevator" algorithm) — reference controller (INTERNAL, spoiler-gated).
//
// SCAN sweeps fully end-to-end, serving every same-direction call en route and
// reversing only at the building's physical extremes — so it always runs to an
// empty top/bottom, which is what makes it lose to LOOK on distance.
//
// Single source of truth: `createController` is compiled from `source` (the exact
// editor-insertable code), so the scored controller and the code shown to the
// player can never drift apart.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'scan',
  name: 'SCAN (the disk "elevator" algorithm)',
  concept: 'Sweep end-to-end serving each direction, but always run to the physical top/bottom before reversing — wasted travel LOOK avoids.',
  blurb:
    'Pick a direction, serve everyone heading that way as you pass, and only turn around once you hit the ' +
    'very top or bottom of the building — even if nobody is out there.',
  spoiler: true,
};

export const source = `// SCAN — sweep end to end, like a disk head. Pick a direction; serve every rider
// heading that way as you pass; reverse only when you reach the PHYSICAL end of the
// building (floor 0 or the top), even if there is no call out there. That "always
// run to the end" rule is the difference from LOOK — and it burns extra distance.
function createController(config) {
  let dir = 1; // +1 = up, -1 = down
  const top = config.numFloors - 1;

  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }
      if (stops.size === 0) return [{ action: 'IDLE' }];

      // Reverse only at the physical extremes.
      if (dir > 0 && e.floor >= top) dir = -1;
      else if (dir < 0 && e.floor <= 0) dir = 1;
      const heading = dir > 0 ? 'up' : 'down';

      // Stop for a drop-off here, or to board riders going our committed direction.
      const alightHere = e.carCalls.includes(e.floor);
      const boardHere = e.load < e.capacity && state.hallCalls.some((h) => h.floor === e.floor && h.direction === heading);
      if (alightHere || boardHere) return [{ action: 'STOP', serving: heading }];

      // Otherwise keep sweeping toward the end.
      return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];
    },
  };
}`;

export const createController = compileController(source);
