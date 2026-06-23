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

  const passengers = generatePassengers(level, seed);
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
    floor: 0,
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
        if (el.floor < numFloors - 1) startMove(el, +1, ticksPerFloor);
        else warn(`MOVE_UP ignored at top floor (elevator ${i}, t=${time}).`);
      } else if (action === 'MOVE_DOWN') {
        if (el.floor > 0) startMove(el, -1, ticksPerFloor);
        else warn(`MOVE_DOWN ignored at bottom floor (elevator ${i}, t=${time}).`);
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
      pos: el.floor + el.pendingDir * progress,
      dir: el.direction,
      doorOpen: el.doors === 'open' ? 1 : 0,
      load: el.onboard.length,
      capacity,
      carCalls: [...new Set(el.onboard.map((p) => p.dest))].sort((a, b) => a - b),
    };
  });
  const waitingSnapshot = waiting.map((p) => ({
    id: p.id,
    floor: p.origin,
    dest: p.dest,
    dir: p.dest > p.origin ? 'up' : 'down',
    wait: time - p.spawnTick,
  }));
  return { t: time, delivered, total, distance, riding, elevators: evs, waiting: waitingSnapshot };
}

function startMove(el, dir, ticksPerFloor) {
  el.moving = true;
  el.pendingDir = dir;
  el.travelRemaining = ticksPerFloor;
  el.direction = dir > 0 ? 'up' : 'down';
}

// Alight everyone whose destination is this floor, then board waiting riders here
// in arrival order up to capacity. If `serving` ('up'|'down') is given, only riders
// heading that way board (real direction-aware boarding — a rider going the other
// way waits for the next car); without it, everyone boards (naive, direction-blind).
// Returns the number delivered (alighted) here.
function serviceStop(el, waiting, capacity, time, serving, strict) {
  let deliveredHere = 0;
  for (let k = el.onboard.length - 1; k >= 0; k--) {
    const p = el.onboard[k];
    if (p.dest === el.floor) {
      p.dropTick = time;
      el.onboard.splice(k, 1);
      deliveredHere++;
    }
  }

  // Pick the single direction we'll board this stop. An explicit `serving` is honored
  // exactly. An implied direction is forgiving: if nobody here is heading that way,
  // serve whoever IS here (the longest-waiting one's direction) so a naive car can't
  // get stuck at a turnaround. Either way it's ONE direction — a stop never boards
  // both, so "board everyone" is never available.
  const dirOf = (p) => (p.dest > p.origin ? 'up' : 'down');
  let board = serving;
  if (!strict) {
    const here = waiting.filter((p) => p.origin === el.floor);
    if (!board || !here.some((p) => dirOf(p) === board)) {
      board = here.length ? dirOf(here[0]) : board;
    }
  }

  for (let k = 0; k < waiting.length && el.onboard.length < capacity; ) {
    const p = waiting[k];
    if (p.origin === el.floor && (!board || dirOf(p) === board)) {
      p.pickupTick = time;
      el.onboard.push(p);
      waiting.splice(k, 1);
    } else {
      k++;
    }
  }
  return deliveredHere;
}

function snapshotElevator(el, capacity) {
  const carCalls = [...new Set(el.onboard.map((p) => p.dest))].sort((a, b) => a - b);
  return {
    index: el.index,
    floor: el.floor,
    direction: el.direction,
    doors: el.doors,
    moving: el.moving,
    ready: !el.moving && el.doorRemaining === 0, // convenience: free to take a command
    load: el.onboard.length,
    capacity,
    carCalls,
  };
}

// One hall call per (floor, direction), kept in arrival order (oldest first).
function buildHallCalls(waiting) {
  const seen = new Set();
  const calls = [];
  for (const p of waiting) {
    const direction = p.dest > p.origin ? 'up' : 'down';
    const key = `${p.origin}:${direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ floor: p.origin, direction });
  }
  return calls;
}
