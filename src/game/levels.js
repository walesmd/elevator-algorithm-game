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
      bar: 'Notice riders you pass who want to go your way. There is a classic strategy for this — look up the SCAN / "elevator algorithm".',
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
    spawn: { type: 'up-peak', count: 22, firstTick: 0, lastTick: 350, lobbyBias: 0.8 },
    seeds: [1, 2, 3, 4, 5],
    weights: { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 },
    brief: {
      situation: 'Morning rush. Almost everyone starts in the lobby, heading up to their floor.',
      goal: 'Get the crowd upstairs with the shortest waits you can.',
      constraint: 'One car — and the lobby keeps refilling the moment you leave it.',
      measured: 'Average wait time, and whether everyone arrives.',
      bar: 'When the work is mostly one direction, think about where the car should go back to. Read up on up-peak / lobby dispatching.',
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
      goal: 'Keep waits low when almost every trip touches the lobby.',
      constraint: 'One car serving the whole tower.',
      measured: 'Average wait and journey time.',
      bar: 'The lobby is the hub here. Where is the best place for an idle car to wait?',
    },
  },
  {
    id: 'l5',
    name: 'Level 5 — Packed Cars',
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
      situation: 'A small four-person car and a sudden crowd of riders.',
      goal: 'Deliver everyone without leaving anyone stranded.',
      constraint: 'Capacity 4 — you cannot scoop up everyone in a single pass.',
      measured: 'Average wait, and that nobody is left behind.',
      bar: 'When the car fills, you must leave people and come back for them. Plan your return trips.',
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
    weights: { wait: 1, journey: 0.5, distance: 0.15, undelivered: 1000 },
    brief: {
      situation: 'Eighteen floors. Every wasted trip is a long one.',
      goal: 'Keep average wait low across a tall building.',
      constraint: 'One car, with a lot of vertical distance to cover.',
      measured: 'Average wait — and total distance traveled now matters more.',
      bar: 'On a tall shaft, darting back and forth is expensive. A disciplined sweep pays off more than ever.',
    },
  },
];

export function getLevel(id) {
  return levels.find((l) => l.id === id) || null;
}
