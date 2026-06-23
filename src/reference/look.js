// look.js — LOOK reference controller (a SCAN / "elevator algorithm" variant).
//
// INTERNAL REFERENCE ONLY — SPOILER. This is a strong reference used to set a
// fair 3-star "par" and to verify in tests that a good algorithm beats FCFS. It
// is NOT surfaced to the player by default; the UI only ever reveals an approach
// like this behind an explicit, earned "show me one approach" action (see
// CLAUDE.md / PROJECT_PLAN.md §7).
//
// Idea: keep sweeping in one direction, stopping for every call along the way
// (both drop-offs and same-side pick-ups); when there's nothing further ahead,
// reverse. That single change — serving riders en route instead of one trip per
// request — is what makes it beat FCFS on wait time.
//
// Contract: createController(config) -> { step(state) -> [command, ...] }

export function createController() {
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

      // Stop here if someone wants off here, or someone's waiting here and we
      // have room.
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
}
