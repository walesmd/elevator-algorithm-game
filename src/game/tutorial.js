// tutorial.js — guided "from naive to the elevator algorithm" track (Phase 11A).
//
// The OPT-IN, sanctioned counterpart to the struggle-first curriculum (see the Phase 11
// note in PROJECT_PLAN and the spoiler doctrine in CLAUDE.md). It derives a strong
// controller one idea at a time: run the naive FCFS, see what's wrong, fix that one
// thing, run again — up to LOOK, with SSTF shown as the greedy contrast.
//
// This module is the DATA + a tiny pure-ish engine (which step, did this run clear it).
// The guided UI is Phase 11B; the before/after view is 11C. Content lives here as data
// so the steps are tunable and the ladder is verifiable in tests: every step's code
// compiles and delivers on the fixed scenario, and each BUILD step measurably beats the
// previous one (the "ships with a reference solution" guarantee, applied to a lesson).

import { runSimulation } from '../engine/simulation.js';
import { compositeOf } from './scoring.js';
import { compileController } from '../sandbox/compile.js';

// One fixed, single-car scenario + seed so every step's before/after is reproducible
// and the improvement is unambiguous (no eight-seed averaging — this is a lesson, not a
// score). Distance is weighted enough that LOOK's "turn around early" win is legible.
export const tutorialScenario = {
  id: 'tutorial',
  numFloors: 12,
  numElevators: 1,
  capacity: 8,
  ticksPerFloor: 2,
  doorTicks: 2,
  timeLimit: 3000,
  spawn: { type: 'uniform', count: 30, firstTick: 0, lastTick: 250 },
  seed: 1,
  weights: { wait: 1, journey: 0.5, distance: 0.4, undelivered: 1000 },
};

// --- Step code (single source of truth: the editor loads it, the engine runs it) ---

const FCFS = `// First-come, first-served: pick ONE errand and drive straight to it, ignoring
// everyone you pass. Carrying riders? go drop the nearest one off. Otherwise go answer
// the oldest waiting call. (On STOP we say which way we're serving, so only riders going
// that way board.)
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];
      let target = null, serving = null;
      if (e.load > 0) {
        target = nearest(e.floor, e.carCalls);
        serving = target > e.floor ? 'up' : 'down';
      } else if (state.hallCalls.length > 0) {
        target = state.hallCalls[0].floor;
        serving = state.hallCalls[0].direction;
      }
      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP', serving }];
    },
  };
}
function nearest(from, floors) {
  let best = floors[0];
  for (const f of floors) if (Math.abs(f - from) < Math.abs(best - from)) best = f;
  return best;
}`;

const SCAN = `// SCAN — the "elevator algorithm." Stop chasing single calls: commit to a DIRECTION,
// serve every rider heading that way as you pass (drop-offs and same-direction pickups),
// and reverse only when you reach the top or bottom of the building. Serving people on
// the way is what kills FCFS's backtracking.
function createController(config) {
  let dir = 1; // +1 up, -1 down
  const top = config.numFloors - 1;
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) for (const h of state.hallCalls) stops.add(h.floor);
      if (stops.size === 0) return [{ action: 'IDLE' }];
      if (dir > 0 && e.floor >= top) dir = -1;
      else if (dir < 0 && e.floor <= 0) dir = 1;
      const heading = dir > 0 ? 'up' : 'down';
      const alight = e.carCalls.includes(e.floor);
      const board = e.load < e.capacity && state.hallCalls.some((h) => h.floor === e.floor && h.direction === heading);
      if (alight || board) return [{ action: 'STOP', serving: heading }];
      return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];
    },
  };
}`;

const LOOK = `// LOOK — SCAN's refinement: everything the same, but turn around the moment there's
// nothing left ahead in your direction, instead of driving all the way to an empty
// top/bottom. That saves the wasted travel SCAN spends running to the ends.
function createController(config) {
  let dir = 1;
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];
      const room = e.load < e.capacity;
      const stops = new Set(e.carCalls);
      if (room) for (const h of state.hallCalls) stops.add(h.floor);
      if (stops.size === 0) return [{ action: 'IDLE' }];
      const ahead = (d) => [...stops].some((f) => (d > 0 ? f > e.floor : f < e.floor));
      const heading = dir > 0 ? 'up' : 'down';
      const alight = e.carCalls.includes(e.floor);
      const board = room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === heading);
      if (alight || board) return [{ action: 'STOP', serving: heading }];
      if (ahead(dir)) return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];
      if (ahead(-dir)) {
        dir = -dir;
        const nh = dir > 0 ? 'up' : 'down';
        if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === nh)) return [{ action: 'STOP', serving: nh }];
        return [{ action: dir > 0 ? 'MOVE_UP' : 'MOVE_DOWN' }];
      }
      if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'up')) { dir = 1; return [{ action: 'STOP', serving: 'up' }]; }
      if (room && state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'down')) { dir = -1; return [{ action: 'STOP', serving: 'down' }]; }
      return [{ action: 'IDLE' }];
    },
  };
}`;

const SSTF = `// SSTF (shortest seek first) — the greedy contrast: always head to the NEAREST pending
// stop. It often posts a lower average wait than LOOK... but with no sense of direction
// it flip-flops (thrashing) and a far-off call can wait a long time (starvation). Run it
// and compare: lower average, but watch the worst-case wait.
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];
      const stops = new Set(e.carCalls);
      if (e.load < e.capacity) for (const h of state.hallCalls) stops.add(h.floor);
      if (stops.size === 0) return [{ action: 'IDLE' }];
      let target = null, best = Infinity;
      for (const f of stops) { const d = Math.abs(f - e.floor); if (d < best) { best = d; target = f; } }
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      const up = state.hallCalls.some((h) => h.floor === e.floor && h.direction === 'up');
      return [{ action: 'STOP', serving: up ? 'up' : 'down' }];
    },
  };
}`;

// --- The track. Each step: the idea, the problem it fixes (seen in the prior run), the
// scoped task, and its target code. A 'build' step must beat the previous one; the
// 'contrast' step only has to deliver (it's a trade-off discussion, not a new best). ---
export const tutorial = {
  id: 'fcfs-to-look',
  title: 'From naive to the elevator algorithm',
  scenario: tutorialScenario,
  steps: [
    {
      id: 'fcfs',
      title: 'Start naive: first-come, first-served',
      kind: 'build',
      concept: 'Scheduling — serving competing requests over time',
      intro: 'Every algorithm starts somewhere. This one answers calls one at a time, in the order they arrive. Run it and watch what it does.',
      problem: 'It backtracks across the whole building and drives straight past riders who wanted to go its way — so waits pile up.',
      task: 'Just run the starting code to see the baseline. (No change needed yet.)',
      code: FCFS,
    },
    {
      id: 'scan',
      title: 'Commit to a direction (the elevator algorithm)',
      kind: 'build',
      concept: 'SCAN — directional collective service',
      intro: 'Instead of chasing one call at a time, pick a direction and serve everyone heading that way as you pass — only reversing at the top or bottom.',
      problem: 'Better — but it still runs all the way to an empty top/bottom before turning, burning travel for nothing.',
      task: 'Replace the one-errand logic with a sweep: keep a direction, stop for drop-offs and same-direction pickups as you pass, and reverse at the ends.',
      code: SCAN,
    },
    {
      id: 'look',
      title: 'Turn around early (LOOK)',
      kind: 'build',
      concept: 'LOOK — reverse when nothing is left ahead',
      intro: 'Keep the sweep, but stop wasting trips to empty ends: reverse the instant there is nothing left ahead of you in your direction.',
      problem: 'Now you are at the strong, fair algorithm real elevators use. The remaining ideas are trade-offs, not strict wins.',
      task: 'Reverse as soon as no stop remains ahead in your current direction, instead of waiting until you hit the top or bottom.',
      code: LOOK,
    },
    {
      id: 'sstf',
      title: 'A greedy contrast: shortest-seek-first',
      kind: 'contrast',
      concept: 'SSTF — greedy nearest-stop (trades fairness for average)',
      intro: 'One more idea, for contrast: always go to the nearest pending stop. It often beats LOOK on AVERAGE wait — but it has no sense of direction.',
      problem: 'It can flip-flop (thrash) and leave a far-off rider waiting a long time (starvation). Lower average, worse worst-case — a real trade-off, not a free win.',
      task: 'Try the greedy version and compare its average wait AND its worst wait against LOOK.',
      code: SSTF,
    },
  ],
};

// --- Tiny engine -----------------------------------------------------------------

export function getTutorial() {
  return tutorial;
}

// The code the editor should show when a step begins: the PREVIOUS step's solution, so
// the learner edits forward from where they were (the first step starts from FCFS).
export function startCodeForStep(index) {
  return index <= 0 ? tutorial.steps[0].code : tutorial.steps[index - 1].code;
}

// Composite of a step's target code on the fixed scenario (cached). The "bar" a build
// step's run must reach to count as cleared.
const goalCache = new Map();
export function goalComposite(step) {
  if (goalCache.has(step.id)) return goalCache.get(step.id);
  const m = runSimulation(tutorial.scenario, tutorial.scenario.seed, compileController(step.code)).metrics;
  const c = compositeOf(m, tutorial.scenario.weights);
  goalCache.set(step.id, c);
  return c;
}

// Did this run clear the step? Must deliver everyone; a build step must also reach
// (within a small tolerance) its target's performance, proving the idea was applied. A
// contrast step only needs to deliver — it's exploration, not a new best.
export function stepCleared(step, playerMetrics) {
  if (!playerMetrics || !playerMetrics.deliveredAll) return false;
  if (step.kind === 'contrast') return true;
  const composite = compositeOf(playerMetrics, tutorial.scenario.weights);
  return composite <= goalComposite(step) * 1.08;
}
