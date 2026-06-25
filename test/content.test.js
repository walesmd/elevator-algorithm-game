// content.test.js — the learning content stays complete and non-spoiler (Phase 7C).
// Run: `node test/content.test.js`.
//
// The concept notes, tiered hints, and worked reference explanations are data; this
// guards that every level / reference actually has them, that they point at a concept
// rather than paste a solution, and that the "earned" gating is wired the way the
// doctrine requires (the naive baseline is free; the solving algorithms are spoilers).

import { getConcept } from '../src/game/concepts.js';
import { getHints } from '../src/game/hints.js';
import { levels } from '../src/game/levels.js';
import { gallery } from '../src/reference/gallery.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

// Guidance is allowed to name the API surface (state.elevators, the commands) — that's
// the contract, not the answer. What it must NOT do is paste the solution, so we flag
// only clear source markers: the controller function, or a returned command literal.
const CODE = /function createController|return \[\s*\{/;

// --- 1. Every level has a concept note (name + explanation + read-more link) -------
{
  for (const L of levels) {
    const c = getConcept(L.id);
    assert(c && c.name && c.what, `${L.id} has a concept name + explanation`);
    assert(c.url && /^https?:\/\//.test(c.url), `${L.id} concept links out to read more`);
    assert(!CODE.test(c.what), `${L.id} concept names the idea, not the code`);
  }
}

// --- 2. Every level has both static hint rungs (Hint 2 is dynamic, from the run) ----
{
  for (const L of levels) {
    const h = getHints(L.id);
    assert(h && h.concept && h.technique, `${L.id} has Hint 1 (idea) and Hint 3 (technique)`);
    assert(!CODE.test(h.concept) && !CODE.test(h.technique), `${L.id} hints stay non-spoiler`);
  }
}

// --- 3. Every reference has a worked explanation; gating is set right ---------------
{
  for (const g of gallery) {
    assert(typeof g.howItWorks === 'string' && g.howItWorks.length > 40, `${g.id} has a worked "how it works" explanation`);
    // It explains the approach in prose — it must not be the literal controller source.
    assert(g.howItWorks.trim() !== g.source.trim() && !/function createController/.test(g.howItWorks),
      `${g.id} worked explanation is prose, not the source code`);
  }
  const fcfs = gallery.find((g) => g.id === 'fcfs');
  assert(fcfs.spoiler === false, 'FCFS walkthrough is free (the baseline is not a spoiler)');
  const solvers = gallery.filter((g) => g.id !== 'fcfs');
  assert(solvers.every((g) => g.spoiler === true), 'the solving algorithms\' walkthroughs are spoiler-gated (earned by clearing, or explicit reveal)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
