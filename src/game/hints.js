// hints.js — tiered hint content, as data (Phase 7).
//
// Doctrine (CLAUDE.md §9): "Tiered hints, never the answer." Three rungs:
//   1. concept   — restate the goal / name the idea (always available).
//   2. (dynamic) — the specific symptom in THEIR run; produced by the analyzer
//                  (analyzer.js → runHint), not stored here.
//   3. technique — name the technique to look up. Never the code.
//
// Kept separate from levels.js and engine logic so hints are pure content a
// non-programmer could tune. Each rung names a concept/technique to investigate; none
// reveals an implementation. Falls back to a generic rung if a level is missing one.

const HINTS = {
  l1: {
    concept: 'Every waiting rider is a request to send the car somewhere. The whole job is to decide, each tick, where the one car should go so that everyone is eventually delivered.',
    technique: 'Start plain: drive toward a waiting call, open the doors there, then handle the next one. Which call to prefer is something you can refine later.',
  },
  l2: {
    concept: 'With ten floors and riders on every floor, darting off to the single oldest call wastes whole trips up and down. The leverage is serving the people you pass on the way.',
    technique: 'Look up the classic SCAN / “elevator algorithm” and its LOOK variant: commit to a direction and serve every same-direction call as you pass it.',
  },
  l3: {
    concept: 'It’s a morning rush — almost everyone starts in the lobby heading up, and the lobby refills the moment you leave it. Your sweep has to keep coming back for the crowd.',
    technique: 'A directional sweep (LOOK) still applies; notice how an up-peak changes how often the car should return to the lobby rather than wandering the top floors.',
  },
  l4: {
    concept: 'It’s a hotel: nearly every trip starts or ends at the lobby, in both directions. The demand clusters around floor 0 instead of spreading evenly.',
    technique: 'A solid LOOK sweep generalises here — watch how lobby-centric traffic changes where the car spends its stops.',
  },
  l5: {
    concept: 'A surge: a crowd of calls lands almost at once, more than your small car can carry in one go, so you’ll have to make several passes.',
    technique: 'Clear the surge in efficient sweeping passes that grab everyone heading your way, rather than chasing calls one at a time.',
  },
  l6: {
    concept: 'Eighteen floors, and now total distance is on the scoreboard. Every wasted trip up or down counts against you.',
    technique: 'Compare SCAN (which runs to the very top/bottom) with LOOK (which turns back the instant nothing is left ahead) — the LOOK turnaround is what saves distance.',
  },
  l7: {
    concept: 'You now have two cars and one shared crowd. Each tick you return one command per car; a car you never command just sits there, wasting half your capacity.',
    technique: 'Drive both cars — return a command for every elevator in state.elevators, not just the first.',
  },
  l8: {
    concept: 'Three cars share one list of hall calls. If they all chase the same call they bunch together and trip over each other — three cars doing one car’s work.',
    technique: 'Decide which car answers which call so they cover different parts of the building — read how elevator banks dispatch cars (group / zoned control).',
  },
  l9: {
    concept: 'Three cars in a tall tower, with distance back on the scoreboard. Overlapping, wandering cars now cost you three times over.',
    technique: 'Combine good dispatch (cars covering different ground) with the LOOK turnaround (turn back as soon as nothing’s left ahead) to hold travel down.',
  },
  l10: {
    concept: 'Each car only reaches part of the building, and the two share one “sky-lobby” floor. A car simply cannot carry a rider past the top (or bottom) of its own range.',
    technique: 'Have each car serve only the calls inside its range, and let cross-building riders hand off at the sky-lobby — look up zoned elevators / sky-lobby transfers.',
  },
  l11: {
    concept: 'Two cars per zone AND a sky-lobby transfer at once: within a zone you again choose which car takes which call, and cross-zone riders still change cars at the shared floor.',
    technique: 'Put it all together: split calls between the two cars in each zone, keep every car inside its range, and route cross-zone riders through the sky-lobby.',
  },
};

const FALLBACK = {
  concept: 'Decide, each tick, where every car should go so that all riders are delivered with the shortest waits you can manage.',
  technique: 'Look up the SCAN / LOOK “elevator algorithm” for the core idea, then adapt it to this level’s twist.',
};

export function getHints(levelId) {
  return HINTS[levelId] || FALLBACK;
}
