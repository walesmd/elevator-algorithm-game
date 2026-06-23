// ui.js — small DOM helpers for the foundation UI.
//
// Deliberately minimal: render the level brief, render a results card after a
// run, and produce one diagnostic, non-spoiler line of feedback. The richer
// visualization (Canvas) and the in-page code editor land in later phases; this
// keeps the loop — read brief, run, see how you did — working today.

export function renderBrief(el, level) {
  const b = level.brief;
  el.innerHTML = `
    <h2>${escape(level.name)}</h2>
    <p class="situation">${escape(b.situation)}</p>
    <dl class="brief">
      <dt>Goal</dt><dd>${escape(b.goal)}</dd>
      <dt>Constraint</dt><dd>${escape(b.constraint)}</dd>
      <dt>Measured</dt><dd>${escape(b.measured)}</dd>
      <dt>To clear</dt><dd>${escape(b.bar)}</dd>
    </dl>`;
}

export function renderResults(el, result, best) {
  if (result.error) {
    el.innerHTML = `<div class="results error"><h3>Your code didn't run</h3><pre>${escape(
      result.error
    )}</pre><p>Fix the error and run again.</p></div>`;
    return;
  }

  const m = result.metrics;
  const look = result.par.look;
  el.innerHTML = `
    <div class="results">
      <div class="stars" title="${m.deliveredAll ? '' : 'Deliver everyone to earn stars'}">${stars(
        result.stars
      )}</div>
      <table class="metrics">
        <tr><th></th><th>You</th><th>Par (LOOK)</th></tr>
        ${row('Avg wait', m.avgWait, look.avgWait)}
        ${row('Avg journey', m.avgJourney, look.avgJourney)}
        ${row('Max wait', m.maxWait, look.maxWait)}
        ${row('Distance', m.distance, look.distance)}
        <tr><td>Delivered</td><td colspan="2">${m.delivered} / ${m.total}${
          m.deliveredAll ? ' ✓' : ''
        }</td></tr>
      </table>
      <p class="feedback">${escape(feedbackFor(result))}</p>
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
