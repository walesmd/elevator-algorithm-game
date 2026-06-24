// levels.js — level content as data.
//
// Levels are pure data so tuning difficulty means editing this file, not engine
// logic. Each level isolates ONE new idea and (by design) makes the previous
// level's lazy strategy start to hurt. Star thresholds are not hard-coded here:
// the scorer derives them from the FCFS and LOOK reference runs on these same
// seeds, so they stay honest if the engine changes.
//
// Field guide:
//   numFloors, numElevators, capacity, ticksPerFloor, doorTicks, timeLimit
//   spawn: { type:'uniform'|'up-peak'|'down-peak', count, firstTick, lastTick }
//   elevators: optional per-car ranges [{ minFloor, maxFloor }, ...] for a zoned
//     "skyscraper" level — a car only travels/opens inside its band, and zones tile
//     the building overlapping on a single shared "sky-lobby" floor where riders
//     transfer. Omit for a normal full-height building.
//   seeds: the fixed seeds a submission is scored against (averaged)
//   weights: how the composite score trades off wait / journey / distance
//   brief: the player-facing card — says WHAT to do, never HOW.

export const levels = [
  {
    id: 'l1',
    name: 'Level 1 — Getting Moving',
    numFloors: 5,
    numElevators: 1,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 1000,
    spawn: { type: 'uniform', count: 10, firstTick: 0, lastTick: 150 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A small 5-floor building. People press buttons; your car is the only ride.',
      goal: 'Write an algorithm that delivers every passenger to their floor.',
      constraint: 'One elevator. You choose its direction and when it stops.',
      measured: 'Average wait time, average journey time, and whether everyone arrives.',
      bar: 'Deliver everyone. Beat the naive baseline to earn your first star.',
    },
  },
  {
    id: 'l2',
    name: 'Level 2 — The Tall One',
    numFloors: 10,
    numElevators: 1,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 2000,
    spawn: { type: 'uniform', count: 18, firstTick: 0, lastTick: 350 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'Ten floors and a steady trickle of riders from every floor.',
      goal: 'Keep average wait low while still delivering everyone.',
      constraint: 'Same single car — but now darting to the oldest call wastes a lot of trips.',
      measured: 'Average wait time is the headline metric here.',
      bar: 'Notice riders you pass who want to go your way. Look up the classic SCAN / "elevator algorithm" and its LOOK variant.',
    },
  },
  {
    id: 'l3',
    name: 'Level 3 — Morning Rush',
    numFloors: 10,
    numElevators: 1,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 2200,
    spawn: { type: 'up-peak', count: 30, firstTick: 0, lastTick: 250, lobbyBias: 0.9 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'Morning rush. Almost everyone starts in the lobby, heading up to their floor.',
      goal: 'Get the whole crowd upstairs with the shortest waits you can.',
      constraint: 'One car — and the lobby keeps refilling the moment you leave it.',
      measured: 'Average wait time, and whether everyone arrives.',
      bar: 'Same car, very different traffic — now it is nearly all one direction. Watch how your sweep copes with the rush, and whether it still holds up.',
    },
  },
  {
    id: 'l4',
    name: 'Level 4 — The Hotel',
    numFloors: 12,
    numElevators: 1,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 2600,
    spawn: { type: 'hotel', count: 24, firstTick: 0, lastTick: 450, lobbyBias: 0.9 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A hotel. Guests ride between their room and the lobby; they rarely go floor-to-floor.',
      goal: 'Keep waits low when nearly every trip touches the lobby.',
      constraint: 'One car serving the whole tower.',
      measured: 'Average wait and journey time.',
      bar: 'Watch where the demand clusters when it is all lobby trips. A solid sweep should generalize here too — see how the pattern changes what the car does.',
    },
  },
  {
    id: 'l5',
    name: 'Level 5 — The Surge',
    numFloors: 10,
    numElevators: 1,
    capacity: 4,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 3000,
    spawn: { type: 'uniform', count: 26, firstTick: 0, lastTick: 220 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A sudden surge — a crowd of calls lands almost all at once, faster than a small car can clear it.',
      goal: 'Work through the surge with low waits and leave no one behind.',
      constraint: 'One small car; it carries only a few at a time, so you will make several passes.',
      measured: 'Average wait, and that everyone eventually arrives.',
      bar: 'When many calls arrive together, serving them in efficient sweeping passes beats chasing them one at a time.',
    },
  },
  {
    id: 'l6',
    name: 'Level 6 — The High-Rise',
    numFloors: 18,
    numElevators: 1,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 4500,
    spawn: { type: 'uniform', count: 30, firstTick: 0, lastTick: 600 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.6, undelivered: 1000 },
    brief: {
      situation: 'Eighteen floors. Every trip up and down is long, and now the distance you travel is on the scoreboard.',
      goal: 'Keep waits low while keeping the car’s total travel down.',
      constraint: 'One car, lots of vertical distance — and distance now counts heavily toward your score.',
      measured: 'Average wait AND total distance traveled.',
      bar: 'Running all the way to an empty top floor burns distance for nothing. Turn around the moment nothing is left ahead — compare a full SCAN sweep against the LOOK refinement in the gallery.',
    },
  },
  {
    id: 'l7',
    name: 'Level 7 — Two Cars',
    numFloors: 10,
    numElevators: 2,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 2500,
    spawn: { type: 'uniform', count: 34, firstTick: 0, lastTick: 280 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A second elevator comes online. Two cars now share one building and one waiting crowd.',
      goal: 'Deliver everyone with low waits — putting both cars to work.',
      constraint: 'state.elevators now holds two cars. You return one command per car (the command at index i drives car i); a car you never command just sits still.',
      measured: 'Average wait time, average journey time, and whether everyone arrives.',
      bar: 'An algorithm written for a single car leaves the other asleep — half your capacity wasted, and the crowd outruns one car. Drive both, then keep their waits low.',
    },
  },
  {
    id: 'l8',
    name: 'Level 8 — The Bank',
    numFloors: 12,
    numElevators: 3,
    capacity: 6,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 3000,
    spawn: { type: 'uniform', count: 42, firstTick: 0, lastTick: 200 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A bank of three cars, and a sudden surge — a big crowd of calls lands almost at once, spread across the building.',
      goal: 'Clear the surge fast, keeping waits low, with no one left behind.',
      constraint: 'Three cars share one list of hall calls. Nothing stops them all from chasing the same call — and three cars doing one car’s job is a waste.',
      measured: 'Average wait time, and that everyone arrives.',
      bar: 'The new question is who answers which call. Decide it deliberately so your cars cover different parts of the building instead of bunching — read up on how elevator banks dispatch cars (group / zoned control).',
    },
  },
  {
    id: 'l9',
    name: 'Level 9 — The Skyline',
    numFloors: 16,
    numElevators: 3,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 4500,
    spawn: { type: 'uniform', count: 44, firstTick: 0, lastTick: 500 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.5, undelivered: 1000 },
    brief: {
      situation: 'A sixteen-floor tower with three cars and steady traffic from every floor — and long rides top to bottom.',
      goal: 'Keep waits low AND keep the cars’ combined travel down, across all three.',
      constraint: 'Distance is back on the scoreboard — and now you pay for it three cars at a time, so overlapping, wandering cars cost triple.',
      measured: 'Average wait time AND the cars’ combined distance traveled.',
      bar: 'Good dispatch keeps cars from re-treading each other’s ground; turning each car around the instant nothing’s left ahead keeps travel down. Compare a full SCAN sweep against the LOOK refinement across several cars in the gallery.',
    },
  },
  {
    id: 'l10',
    name: 'Level 10 — The Skyscraper',
    numFloors: 20,
    numElevators: 2,
    capacity: 8,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 5000,
    spawn: { type: 'uniform', count: 36, firstTick: 0, lastTick: 288 },
    seeds: [1, 2, 3, 4, 5],
    // Two zoned shafts meeting at floor 10, the shared "sky-lobby".
    elevators: [
      { minFloor: 0, maxFloor: 10 },
      { minFloor: 10, maxFloor: 19 },
    ],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A 20-floor tower. Two cars — but neither covers the whole building: one serves the lower floors, one the upper, and they meet on a single shared “sky-lobby” floor.',
      goal: 'Deliver everyone with low waits — including riders whose destination your car can’t reach.',
      constraint: 'Each car has a fixed range (`minFloor..maxFloor`, on every car in the run state). A rider crossing between zones rides to the sky-lobby, gets off, and waits there for the other car to finish the trip — the engine hands them off automatically when you drop them at the boundary.',
      measured: 'Average wait and journey time (a transfer adds to the journey), and whether everyone arrives.',
      bar: 'A car simply can’t answer a call outside its range — don’t send it chasing one. Serve the riders within reach and let cross-building riders hand off at the sky-lobby. This is how real super-tall towers run: zoned shafts with a sky-lobby transfer.',
    },
  },
  {
    id: 'l11',
    name: 'Level 11 — Sky Lobby',
    numFloors: 24,
    numElevators: 4,
    capacity: 6,
    ticksPerFloor: 2,
    doorTicks: 2,
    timeLimit: 5000,
    spawn: { type: 'uniform', count: 70, firstTick: 0, lastTick: 350 },
    seeds: [1, 2, 3, 4, 5],
    // Two zones of two cars each, meeting at floor 12 (the sky-lobby).
    elevators: [
      { minFloor: 0, maxFloor: 12 },
      { minFloor: 0, maxFloor: 12 },
      { minFloor: 12, maxFloor: 23 },
      { minFloor: 12, maxFloor: 23 },
    ],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'A 24-floor tower at rush hour. Four cars split into two zones of two — the lower pair and the upper pair — meeting at the sky-lobby.',
      goal: 'Clear the rush with low waits: share the work within each zone AND hand cross-building riders off at the sky-lobby.',
      constraint: 'Two cars now cover each zone, so within a zone you again choose which car answers which call — and a rider crossing zones still transfers at the shared floor.',
      measured: 'Average wait and journey time, and that everyone arrives.',
      bar: 'Everything at once: split the calls between the two cars in each zone so they don’t bunch, keep every car inside its range, and route cross-zone riders through the sky-lobby.',
    },
  },
];

export function getLevel(id) {
  return levels.find((l) => l.id === id) || null;
}
