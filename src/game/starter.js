// starter.js — the default code a player sees in the editor (the "strawman").
//
// A deliberately naive starting point: it serves the oldest call and drops riders
// one errand at a time. It works (clears every level at ~1 star) but is beatable on
// purpose. The good algorithms are NOT shipped here. Kept in its own module so it's
// the single source for both the editor (main.js) and the test that pins it to
// "must still deliver/clear" across many seeds.

export const STARTER_CODE = `// You write createController. The engine calls step(state) each tick and you
// return one command per elevator: MOVE_UP, MOVE_DOWN, STOP, or IDLE.
//
// Like a real elevator, the car shows a direction: on STOP, pass
//   { action: 'STOP', serving: 'up' }  (or 'down')
// and only riders heading that way board — a down-rider won't get into an up car.
//
// state.elevators[0] = { floor, ready, load, capacity, carCalls, direction, ... }
// state.hallCalls    = [ { floor, direction }, ... ]  // people waiting + which way
//
// This starter just chases the oldest call. Can you make riders wait less?
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      // Where are we headed, and which way are we serving when we get there?
      let target = null;
      let serving = null;
      if (e.load > 0) {
        target = e.carCalls[0];                 // head to the nearest drop-off
        for (const f of e.carCalls) {
          if (Math.abs(f - e.floor) < Math.abs(target - e.floor)) target = f;
        }
        serving = target > e.floor ? 'up' : 'down';
      } else if (state.hallCalls.length > 0) {
        target = state.hallCalls[0].floor;      // else go answer the oldest call
        serving = state.hallCalls[0].direction; // serving the way they want to go
      }

      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP', serving }];
    },
  };
}
`;
