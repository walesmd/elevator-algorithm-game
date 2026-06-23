// look.js — LOOK reference controller (a SCAN / "elevator algorithm" variant).
//
// INTERNAL REFERENCE — SPOILER. A strong reference used to set a fair 3-star "par"
// and to verify in tests that a good algorithm beats FCFS. Surfaced to the player
// only behind the explicit, opt-in "reference approaches (spoilers)" gate.
//
// Idea: keep sweeping in one direction, stopping for every call along the way (both
// drop-offs and same-side pick-ups); when there's nothing further ahead, reverse.
// Serving riders en route instead of one trip per request is what beats FCFS.
//
// Single source of truth: `createController` is compiled from `source`, the exact
// editor-insertable code.

import { compileController } from '../sandbox/compile.js';

export const meta = {
  id: 'look',
  name: 'LOOK (the elevator algorithm)',
  concept: 'Sweep one direction serving everything en route; reverse only when nothing remains ahead.',
  blurb:
    'Keep moving one way, picking up and dropping off everything along your path, ' +
    'and turn around only when there is nothing further ahead. The classic fix for FCFS thrashing.',
  spoiler: true,
};

export const source = `// LOOK (a SCAN / "elevator algorithm" variant).
// Commit to a direction and serve EVERY call along the way — drop-offs and
// same-direction pick-ups alike — instead of making a separate trip per request.
// Reverse only when there's nothing left ahead in the current direction. That one
// change (serve en route) is what beats first-come-first-served on wait time.
function createController(config) {
  let dir = 1; // +1 = up, -1 = down

  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      // Floors worth visiting: every drop-off, plus pick-ups if we have room.
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }

      // Stop here if someone wants off, or someone's waiting here and we have room.
      const alightHere = e.carCalls.includes(e.floor);
      const boardHere = e.load < e.capacity && state.hallCalls.some((h) => h.floor === e.floor);
      if (alightHere || boardHere) return [{ action: 'STOP' }];

      if (stops.size === 0) return [{ action: 'IDLE' }];

      const anyAbove = [...stops].some((f) => f > e.floor);
      const anyBelow = [...stops].some((f) => f < e.floor);

      if (dir > 0) {
        if (anyAbove) return [{ action: 'MOVE_UP' }];
        if (anyBelow) { dir = -1; return [{ action: 'MOVE_DOWN' }]; }
      } else {
        if (anyBelow) return [{ action: 'MOVE_DOWN' }];
        if (anyAbove) { dir = 1; return [{ action: 'MOVE_UP' }]; }
      }
      return [{ action: 'IDLE' }];
    },
  };
}`;

export const createController = compileController(source);
