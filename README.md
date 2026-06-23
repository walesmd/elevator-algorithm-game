# Elevator Algorithm Game

A browser game that teaches algorithmic thinking through elevator dispatch. You
write a JavaScript controller, run it against a deterministic simulation, and get
specific, encouraging feedback on how to make riders wait less — then iterate
across levels that get harder one idea at a time.

Runs entirely client-side: no server, no build step, no network needed to play
or to be scored. See `CLAUDE.md` for the design doctrine and `PROJECT_PLAN.md`
for the full technical spec.

## Status: through progression (Phases 0–5)

What works today:

- A deterministic, seeded simulation engine (`src/engine/`) — DOM-free, runs in
  the browser, a Web Worker, and Node. It can optionally **record a frame per
  tick** (`runSimulation(level, seed, factory, { record: true })`) for replay.
- **Five reference controllers** (`src/reference/`) — the classic scheduling
  family **FCFS, SSTF, SCAN, LOOK, C-SCAN** — each a clean, well-commented
  teaching artifact (one `source` string is both the scored controller and the
  editor-insertable code, so they can't drift). FCFS + LOOK also anchor the star
  thresholds.
- A **reference gallery & comparison tool**: a collapsed-by-default, clearly
  labeled "reference approaches (spoilers)" panel. Open it to **insert** any
  algorithm into the editor, **watch** it drive the current level in the Canvas,
  or **compare all five** side by side (stars + metrics, best-in-column
  highlighted) — so you can feel, on any level, why one strategy beats another.
- Multi-seed scoring with reference-anchored 1/2/3 stars (`src/game/scoring.js`).
- A **live Canvas visualization** (`src/render/`): press Run and watch your
  algorithm drive the building — shaft(s), car(s), riders waiting on each floor
  (who warm yellow → red the longer they wait, so you *see* starvation), with
  play / pause / single-step / 1×–Max speed and a scrubber. The render loop runs
  on `requestAnimationFrame`, decoupled from sim ticks and interpolating between
  them for smooth motion; it is read-only and replays the recorded run.
- A **sandboxed run**: your code runs in a Web Worker (`src/sandbox/`), off the
  main thread, behind a timeout **watchdog** — an infinite loop ends the run with
  a friendly message instead of freezing the tab. Syntax and runtime errors are
  surfaced kindly. The worker runs the engine across every seed and records one
  for replay; the trusted scoring/stars math stays on the main thread.
- A lean **in-page code editor** (`src/render/editor.js`) — syntax highlighting,
  line numbers, tab indent — behind a `createEditor()` wrapper so a heavier
  editor (CodeMirror/Monaco) can swap in later without touching the rest.
- **Progression & persistence** (`src/game/progression.js`, `progress.js`): a
  level bar with per-level star badges and lock state; a level unlocks once the
  previous earns ≥ 1★, with a "level unlocked" toast. Best stars, your code per
  level, and the last-played level are saved to `localStorage`, so progress
  survives a reload and you resume where you left off.
- A growing **level curriculum** (`src/game/levels.js`): six single-car levels so
  far — getting moving, sweeping (SCAN/LOOK), a morning up-peak rush, hotel
  (lobby-centric) traffic, a sudden surge of calls, and an 18-floor high-rise where
  distance/energy becomes the headline (LOOK's turn-early sweep vs SCAN's run to the
  ends). Traffic shapes: `uniform` / `up-peak` / `down-peak` / `hotel`.
- A full play loop: read the brief, edit the algorithm, Run, watch it, read the
  metrics + feedback, and advance through unlocking levels.
- Passing headless tests (`simulation`, `recording`, `phase3`, `references`,
  `progression`).

Not yet built: multiple-elevator levels (+ multi-car-aware references), zoned
"skyscraper" levels where riders transfer at a sky-lobby, an onboarding tutorial,
and tiered hints.

## Run it

It's static files. Serve the folder and open it (a static server is needed so the
browser will load the ES modules and the module Web Worker):

```
npm run serve      # python3 -m http.server 8000
# then open http://localhost:8000
```

## Test it

No framework — plain assertions runnable in Node:

```
npm test           # engine, recording, sandbox, reference, progression suites
```

## Layout

```
index.html            # app shell
src/engine/           # deterministic simulation (rng, passengers, metrics, simulation)
src/reference/        # FCFS, SSTF, SCAN, LOOK, C-SCAN controllers + gallery (internal)
src/game/             # levels (data), scoring/stars, progress, progression (unlock), UI
src/render/           # Canvas renderer + rAF playback + lean editor + highlighter
src/sandbox/          # Web Worker harness (watchdog) + worker + code compiler
src/main.js           # wires brief -> editor -> run -> watch + results + gallery + level bar
test/                 # headless engine, recording, sandbox, reference, progression tests
```
