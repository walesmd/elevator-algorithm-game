// tutorial.test.js — the guided FCFS→LOOK track (Phase 11A). Run: `node test/tutorial.test.js`.
//
// The lesson ships with a verified ladder: every step's code compiles and delivers on
// the fixed scenario, each BUILD step measurably beats the previous one, the track ends
// at LOOK-level performance, and the step-clear check behaves (must deliver; build steps
// must reach the idea; the contrast step only needs to deliver).

import { tutorial, tutorialScenario, getTutorial, startCodeForStep, goalComposite, stepCleared } from '../src/game/tutorial.js';
import { runSimulation } from '../src/engine/simulation.js';
import { compositeOf } from '../src/game/scoring.js';
import { compileController } from '../src/sandbox/compile.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const run = (code) => runSimulation(tutorialScenario, tutorialScenario.seed, compileController(code)).metrics;

// --- 1. Shape -----------------------------------------------------------------------
{
  assert(getTutorial() === tutorial, 'getTutorial returns the tutorial');
  assert(tutorial.steps.length >= 4, 'the track has at least four steps');
  const wellFormed = tutorial.steps.every(
    (s) => s.id && s.title && s.intro && s.problem && s.task && typeof s.code === 'string' && /createController/.test(s.code) &&
      (s.kind === 'build' || s.kind === 'contrast')
  );
  assert(wellFormed, 'every step has id/title/intro/problem/task/code and a kind');
  const ids = ['fcfs', 'scan', 'look', 'sstf'];
  assert(ids.every((id) => tutorial.steps.some((s) => s.id === id)), 'covers FCFS → SCAN → LOOK → SSTF');
}

// --- 2. Every step compiles and delivers everyone on the scenario -------------------
{
  let allDeliver = true;
  for (const s of tutorial.steps) if (!run(s.code).deliveredAll) { allDeliver = false; console.error('   strands:', s.id); }
  assert(allDeliver, 'every step compiles and delivers everyone on the fixed scenario');
}

// --- 3. The build ladder strictly improves; the contrast step needn't ---------------
{
  const builds = tutorial.steps.filter((s) => s.kind === 'build');
  let monotonic = true;
  let prev = Infinity;
  const line = [];
  for (const s of builds) {
    const c = compositeOf(run(s.code), tutorialScenario.weights);
    line.push(`${s.id}=${c.toFixed(1)}`);
    if (!(c < prev)) monotonic = false;
    prev = c;
  }
  assert(monotonic, `each build step beats the previous (${line.join(' > ')})`);

  // The track ends at LOOK, the best of the build steps.
  const last = builds[builds.length - 1];
  assert(last.id === 'look', 'the build ladder ends at LOOK');

  // The greedy contrast delivers but isn't required to beat LOOK.
  const sstf = tutorial.steps.find((s) => s.id === 'sstf');
  assert(run(sstf.code).deliveredAll, 'the SSTF contrast delivers everyone');
}

// --- 4. startCodeForStep walks from the previous solution ---------------------------
{
  assert(startCodeForStep(0) === tutorial.steps[0].code, 'step 1 starts from FCFS itself');
  assert(startCodeForStep(2) === tutorial.steps[1].code, 'step 3 starts from the previous step’s solution');
}

// --- 5. stepCleared: must deliver; build needs the idea; contrast just delivers ------
{
  const scan = tutorial.steps.find((s) => s.id === 'scan');
  const look = tutorial.steps.find((s) => s.id === 'look');
  const sstf = tutorial.steps.find((s) => s.id === 'sstf');

  assert(stepCleared(scan, run(scan.code)), 'running SCAN clears the SCAN step');
  // FCFS does NOT clear the SCAN step (it hasn't applied the idea).
  assert(!stepCleared(scan, run(tutorial.steps[0].code)), 'FCFS does not clear the SCAN step');
  // SCAN does NOT clear the LOOK step (close, but it must turn early).
  assert(!stepCleared(look, run(scan.code)), 'SCAN does not clear the LOOK step (must turn around early)');
  assert(stepCleared(look, run(look.code)), 'running LOOK clears the LOOK step');
  // The contrast step clears on delivery alone.
  assert(stepCleared(sstf, run(sstf.code)), 'the contrast step clears by delivering everyone');

  // A run that strands anyone never clears, build or contrast.
  const stranded = { deliveredAll: false, avgWait: 1, avgJourney: 1, distance: 1, delivered: 1, total: 30 };
  assert(!stepCleared(scan, stranded) && !stepCleared(sstf, stranded), 'a run that strands riders never clears a step');

  // goalComposite is the target's own composite.
  assert(Math.abs(goalComposite(look) - compositeOf(run(look.code), tutorialScenario.weights)) < 1e-9, 'goalComposite matches the target run');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
