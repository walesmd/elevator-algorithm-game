// analyzer.js — local, rule-based run diagnosis (Phase 7).
//
// The teaching half of the loop: after a run, look at what actually happened and
// name the single most useful thing to improve — observationally and Socratically,
// never the code. It is decoupled from the engine and the renderer: hand it the
// recorded run (the seed the learner watches) plus the aggregate metrics and par,
// and it returns prioritized findings, one headline feedback line, and a run-specific
// hint (the "symptom in your run" tier of the tiered-hint system).
//
// Doctrine (CLAUDE.md §"How feedback works"): rules are data/heuristics, decoupled
// and easy to extend per level; feedback compares to par and to the player's own
// previous best; it names the single highest-impact thing; it stays kind and
// specific; and it never reveals the fix.
//
// Each rule reads the recorded `frames` (one per tick: every car's floor / dir /
// doors / load and every waiting rider's floor / direction / wait) and/or the
// aggregate `metrics` vs `par`, and emits a finding:
//   { id, severity, title, detail, concept, hint }
// `severity` orders them (higher = more important); `hint` is the short pointer used
// for Hint 2. The headline `feedback` is built from the top finding.

const SEV = { stranded: 100, starvation: 80, highWait: 60, overTravel: 50, passedSameDir: 45, idleWithPending: 40 };

/**
 * @param {object} args
 * @param {Array} args.frames    recorded frames for the watched seed (may be empty)
 * @param {object} args.metrics  aggregate metrics across all scoring seeds
 * @param {object} args.par      { look, fcfs, ... } aggregate reference metrics
 * @param {object} args.level    the level definition (for thresholds + traffic)
 * @param {object} [args.prevBest] the player's previous best for this level ({stars,composite})
 * @param {number} [args.stars]  stars earned this run
 * @returns {{findings:Array, feedback:string, runHint:(string|null)}}
 */
export function analyze({ frames = [], metrics, par, level, prevBest = null, stars = 0 }) {
  const look = (par && par.look) || metrics;
  const findings = [];
  const push = (f) => { if (f) findings.push(f); };

  // --- Metric-level rules (aggregate across all seeds) ---
  push(ruleStranded(metrics));
  push(ruleHighWait(metrics, look));
  push(ruleOverTravel(metrics, look, level));

  // --- Behavioural rules (from the one recorded seed the learner watches) ---
  if (frames.length) {
    push(ruleStarvation(frames, level));
    push(rulePassedSameDir(frames));
    push(ruleIdleWithPending(frames));
  }

  findings.sort((a, b) => b.severity - a.severity);

  return {
    findings,
    feedback: buildFeedback(findings, { metrics, stars, prevBest }),
    runHint: findings.length ? findings[0].hint : null,
  };
}

// ---------------------------------------------------------------------------
// Metric rules
// ---------------------------------------------------------------------------

function ruleStranded(m) {
  if (m.deliveredAll) return null;
  const left = m.total - Math.round(m.delivered);
  return {
    id: 'stranded',
    severity: SEV.stranded,
    title: 'Not everyone arrived',
    detail: `${left} of ${m.total} rider(s) never reached their floor. An algorithm has to eventually serve every call — including the ones a car drives past. Make sure no waiting rider can be ignored forever.`,
    concept: 'completeness — every call must eventually be served',
    hint: 'Some riders are never delivered — check that a waiting call can’t be passed over indefinitely.',
  };
}

function ruleHighWait(m, look) {
  if (!m.deliveredAll) return null;
  if (!(look.avgWait > 0) || m.avgWait <= look.avgWait * 1.15) return null;
  const pct = Math.round((m.avgWait / look.avgWait - 1) * 100);
  return {
    id: 'highWait',
    severity: SEV.highWait,
    title: 'Riders wait longer than they need to',
    detail: `Everyone arrives, but your average wait is about ${pct}% above par. Waits balloon when a car ignores people it could pick up on the way, or when the cars don’t divide the work. Think about serving riders en route rather than one errand at a time.`,
    concept: 'collective / en-route service (and, with several cars, dispatch)',
    hint: 'Average wait is well above par — look for riders a car could have grabbed without going out of its way.',
  };
}

function ruleOverTravel(m, look, level) {
  if (!m.deliveredAll) return null;
  if (!(look.distance > 0) || m.distance <= look.distance * 1.2) return null;
  const pct = Math.round((m.distance / look.distance - 1) * 100);
  const distanceCounts = (level.weights && level.weights.distance) >= 0.4;
  return {
    id: 'overTravel',
    severity: SEV.overTravel,
    title: 'The cars travel further than they need to',
    detail: `Everyone arrives, but your cars cover about ${pct}% more distance than par.${distanceCounts ? ' Distance is weighted heavily on this level, so that’s costing your score.' : ''} Where is a car driving further than it has to — running to the end of the shaft when nothing’s left ahead, or re-treading ground another car already covered?`,
    concept: 'minimise travel — turn back when nothing’s ahead; don’t overlap cars',
    hint: 'Total distance is well above par — watch for a car running past the last call it needs.',
  };
}

// ---------------------------------------------------------------------------
// Behavioural rules (segment each car's frames into per-floor "visits")
// ---------------------------------------------------------------------------

// A visit = a maximal run of consecutive frames where a car sits at one integer
// floor. `opened` is whether its doors opened at any point during the visit (i.e.
// it actually served that floor). `depDir` is the direction it left in.
function carVisits(frames, carIndex) {
  const visits = [];
  let cur = null;
  for (let i = 0; i < frames.length; i++) {
    const ev = frames[i].elevators[carIndex];
    if (!ev) continue;
    if (!cur || cur.floor !== ev.floor) {
      if (cur) cur.endFloor = ev.floor; // we now know where it went next
      cur = { floor: ev.floor, from: i, to: i, opened: ev.doorOpen > 0, endFloor: null };
      visits.push(cur);
    } else {
      cur.to = i;
      if (ev.doorOpen > 0) cur.opened = true;
    }
  }
  for (const v of visits) v.depDir = v.endFloor == null ? null : v.endFloor > v.floor ? 'up' : 'down';
  return visits;
}

function numCars(frames) {
  return frames[0] && frames[0].elevators ? frames[0].elevators.length : 0;
}

// Passed a same-direction call: the car left a floor (without opening its doors)
// heading the very way a rider standing there wanted to go, while it had room. That
// rider should have been picked up on the way past — the heart of the elevator idea.
function rulePassedSameDir(frames) {
  let count = 0;
  let example = null;
  const N = numCars(frames);
  for (let c = 0; c < N; c++) {
    for (const v of carVisits(frames, c)) {
      if (v.opened || !v.depDir) continue;
      for (let i = v.from; i <= v.to; i++) {
        const ev = frames[i].elevators[c];
        const room = ev.load < ev.capacity;
        if (!room) continue;
        const sameDirHere = frames[i].waiting.some((w) => w.floor === v.floor && w.dir === v.depDir);
        if (sameDirHere) {
          count++;
          if (!example) example = { floor: v.floor, dir: v.depDir, t: frames[v.from].t };
          break;
        }
      }
    }
  }
  if (count === 0) return null;
  return {
    id: 'passedSameDir',
    severity: SEV.passedSameDir,
    title: 'Your car passes riders going its way',
    detail: `In the run you’re watching, a car drove past ${count} time(s) where someone was waiting to go the same direction it was already heading (and it had room). Picking those riders up as you pass — instead of making a separate trip — is the core of the classic elevator (SCAN / LOOK) algorithm.`,
    concept: 'directional collective control (the SCAN / LOOK elevator algorithm)',
    hint: example
      ? `Around t=${example.t}, watch floor ${example.floor}: your car heads ${example.dir} right past someone who also wants to go ${example.dir}.`
      : 'Your car passes riders heading the same way it is — pick them up on the way by.',
  };
}

// Starvation: everyone arrived, but one rider waited far longer than a fair scheduler
// should allow (calibrated to the same threshold the renderer turns red).
function ruleStarvation(frames, level) {
  const sweep = level.numFloors * (level.ticksPerFloor ?? 2);
  const red = (level.starve && level.starve.red) || sweep * 4;
  let worst = 0;
  let where = null;
  for (const f of frames) {
    for (const w of f.waiting) {
      if (w.wait > worst) { worst = w.wait; where = { floor: w.floor, wait: w.wait }; }
    }
  }
  if (!where || worst < red) return null;
  return {
    id: 'starvation',
    severity: SEV.starvation,
    title: 'One rider waited far too long',
    detail: `Everyone arrives, but someone on floor ${where.floor} waited ${where.wait} ticks — far longer than the rest. That’s the worst-case-versus-average trade-off: a fair scheduler bounds how long any single rider can be left behind, not just the average.`,
    concept: 'fairness / starvation — bound the worst wait, not only the mean',
    hint: `A rider on floor ${where.floor} waited ${where.wait} ticks while others were served — watch for a call that keeps getting skipped.`,
  };
}

// Idled with work pending: a car sat still (idle, doors shut, going nowhere) for a
// sustained stretch while people were waiting somewhere it could have helped.
function ruleIdleWithPending(frames) {
  const N = numCars(frames);
  let worstRun = 0;
  for (let c = 0; c < N; c++) {
    let run = 0;
    for (const f of frames) {
      const ev = f.elevators[c];
      const idle = ev && ev.dir === 'idle' && ev.doorOpen === 0 && ev.load === 0;
      // Someone is waiting that this car could reach (inside its range).
      const reachable = f.waiting.some((w) => w.floor >= (ev.minFloor ?? 0) && w.floor <= (ev.maxFloor ?? Infinity));
      if (idle && reachable) { run++; if (run > worstRun) worstRun = run; } else { run = 0; }
    }
  }
  // Only flag a *sustained* idle (brief pauses between errands are fine).
  if (worstRun < 15) return null;
  return {
    id: 'idleWithPending',
    severity: SEV.idleWithPending,
    title: 'A car sat idle while people waited',
    detail: `One of your cars stayed parked for a stretch (about ${worstRun} ticks) while riders were still waiting within its reach. A car with no one aboard can usually start toward the oldest call instead of waiting to be told.`,
    concept: 'don’t idle with work pending — keep an empty car useful',
    hint: 'A car sits idle while people are still waiting — send an empty car toward a pending call instead of parking it.',
  };
}

// ---------------------------------------------------------------------------
// Headline feedback: encourage first, then point at the single top finding,
// and note progress against the player's own previous best.
// ---------------------------------------------------------------------------

function buildFeedback(findings, { metrics, stars, prevBest }) {
  if (!metrics.deliveredAll) {
    // Stranded is the top finding; lead with it (delivering everyone comes first).
    return findings[0] ? `${findings[0].detail}` : `Some riders never arrived — make sure every call is eventually served.`;
  }

  const beat = prevBest && prevBest.stars != null;
  const improved = beat && stars > prevBest.stars;

  if (stars >= 3 && findings.length === 0) {
    return 'Excellent — at or beyond par on every metric, and nothing obvious left on the table. Try it on a taller building, or see how close to par you can get with less total travel.';
  }
  if (stars >= 3) {
    return `Strong run — you reached par${improved ? ' (a new best!)' : ''}. One thing still stands out: ${lower(findings[0].detail)}`;
  }

  const lead = improved
    ? 'Nice — that’s a new best, and everyone arrives. '
    : 'Everyone arrives — good. ';
  return findings[0]
    ? `${lead}The single biggest thing to improve: ${lower(findings[0].detail)}`
    : `${lead}You’re close to par — find the one metric furthest from it and focus there.`;
}

function lower(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
