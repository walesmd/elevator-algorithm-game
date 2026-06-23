// harness.js — Web Worker sandbox harness (Phase 3).
//
// Owns the lifecycle of running untrusted player code safely off the main thread.
// It spins up worker.js (a module worker, so it can `import` the engine), sends a
// scoring request, and arms a WATCHDOG: if the worker doesn't answer within the
// time budget — the signature of an infinite loop, which JS can't interrupt from
// inside — the main thread calls worker.terminate() and the run ends with a
// friendly message instead of a frozen tab. A terminated worker is dead, so the
// next run lazily spawns a fresh one.
//
// This replaces the TEMPORARY main-thread new Function() path that used to live in
// main.js. The worker returns raw per-seed metrics + replay frames; the trusted
// scoring/stars math stays on the main thread (see game/scoring.js).
//
//   const harness = createHarness({ budgetMs: 4000 });
//   const { perSeed, warnings, frames } = await harness.score({ code, level, seeds, recordSeed });
//   // rejects with { kind:'compile'|'runtime'|'timeout'|'worker', message }

const DEFAULT_BUDGET_MS = 4000;

// The real worker. Factored out (and overridable via opts.createWorker) so the
// watchdog/lifecycle logic can be tested in Node with a fake worker.
function defaultCreateWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

export function createHarness({ budgetMs = DEFAULT_BUDGET_MS, createWorker = defaultCreateWorker } = {}) {
  let worker = null;
  let seq = 0;
  let chain = Promise.resolve(); // serialize jobs: the worker handles one at a time

  function ensureWorker() {
    if (!worker) worker = createWorker();
    return worker;
  }

  function killWorker() {
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    }
  }

  function runJob(req) {
    const limit = req.budgetMs ?? budgetMs;
    return new Promise((resolve, reject) => {
      const w = ensureWorker();
      const id = ++seq;
      let settled = false;

      const finish = (fn, payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        fn(payload);
      };

      const timer = setTimeout(() => {
        killWorker(); // the only way to stop a hung worker
        finish(reject, {
          kind: 'timeout',
          message: `Your code ran too long and was stopped (likely an infinite loop). Limit: ${limit}ms.`,
        });
      }, limit);

      const onMessage = (e) => {
        const msg = e.data;
        if (!msg || msg.id !== id) return;
        if (msg.type === 'result') finish(resolve, msg);
        else finish(reject, { kind: msg.phase || 'error', message: msg.message });
      };

      const onError = (err) => {
        killWorker();
        finish(reject, { kind: 'worker', message: (err && err.message) || 'The sandbox worker failed to start.' });
      };

      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.postMessage({ type: 'score', id, code: req.code, level: req.level, seeds: req.seeds, recordSeed: req.recordSeed });
    });
  }

  function score(req) {
    // Queue behind any in-flight job, regardless of how it settled.
    const run = () => runJob(req);
    const p = chain.then(run, run);
    chain = p.then(() => {}, () => {});
    return p;
  }

  return { score, dispose: killWorker };
}
