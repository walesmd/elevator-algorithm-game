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
      contrastNote: 'A real trade-off, not a free win: weigh the average against the worst case above, then watch where the two strategies actually diverge.',
      code: SSTF,
    },
  ],
};

// === Track 2: from one car to a coordinated fleet (multi-car dispatch) =============
//
// The guided sibling of the curriculum's L7–L9 arc. One fixed 3-car scenario; distance is
// weighted enough that overlapping, bunched cars cost you, so the dispatch win is legible.
// The step code is derived from the N-car references (src/reference/fcfs.js, look.js).

export const multiCarScenario = {
  id: 'tutorial-multicar',
  numFloors: 14,
  numElevators: 3,
  capacity: 6,
  ticksPerFloor: 2,
  doorTicks: 2,
  timeLimit: 5000,
  spawn: { type: 'uniform', count: 42, firstTick: 0, lastTick: 320 },
  seed: 1,
  weights: { wait: 1, journey: 0.5, distance: 0.3, undelivered: 1000 },
};

// All three steps share the SAME per-car LOOK brain (stepCar); they differ ONLY in which
// hall calls each car is handed. That is the whole lesson: the driving never changes —
// dispatch is purely about WHO answers WHICH call. (stepCar mirrors the N-car LOOK
// reference, including the turnaround/opposite-call rule so no assigned rider is stranded.)
const MC_STEP_CAR = `
// One car's LOOK decision over the calls it was handed (drop-offs + assigned pick-ups).
function stepCar(e, i, calls, dir) {
  if (!e.ready) return { action: 'IDLE' };
  const room = e.load < e.capacity;
  const stops = new Set(e.carCalls);
  if (room) for (const c of calls) stops.add(c.floor);
  if (stops.size === 0) return { action: 'IDLE' };
  const ahead = (d) => [...stops].some((f) => (d > 0 ? f > e.floor : f < e.floor));
  const heading = dir[i] > 0 ? 'up' : 'down';
  // Serve our committed direction here first (let riders off, board riders going our way).
  if (e.carCalls.includes(e.floor) || (room && calls.some((c) => c.floor === e.floor && c.direction === heading)))
    return { action: 'STOP', serving: heading };
  // Keep going while there is work ahead; otherwise reverse toward the work behind us.
  if (ahead(dir[i])) return { action: dir[i] > 0 ? 'MOVE_UP' : 'MOVE_DOWN' };
  if (ahead(-dir[i])) {
    dir[i] = -dir[i];
    const nh = dir[i] > 0 ? 'up' : 'down';
    if (room && calls.some((c) => c.floor === e.floor && c.direction === nh)) return { action: 'STOP', serving: nh };
    return { action: dir[i] > 0 ? 'MOVE_UP' : 'MOVE_DOWN' };
  }
  // The only thing left is an opposite-direction call right here — serve it (don't idle on it).
  if (room && calls.some((c) => c.floor === e.floor && c.direction === 'up')) { dir[i] = 1; return { action: 'STOP', serving: 'up' }; }
  if (room && calls.some((c) => c.floor === e.floor && c.direction === 'down')) { dir[i] = -1; return { action: 'STOP', serving: 'down' }; }
  return { action: 'IDLE' };
}`;

const MC_NAIVE = `// Multi-car, naive: hand EVERY car the same full list of hall calls and let each run the
// LOOK brain you already know. Because they all see the same calls, they all chase the
// same people and travel as a pack ("bunching") — three cars do barely more than one.
function createController(config) {
  const dir = Array.from({ length: config.numElevators }, () => 1);
  return {
    step(state) {
      // No dispatch: every car is handed the SAME calls, so they herd together.
      return state.elevators.map((e, i) => stepCar(e, i, state.hallCalls, dir));
    },
  };
}
${MC_STEP_CAR}`;

const MC_CLAIM = `// Stop duplicating work: give each hall call to ONE car (the nearest with room), so two
// cars never chase the same person. Each car then runs LOOK over just the calls it owns.
function createController(config) {
  const dir = Array.from({ length: config.numElevators }, () => 1);
  return {
    step(state) {
      const cars = state.elevators;
      const mine = cars.map(() => []); // hall calls assigned to each car
      for (const call of state.hallCalls) {
        let pick = -1, best = Infinity;
        cars.forEach((e, i) => {
          if (e.load >= e.capacity) return; // full: can't pick anyone up
          const d = Math.abs(e.floor - call.floor);
          if (d < best) { best = d; pick = i; }
        });
        if (pick !== -1) mine[pick].push(call);
      }
      return cars.map((e, i) => stepCar(e, i, mine[i], dir));
    },
  };
}
${MC_STEP_CAR}`;

const MC_DISPATCH = `// Don't just pick the NEAREST car — pick the best-placed one: a car already sweeping
// toward the call (and about to pass it) should take it, even if another is a hair closer.
// A directional cost makes the cars specialise into regions and stop overlapping.
function createController(config) {
  const dir = Array.from({ length: config.numElevators }, () => 1);
  return {
    step(state) {
      const cars = state.elevators;
      const mine = cars.map(() => []);
      for (const call of state.hallCalls) {
        let pick = -1, best = Infinity;
        cars.forEach((e, i) => {
          if (e.load >= e.capacity) return;
          const cost = reachCost(e, dir[i], call);
          if (cost < best) { best = cost; pick = i; }
        });
        if (pick !== -1) mine[pick].push(call);
      }
      return cars.map((e, i) => stepCar(e, i, mine[i], dir));
    },
  };
}
// Cheap if the call is ahead of the car and the same way it's heading; pricier if the car
// would have to pass it the wrong way, priciest if it sits behind us (a turnaround).
function reachCost(e, d, call) {
  const dist = Math.abs(call.floor - e.floor);
  const ahead = d > 0 ? call.floor >= e.floor : call.floor <= e.floor;
  const sameWay = (call.direction === 'up') === (d > 0);
  if (ahead && sameWay) return dist;
  if (ahead && !sameWay) return dist + 1000;
  return dist + 2000;
}
${MC_STEP_CAR}`;

const multiCarTrack = {
  id: 'one-car-to-many',
  title: 'From one car to a coordinated fleet',
  blurb: 'Take the elevator algorithm to three cars: stop them bunching, then dispatch each call to the right car.',
  scenario: multiCarScenario,
  steps: [
    {
      id: 'per-car',
      title: 'One brain, three cars',
      kind: 'build',
      concept: 'Group control — driving several cars at once',
      intro: 'You have the elevator algorithm down for one car. Now there are three. The obvious first move: run that same LOOK brain on every car, independently — each returns its own command.',
      problem: 'They bunch. All three see the same hall calls and chase the same people, travelling as a pack — so three cars do barely more than one.',
      task: 'Just run it to see the baseline: every car already runs LOOK over all the calls. Watch the three cars clump together.',
      code: MC_NAIVE,
    },
    {
      id: 'claim',
      title: 'One call, one car',
      kind: 'build',
      concept: 'Dispatch — divide the work so cars stop duplicating it',
      intro: 'The cure for bunching: stop letting every car chase every call. Hand each waiting call to a single car, so they split the building between them.',
      problem: 'Much better — the cars spread out. But picking the nearest car can hand a call to one that is heading away from it, forcing a U-turn.',
      task: 'Before driving, assign each hall call to exactly one car (the nearest with room), and have each car serve only the calls it was given.',
      code: MC_CLAIM,
    },
    {
      id: 'cost',
      title: 'A refinement: send the best-placed car',
      kind: 'contrast',
      concept: 'Cost-aware dispatch — prefer the car already heading there',
      intro: 'One refinement on the dispatch you just built: instead of the nearest car, prefer the car already sweeping toward the call and about to pass it — even if another is a hair closer by floor count.',
      problem: 'It usually trims a little more travel — most of all when distance is penalised heavily — but the big leap was dividing the work; this is the polish on top.',
      task: 'Assign each call by a directional cost: cheap when the car is heading that way and the call is ahead, pricier when it would have to pass it the wrong way or turn around.',
      contrastNote: 'A refinement, not a transformation: cost-aware dispatch usually edges out nearest-car — most of all when travel is weighted heavily — but the real leap was dividing the work in the first place. Watch where the two assignments send a car differently.',
      code: MC_DISPATCH,
    },
  ],
};

// --- Tracks + tiny engine --------------------------------------------------------
//
// Phase 12 generalizes the single hardcoded track into a small ordered REGISTRY. Each
// track is { id, title, blurb, scenario, steps }; the single-car FCFS→LOOK track is the
// first entry. Every helper that used to assume the one track now takes the track (and
// reads `track.scenario`), so the same engine + UI drive any track. The metrics/frames
// caches key on track id + step id, so two tracks can't collide.

export const tutorialTracks = [tutorial, multiCarTrack]; // the zoned track appends here (12B)

export function getTutorialTracks() {
  return tutorialTracks;
}
export function getTutorialTrack(id) {
  return tutorialTracks.find((t) => t.id === id) || null;
}
// Back-compat: the first (single-car) track.
export function getTutorial() {
  return tutorialTracks[0];
}

// The code the editor shows when a step begins: the PREVIOUS step's solution, so the
// learner edits forward from where they were (the first step starts from its own code).
export function startCodeForStep(track, index) {
  return index <= 0 ? track.steps[0].code : track.steps[index - 1].code;
}

// A track's end-state step: its last BUILD step (the strong algorithm the ladder climbs
// to). Its metrics are "par" for the diagnosis; a build step is cleared against its own
// target. (A trailing 'contrast' or a leading 'demo' step is never the reference.)
export function referenceStep(track) {
  let ref = track.steps.find((s) => s.kind === 'build') || track.steps[0];
  for (const s of track.steps) if (s.kind === 'build') ref = s;
  return ref;
}

// Metrics / frames of a step's TARGET code on its track's fixed scenario (cached, keyed by
// track+step). The single source for the step's "bar" and the before/after reference the
// UI shows. Trusted reference code → runs on the main thread; the LEARNER's edited code,
// by contrast, must go through the sandboxed Worker. Frames are recorded lazily (only the
// before/after view needs them).
const metricsCache = new Map();
const framesCache = new Map();
const keyOf = (track, step) => `${track.id}:${step.id}`;

export function stepMetrics(track, step) {
  const key = keyOf(track, step);
  if (metricsCache.has(key)) return metricsCache.get(key);
  const m = runSimulation(track.scenario, track.scenario.seed, compileController(step.code)).metrics;
  metricsCache.set(key, m);
  return m;
}

export function stepFrames(track, step) {
  const key = keyOf(track, step);
  if (framesCache.has(key)) return framesCache.get(key);
  const frames = runSimulation(track.scenario, track.scenario.seed, compileController(step.code), { record: true }).frames;
  framesCache.set(key, frames);
  return frames;
}

// Composite of a step's target code on its track's scenario — the "bar" a build step's run
// must reach to count as cleared.
export function goalComposite(track, step) {
  return compositeOf(stepMetrics(track, step), track.scenario.weights);
}

// Par for the run diagnosis: the end-state (reference step) metrics, shaped as the
// curriculum analyzer expects ({ look }). Reusing par=end-state across every step means the
// diagnosis always measures the gap to the strong algorithm — big at the naive step,
// shrinking each step, quiet once you reach it — which shows the baseline failing and
// motivates the next idea, exactly like the curriculum's feedback.
export function parFor(track) {
  return { look: stepMetrics(track, referenceStep(track)) };
}

// Did this run clear the step? Rules by kind:
//   demo     — "just run it to see the problem" (e.g. the zoned naive step, which is MEANT
//              to strand riders): clears as soon as a run produced metrics.
//   contrast — exploration, not a new best: must deliver everyone, nothing more.
//   build    — must deliver everyone AND reach (within tolerance) its target's performance,
//              proving the idea was actually applied.
export function stepCleared(track, step, playerMetrics) {
  if (!playerMetrics) return false;
  if (step.kind === 'demo') return true;
  if (!playerMetrics.deliveredAll) return false;
  if (step.kind === 'contrast') return true;
  const composite = compositeOf(playerMetrics, track.scenario.weights);
  return composite <= goalComposite(track, step) * 1.08;
}
