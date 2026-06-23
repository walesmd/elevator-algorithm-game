// phase3.test.js — Node-testable units of the sandbox layer. Run: `node test/phase3.test.js`.
//
// The Worker harness + watchdog and the DOM editor are browser-only (verified with
// a headless browser, not here). What IS pure and testable in Node: compiling a
// code string into a controller, the scoring path the worker feeds, and the editor's
// highlighter — whose one hard requirement is that it reproduces the source exactly.

import { compileController, CompileError } from '../src/sandbox/compile.js';
import { createHarness } from '../src/sandbox/harness.js';
import { runSimulation } from '../src/engine/simulation.js';
import { scoreLevel, scoreFromPlayerRuns } from '../src/game/scoring.js';
import { highlightJS } from '../src/render/highlight.js';
import { getLevel } from '../src/game/levels.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const L1 = getLevel('l1');
const L2 = getLevel('l2');

// A valid FCFS-ish controller as a *string*, the way a player would type it.
const PLAYER_CODE = `
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];
      let target = null;
      if (e.load > 0) target = e.carCalls[0];
      else if (state.hallCalls.length > 0) target = state.hallCalls[0].floor;
      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP' }];
    },
  };
}`;

// --- 1. compileController ---------------------------------------------------
{
  const factory = compileController(PLAYER_CODE);
  assert(typeof factory === 'function', 'valid code compiles to a factory function');
  const ctrl = factory({ numFloors: 5, numElevators: 1, capacity: 8 });
  assert(ctrl && typeof ctrl.step === 'function', 'the factory returns a controller with step()');

  let threw = null;
  try { compileController('function createController( { syntax error'); } catch (e) { threw = e; }
  assert(threw instanceof CompileError, 'a syntax error throws CompileError');
  assert(/syntax/i.test(threw.message), 'syntax error message mentions syntax');

  let threw2 = null;
  try { compileController('const notIt = 1;'); } catch (e) { threw2 = e; }
  assert(threw2 instanceof CompileError && /createController/.test(threw2.message),
    'missing createController throws a helpful message');

  let threw3 = null;
  try { compileController('throw new Error("boom at load");'); } catch (e) { threw3 = e; }
  assert(threw3 instanceof CompileError && /boom at load/.test(threw3.message),
    'a top-level throw is reported as a compile-time problem');
}

// --- 2. Sandbox scoring path matches scoreLevel ----------------------------
// The worker runs the compiled factory and returns per-seed metrics; the main
// thread scores them with scoreFromPlayerRuns. That must equal scoring the same
// factory directly, or the sandbox would change a player's result.
{
  const factory = compileController(PLAYER_CODE);
  for (const L of [L1, L2]) {
    const direct = scoreLevel(L, factory);
    const perSeed = L.seeds.map((s) => runSimulation(L, s, factory).metrics);
    const viaWorkerPath = scoreFromPlayerRuns(L, perSeed, []);
    assert(direct.stars === viaWorkerPath.stars, `${L.id}: sandbox path yields the same stars (${direct.stars})`);
    assert(direct.composite === viaWorkerPath.composite, `${L.id}: sandbox path yields the same composite`);
    assert(JSON.stringify(direct.metrics) === JSON.stringify(viaWorkerPath.metrics),
      `${L.id}: sandbox path yields identical aggregate metrics`);
  }
}

// --- 3. Highlighter is round-trip safe (overlay must match the textarea) ----
{
  const stripTags = (html) => html.replace(/<[^>]*>/g, '');
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const samples = [
    PLAYER_CODE,
    `const a = 1 < 2 && 3 > 2; // compare & stuff`,
    `const s = "a<b>c&d", t = 'x', u = \`tmpl \${a}\`;`,
    `/* block\n comment */ function f(){ return 0xFF + 1.5e3; }`,
    `let html = "<div>" + x + "</div>"; // & < >`,
    ``,
    `\n\n  indented\n`,
  ];
  let allRoundTrip = true;
  for (const src of samples) {
    const back = unescape(stripTags(highlightJS(src)));
    if (back !== src) { allRoundTrip = false; console.error('   round-trip mismatch for:', JSON.stringify(src)); }
  }
  assert(allRoundTrip, 'highlightJS reproduces the exact source (strip tags + unescape === input)');

  const h = highlightJS(`const x = "hi"; // note`);
  assert(/class="tok-keyword">const</.test(h), 'keywords get tok-keyword');
  assert(/class="tok-string">&quot;hi&quot;<|class="tok-string">"hi"</.test(h) || /tok-string/.test(h), 'strings get tok-string');
  assert(/tok-comment/.test(h), 'comments get tok-comment');
  assert(/tok-keyword/.test(highlightJS('return 1')), 'return is a keyword');
  assert(/tok-literal/.test(highlightJS('x = true')), 'true is a literal');
}

// --- 4. Harness watchdog & lifecycle (with a fake worker) ------------------
// The real Worker is browser-only, but the risky part is the harness state machine:
// resolve on result, reject+terminate on a hang, reject on worker error, and spawn a
// fresh worker after a kill. A fake worker lets us test that deterministically.
class FakeWorker {
  constructor(behavior) {
    this.behavior = behavior;
    this.listeners = { message: [], error: [] };
    this.terminated = false;
  }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const a = this.listeners[type];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  postMessage(msg) { this.behavior(this, msg); }
  terminate() { this.terminated = true; }
  emit(type, payload) { for (const fn of (this.listeners[type] || []).slice()) fn(payload); }
}

const REPLY_RESULT = (w, msg) =>
  setTimeout(() => w.emit('message', { data: { type: 'result', id: msg.id, perSeed: [], warnings: [], frames: [] } }), 0);
const REPLY_NEVER = () => {};
const REPLY_ERROR = (w) => setTimeout(() => w.emit('error', { message: 'worker exploded' }), 0);

await (async () => {
  // 4a: a result resolves the promise.
  {
    const h = createHarness({ createWorker: () => new FakeWorker(REPLY_RESULT) });
    const res = await h.score({ code: '', level: { seeds: [1] }, seeds: [1], recordSeed: 1 }).then(
      (r) => ({ ok: true, r }),
      (e) => ({ ok: false, e })
    );
    assert(res.ok && res.r.type === 'result', 'harness resolves when the worker returns a result');
  }

  // 4b: a hang times out, terminates the worker, and the next run spawns a fresh one.
  {
    let made = 0;
    let lastWorker = null;
    const h = createHarness({
      budgetMs: 25,
      createWorker: () => { made++; lastWorker = new FakeWorker(REPLY_NEVER); return lastWorker; },
    });
    const out = await h.score({ code: '', level: { seeds: [1] }, seeds: [1], recordSeed: 1 }).then(
      () => ({ ok: true }),
      (e) => ({ ok: false, e })
    );
    assert(!out.ok && out.e.kind === 'timeout', 'a hung worker rejects with a timeout');
    assert(lastWorker.terminated, 'the watchdog terminates the hung worker');

    const h2made = made;
    // Next job on the same harness must build a new worker (the old one was killed).
    const h3 = createHarness({
      budgetMs: 25,
      createWorker: () => { made++; lastWorker = new FakeWorker(REPLY_RESULT); return lastWorker; },
    });
    await h3.score({ code: '', level: { seeds: [1] }, seeds: [1], recordSeed: 1 }).catch(() => {});
    assert(made > h2made, 'a fresh worker is spawned after a terminate');
  }

  // 4c: a worker error rejects (and terminates).
  {
    let lastWorker = null;
    const h = createHarness({ createWorker: () => { lastWorker = new FakeWorker(REPLY_ERROR); return lastWorker; } });
    const out = await h.score({ code: '', level: { seeds: [1] }, seeds: [1], recordSeed: 1 }).then(
      () => ({ ok: true }),
      (e) => ({ ok: false, e })
    );
    assert(!out.ok && out.e.kind === 'worker', 'a worker error rejects with kind "worker"');
    assert(lastWorker.terminated, 'a worker error terminates the worker');
  }

  // 4d: jobs serialize — the second only starts after the first settles.
  {
    let inFlight = 0;
    let maxConcurrent = 0;
    const h = createHarness({
      createWorker: () => new FakeWorker((w, msg) => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        setTimeout(() => { inFlight--; w.emit('message', { data: { type: 'result', id: msg.id } }); }, 0);
      }),
    });
    const job = () => h.score({ code: '', level: { seeds: [1] }, seeds: [1], recordSeed: 1 });
    await Promise.all([job(), job(), job()]);
    assert(maxConcurrent === 1, 'the harness runs at most one job at a time (serialized)');
  }
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
