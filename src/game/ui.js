// ui.js — small DOM helpers for the foundation UI.
//
// Deliberately minimal: render the level brief, render a results card after a
// run, and produce one diagnostic, non-spoiler line of feedback. The richer
// visualization (Canvas) and the in-page code editor land in later phases; this
// keeps the loop — read brief, run, see how you did — working today.

import { getHints } from './hints.js';
import { getConcept } from './concepts.js';

export function renderBrief(el, level) {
  const b = level.brief;
  const c = getConcept(level.id);
  // The "concept" note names the CS idea behind the level and links out to read more
  // ("name the concept, not the code"). Collapsed by default — reference material, not
  // a spoiler, and distinct from the run-aware tiered hints below.
  el.innerHTML = `
    <h2>${escape(level.name)}</h2>
    <p class="situation">${escape(b.situation)}</p>
    <dl class="brief">
      <dt>Goal</dt><dd>${escape(b.goal)}</dd>
      <dt>Constraint</dt><dd>${escape(b.constraint)}</dd>
      <dt>Measured</dt><dd>${escape(b.measured)}</dd>
      <dt>To clear</dt><dd>${escape(b.bar)}</dd>
    </dl>
    <details class="concept">
      <summary><span class="concept-tag">The concept</span> ${escape(c.name)}</summary>
      <p>${escape(c.what)}</p>
      ${c.url ? `<p><a class="concept-link" href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">Read more ↗</a></p>` : ''}
    </details>`;
}

export function renderResults(el, result, best) {
  if (result.error) {
    el.innerHTML = `<div class="results error"><h3>${escape(
      result.errorTitle || "Your code didn't run"
    )}</h3><pre>${escape(result.error)}</pre><p>Fix it and run again.</p></div>`;
    return;
  }

  const m = result.metrics;
  const look = result.par.look;
  const parLabel = result.par.label || 'LOOK';
  el.innerHTML = `
    <div class="results">
      <div class="stars" title="${m.deliveredAll ? '' : 'Deliver everyone to earn stars'}">${stars(
        result.stars
      )}</div>
      <table class="metrics">
        <tr><th></th><th>You</th><th>Par (${escape(parLabel)})</th></tr>
        ${row('Avg wait', m.avgWait, look.avgWait)}
        ${row('Avg journey', m.avgJourney, look.avgJourney)}
        ${row('Max wait', m.maxWait, look.maxWait)}
        ${row('Distance', m.distance, look.distance)}
        <tr><td>Delivered</td><td colspan="2">${m.delivered} / ${m.total}${
          m.deliveredAll ? ' ✓' : ''
        }</td></tr>
      </table>
      <p class="feedback">${escape(result.analysis ? result.analysis.feedback : feedbackFor(result))}</p>
      ${perSeedTable(result)}
      ${best ? `<p class="best">Best so far: ${stars(best.stars)}</p>` : ''}
      ${
        result.warnings && result.warnings.length
          ? `<details class="warnings"><summary>${result.warnings.length} warning(s)</summary><pre>${escape(
              result.warnings.slice(0, 8).join('\n')
            )}</pre></details>`
          : ''
      }
    </div>`;
}

// Diagnostic + Socratic, never the code. Describe what happened, name a concept.
export function feedbackFor(result) {
  const m = result.metrics;
  if (!m.deliveredAll) {
    return `You delivered ${m.delivered} of ${m.total} riders. Some never reached their floor — make sure your algorithm eventually serves every call, including the ones it passes.`;
  }
  const look = result.par.look;
  if (result.stars >= 3) {
    return `Excellent — you matched or beat par. Try a taller building or trim total distance further.`;
  }
  if (m.avgWait > look.avgWait * 1.15) {
    return `Everyone arrives — nice. But your average wait is well above par. Watch for riders you pass who want to go the same direction you're already heading. There's a classic strategy for this.`;
  }
  return `Solid run — everyone delivered and you're near par. Look for the single metric furthest from par and focus there.`;
}

// The seed switcher (Phase 10): a chip per scored seed on the replay, the active one
// highlighted, so the player can watch any seed (not just seed 1). main.js handles clicks.
export function renderSeedSwitcher(el, seeds, activeSeed) {
  el.hidden = false;
  el.innerHTML =
    '<span class="seed-label">Watch seed:</span>' +
    seeds
      .map(
        (s) => `<button class="seed-chip${s === activeSeed ? ' active' : ''}" data-seed="${s}" type="button" aria-pressed="${s === activeSeed}">${s}</button>`
      )
      .join('');
}

// Per-seed breakdown (Phase 10): make the multi-seed averaging visible. Each row is a
// scored seed's result; the worst (highest composite) is flagged, undelivered seeds are
// marked, and rows are clickable to watch that seed (main.js delegates the click). Needs
// result.perSeed = [{ seed, metrics, composite }].
function perSeedTable(result) {
  const ps = result.perSeed;
  if (!ps || ps.length <= 1) return '';
  const worst = ps.reduce((a, b) => (b.composite > a.composite ? b : a), ps[0]);
  const rows = ps
    .map((p) => {
      const m = p.metrics;
      const cls = ['watchable'];
      if (!m.deliveredAll) cls.push('undelivered');
      if (p === worst) cls.push('worst');
      return `<tr class="${cls.join(' ')}" data-seed="${p.seed}" title="Watch seed ${p.seed}">
        <td>seed ${p.seed}</td><td>${fmt(m.avgWait)}</td><td>${fmt(m.distance)}</td>
        <td>${m.delivered}/${m.total}${m.deliveredAll ? '' : ' ✗'}</td>
        <td class="seed-comp">${fmt(p.composite)}</td></tr>`;
    })
    .join('');
  return `
    <p class="per-seed-note">Scored as the average of ${ps.length} runs on different passenger
    sequences — so a single lucky (or unlucky) crowd can't decide your score. Click a seed to watch it.</p>
    <table class="per-seed">
      <thead><tr><th>Seed</th><th>Avg wait</th><th>Distance</th><th>Delivered</th><th>Score*</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Tiered hints (Phase 7), opt-in and progressive. Three rungs — the idea (Hint 1),
// the symptom in your own run (Hint 2, from the analyzer), then the technique to look
// up (Hint 3) — revealed one at a time so a stuck learner gets just enough to get
// unstuck, never the answer. Nothing is shown until the player asks. `state` is
// { revealed:0..3, runHint:string|null }; main.js owns it and re-renders on reveal.
export function renderHints(el, level, state) {
  const h = getHints(level.id);
  const revealed = Math.max(0, Math.min(3, state.revealed || 0));
  const tiers = [
    { label: 'Hint 1 · the idea', text: h.concept },
    {
      label: 'Hint 2 · your run',
      text: state.runHint || 'Run your algorithm once — then this hint points at the single biggest thing to fix in the run you just watched.',
    },
    { label: 'Hint 3 · the technique', text: h.technique },
  ];
  // Resting state: a single quiet affordance, nothing to read until you ask. (The
  // generic "how hints work" preamble was just noise on every level — the per-tier
  // labels below already make the three-rung structure clear once you engage.)
  if (revealed === 0) {
    el.innerHTML = `
      <div class="hints">
        <button class="ghost hint-reveal" type="button">Stuck? Reveal a hint →</button>
      </div>`;
    return;
  }

  const shown = tiers
    .slice(0, revealed)
    .map((t) => `<div class="hint-tier"><b>${escape(t.label)}</b><p>${escape(t.text)}</p></div>`)
    .join('');
  const more =
    revealed < 3
      ? `<button class="ghost hint-reveal" type="button">Show the next hint →</button>`
      : `<p class="hint hints-done">That’s all three — the rest is yours to discover. That struggle is where the learning is.</p>`;
  el.innerHTML = `
    <div class="hints">
      <div class="hints-head">Tiered hints <span class="hints-count">${revealed}/3</span></div>
      ${shown}
      ${more}
    </div>`;
}

// Side-by-side comparison of the reference algorithms on one level. Each row is
// { id, name, stars, metrics, deliveredAll }. The best value in each
// lower-is-better column (and the most stars) is highlighted, so the trade-offs
// between strategies are legible at a glance. A "Watch" button per row lets the
// learner replay any of them; main.js wires the clicks.
export function renderComparison(el, rows) {
  if (!rows || !rows.length) {
    el.innerHTML = '';
    return;
  }
  const delivered = rows.filter((r) => r.deliveredAll);
  const best = (key) => (delivered.length ? Math.min(...delivered.map((r) => r.metrics[key])) : null);
  const bestStars = Math.max(...rows.map((r) => r.stars));
  const lowers = { avgWait: best('avgWait'), avgJourney: best('avgJourney'), maxWait: best('maxWait'), distance: best('distance') };

  // A ✓ marks the winner so the signal isn't carried by colour alone (WCAG 1.4.1).
  const mark = ' <span class="cmp-mark" aria-hidden="true">✓</span>';
  const cell = (r, key) => {
    const v = fmt(r.metrics[key]);
    const isBest = r.deliveredAll && lowers[key] != null && Math.abs(r.metrics[key] - lowers[key]) < 1e-9;
    return `<td class="${isBest ? 'cmp-best' : ''}">${v}${isBest ? mark : ''}</td>`;
  };

  el.innerHTML = `
    <table class="cmp">
      <thead><tr>
        <th>Algorithm</th><th>Stars</th><th>Avg wait</th><th>Avg journey</th>
        <th>Max wait</th><th>Distance</th><th>Delivered</th><th></th>
      </tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const bestStar = r.stars === bestStars && r.stars > 0;
            return `<tr class="${r.deliveredAll ? '' : 'cmp-undelivered'}">
          <td class="cmp-name">${escape(r.name)}</td>
          <td class="${bestStar ? 'cmp-best' : ''}">${stars(r.stars)}${bestStar ? mark : ''}</td>
          ${cell(r, 'avgWait')}${cell(r, 'avgJourney')}${cell(r, 'maxWait')}${cell(r, 'distance')}
          <td>${r.metrics.delivered}/${r.metrics.total}${r.deliveredAll ? ' ✓' : ' ✗'}</td>
          <td><button class="cmp-watch" data-id="${escape(r.id)}">Watch</button></td>
        </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <p class="hint">Lower is better for wait, journey, and distance; the column winner is marked <span class="cmp-mark">✓</span>. Rows that didn't deliver everyone are dimmed and don't count. Click <b>Watch</b> to replay any one above.</p>`;
}

// --- Phase 11B: the guided tutorial (opt-in, sanctioned walkthrough) ---------------
//
// Two render passes, mirroring the curriculum's brief/results split:
//   renderTutorialStep   — the lesson card (in the brief column): which step, the named
//                          concept, the idea, the one scoped change, and the gated
//                          "show me the change" reveal. Stable across runs.
//   renderTutorialResult — after a run (in the results column): what your run actually
//                          did vs the previous step, the analyzer's diagnosis of THIS
//                          run, and the success-gated "next step". Re-rendered each run.
// main.js owns the state + wires the (delegated) button clicks.

// The lesson card. `revealed` disables the spoiler reveal once it's been used.
export function renderTutorialStep(el, { step, index, total, revealed = false }) {
  const n = index + 1;
  const dots = Array.from({ length: total }, (_, i) => {
    const cls = i < index ? ' done' : i === index ? ' current' : '';
    return `<span class="tut-dot${cls}"></span>`;
  }).join('');
  // The first step IS the naive baseline — there's nothing to change, just run it — so
  // the reveal would be a no-op there; offer it only from step 2 on.
  const canReveal = index > 0;
  const revealBtn = !canReveal
    ? ''
    : revealed
    ? `<button class="ghost tut-reveal" type="button" disabled>Change revealed — read it, then Run</button>`
    : `<button class="ghost tut-reveal" type="button">Show me the change <span class="spoiler-tag">spoiler</span></button>`;
  el.innerHTML = `
    <div class="tut-card">
      <div class="tut-head">
        <span class="tut-kicker">Guided tutorial${step.kind === 'contrast' ? ' · a contrast' : ''}</span>
        <button class="ghost tut-exit" type="button">Exit ✕</button>
      </div>
      <div class="tut-progress">
        <span class="tut-stepn" role="status">Step ${n} of ${total}</span>
        <span class="tut-dots" aria-hidden="true">${dots}</span>
      </div>
      <h2 class="tut-title">${escape(step.title)}</h2>
      <p class="tut-concept"><span class="concept-tag">The concept</span> ${escape(step.concept)}</p>
      <p class="tut-intro">${escape(step.intro)}</p>
      <div class="tut-task"><b>Your task</b><p>${escape(step.task)}</p></div>
      ${revealBtn}
    </div>`;
}

// A "this step" metric cell, annotated with how it moved vs the previous step. Lower is
// better for all three (wait, max wait, distance), so a drop is good (green ↓) and a
// rise is worse (amber ↑) — which is exactly what makes the SSTF contrast legible (its
// average drops while its worst case rises). No arrow when the value didn't move.
function deltaCell(val, prev) {
  if (prev == null) return `<td>${fmt(val)}</td>`;
  const d = fmt(val) - fmt(prev);
  if (d === 0) return `<td>${fmt(val)}</td>`;
  const cls = d < 0 ? 'good' : 'bad';
  const arrow = d < 0 ? '↓' : '↑';
  return `<td>${fmt(val)} <span class="tut-arrow ${cls}">${arrow}${fmt(Math.abs(d))}</span></td>`;
}

// The post-run card. `prevStep`/`prevMetrics` give the before/after reference (null on
// the first step). `analysis` is the analyzer's verdict on THIS run; `cleared` gates the
// "next step" button (and on the last step it becomes "finish"). When there's a previous
// step, a "watch before/after" button opens the side-by-side replay (Phase 11C).
export function renderTutorialResult(el, { metrics, analysis, cleared, prevStep, prevMetrics, isLast, isContrast, contrastNote }) {
  if (!metrics) {
    el.innerHTML = '';
    return;
  }
  const m = metrics;
  const p = prevStep && prevMetrics ? prevMetrics : null;
  const compareRows = `
    <tr><td>This step</td>${deltaCell(m.avgWait, p && p.avgWait)}${deltaCell(m.maxWait, p && p.maxWait)}${deltaCell(m.distance, p && p.distance)}</tr>
    ${p ? `<tr class="tut-prev"><td>Previous (${escape(prevStep.id.toUpperCase())})</td><td>${fmt(p.avgWait)}</td><td>${fmt(p.maxWait)}</td><td>${fmt(p.distance)}</td></tr>` : ''}`;
  // A contrast step (e.g. SSTF, or cost-aware dispatch) names how to read its result — a
  // trade-off, or a marginal refinement — from the step's own copy. The arrows above
  // already point the way; this says what it means.
  const tradeoff = isContrast && p && contrastNote
    ? `<p class="tut-tradeoff">${escape(contrastNote)}</p>`
    : '';
  const watchBtn = prevStep
    ? `<button class="ghost tut-compare" type="button">▶ ${isContrast ? 'Watch the trade-off' : 'Watch before / after'}</button>`
    : '';
  const nextBtn = cleared ? `<button class="primary tut-next" type="button">${isLast ? 'Finish ✓' : 'Next step →'}</button>` : '';
  el.innerHTML = `
    <div class="results tut-results">
      <div class="tut-runline ${m.deliveredAll ? 'ok' : 'bad'}">Delivered ${m.delivered} / ${m.total}${
        m.deliveredAll ? ' ✓' : ' — someone never arrived'
      }</div>
      <table class="metrics tut-metrics">
        <tr><th></th><th>Avg wait</th><th>Max wait</th><th>Distance</th></tr>
        ${compareRows}
      </table>
      <p class="feedback">${escape(analysis ? analysis.feedback : '')}</p>
      ${tradeoff}
      ${cleared ? `<div class="tut-cleared">✓ You’ve applied the idea${isLast ? ' — and that’s the whole track. Nicely done.' : '.'}</div>` : ''}
      <div class="tut-actions">${watchBtn}${nextBtn}</div>
      ${cleared ? '' : `<p class="tut-not-cleared">Not there yet — apply the change described on the left and run again. (Stuck? “Show me the change” reveals one way to do it.)</p>`}
    </div>`;
}

function row(label, you, par) {
  return `<tr><td>${label}</td><td>${fmt(you)}</td><td>${fmt(par)}</td></tr>`;
}
function fmt(n) {
  return Math.round(n * 10) / 10;
}
function stars(n) {
  return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
}
function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
