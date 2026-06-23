// worker.js — Web Worker entry point. STUB (Phase 3).
//
// Runs INSIDE the Web Worker. Receives the player's code as a string plus the
// level, builds the controller, runs the deterministic engine here (off the main
// thread), and posts back metrics + a trace for replay. Has no DOM access by
// design, which is part of why player code is sandboxed here.
//
// Message protocol (planned):
//   main -> worker: { type:'run', code, level, seeds }
//   worker -> main: { type:'result', runs } | { type:'error', message }
//
// Implementation note: the engine (../engine/simulation.js) is already DOM-free,
// so the worker can import and run it unchanged. See Phase 3 in PROJECT_PLAN.md.

self.onmessage = (e) => {
  if (e && e.data && e.data.type === 'run') {
    self.postMessage({ type: 'error', message: 'worker not implemented yet (Phase 3)' });
  }
};
