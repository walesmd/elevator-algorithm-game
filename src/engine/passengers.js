// passengers.js — deterministic traffic generation.
//
// Given a level and a seed, produce the exact list of passengers that will
// appear during a run: who shows up, when, where they are, and where they want
// to go. Because this is seeded (see rng.js), the same inputs always yield the
// same people — which is what makes scoring fair and bugs reproducible.
//
// A level's `spawn` block describes the traffic shape. Supported types:
//   - 'uniform'  : origins and destinations spread across all floors.
//   - 'up-peak'  : most riders start in the lobby (floor 0) heading up.
//   - 'down-peak': most riders head down toward the lobby.
//   - 'hotel'    : lobby-centric — most riders go lobby->room or room->lobby (either
//                  direction), and only rarely between two upper floors.
// Add new shapes here as data-driven cases; nothing else needs to change.

import { mulberry32, randInt } from './rng.js';

/**
 * @param {object} level - level definition (see game/levels.js)
 * @param {number} seed
 * @returns {Array<{id:number, origin:number, dest:number, spawnTick:number,
 *                  pickupTick:?number, dropTick:?number}>}
 *          sorted ascending by spawnTick.
 */
export function generatePassengers(level, seed) {
  const rng = mulberry32(seed);
  const { numFloors } = level;
  const numCols = level.numCols ?? 1; // > 1 only on the 2-D "sideways" bonus levels
  const spawn = level.spawn || { type: 'uniform', count: 10, firstTick: 0, lastTick: 200 };
  const count = spawn.count;
  const first = spawn.firstTick ?? 0;
  const last = spawn.lastTick ?? Math.max(first, level.timeLimit ?? 200);
  const lobbyBias = spawn.lobbyBias ?? 0.7; // used by up/down-peak

  const people = [];
  for (let i = 0; i < count; i++) {
    const spawnTick = first + randInt(rng, Math.max(1, last - first + 1));
    let origin;
    let dest;

    // 2-D bonus levels (a building that's floors × columns). Generated in its own
    // branch so it never touches — and never perturbs the seeded RNG of — the
    // one-dimensional levels, which keep generating exactly as before.
    if (numCols > 1) {
      let oF;
      let oC;
      let dF;
      let dC;
      if (spawn.type === 'vault') {
        // Lobby-centric in 2-D: most trips run between the lobby cell (floor 0,
        // column 0) and a "vault" somewhere in the grid, either direction.
        const vF = randInt(rng, numFloors);
        const vC = 1 + randInt(rng, numCols - 1); // a vault is never the lobby column
        if (rng() < lobbyBias) {
          if (rng() < 0.5) { oF = 0; oC = 0; dF = vF; dC = vC; }
          else { oF = vF; oC = vC; dF = 0; dC = 0; }
        } else {
          oF = randInt(rng, numFloors); oC = randInt(rng, numCols);
          dF = randInt(rng, numFloors); dC = randInt(rng, numCols);
        }
      } else {
        // 'grid': anywhere to anywhere.
        oF = randInt(rng, numFloors); oC = randInt(rng, numCols);
        dF = randInt(rng, numFloors); dC = randInt(rng, numCols);
      }
      // No zero-distance trips: a destination must differ from the origin CELL (it's
      // fine for it to share a floor, as long as the column differs — that's a
      // horizontal-only ride, which is the whole point here).
      while (oF === dF && oC === dC) { dF = randInt(rng, numFloors); dC = randInt(rng, numCols); }
      people.push({ id: i, origin: oF, dest: dF, originCol: oC, destCol: dC, spawnTick, pickupTick: null, dropTick: null });
      continue;
    }

    if (spawn.type === 'up-peak') {
      origin = rng() < lobbyBias ? 0 : randInt(rng, numFloors);
      dest = origin === 0 ? 1 + randInt(rng, numFloors - 1) : pickOther(rng, numFloors, origin);
    } else if (spawn.type === 'down-peak') {
      dest = rng() < lobbyBias ? 0 : randInt(rng, numFloors);
      origin = dest === 0 ? 1 + randInt(rng, numFloors - 1) : pickOther(rng, numFloors, dest);
    } else if (spawn.type === 'hotel') {
      // Lobby-centric both ways: with probability lobbyBias the trip touches the
      // lobby (50/50 lobby->room vs room->lobby); otherwise a rare room-to-room hop.
      if (rng() < lobbyBias) {
        const room = 1 + randInt(rng, numFloors - 1);
        if (rng() < 0.5) { origin = 0; dest = room; }
        else { origin = room; dest = 0; }
      } else {
        origin = randInt(rng, numFloors);
        dest = pickOther(rng, numFloors, origin);
      }
    } else {
      origin = randInt(rng, numFloors);
      dest = pickOther(rng, numFloors, origin);
    }

    // Safety net: nobody calls the elevator to the floor they're already on. Each
    // spawn shape above already avoids this, but enforce it centrally so a traffic
    // type added later can't accidentally create a zero-distance "trip". (A no-op
    // for the shapes above, so it doesn't perturb the seeded sequence.)
    if (dest === origin) dest = pickOther(rng, numFloors, origin);

    people.push({ id: i, origin, dest, spawnTick, pickupTick: null, dropTick: null });
  }

  people.sort((a, b) => a.spawnTick - b.spawnTick || a.id - b.id);
  // Reassign ids in arrival order so id also reflects arrival sequence.
  people.forEach((p, idx) => { p.id = idx; });
  return people;
}

function pickOther(rng, n, notThis) {
  if (n <= 1) return notThis; // degenerate building: no other floor to pick (avoids a hang)
  let v = randInt(rng, n);
  while (v === notThis) v = randInt(rng, n);
  return v;
}
