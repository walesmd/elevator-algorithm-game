// Circular SCAN (C-SCAN) — reference controller (INTERNAL, spoiler-gated).
//
// Service in one direction only, then deadhead back — trades efficiency for more uniform, fairer waits.
//
// Single source of truth: `createController` is compiled from `source` (the exact
// editor-insertable code), so the scored controller and the code shown to the
// player can never drift apart.

import { compileController } from "../sandbox/compile.js";

export const meta = {
  id: "cscan",
  name: "Circular SCAN (C-SCAN)",
  concept: "Service in one direction only, then deadhead back — trades efficiency for more uniform, fairer waits.",
  blurb: "Only picks up and drops off while sweeping up, then returns empty to the bottom to start again. Aims for uniform waits across all floors — watch what that one-way rule costs on a two-way elevator.",
  spoiler: true,
};

export const source = `// Circular SCAN (C-SCAN): service in ONE direction only.
//
// The strategy: only ever pick up and drop off while sweeping UP. Climb from the
// bottom to the highest floor that needs service, stopping for every drop-off and
// every waiting rider on the way. Then "deadhead" — run straight back down to the
// bottom WITHOUT stopping for anyone — and start another up-sweep.
//
// Why pay for an empty return trip? Fairness / uniformity. A back-and-forth sweep
// favours the middle floors (visited twice per cycle) while the ends wait a whole
// cycle. Servicing in one direction only gives every floor the same treatment each
// pass, so waits are more UNIFORM across the building — at the cost of that wasted
// descent. (It is a disk-scheduling idea; on a two-way elevator the empty return is
// expensive, which is exactly the trade-off worth feeling.)
//
// Engine note: a STOP boards EVERYONE waiting at that floor, whichever way they
// want to go. So a down-bound rider is collected on an up-sweep and carried until
// their floor comes round again on a later up-sweep — which is why up-only service
// still delivers everyone.
function createController(config) {
  let phase = "up"; // "up" = servicing sweep; "return" = empty deadhead to the bottom

  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: "IDLE" }];

      // Deadhead: descend to the very bottom without servicing anyone, then start
      // a fresh up-sweep. (No STOP can happen in this phase — that is what keeps
      // service strictly one-directional.)
      if (phase === "return") {
        if (e.floor > 0) return [{ action: "MOVE_DOWN" }];
        phase = "up";
      }

      // Floors worth visiting on the up-sweep: every drop-off, plus pick-ups if we
      // still have room to take anyone on.
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) {
        for (const h of state.hallCalls) stops.add(h.floor);
      }
      if (stops.size === 0) return [{ action: "IDLE" }]; // nothing to do; park

      // Stop here for a drop-off, or for a waiting rider if we have capacity.
      const alightHere = e.carCalls.includes(e.floor);
      const boardHere =
        e.load < e.capacity && state.hallCalls.some((h) => h.floor === e.floor);
      if (alightHere || boardHere) return [{ action: "STOP" }];

      // Keep climbing while anything remains above us.
      const highest = Math.max(...stops);
      if (e.floor < highest) return [{ action: "MOVE_UP" }];

      // Reached the top of the sweep with nothing above. If work remains below,
      // deadhead back to the bottom; otherwise idle.
      if (e.floor > 0) {
        phase = "return";
        return [{ action: "MOVE_DOWN" }];
      }
      return [{ action: "IDLE" }];
    },
  };
}`;

export const createController = compileController(source);
