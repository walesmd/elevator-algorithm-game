# Elevator Algorithm Game

A browser game that teaches algorithmic thinking through elevator dispatch. You
write a JavaScript controller, run it against a deterministic simulation, and get
specific, encouraging feedback on how to make riders wait less — then iterate
across levels that get harder one idea at a time.

Runs entirely client-side: no server, no build step, no network needed to play
or to be scored. See `CLAUDE.md` for the design doctrine and `PROJECT_PLAN.md`
for the full technical spec.

## Status: foundation + visualization (Phases 0–2)

What works today:

- A deterministic, seeded simulation engine (`src/engine/`) — DOM-free, runs in
  the browser and in Node. It can optionally **record a frame per tick**
  (`runSimulation(level, seed, factory, { record: true })`) for replay.
- Reference controllers (`src/reference/`) used internally to set fair star
  thresholds. FCFS is the baseline; LOOK is a spoiler-gated par.
- Multi-seed scoring with reference-anchored 1/2/3 stars (`src/game/scoring.js`).
- A **live Canvas visualization** (`src/render/`): press Run and watch your
  algorithm drive the building — shaft(s), car(s), riders waiting on each floor
  (who warm yellow → red the longer they wait, so you *see* starvation), with
  play / pause / single-step / 1×–Max speed and a scrubber. The render loop runs
  on `requestAnimationFrame`, decoupled from sim ticks and interpolating between
  them for smooth motion; it is read-only and replays the recorded run.
- A play loop in the browser: read the brief, edit the algorithm in a textarea,
  Run, watch it, and read the metrics + feedback.
- Passing headless tests (`test/simulation.test.js`, `test/recording.test.js`).

Not yet built (later phases): the Web Worker sandbox that runs player code safely
off the main thread (Phase 3 — today it runs via `new Function` on the main
thread), the in-page code editor, and more levels. A stub with the intended
interface is in `src/sandbox/`.

## Run it

It's static files. Serve the folder and open it (a static server is needed so the
browser will load ES modules and, later, the worker):

```
npm run serve      # python3 -m http.server 8000
# then open http://localhost:8000
```

## Test it

No framework — plain assertions runnable in Node:

```
npm test           # runs the engine + recording test suites
```

## Layout

```
index.html            # app shell
src/engine/           # deterministic simulation (rng, passengers, metrics, simulation)
src/reference/        # FCFS + LOOK reference controllers (internal)
src/game/             # levels (data), scoring/stars, progress, UI
src/render/           # Canvas renderer + rAF playback controller
src/sandbox/          # Web Worker harness + worker — STUB (Phase 3)
src/main.js           # wires brief -> editor -> run -> watch + results
test/                 # headless engine + recording tests
```
