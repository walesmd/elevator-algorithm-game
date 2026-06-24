// starter.js — the default code a player sees in the editor (the "strawman").
//
// A deliberately naive starting point: it serves the oldest call and drops riders
// one errand at a time. It works (clears every level at ~1 star) but is beatable on
// purpose. The good algorithms are NOT shipped here. Kept in its own module so it's
// the single source for both the editor (main.js) and the test that pins it to
// "must still deliver/clear" across many seeds.

export const STARTER_CODE = `// You write createController. The engine calls step(state) each tick and you
// return ONE command per elevator: MOVE_UP, MOVE_DOWN, STOP, or IDLE. The command
// at index i drives state.elevators[i] — so on a level with two cars, return two
// commands. An IDLE car is wasted capacity.
//
// Like a real elevator, a car shows a direction: on STOP, pass
//   { action: 'STOP', serving: 'up' }  (or 'down')
// and only riders heading that way board — a down-rider won't get into an up car.
//
// state.elevators = [ { floor, ready, load, capacity, carCalls, direction, ... }, ... ]
// state.hallCalls = [ { floor, direction }, ... ]  // people waiting + which way
//
// This starter gives each car one errand at a time: drop a rider off, or go answer
// a waiting call (a different one per car, so they don't all chase the same person).
// It works, but every car backtracks a lot. Can you make riders wait less?
function createController(config) {
  return {
    step(state) {
      const cars = state.elevators;

      // A car carrying riders is committed to its nearest drop-off.
      const target = cars.map((e) => {
        if (e.load === 0) return null;
        let f = e.carCalls[0];
        for (const c of e.carCalls) {
          if (Math.abs(c - e.floor) < Math.abs(f - e.floor)) f = c;
        }
        return { floor: f, serving: f > e.floor ? 'up' : 'down' };
      });

      // Give each still-free car the nearest waiting call it hasn't been handed yet.
      // On a zoned level a car only reaches floors in its own range, so skip calls it
      // can't serve (and a rider going past the car's range gets dropped at the
      // boundary to transfer — the engine handles the hand-off).
      for (const call of state.hallCalls) {
        let pick = -1;
        let bestDist = Infinity;
        cars.forEach((e, i) => {
          if (target[i]) return;
          if (!serves(e, call)) return;
          const d = Math.abs(e.floor - call.floor);
          if (d < bestDist) { bestDist = d; pick = i; }
        });
        if (pick === -1) continue;
        target[pick] = { floor: call.floor, serving: call.direction };
      }

      return cars.map((e, i) => {
        if (!e.ready) return { action: 'IDLE' };
        const t = target[i];
        if (!t) return { action: 'IDLE' };
        if (e.floor < t.floor) return { action: 'MOVE_UP' };
        if (e.floor > t.floor) return { action: 'MOVE_DOWN' };
        return { action: 'STOP', serving: t.serving };
      });
    },
  };
}

// A car only covers floors in [minFloor, maxFloor]; it can take a rider their way
// only if there's room to move that way inside its range. (On a single-zone level a
// car covers the whole building, so this is always true.)
function serves(e, call) {
  if (call.floor < e.minFloor || call.floor > e.maxFloor) return false;
  return call.direction === 'up' ? call.floor < e.maxFloor : call.floor > e.minFloor;
}
`;
