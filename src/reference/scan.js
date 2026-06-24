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
// With more than one car, each car runs its own full end-to-end sweep; a waiting
// call is handed to the nearest car that has room. Several cars sweeping the same
// shaft cover the building faster, but each still runs all the way to the top/bottom
// before turning — the wasted travel that separates SCAN from LOOK.
function createController(config) {
  const dir = Array.from({ length: config.numElevators }, () => 1); // +1 = up, -1 = down, per car

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

        const stops = new Set(e.carCalls);
        if (e.load < e.capacity) for (const c of mine[i]) stops.add(c.floor);
        if (stops.size === 0) return { action: 'IDLE' };

        // Reverse only at the extremes of this car's range (the whole building when
        // it isn't zoned).
        if (dir[i] > 0 && e.floor >= e.maxFloor) dir[i] = -1;
        else if (dir[i] < 0 && e.floor <= e.minFloor) dir[i] = 1;
        const heading = dir[i] > 0 ? 'up' : 'down';

        // Stop for a drop-off here, or to board riders going our committed direction.
        const alightHere = e.carCalls.includes(e.floor);
        const boardHere = e.load < e.capacity && mine[i].some((c) => c.floor === e.floor && c.direction === heading);
        if (alightHere || boardHere) return { action: 'STOP', serving: heading };

        // Otherwise keep sweeping toward the end.
        return { action: dir[i] > 0 ? 'MOVE_UP' : 'MOVE_DOWN' };
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
