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
  Boarding is **direction-aware**, like a real car: a `STOP` declares a `serving`
  direction (or inherits the car's travel direction) and only riders heading that
  way board — a down-rider won't step into an up-bound car.
- **Four reference controllers** (`src/reference/`) — the elevator-scheduling
  family **FCFS, SSTF, SCAN, LOOK** — each a clean, well-commented teaching
  artifact (one `source` string is both the scored controller and the
  editor-insertable code, so they can't drift). The sweeps (SCAN/LOOK) run as real
  *directional collective* controllers; FCFS + LOOK anchor the star thresholds.
- A **reference gallery & comparison tool**: a collapsed-by-default, clearly
  labeled "reference approaches (spoilers)" panel. Open it to **insert** any
  algorithm into the editor, **watch** it drive the current level in the Canvas,
  or **compare them** side by side (stars + metrics, best-in-column highlighted) —
  so you can feel, on any level, why one strategy beats another.
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
- A growing **level curriculum** (`src/game/levels.js`): eleven levels so far. Six
  single-car ones — getting moving, sweeping (SCAN/LOOK), a morning up-peak rush,
  hotel (lobby-centric) traffic, a sudden surge of calls, and an 18-floor high-rise
  where distance/energy becomes the headline (LOOK's turn-early sweep vs SCAN's run
  to the ends); three multiple-elevator ones — a two-car building (drive both), a
  three-car surge (dispatch the cars so they don't all chase the same call), and a
  16-floor three-car tower where distance is back on the scoreboard; then two zoned
  "skyscraper" ones — a 20-floor tower whose two cars each cover only part of the
  building and hand cross-building riders off at a shared **sky-lobby**, and a
  24-floor four-car capstone (two cars per zone) that needs dispatch *and* transfers
  at once. The reference controllers and starter are N-car aware and range-aware (a
  call goes to the best-placed car that can actually reach it, then each car runs its
  own strategy within its zone). Traffic shapes: `uniform` / `up-peak` / `down-peak`
  / `hotel`.
- A full play loop: read the brief, edit the algorithm, Run, watch it, read the
  metrics + feedback, and advance through unlocking levels.
- A **pedagogy layer** (Phase 7): a local run **analyzer** that names anti-patterns
  from the recorded run, **tiered hints** (the idea → the symptom in your run → the
  technique, opt-in, never the answer), an **A/B compare** tool that replays two
  algorithms side by side on the same seed and curates the few notable moments where
  they diverge, a per-level **concept note** that names the CS idea and links out, a
  first-run **onboarding** overlay, and **worked reference explanations** earned by
  clearing a level.
- **Bonus levels** (Phase 8): two always-open "elevators that go sideways" levels on a
  2-D grid — *The Great Glass Elevator* (one free-roaming car) and *Gringotts* (three
  carts) — where a car moves left/right as well as up/down. Grid-aware references
  anchor their stars; a dedicated grid renderer draws the 2-D building.
- **Elevator music** (Phase 9): a floating radio widget with a mute toggle and a
  six-station, GTA/Forza-style picker — every station is *synthesized live* with the
  Web Audio API (no audio files ship, so it stays offline and licence-free), each a
  distinct generically-named genre. Off by default (autoplay-safe); mute, station, and
  volume persist across visits.
- Passing headless tests (`simulation`, `recording`, `phase3`, `references`,
  `progression`, `analyzer`, `compare`, `content`, `grid`, `audio`).

All nine phases are built. (The original "sharing & challenge" Phase 8 was retired in
favor of the sideways-elevator bonus levels; Phase 9 added the procedural radio.)

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
src/reference/        # FCFS, SSTF, SCAN, LOOK controllers + gallery (internal)
src/game/             # levels (data), scoring/stars, progress, progression (unlock), UI
src/render/           # Canvas renderer + rAF playback + lean editor + highlighter
src/sandbox/          # Web Worker harness (watchdog) + worker + code compiler
src/main.js           # wires brief -> editor -> run -> watch + results + gallery + level bar
test/                 # headless engine, recording, sandbox, reference, progression tests
```
