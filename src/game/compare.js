// compare.js — find the few genuinely interesting moments where two algorithms,
// run on the SAME level and the SAME seed, diverge (Phase 7B).
//
// The A/B tool replays two recorded runs side by side. Staring at two whole runs is
// noise; the teaching value is in the handful of instants where the *choice of
// algorithm* changes the outcome. This module is the curator: pure, local (no network,
// no AI — consistent with the local-first feedback doctrine), and computed from the two
// deterministic frame streams. It returns a small, ranked, timeline-ordered list of
// moments, each with a non-spoiler note and a tick the synced replay can jump to.
//
// Because both runs use the same seed, the passenger set is identical — same ids,
// origins, destinations — so a rider can be followed across both runs and the two
// algorithms' treatment of *that same rider* compared directly.

/**
 * @param {{frames:Array, metrics:object, label:string}} a
 * @param {{frames:Array, metrics:object, label:string}} b
 * @param {object} level
 * @returns {Array<{t:number, kind:string, title:string, note:string}>}
 */
export function findMoments(a, b, level) {
  const La = a.label, Lb = b.label;
  // Thresholds scale with the building but stay low enough to surface real-but-modest
  // divergences on gentle levels. They are all strictly > 0, so two identical runs
  // (every gap exactly 0) produce nothing — the curator stays quiet when there's
  // nothing to teach.
  const sweep = level.numFloors * (level.ticksPerFloor ?? 2);
  const red = (level.starve && level.starve.red) || sweep * 4;
  const forkMin = Math.max(4, Math.round(sweep * 0.3));
  const finishMin = Math.max(6, Math.round(sweep * 0.4));
  const proximity = Math.max(4, Math.round(sweep * 0.4));

  const waitsA = riderWaits(a.frames);
  const waitsB = riderWaits(b.frames);
  const candidates = [];

  // 1) The directional fork — the rider the two algorithms treat most differently.
  let fork = null;
  for (const [id, wa] of waitsA) {
    const wb = waitsB.get(id);
    if (!wb) continue;
    const diff = Math.abs(wa.wait - wb.wait);
    if (!fork || diff > fork.diff) fork = { diff, wa, wb };
  }
  if (fork && fork.diff >= forkMin) {
    const aFaster = fork.wa.wait <= fork.wb.wait;
    const fast = { L: aFaster ? La : Lb, w: aFaster ? fork.wa : fork.wb };
    const slow = { L: aFaster ? Lb : La, w: aFaster ? fork.wb : fork.wa };
    candidates.push({
      t: fast.w.t,
      kind: 'fork',
      score: 100 + fork.diff,
      title: 'The directional fork',
      note: `On floor ${fast.w.floor}, ${fast.L} picks up this ${fast.w.dir}-bound rider as it passes; ${slow.L} leaves them, and they wait about ${fork.diff} ticks longer.`,
    });
  }

  // 2) Fairness — a rider whose wait crosses the "too long" line in one run, not the other.
  let fair = null;
  for (const [id, wa] of waitsA) {
    const wb = waitsB.get(id);
    if (!wb) continue;
    if ((wa.wait >= red) !== (wb.wait >= red)) {
      const diff = Math.abs(wa.wait - wb.wait);
      if (!fair || diff > fair.diff) fair = { diff, wa, wb, aBad: wa.wait >= red };
    }
  }
  if (fair) {
    const bad = { L: fair.aBad ? La : Lb, w: fair.aBad ? fair.wa : fair.wb };
    const good = { L: fair.aBad ? Lb : La, w: fair.aBad ? fair.wb : fair.wa };
    candidates.push({
      t: bad.w.t,
      kind: 'fairness',
      score: 80 + fair.diff,
      title: 'A rider left behind',
      note: `Under ${bad.L}, the rider on floor ${bad.w.floor} waits ${bad.w.wait} ticks — past the “waited too long” line — while ${good.L} serves them in ${good.w.wait}. That is the worst-case cost of optimising the average.`,
    });
  }

  // 3) Commit vs. thrash — one car reverses far more often to chase nearer calls.
  const revA = reversals(a.frames);
  const revB = reversals(b.frames);
  const revGap = Math.abs(revA.count - revB.count);
  if (revGap >= Math.max(3, 0.3 * Math.max(revA.count, revB.count))) {
    const aThrash = revA.count > revB.count;
    const thr = { L: aThrash ? La : Lb, r: aThrash ? revA : revB };
    const cmt = { L: aThrash ? Lb : La, r: aThrash ? revB : revA };
    if (thr.r.example != null) {
      candidates.push({
        t: thr.r.example,
        kind: 'thrash',
        score: 60 + revGap,
        title: 'Commit vs. thrash',
        note: `${thr.L} keeps reversing to chase the nearest call (${thr.r.count} direction changes in all); ${cmt.L} commits to a sweep (${cmt.r.count}). Watch a car here turn back instead of holding its line.`,
      });
    }
  }

  // 4) One finishes first — clears the same crowd well ahead of the other.
  const finA = finishTick(a.frames);
  const finB = finishTick(b.frames);
  if (finA != null && finB != null && Math.abs(finA - finB) >= finishMin) {
    const earlier = finA <= finB ? La : Lb;
    const eT = Math.min(finA, finB);
    const lT = Math.max(finA, finB);
    candidates.push({
      t: eT,
      kind: 'finish',
      score: 50 + (lT - eT),
      title: 'One finishes first',
      note: `${earlier} has delivered everyone by t=${eT}; the other runs until t=${lT} — ${lT - eT} ticks longer to clear the same riders.`,
    });
  }

  // 5) Biggest spread — the tick the two runs' deliveries are furthest apart.
  const spread = maxDeliveredSpread(a.frames, b.frames);
  if (spread && spread.gap >= 3) {
    const ahead = spread.aAhead ? La : Lb;
    candidates.push({
      t: spread.t,
      kind: 'spread',
      score: 30 + spread.gap,
      title: 'Pulling ahead',
      note: `By t=${spread.t}, ${ahead} is ${spread.gap} riders ahead — the moment the two strategies separate most.`,
    });
  }

  // Rank by teaching value, drop near-duplicates in time, keep a curated handful,
  // then present in timeline order.
  candidates.sort((x, y) => y.score - x.score);
  const picked = [];
  for (const m of candidates) {
    if (picked.some((p) => Math.abs(p.t - m.t) < proximity)) continue;
    picked.push(m);
    if (picked.length >= 5) break;
  }
  picked.sort((x, y) => x.t - y.t);
  return picked.map(({ t, kind, title, note }) => ({ t, kind, title, note }));
}

// Per rider: their longest wait and when/where it peaked (≈ just before pickup).
// Same seed ⇒ same ids in both runs, so this is directly comparable across A and B.
function riderWaits(frames) {
  const out = new Map();
  for (const f of frames) {
    for (const r of f.waiting) {
      const cur = out.get(r.id);
      if (!cur || r.wait > cur.wait) out.set(r.id, { wait: r.wait, t: f.t, floor: r.floor, dir: r.dir });
    }
  }
  return out;
}

// Count up/down direction reversals across all cars; note the first reversal tick.
function reversals(frames) {
  const prev = [];
  let count = 0;
  let example = null;
  for (const f of frames) {
    for (const ev of f.elevators) {
      const d = ev.dir;
      if (d !== 'up' && d !== 'down') continue;
      if (prev[ev.index] && prev[ev.index] !== d) {
        count++;
        if (example == null) example = f.t;
      }
      prev[ev.index] = d;
    }
  }
  return { count, example };
}

function finishTick(frames) {
  for (const f of frames) if (f.total > 0 && f.delivered >= f.total) return f.t;
  return null;
}

// Walk both runs together; find the tick where their delivered counts differ most.
function maxDeliveredSpread(fa, fb) {
  const n = Math.min(fa.length, fb.length);
  let best = null;
  for (let i = 0; i < n; i++) {
    const gap = fa[i].delivered - fb[i].delivered;
    const mag = Math.abs(gap);
    if (!best || mag > best.gap) best = { t: fa[i].t, gap: mag, aAhead: gap > 0 };
  }
  return best;
}
