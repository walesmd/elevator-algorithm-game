// scoring.js — turn runs into a composite score and an honest star rating.
//
// Two principles from the doctrine drive this file:
//   1) Fairness over a single lucky run: every controller is scored across all
//      of a level's fixed seeds and averaged, so you can't overfit to one
//      passenger sequence.
//   2) Honest thresholds: stars are anchored to the FCFS and LOOK reference
//      runs on the *same* seeds, not to magic numbers. 1 star ≈ beat FCFS,
//      3 stars ≈ match/beat LOOK ("par").
//
// Lower composite = better (it's built from wait/journey/distance, all
// lower-is-better, plus a heavy penalty for anyone left undelivered).

import { runSimulation } from '../engine/simulation.js';
import * as fcfs from '../reference/fcfs.js';
import * as look from '../reference/look.js';

const DEFAULT_WEIGHTS = { wait: 1, journey: 0.5, distance: 0.1, undelivered: 1000 };

// Reference runs only depend on (level, seeds), so cache them per level id.
const referenceCache = new Map();

/**
 * Score a player's controller on a level.
 * @returns {{metrics:object, composite:number, stars:number,
 *            par:{fcfs:object, look:object, fcfsComposite:number, lookComposite:number},
 *            warnings:string[]}}
 */
export function scoreLevel(level, createController) {
  const runs = level.seeds.map((s) => runSimulation(level, s, createController));
  return scoreFromPlayerRuns(
    level,
    runs.map((r) => r.metrics),
    runs.flatMap((r) => r.warnings)
  );
}

/**
 * Score from per-seed metrics that were produced elsewhere (e.g. by the sandbox
 * Web Worker running the player's code). This keeps the trusted scoring/stars math
 * on the main thread while the untrusted run happens off it. Returns the SAME shape
 * as scoreLevel, so the results UI doesn't care which path produced it.
 * @param {object} level
 * @param {Array<object>} perSeedMetrics - one metrics summary per seed
 * @param {string[]} [warnings]
 */
export function scoreFromPlayerRuns(level, perSeedMetrics, warnings = []) {
  const metrics = aggregate(perSeedMetrics.map((m) => ({ metrics: m })));
  const composite = compositeOf(metrics, level.weights);

  const { fcfsAgg, lookAgg, fcfsComposite, lookComposite } = getReferences(level);
  const stars = computeStars(metrics, composite, fcfsComposite, lookComposite);

  return {
    metrics,
    composite,
    stars,
    par: { fcfs: fcfsAgg, look: lookAgg, fcfsComposite, lookComposite },
    warnings,
  };
}

export function aggregate(runs) {
  const ms = runs.map((r) => r.metrics);
  const n = ms.length;
  const mean = (key) => ms.reduce((s, m) => s + m[key], 0) / n;
  return {
    avgWait: mean('avgWait'),
    avgJourney: mean('avgJourney'),
    maxWait: mean('maxWait'),
    throughput: mean('throughput'),
    distance: mean('distance'),
    delivered: mean('delivered'),
    total: ms[0].total,
    deliveredAll: ms.every((m) => m.deliveredAll),
  };
}

export function compositeOf(m, weights) {
  const w = weights || DEFAULT_WEIGHTS;
  const undelivered = m.total - m.delivered;
  return (
    w.wait * m.avgWait +
    w.journey * m.avgJourney +
    w.distance * m.distance +
    (w.undelivered ?? 1000) * undelivered
  );
}

export function computeStars(metrics, composite, fcfsComposite, lookComposite) {
  if (!metrics.deliveredAll) return 0; // must deliver everyone to earn any star
  if (composite <= lookComposite) return 3;
  if (composite <= (fcfsComposite + lookComposite) / 2) return 2;
  if (composite <= fcfsComposite) return 1;
  return 0;
}

export function getReferences(level) {
  if (referenceCache.has(level.id)) return referenceCache.get(level.id);
  const fcfsRuns = level.seeds.map((s) => runSimulation(level, s, fcfs.createController));
  const lookRuns = level.seeds.map((s) => runSimulation(level, s, look.createController));
  const fcfsAgg = aggregate(fcfsRuns);
  const lookAgg = aggregate(lookRuns);
  const result = {
    fcfsAgg,
    lookAgg,
    fcfsComposite: compositeOf(fcfsAgg, level.weights),
    lookComposite: compositeOf(lookAgg, level.weights),
  };
  referenceCache.set(level.id, result);
  return result;
}
