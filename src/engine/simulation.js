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

const ACTIONS = new Set(['MOVE_UP', 'MOVE_DOWN', 'MOVE_LEFT', 'MOVE_RIGHT', 'STOP', 'IDLE']);

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
  // 2-D "sideways" bonus levels: the building is `numCols` columns wide and a car can
  // move left/right as well as up/down. `grid` gates every new behavior; with no
  // numCols (or 1) the world is a single column and behaves exactly as before.
  const numCols = level.numCols ?? 1;
  const grid = numCols > 1;
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
    col: 0, // 2-D bonus levels: horizontal position; always 0 in a one-column building
    minFloor: ranges[i].lo,
    maxFloor: ranges[i].hi,
    minCol: 0,
    maxCol: numCols - 1,
    direction: 'idle',
    doors: 'closed',
    moving: false,
    travelRemaining: 0,
    pendingDir: 0, // floor delta in flight (+1/-1)
    pendingCol: 0, // column delta in flight (+1/-1)
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
          el.col += el.pendingCol;
          el.pendingDir = 0;
          el.pendingCol = 0;
          el.moving = false;
          distance++; // one cell of travel, vertical OR horizontal
        }
      } else if (el.doorRemaining > 0) {
        el.doorRemaining--;
        if (el.doorRemaining === 0) el.doors = 'closed';
      }
    }

    // 3) Build the read-only snapshot the controller sees.
    const snapshot = {
      time,
      elevators: elevators.map((el) => snapshotElevator(el, capacity, grid)),
      hallCalls: grid ? buildHallCallsGrid(waiting) : buildHallCalls(waiting),
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
        if (el.floor < el.maxFloor) startMove(el, +1, 0, ticksPerFloor);
        else warn(`MOVE_UP ignored at top of its range (elevator ${i}, t=${time}).`);
      } else if (action === 'MOVE_DOWN') {
        if (el.floor > el.minFloor) startMove(el, -1, 0, ticksPerFloor);
        else warn(`MOVE_DOWN ignored at bottom of its range (elevator ${i}, t=${time}).`);
      } else if (action === 'MOVE_LEFT') {
        if (el.col > el.minCol) startMove(el, 0, -1, ticksPerFloor);
        else warn(`MOVE_LEFT ignored at the left edge (elevator ${i}, t=${time}).`);
      } else if (action === 'MOVE_RIGHT') {
        if (el.col < el.maxCol) startMove(el, 0, +1, ticksPerFloor);
        else warn(`MOVE_RIGHT ignored at the right edge (elevator ${i}, t=${time}).`);
      } else if (action === 'STOP') {
        if (grid) {
          // 2-D boarding is simplified for fun: a stopped car picks up whoever is in
          // its cell (no committed direction — there's no natural "up/down" here).
          delivered += serviceStopGrid(el, waiting, capacity, time);
        } else {
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
        }
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
      frames.push(
        grid
          ? recordFrameGrid(time, elevators, waiting, capacity, ticksPerFloor, delivered, total, distance)
          : recordFrame(time, elevators, waiting, capacity, ticksPerFloor, delivered, total, distance)
      );
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

// 2-D replay frame: each car carries continuous (posF, posC) so the renderer can slide
// it smoothly along either axis; waiting riders and drop-offs carry their {floor,col}.
function recordFrameGrid(time, elevators, waiting, capacity, ticksPerFloor, delivered, total, distance) {
  let riding = 0;
  const evs = elevators.map((el) => {
    const progress = el.travelRemaining > 0 ? (ticksPerFloor - el.travelRemaining) / ticksPerFloor : 0;
    riding += el.onboard.length;
    return {
      index: el.index,
      floor: el.floor,
      col: el.col,
      posF: el.floor + el.pendingDir * progress,
      posC: el.col + el.pendingCol * progress,
      dir: el.direction,
      doorOpen: el.doors === 'open' ? 1 : 0,
      load: el.onboard.length,
      capacity,
      carCalls: uniqueCells(el.onboard.map((p) => ({ floor: p.dest, col: p.destCol ?? 0 }))),
    };
  });
  const waitingSnapshot = waiting.map((p) => ({
    id: p.id,
    floor: p.origin,
    col: p.originCol ?? 0,
    dest: p.dest,
    destCol: p.destCol ?? 0,
    wait: time - p.spawnTick,
  }));
  return { t: time, delivered, total, distance, riding, grid: true, elevators: evs, waiting: waitingSnapshot };
}

// Begin moving one cell: (df, dc) is the floor/column delta — exactly one is non-zero
// (a car never moves diagonally). `direction` keeps its up/down meaning for the 1-D
// path and gains left/right for the 2-D bonus levels.
function startMove(el, df, dc, ticksPerFloor) {
  el.moving = true;
  el.pendingDir = df;
  el.pendingCol = dc;
  el.travelRemaining = ticksPerFloor;
  el.direction = df > 0 ? 'up' : df < 0 ? 'down' : dc > 0 ? 'right' : 'left';
}

// 2-D boarding: a stopped car delivers everyone whose destination cell is this cell,
// then boards whoever is waiting in this cell up to capacity — no direction constraint
// (there's no up/down to commit to on a grid). Returns the number delivered here.
function serviceStopGrid(el, waiting, capacity, time) {
  let deliveredHere = 0;
  for (let k = el.onboard.length - 1; k >= 0; k--) {
    const p = el.onboard[k];
    if (p.dest === el.floor && (p.destCol ?? 0) === el.col) {
      p.dropTick = time;
      el.onboard.splice(k, 1);
      deliveredHere++;
    }
  }
  for (let k = 0; k < waiting.length && el.onboard.length < capacity; ) {
    const p = waiting[k];
    if (p.origin === el.floor && (p.originCol ?? 0) === el.col) {
      if (p.pickupTick == null) p.pickupTick = time;
      el.onboard.push(p);
      waiting.splice(k, 1);
    } else {
      k++;
    }
  }
  return deliveredHere;
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

function snapshotElevator(el, capacity, grid) {
  if (grid) {
    // 2-D: position is a {floor, col} cell; carCalls are the destination CELLS aboard.
    return {
      index: el.index,
      floor: el.floor,
      col: el.col,
      minCol: el.minCol,
      maxCol: el.maxCol,
      doors: el.doors,
      moving: el.moving,
      ready: !el.moving && el.doorRemaining === 0,
      load: el.onboard.length,
      capacity,
      carCalls: uniqueCells(el.onboard.map((p) => ({ floor: p.dest, col: p.destCol ?? 0 }))),
    };
  }
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

// Distinct {floor,col} cells, sorted (floor then col) so the controller's view and the
// recorded frames are deterministic.
function uniqueCells(cells) {
  const seen = new Set();
  const out = [];
  for (const c of cells) {
    const k = `${c.floor}:${c.col}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ floor: c.floor, col: c.col });
  }
  return out.sort((a, b) => a.floor - b.floor || a.col - b.col);
}

// 2-D hall calls: one entry per occupied {floor,col} cell, in arrival order.
function buildHallCallsGrid(waiting) {
  const seen = new Set();
  const calls = [];
  for (const p of waiting) {
    const col = p.originCol ?? 0;
    const key = `${p.origin}:${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ floor: p.origin, col });
  }
  return calls;
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
