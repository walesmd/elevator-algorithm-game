// simulation.js — the deterministic, DOM-free heart of the game.
//
// One run = one (level, seed, controller). The engine owns the *physics*
// (moving the car, door timing, boarding, capacity); the player's controller
// owns the *algorithm* (which direction, when to stop). The two meet through a
// small command protocol, one command per elevator per tick.
//
// Timing model (fixed tick):
//   - Moving one floor takes `ticksPerFloor` ticks. While moving, the car is
//     committed — direction-change commands are ignored until it arrives.
//   - A STOP opens the doors for `doorTicks` ticks; boarding and alighting
//     happen as the doors open. The car is busy until they close.
//   - A busy car (moving or doors not closed) ignores commands that tick.
//
// Boarding rule (direction-aware, like a real car): on STOP, everyone whose
// destination is this floor gets off; then waiting riders board in arrival order up
// to capacity, but ONLY those heading the car's committed direction — a down-rider
// won't step into an up-bound car. The direction is the command's `serving`, else
// the car's current travel direction; a still-idle car (no direction yet) admits
// anyone. (A plain STOP with no serving and no movement is the naive case.)

import { generatePassengers } from './passengers.js';
import { summarize } from './metrics.js';

const ACTIONS = new Set(['MOVE_UP', 'MOVE_DOWN', 'STOP', 'IDLE']);

/**
 * Run one deterministic simulation.
 * @param {object} level - level definition (see game/levels.js)
 * @param {number} seed
 * @param {(config:object) => {step:(state:object)=>Array}} createController
 * @param {{trace?:boolean}} [opts]
 * @returns {{metrics:object, trace:Array, warnings:Array<string>, passengers:Array}}
 */
export function runSimulation(level, seed, createController, opts = {}) {
  const numFloors = level.numFloors;
  const numElevators = level.numElevators ?? 1;
  const capacity = level.capacity ?? 8;
  const ticksPerFloor = level.ticksPerFloor ?? 2;
  const doorTicks = level.doorTicks ?? 2;
  const timeLimit = level.timeLimit ?? 600;
  const wantTrace = !!opts.trace;
  // Recording captures a full visual snapshot of the world every tick so the
  // renderer can replay the run (smoothly, decoupled from ticks) without re-running
  // the controller. It's opt-in because the headless scoring path never needs it
  // and stays fast; determinism is untouched — frames are pure functions of state.
  const wantRecord = !!opts.record;
  // A controller that misbehaves every tick (throws, illegal move, …) would warn
  // every tick; cap the collected warnings so a pathological run can't build a huge
  // array. Default is unlimited, so the synchronous scoring path and tests are
  // unchanged; the sandbox worker passes a small cap.
  const maxWarnings = opts.maxWarnings ?? Infinity;

  // Per-car floor range. A zoned ("skyscraper") level gives each car a
  // `{ minFloor, maxFloor }` in `level.elevators[i]`; a car can only travel and open
  // its doors inside that band. With no ranges given, every car covers the whole
  // building [0, numFloors-1] — which makes every non-zoned level behave exactly as
  // before (the byte-identity canary the tests pin).
  const ranges = Array.from({ length: numElevators }, (_, i) => {
    const r = (level.elevators && level.elevators[i]) || {};
    return { lo: r.minFloor ?? 0, hi: r.maxFloor ?? numFloors - 1 };
  });

  const passengers = generatePassengers(level, seed);
  // A rider's journey is tracked in three fields so a car can hand them off at a
  // sky-lobby without losing where they ultimately want to go:
  //   finalDest — the floor they actually want (never changes)
  //   curOrigin — where they are waiting RIGHT NOW (their origin, or the sky-lobby
  //               they were just dropped at to transfer)
  //   legTarget — the floor the car currently carrying them will drop them at (a
  //               point inside that car's range), or null while they wait.
  // origin/dest are left untouched so single-zone runs stay byte-identical.
  for (const p of passengers) {
    p.finalDest = p.dest;
    p.curOrigin = p.origin;
    p.legTarget = null;
  }
  const warnings = [];
  const warn = (msg) => { if (warnings.length < maxWarnings) warnings.push(msg); };
  const trace = [];
  const frames = [];

  let controller;
  try {
    controller = createController({ numFloors, numElevators, capacity });
  } catch (e) {
    warnings.push(`createController threw: ${e.message}`);
    controller = { step: () => [] };
  }
  if (!controller || typeof controller.step !== 'function') {
    warnings.push('createController must return an object with a step(state) method.');
    controller = { step: () => [] };
  }

  const elevators = Array.from({ length: numElevators }, (_, i) => ({
    index: i,
    floor: ranges[i].lo, // a car starts at the bottom of its own range (lobby / sky-lobby)
    minFloor: ranges[i].lo,
    maxFloor: ranges[i].hi,
    direction: 'idle',
    doors: 'closed',
    moving: false,
    travelRemaining: 0,
    pendingDir: 0,
    doorRemaining: 0,
    onboard: [],
  }));

  const waiting = [];
  let spawnIdx = 0;
  let delivered = 0;
  let distance = 0;
  let time = 0;
  const total = passengers.length;

  while (time <= timeLimit && delivered < total) {
    // 1) Spawn anyone due by now.
    while (spawnIdx < passengers.length && passengers[spawnIdx].spawnTick <= time) {
      waiting.push(passengers[spawnIdx]);
      spawnIdx++;
    }

    // 2) Advance in-flight physics (travel + doors).
    for (const el of elevators) {
      if (el.travelRemaining > 0) {
        el.travelRemaining--;
        if (el.travelRemaining === 0) {
          el.floor += el.pendingDir;
          el.pendingDir = 0;
          el.moving = false;
          distance++;
        }
      } else if (el.doorRemaining > 0) {
        el.doorRemaining--;
        if (el.doorRemaining === 0) el.doors = 'closed';
      }
    }

    // 3) Build the read-only snapshot the controller sees.
    const snapshot = {
      time,
      elevators: elevators.map((el) => snapshotElevator(el, capacity)),
      hallCalls: buildHallCalls(waiting),
    };

    // 4) Ask the controller for commands.
    let commands = [];
    try {
      commands = controller.step(snapshot) || [];
    } catch (e) {
      warn(`step() threw at t=${time}: ${e.message}`);
      commands = [];
    }
    if (!Array.isArray(commands)) {
      warn(`step() must return an array of commands (got ${typeof commands}).`);
      commands = [];
    }

    // 5) Apply one command per free elevator.
    elevators.forEach((el, i) => {
      if (el.moving || el.doorRemaining > 0) return; // busy — ignore
      const cmd = commands[i] || { action: 'IDLE' };
      const action = cmd && cmd.action;
      if (!ACTIONS.has(action)) {
        warn(`Unknown command for elevator ${i} at t=${time}: ${JSON.stringify(cmd)}`);
        el.direction = 'idle';
        return;
      }
      if (action === 'MOVE_UP') {
        if (el.floor < el.maxFloor) startMove(el, +1, ticksPerFloor);
        else warn(`MOVE_UP ignored at top of its range (elevator ${i}, t=${time}).`);
      } else if (action === 'MOVE_DOWN') {
        if (el.floor > el.minFloor) startMove(el, -1, ticksPerFloor);
        else warn(`MOVE_DOWN ignored at bottom of its range (elevator ${i}, t=${time}).`);
      } else if (action === 'STOP') {
        // Real direction-aware boarding: a car shows the direction it's committed to,
        // and riders going the other way wait for the next car. An EXPLICIT `serving`
        // is taken strictly (the algorithm owns that choice). Without one, the engine
        // implies a direction from the car's travel direction — forgivingly, so a
        // naive car can't wedge at a turnaround (see serviceStop).
        const explicit = cmd.serving === 'up' || cmd.serving === 'down';
        const serving = explicit
          ? cmd.serving
          : el.direction === 'up' || el.direction === 'down'
            ? el.direction
            : null;
        delivered += serviceStop(el, waiting, capacity, time, serving, explicit);
        el.doors = 'open';
        el.doorRemaining = doorTicks;
      } else {
        el.direction = 'idle';
      }
      if (wantTrace) trace.push({ t: time, elevator: i, floor: el.floor, action });
    });

    // 6) Record the end-of-tick world for replay (after commands have taken effect:
    //    a STOP shows open doors and updated load; a MOVE has begun advancing pos).
    if (wantRecord) {
      frames.push(recordFrame(time, elevators, waiting, capacity, ticksPerFloor, delivered, total, distance));
    }

    time++;
  }

  const metrics = summarize({ passengers, distance, endTick: time, timeLimit });
  return { metrics, trace, warnings, passengers, frames };
}

// One frame = the renderable state of the whole building at the end of a tick.
// Everything is copied to primitives (no references into live passenger/elevator
// objects) so later mutation can't corrupt an earlier frame. `pos` is a continuous
// floor coordinate: while a car is mid-travel it sits partway between floors, which
// is what lets the renderer interpolate smooth motion instead of teleporting.
function recordFrame(time, elevators, waiting, capacity, ticksPerFloor, delivered, total, distance) {
  let riding = 0;
  const evs = elevators.map((el) => {
    const progress = el.travelRemaining > 0 ? (ticksPerFloor - el.travelRemaining) / ticksPerFloor : 0;
    riding += el.onboard.length;
    return {
      index: el.index,
      floor: el.floor,
      minFloor: el.minFloor,
      maxFloor: el.maxFloor,
      pos: el.floor + el.pendingDir * progress,
      dir: el.direction,
      doorOpen: el.doors === 'open' ? 1 : 0,
      load: el.onboard.length,
      capacity,
      carCalls: [...new Set(el.onboard.map((p) => p.legTarget))].sort((a, b) => a - b),
    };
  });
  const waitingSnapshot = waiting.map((p) => ({
    id: p.id,
    floor: p.curOrigin,
    dest: p.finalDest,
    dir: p.finalDest > p.curOrigin ? 'up' : 'down',
    wait: time - p.spawnTick,
    transfer: p.pickupTick != null, // mid-journey, waiting at a sky-lobby for an onward car
  }));
  return { t: time, delivered, total, distance, riding, elevators: evs, waiting: waitingSnapshot };
}

function startMove(el, dir, ticksPerFloor) {
  el.moving = true;
  el.pendingDir = dir;
  el.travelRemaining = ticksPerFloor;
  el.direction = dir > 0 ? 'up' : 'down';
}

// Service a stop in three strict phases so a sky-lobby transfer is unambiguous and
// deterministic. `serving` ('up'|'down') is the car's committed direction (so only
// riders going that way board, real direction-aware boarding); without it the engine
// implies one forgivingly so a naive car can't wedge at a turnaround.
// Returns the number FINALLY delivered (transfers don't count — they're still in
// flight). A car only carries a rider as far as its own range reaches, dropping them
// at the boundary (a sky-lobby) to wait for the next zone's car.
function serviceStop(el, waiting, capacity, time, serving, strict) {
  const { minFloor: lo, maxFloor: hi } = el;
  let deliveredHere = 0;

  // (a) Alight everyone whose current-leg target is this floor. If that's their final
  //     destination they're delivered; otherwise they're transferring — drop them
  //     here as a fresh waiter heading on toward finalDest.
  const transfers = [];
  for (let k = el.onboard.length - 1; k >= 0; k--) {
    const p = el.onboard[k];
    if (p.legTarget === el.floor) {
      el.onboard.splice(k, 1);
      if (p.legTarget === p.finalDest) {
        p.dropTick = time;
        deliveredHere++;
      } else {
        p.curOrigin = el.floor; // now waiting at the sky-lobby for an onward car
        p.legTarget = null;
        transfers.push(p);
      }
    }
  }

  // A rider only boards a car that can carry them somewhere NEW: clamp their final
  // destination into this car's range; if that lands on the current floor the car
  // can't help them (they're at this car's range edge and need the next zone).
  const dirOf = (p) => (p.finalDest > p.curOrigin ? 'up' : 'down');
  const canCarry = (p) => clamp(p.finalDest, lo, hi) !== el.floor;

  // (b) Pick the single direction we'll board this stop, then board from the
  //     PRE-EXISTING waiting list in arrival order up to capacity.
  let board = serving;
  if (!strict) {
    const here = waiting.filter((p) => p.curOrigin === el.floor && canCarry(p));
    if (!board || !here.some((p) => dirOf(p) === board)) {
      board = here.length ? dirOf(here[0]) : board;
    }
  }
  for (let k = 0; k < waiting.length && el.onboard.length < capacity; ) {
    const p = waiting[k];
    if (p.curOrigin === el.floor && canCarry(p) && (!board || dirOf(p) === board)) {
      if (p.pickupTick == null) p.pickupTick = time; // wait is measured to the FIRST pickup
      p.legTarget = clamp(p.finalDest, lo, hi);
      el.onboard.push(p);
      waiting.splice(k, 1);
    } else {
      k++;
    }
  }

  // (c) Only now do transfers re-enter the hall, so a rider can't be dropped and
  //     re-boarded by the same car on the same stop (which would also be non-terminating).
  for (const p of transfers) waiting.push(p);
  return deliveredHere;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function snapshotElevator(el, capacity) {
  // carCalls are this-leg drop-offs (legTarget), always inside the car's range — so a
  // controller never sees a stop it can't actually drive to.
  const carCalls = [...new Set(el.onboard.map((p) => p.legTarget))].sort((a, b) => a - b);
  return {
    index: el.index,
    floor: el.floor,
    minFloor: el.minFloor,
    maxFloor: el.maxFloor,
    direction: el.direction,
    doors: el.doors,
    moving: el.moving,
    ready: !el.moving && el.doorRemaining === 0, // convenience: free to take a command
    load: el.onboard.length,
    capacity,
    carCalls,
  };
}

// One hall call per (current-floor, direction), kept in arrival order (oldest first).
// A waiting rider is at `curOrigin` (their origin, or a sky-lobby they're transferring
// at) and calls in the direction of their FINAL destination.
function buildHallCalls(waiting) {
  const seen = new Set();
  const calls = [];
  for (const p of waiting) {
    const direction = p.finalDest > p.curOrigin ? 'up' : 'down';
    const key = `${p.curOrigin}:${direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ floor: p.curOrigin, direction });
  }
  return calls;
}
