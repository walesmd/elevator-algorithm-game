// worker.js — Web Worker entry point (Phase 3).
//
// Runs INSIDE the worker, off the main thread. It receives the player's code plus
// the level, compiles the controller, and runs the *whole* deterministic engine
// here — one message in, one message out per scoring request — rather than chatting
// per tick. The engine (../engine/simulation.js) is already DOM-free, so it runs
// unchanged. Because there's no DOM here, player code can't touch the page; and
// because a hung run never posts back, the harness's watchdog can terminate it.
//
// Protocol:
//   main -> worker: { type:'score', id, code, level, seeds, recordSeed }
//   worker -> main: { type:'result', id, perSeed:[{seed,metrics}], warnings, frames }
//                 | { type:'error', id, phase:'compile'|'runtime', message }

import { runSimulation } from '../engine/simulation.js';
import { compileController } from './compile.js';

// A misbehaving controller can emit a warning every tick; don't ship thousands of
// strings back across the boundary. Keep the first N and a count of the rest.
const WARNING_CAP = 50;

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'score') return;
  const { id, code, level, seeds, recordSeed } = msg;

  let factory;
  try {
    factory = compileController(code);
  } catch (err) {
    // err.kind ('syntax' | 'load' | 'shape') lets the UI title it accurately.
    self.postMessage({ type: 'error', id, phase: (err && err.kind) || 'compile', message: err.message });
    return;
  }

  try {
    const perSeed = [];
    const warnings = [];
    let extraWarnings = 0;
    let frames = null;

    for (const seed of seeds) {
      const record = seed === recordSeed;
      // Cap warnings in the engine too, so a throw-every-tick controller doesn't
      // build a huge per-seed warning array before we trim it here.
      const r = runSimulation(level, seed, factory, { record, maxWarnings: WARNING_CAP });
      perSeed.push({ seed, metrics: r.metrics });
      for (const w of r.warnings) {
        if (warnings.length < WARNING_CAP) warnings.push(`seed ${seed}: ${w}`);
        else extraWarnings++;
      }
      if (record) frames = r.frames;
    }
    if (extraWarnings > 0) warnings.push(`…and ${extraWarnings} more warning(s).`);

    self.postMessage({ type: 'result', id, perSeed, warnings, frames });
  } catch (err) {
    // runSimulation is defensive (it catches controller throws per tick), so this
    // is unexpected — surface it rather than dying silently.
    self.postMessage({ type: 'error', id, phase: 'runtime', message: err && err.message ? err.message : String(err) });
  }
};
