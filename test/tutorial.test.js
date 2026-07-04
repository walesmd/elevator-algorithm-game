// tutorial.test.js — the guided tutorial tracks. Run: `node test/tutorial.test.js`.
//
// Every track ships a VERIFIED ladder: each step's code compiles; build steps deliver
// everyone on the track's fixed scenario and strictly improve; the track ends at a strong
// build step; consecutive build steps actually diverge (so the before/after has something
// to show); and the step-clear check behaves per kind (demo → run it; contrast → deliver;
// build → reach its target). `verifyTrackLadder` runs these generic checks on every track
// in the registry, so a new track (Phase 12: multi-car, zoned) is held to the same bar.

import {
  tutorial, tutorialTracks, getTutorialTracks, getTutorialTrack, getTutorial,
  startCodeForStep, goalComposite, stepCleared, stepMetrics, parFor, stepFrames, referenceStep,
} from '../src/game/tutorial.js';
import { runSimulation } from '../src/engine/simulation.js';
import { compositeOf } from '../src/game/scoring.js';
import { compileController } from '../src/sandbox/compile.js';
import { analyze } from '../src/game/analyzer.js';
import { findMoments } from '../src/game/compare.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const runOn = (track, code) => runSimulation(track.scenario, track.scenario.seed, compileController(code)).metrics;

// --- Generic: a track ships a verified ladder ---------------------------------------
function verifyTrackLadder(track) {
  const L = track.id;

  const KINDS = ['build', 'contrast', 'demo'];
  const wellFormed = track.steps.every(
    (s) => s.id && s.title && s.intro && s.problem && s.task && typeof s.code === 'string' &&
      /createController/.test(s.code) && KINDS.includes(s.kind)
  );
  assert(wellFormed, `[${L}] every step has id/title/intro/problem/task/code and a known kind`);

  // Build steps deliver everyone and strictly improve. (Demo steps may strand by design;
  // contrast steps must deliver but needn't beat anything.)
  const builds = track.steps.filter((s) => s.kind === 'build');
  let buildsDeliver = true, monotonic = true, prev = Infinity;
  const line = [];
  for (const s of builds) {
    const m = runOn(track, s.code);
    if (!m.deliveredAll) { buildsDeliver = false; console.error('   build strands:', s.id); }
    const c = compositeOf(m, track.scenario.weights);
    line.push(`${s.id}=${c.toFixed(1)}`);
    if (!(c < prev)) monotonic = false;
    prev = c;
  }
  assert(buildsDeliver, `[${L}] every build step delivers everyone on the fixed scenario`);
  assert(builds.length >= 2 && monotonic, `[${L}] each build step beats the previous (${line.join(' > ')})`);

  for (const s of track.steps.filter((s) => s.kind === 'contrast')) {
    assert(runOn(track, s.code).deliveredAll, `[${L}] the ${s.id} contrast delivers everyone`);
  }

  // referenceStep is the last build step; par is its metrics.
  const ref = referenceStep(track);
  assert(ref === builds[builds.length - 1], `[${L}] referenceStep is the last build step (${ref.id})`);
  assert(parFor(track).look === stepMetrics(track, ref), `[${L}] par is the reference step's metrics`);

  // stepCleared per kind: a build step is cleared by its own target run.
  for (const s of builds) {
    assert(stepCleared(track, s, runOn(track, s.code)), `[${L}] running ${s.id} clears the ${s.id} step`);
  }
  // A run that strands anyone never clears a build/contrast step; a demo step clears anyway.
  const stranded = { deliveredAll: false, avgWait: 1, avgJourney: 1, distance: 1, delivered: 1, total: 9 };
  for (const s of track.steps) {
    if (s.kind === 'demo') assert(stepCleared(track, s, stranded), `[${L}] the ${s.id} demo clears on a run even if it strands`);
    else assert(!stepCleared(track, s, stranded), `[${L}] a stranding run never clears the ${s.id} step`);
  }

  // startCodeForStep walks from the previous solution.
  assert(startCodeForStep(track, 0) === track.steps[0].code, `[${L}] step 1 starts from its own code`);
  if (track.steps.length > 1)
    assert(startCodeForStep(track, 1) === track.steps[0].code, `[${L}] step 2 starts from step 1's solution`);

  // stepFrames records + caches.
  const fr = stepFrames(track, track.steps[0]);
  assert(Array.isArray(fr) && fr.length > 0 && stepFrames(track, track.steps[0]) === fr, `[${L}] stepFrames records and caches`);

  // Consecutive build steps actually diverge (so the before/after isn't "they run the same").
  for (let i = 1; i < builds.length; i++) {
    const a = builds[i - 1], b = builds[i];
    const moments = findMoments(
      { frames: stepFrames(track, a), metrics: stepMetrics(track, a), label: a.id.toUpperCase() },
      { frames: stepFrames(track, b), metrics: stepMetrics(track, b), label: b.id.toUpperCase() },
      track.scenario
    );
    assert(moments.length > 0, `[${L}] ${a.id}→${b.id} before/after surfaces moment(s) (${moments.map((m) => m.kind).join(',') || 'none'})`);
  }
}

// --- Registry shape -----------------------------------------------------------------
{
  assert(Array.isArray(tutorialTracks) && tutorialTracks.length >= 1, 'the registry holds at least one track');
  assert(getTutorialTracks() === tutorialTracks, 'getTutorialTracks returns the registry');
  assert(getTutorial() === tutorialTracks[0], 'getTutorial returns the first track');
  assert(getTutorialTrack(tutorial.id) === tutorial, 'getTutorialTrack looks a track up by id');
  assert(getTutorialTrack('no-such-track') === null, 'getTutorialTrack returns null for an unknown id');
  const ids = tutorialTracks.map((t) => t.id);
  assert(new Set(ids).size === ids.length, `track ids are unique (${ids.join(', ')})`);
  assert(tutorialTracks.every((t) => t.title && t.scenario && Array.isArray(t.steps) && t.steps.length), 'every track has a title, scenario, and steps');
}

// --- Every registered track is a verified ladder ------------------------------------
for (const track of tutorialTracks) verifyTrackLadder(track);

// --- Single-car track specifics -----------------------------------------------------
{
  const ids = ['fcfs', 'scan', 'look', 'sstf'];
  assert(ids.every((id) => tutorial.steps.some((s) => s.id === id)), 'single-car track covers FCFS → SCAN → LOOK → SSTF');
  assert(referenceStep(tutorial).id === 'look', 'single-car build ladder ends at LOOK');

  const scan = tutorial.steps.find((s) => s.id === 'scan');
  const look = tutorial.steps.find((s) => s.id === 'look');
  // FCFS does NOT clear SCAN (idea not applied); SCAN does NOT clear LOOK (must turn early).
  assert(!stepCleared(tutorial, scan, runOn(tutorial, tutorial.steps[0].code)), 'FCFS does not clear the SCAN step');
  assert(!stepCleared(tutorial, look, runOn(tutorial, scan.code)), 'SCAN does not clear the LOOK step (must turn around early)');
  // goalComposite is the target's own composite.
  assert(Math.abs(goalComposite(tutorial, look) - compositeOf(runOn(tutorial, look.code), tutorial.scenario.weights)) < 1e-9, 'goalComposite matches the target run');
}

// --- Multi-car track specifics ------------------------------------------------------
{
  const mc = getTutorialTrack('one-car-to-many');
  assert(mc, 'the multi-car track is registered');
  assert(mc.scenario.numElevators >= 2, 'the multi-car scenario has more than one car');
  const ids = ['per-car', 'claim', 'cost'];
  assert(ids.every((id) => mc.steps.some((s) => s.id === id)), 'multi-car track covers per-car → claim → cost');
  // The build ladder ends at dispatch-by-claim (the big win); cost-aware is the contrast.
  assert(referenceStep(mc).id === 'claim', 'multi-car build ladder ends at the dispatch (claim) step');
  const cost = mc.steps.find((s) => s.id === 'cost');
  assert(cost.kind === 'contrast' && cost.contrastNote, 'the cost-aware step is a contrast with its own note');

  // The naive (bunching) run must NOT clear the dispatch step — the idea has to be applied.
  const perCar = mc.steps.find((s) => s.id === 'per-car');
  const claim = mc.steps.find((s) => s.id === 'claim');
  assert(!stepCleared(mc, claim, runOn(mc, perCar.code)), 'the bunching naive run does not clear the dispatch step');
  // Dispatch roughly halves the naive composite (bunching → divided work is the big win).
  const naiveC = compositeOf(runOn(mc, perCar.code), mc.scenario.weights);
  const claimC = compositeOf(runOn(mc, claim.code), mc.scenario.weights);
  assert(claimC < naiveC * 0.75, `dispatch is a big win over bunching (${naiveC.toFixed(0)} → ${claimC.toFixed(0)})`);
}

// --- The run diagnosis (reusing the analyzer) names FCFS's symptom, quiet at LOOK ----
{
  const par = parFor(tutorial);
  const fcfs = tutorial.steps[0];
  const look = tutorial.steps.find((s) => s.id === 'look');

  const recFcfs = runSimulation(tutorial.scenario, tutorial.scenario.seed, compileController(fcfs.code), { record: true });
  const aFcfs = analyze({ frames: recFcfs.frames, metrics: recFcfs.metrics, par, level: tutorial.scenario });
  assert(typeof aFcfs.feedback === 'string' && aFcfs.feedback.length > 0, 'a FCFS run yields a feedback line');
  assert(
    aFcfs.findings.some((f) => f.id === 'highWait' || f.id === 'passedSameDir'),
    'the analyzer flags FCFS’s high-wait / passed-by symptom (the lesson’s hook)'
  );

  const recLook = runSimulation(tutorial.scenario, tutorial.scenario.seed, compileController(look.code), { record: true });
  const aLook = analyze({ frames: recLook.frames, metrics: recLook.metrics, par, level: tutorial.scenario });
  assert(!aLook.findings.some((f) => f.id === 'highWait'), 'at LOOK the analyzer no longer flags high wait (it IS par)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
