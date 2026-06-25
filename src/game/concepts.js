// concepts.js — the CS idea behind each level, as data (Phase 7C).
//
// Doctrine (CLAUDE.md §3): "Name the concept, not the code." Each level points at the
// real algorithmic idea it teaches and where to read more — never at the solution.
// Surfaced as an always-available, collapsed "the concept" note on the brief, distinct
// from the tiered hints (which are run-aware, opt-in, get-unstuck help). Kept as pure
// content so a non-programmer could tune it.

const CONCEPTS = {
  l1: {
    name: 'Scheduling',
    what: 'Each tick you choose where the car goes. That is a scheduling decision — ordering competing requests over time so they all get served.',
    url: 'https://en.wikipedia.org/wiki/Scheduling_(computing)',
  },
  l2: {
    name: 'The elevator algorithm (SCAN / LOOK)',
    what: 'Commit to a direction and serve every request along the way, turning around only when nothing is left ahead. Disk drives schedule their read/write head the very same way.',
    url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
  },
  l3: {
    name: 'The elevator algorithm under up-peak',
    what: 'The same directional sweep, but with traffic surging one way — everyone pouring out of the lobby — so when the car chooses to head back down matters a lot.',
    url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
  },
  l4: {
    name: 'The elevator algorithm with lobby-centric traffic',
    what: 'Most trips start or end at one floor. The sweep still applies, but demand clusters at the lobby instead of spreading evenly across the building.',
    url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
  },
  l5: {
    name: 'Scheduling a surge with bounded capacity',
    what: 'When requests arrive faster than one small car can clear them, batching them into efficient sweeping passes beats chasing them one at a time.',
    url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
  },
  l6: {
    name: 'Minimising seek distance — SCAN vs LOOK',
    what: 'LOOK turns back the moment nothing is ahead; SCAN runs all the way to the physical end first. The gap between them is pure wasted travel.',
    url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
  },
  l7: {
    name: 'Group elevator control',
    what: 'With more than one car the new question is dispatch: which car answers which call, so the cars share the work instead of duplicating it.',
    url: 'https://en.wikipedia.org/wiki/Destination_dispatch',
  },
  l8: {
    name: 'Dispatch — covering the building',
    what: 'Assign calls so several cars cover different parts of the building rather than all chasing the same call and bunching together.',
    url: 'https://en.wikipedia.org/wiki/Destination_dispatch',
  },
  l9: {
    name: 'Group control under distance pressure',
    what: 'Coordinate several cars to keep both the waiting AND the total travel down — overlapping, wandering cars cost you on every shaft.',
    url: 'https://en.wikipedia.org/wiki/Destination_dispatch',
  },
  l10: {
    name: 'Zoned shafts & the sky lobby',
    what: 'In super-tall towers a car serves only a band of floors; riders crossing between bands change cars at a shared transfer floor — the sky lobby.',
    url: 'https://en.wikipedia.org/wiki/Sky_lobby',
  },
  l11: {
    name: 'Zoning and dispatch together',
    what: 'Two cars per zone plus sky-lobby transfers: dispatch within each zone, keep every car in its range, and hand cross-zone riders off at the shared floor.',
    url: 'https://en.wikipedia.org/wiki/Sky_lobby',
  },
};

const FALLBACK = {
  name: 'The elevator algorithm',
  what: 'A scheduling problem: decide where each car goes so every rider is delivered with the shortest waits you can manage.',
  url: 'https://en.wikipedia.org/wiki/Elevator_algorithm',
};

export function getConcept(levelId) {
  return CONCEPTS[levelId] || FALLBACK;
}
