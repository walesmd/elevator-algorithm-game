// harness.js — Web Worker sandbox harness. STUB (Phase 3).
//
// Owns the lifecycle of running untrusted player code safely off the main
// thread: spin up the worker (worker.js), hand it the player's code + the level,
// stream/collect commands, and enforce time budgets with a watchdog. If the
// player's code hangs (e.g. while(true)), the main thread calls
// worker.terminate() and the run ends with a friendly "your code timed out"
// message — never a frozen tab.
//
// This replaces the TEMPORARY main-thread new Function() path in main.js. The
// contract is intentionally the same shape so the swap is local:
//
//   const result = await runInWorker(code, level, { tickBudgetMs, runBudgetMs });
//   // result: { metrics, stars, composite, par, warnings } | { error, timedOut }
//
// See CLAUDE.md (Never block the tab) and PROJECT_PLAN.md §5 / Phase 3.

export async function runInWorker(/* code, level, opts */) {
  throw new Error('worker harness not implemented yet (Phase 3)');
}
