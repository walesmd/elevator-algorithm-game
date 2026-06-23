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
];

export function getLevel(id) {
  return levels.find((l) => l.id === id) || null;
}
