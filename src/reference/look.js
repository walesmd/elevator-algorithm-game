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
// With more than one car the new question is DISPATCH: who answers which call? If
// every car chases every call they herd together and waste each other; if one car
// does all the work the rest sit idle. So first we hand each waiting call to the
// best-placed car (one already heading that way, soon to pass it), then each car
// just runs LOOK over the calls assigned to it plus its own drop-offs.
//
// Note the \`serving\` field on STOP: it tells the engine which way the car is
// committed, so only riders going that way board (a down-rider won't step into an
// up-bound car). Declaring it correctly — especially flipping it at a turnaround —
// is the heart of running a real elevator.
function createController(config) {
  const dir = Array.from({ length: config.numElevators }, () => 1); // committed direction per car (+1/-1)

  return {
    step(state) {
      const cars = state.elevators;

      // --- Dispatch: assign each waiting hall call to exactly one car ----------
      // A full car can't take pick-ups. Among the rest, pick the car that would
      // reach this call soonest: cheapest is a car already heading this way with
      // the call still ahead of it; pricier is a call it must turn around for.
      const mine = cars.map(() => []); // hall calls assigned to each car
      for (const call of state.hallCalls) {
        let pick = -1;
        let best = Infinity;
        cars.forEach((e, i) => {
          if (e.load >= e.capacity) return;            // no room: can't pick anyone up
          const cost = reachCost(e, dir[i], call);
          if (cost < best) { best = cost; pick = i; }
        });
        if (pick !== -1) mine[pick].push(call);
      }

      // --- Each car runs LOOK over its own work (drop-offs + assigned pick-ups) -
      return cars.map((e, i) => stepCar(e, i, mine[i], dir));
    },
  };
}

// One car's LOOK decision, given the hall calls dispatched to it this tick.
function stepCar(e, i, calls, dir) {
  if (!e.ready) return { action: 'IDLE' };

  const room = e.load < e.capacity;
  const stops = new Set(e.carCalls);
  if (room) for (const c of calls) stops.add(c.floor);
  if (stops.size === 0) return { action: 'IDLE' }; // nothing to do; hold our heading

  const workAhead = (d) => [...stops].some((f) => (d > 0 ? f > e.floor : f < e.floor));
  const heading = dir[i] > 0 ? 'up' : 'down';

  // 1) Serve our COMMITTED direction right here first — let riders off, and board
  //    riders going our way. (Decide this before any reversal, so we never abandon
  //    a rider we just arrived for.)
  const alightHere = e.carCalls.includes(e.floor);
  const boardHere = room && calls.some((c) => c.floor === e.floor && c.direction === heading);
  if (alightHere || boardHere) return { action: 'STOP', serving: heading };

  // 2) Keep going while there is work ahead in our direction.
  if (workAhead(dir[i])) return { action: dir[i] > 0 ? 'MOVE_UP' : 'MOVE_DOWN' };

  // 3) Nothing ahead: reverse. Serve here in the NEW direction (a turnaround
  //    pickup) or head toward the work behind us.
  if (workAhead(-dir[i])) {
    dir[i] = -dir[i];
    const nh = dir[i] > 0 ? 'up' : 'down';
    if (room && calls.some((c) => c.floor === e.floor && c.direction === nh)) {
      return { action: 'STOP', serving: nh };
    }
    return { action: dir[i] > 0 ? 'MOVE_UP' : 'MOVE_DOWN' };
  }

  // 4) The only thing left is an opposite-direction call AT this floor: serve it.
  if (room && calls.some((c) => c.floor === e.floor && c.direction === 'up')) {
    dir[i] = 1;
    return { action: 'STOP', serving: 'up' };
  }
  if (room && calls.some((c) => c.floor === e.floor && c.direction === 'down')) {
    dir[i] = -1;
    return { action: 'STOP', serving: 'down' };
  }
  return { action: 'IDLE' };
}

// How "expensive" it is for this car to answer a call, LOOK-style. Lower is better:
// a same-direction call still ahead of us is cheapest; one we'd have to pass and come
// back for, or that sits behind us, costs progressively more.
function reachCost(e, d, call) {
  const dist = Math.abs(call.floor - e.floor);
  const ahead = d > 0 ? call.floor >= e.floor : call.floor <= e.floor;
  const sameWay = (call.direction === 'up') === (d > 0);
  if (ahead && sameWay) return dist;            // en route, our way — grab it as we pass
  if (ahead && !sameWay) return dist + 1000;    // we'll pass it but it wants the other way
  return dist + 2000;                           // behind us — we'd have to turn around
}`;

export const createController = compileController(source);
