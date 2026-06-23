// look.js — LOOK reference controller: the real "elevator algorithm."
//
// INTERNAL REFERENCE — SPOILER. The strong reference that sets the 3-star "par."
// Surfaced to the player only behind the opt-in "reference approaches" gate.
//
// LOOK is *directional collective control*, the way real elevators run: the car
// commits to a direction, shows it, and serves every call going THAT way as it
// passes; riders heading the other way wait for the return trip. When nothing is
// left ahead, it reverses and sweeps back. Serving riders en route in a single
// committed direction is what makes it beat first-come-first-served.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'look',
  name: 'LOOK (the elevator algorithm)',
  concept: 'Directional collective control — commit to a direction, serve every same-direction call en route, reverse only when nothing remains ahead.',
  blurb:
    'The real elevator algorithm: pick a direction, pick up and drop off everyone heading that way as you pass, ' +
    'and turn around only when there is nothing further ahead.',
  spoiler: true,
};

export const source = `// LOOK — the real "elevator algorithm" (directional collective control).
//
// A real car commits to a direction, shows it, and serves every call going THAT
// way as it passes — riders heading the other way wait for the return trip. When
// there is nothing left ahead it reverses and sweeps back.
//
// Note the \`serving\` field on STOP: it tells the engine which way the car is
// committed, so only riders going that way board (a down-rider won't step into an
// up-bound car). Declaring it correctly — especially flipping it at a turnaround —
// is the heart of running a real elevator.
function createController(config) {
  let dir = 1; // +1 = up, -1 = down

  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      // Floors still worth visiting: drop-offs, plus pick-ups if we have room.
      const room = e.load < e.capacity;
      const stops = new Set(e.carCalls);
      if (room) for (const h of state.hallCalls) stops.add(h.floor);
      if (stops.size === 0) return [{ action: 'IDLE' }];
      const workAhead = (d) => [...stops].some((f) => (d > 0 ? f > e.floor : f < e.floor));
      const heading = dir > 0 ? 'up' : 'down';

      // 1) Serve our COMMITTED direction right here first — let riders off, and board
      //    riders going our way. (Decide this before any reversal, so we never abandon
      //    a rider we just arrived for.)
      const alightHere = e.carCalls.includes(e.floor);
      const boardHere = room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === heading);
      if (alightHere || boardHere) return [{ action: 'STOP', serving: heading }];

      // 2) Keep going while there is work ahead in our direction.
      if (workAhead(dir)) return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];

      // 3) Nothing ahead: reverse. Serve here in the NEW direction (a turnaround
      //    pickup) or head toward the work behind us.
      if (workAhead(-dir)) {
        dir = -dir;
        const nh = dir > 0 ? 'up' : 'down';
        if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === nh)) {
          return [{ action: 'STOP', serving: nh }];
        }
        return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];
      }

      // 4) The only thing left is an opposite-direction call AT this floor: serve it.
      if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'up')) {
        dir = 1;
        return [{ action: 'STOP', serving: 'up' }];
      }
      if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'down')) {
        dir = -1;
        return [{ action: 'STOP', serving: 'down' }];
      }
      return [{ action: 'IDLE' }];
    },
  };
}`;

export const createController = compileController(source);
