# Elevator Algorithm Game — Project Plan

A browser-based game where the player writes an elevator dispatch algorithm in
JavaScript, runs it against a simulated building, watches it work, and improves
it across increasingly hard levels. Everything runs client-side — no server.

- **Primary purpose:** teaching tool. Design priorities, in order: clear
  algorithmic concepts, honest and legible feedback, a difficulty curve that
  introduces one new idea at a time.
- **Tech stack:** vanilla JavaScript (ES modules) + HTML5 Canvas, with lean
  client-side dependencies vendored into the repo where they clearly earn their
  weight (e.g. the code editor). No build step, no framework, no server-side
  process. Runs offline; deploys as static files.
- **Status:** Phases 0–5 complete (engine, scoring/stars, visualization, sandbox +
  editor, reference gallery, progression + persistence). In progress: Phase 6 —
  the level curriculum (taller buildings, multiple elevators, zoned skyscrapers,
  hotel traffic), landing as staged PRs. This document is the spec the build follows.

---

## 1. Vision and learning goals

The player is handed a working-but-naive elevator and a coding panel. Their job
is to write the brain that decides where the elevator goes. They run it, watch
passengers wait (or not), see their score, and rewrite the algorithm to do
better. Each level introduces a new wrinkle that breaks the previous strategy,
which is the teaching mechanism: the game makes you *feel* why a smarter
algorithm is needed before handing you the next problem.

Concepts the game is built to teach, level by level:

- **Greedy vs. planned scheduling** — first-come-first-served feels fair but is
  slow; sweeping (the SCAN / "elevator algorithm" and LOOK variants) is faster.
- **State and direction** — committing to a direction and serving calls along
  the way; avoiding passing a waiting passenger going your way.
- **Starvation and fairness** — optimizing average wait can strand one person
  forever; max-wait matters too.
- **Throughput under load** — capacity limits, bursty traffic, rush-hour
  patterns (morning up-peak, lunch churn, evening down-peak).
- **Coordination** — with multiple elevators, the hard part is *assignment*: not
  sending two cars to the same call, zoning, destination dispatch.
- **Trade-offs and objective functions** — wait time vs. energy/distance vs.
  fairness. There is no single "correct" algorithm; there is a score to beat.

The design principle throughout: **the player owns the algorithm, the engine
owns the physics.** They decide direction and stops; the engine handles how
fast the car moves, how long doors take, and who boards. This keeps attention on
scheduling — the actual computer-science content — instead of animation math.

---

## 2. Core gameplay loop

```
        ┌─────────────────────────────────────────────────┐
        │                                                   │
        ▼                                                   │
  Read the level   →  Write / edit algorithm  →  Run simulation
   (goal + new          (JS in the editor)         (watch it play)
    constraint)                                          │
                                                         ▼
                                                  See metrics + stars
                                                         │
                       ┌─────────────────────────────────┤
                       │                                  │
              < 1 star (retry, with             ≥ 1 star  → milestone met
               feedback on what was weak)        next level unlocks
```

A run has two modes that share one engine:

1. **Headless scoring run** — the simulation executes at full speed with no
   rendering across several fixed random seeds, producing the official score.
2. **Visualized run** — the same deterministic run replayed (or run live) at a
   watchable speed so the player can see what their algorithm actually did.

Separating these matters: scoring stays fast and fair while the visualization
stays smooth, and both are reproducible because the world is seeded.

---

## 3. Domain model

The simulation is a fixed-tick discrete model. One **tick** is the atomic unit
of time; everything (movement, door timing, boarding) is expressed in ticks.

- **Building** — `numFloors` (e.g. 5–20). Floors are integers, `0` at the
  bottom.
- **Elevator** — position (current floor), direction (`up`/`down`/`idle`), door
  state (`open`/`closed`/`opening`/`closing`), `moving` flag, onboard passengers,
  and `capacity`. The model always holds an **array** of elevators, even when
  there is only one (see §4 — this avoids a painful refactor at the multi-car
  levels).
- **Passenger** — spawns on an origin floor at a given tick with a destination
  floor. Generates a **hall call** (a request at a floor, with a desired
  direction) while waiting; once aboard, contributes a **car call** (a
  destination button press). Carries timestamps for wait and journey metrics.
- **Traffic profile** — a per-level, seeded schedule of passenger spawns
  (uniform random, up-peak, down-peak, bursts, etc.).
- **Movement model** — moving one floor takes a fixed number of ticks. While
  `moving` is `true` the car is committed to reaching the next floor; direction
  reversals only take effect once it arrives (no teleporting or mid-shaft
  reversals). Doors take ticks to open, dwell, and close; boarding/alighting
  consume dwell time.

The engine is **deterministic**: given a level + seed, the passenger stream and
all physics are identical every run. A small seeded PRNG (e.g. mulberry32) drives
all randomness. This is what makes scoring fair and bugs reproducible.

---

## 4. The player's algorithm API

This is the heart of the product and the part to design most carefully. The
player writes a **controller factory**: a function that sets up whatever state
it wants and returns an object with a `step` method. `step` is called by the
engine and returns one **command per elevator**.

```js
// The player writes this. It runs inside a sandboxed Web Worker.
function createController(config) {
  // config = { numFloors, numElevators, capacity }
  // Initialize any state you want to keep between ticks here.
  const queue = [];

  return {
    // Called by the engine each tick. Return an array of commands,
    // one per elevator, indexed the same as state.elevators.
    step(state) {
      const e = state.elevators[0];
      // ...your scheduling logic...
      return [{ action: 'MOVE_UP' }];
    }
  };
}
```

**The `state` object passed to `step`:**

```js
state = {
  time: 1234,                       // ticks elapsed
  elevators: [
    {
      index: 0,
      floor: 3,                     // current floor
      moving: false,                // mid-shaft? (commands ignored until arrival)
      direction: 'idle',            // 'up' | 'down' | 'idle'
      doors: 'closed',              // 'open' | 'closed' | 'opening' | 'closing'
      carCalls: [7, 9],             // destinations of onboard passengers
      load: 2,                      // passengers aboard
      capacity: 8,
    },
  ],
  hallCalls: [                      // waiting requests not yet picked up
    { floor: 5, direction: 'up' },
    { floor: 2, direction: 'down' },
  ],
};
```

**Commands the player may return per elevator:**

| Command | Effect |
|---|---|
| `{ action: 'MOVE_UP' }` | Travel toward the next floor up. |
| `{ action: 'MOVE_DOWN' }` | Travel toward the next floor down. |
| `{ action: 'STOP' }` | Open doors at the current floor to load/unload. |
| `{ action: 'IDLE' }` | Do nothing this tick. |

The engine resolves the rest: enforcing capacity, moving boarders' destinations
into `carCalls`, running door timing, and updating metrics. Illegal or malformed
commands (e.g. `MOVE_UP` at the top floor, or a non-object) are treated as
`IDLE` and surfaced as a non-fatal warning so the player learns without crashing
the run.

**Why a factory returning `step`, rather than a bare function:** it lets the
player keep state between ticks (their own queue, a planned route, a target per
car) without globals — which is exactly the state-management lesson we want, and
it generalizes cleanly to N elevators.

**Progressive disclosure.** Early levels can ship with an optional convenience
helper (e.g. a `goTo(floor)` that returns the right MOVE/STOP for you) so a
beginner can express intent in one line, then graduate to raw commands. There is
still only **one** core API; the helper is sugar on top, documented in the panel.

**The teaching arc in three reference algorithms** (used internally to set
scoring "par"; shown to the player only as opt-in, earned spoilers — after a
level is cleared or via an explicit "show me one approach" action — never as a
default starter and never as the content of a hint):

1. **FCFS** — serve hall calls in arrival order. Simple, obviously fair, slow.
2. **SCAN / LOOK** — keep going one direction, serving every call along the way,
   reverse when there's nothing further ahead. The classic elevator algorithm.
3. **Destination-aware / multi-car dispatch** — assign calls to cars to minimize
   expected wait; the late-game target.

---

## 5. Technical architecture

All client-side. Four cooperating parts:

```
┌───────────────────────────── Main thread (UI) ──────────────────────────────┐
│  Code editor (CodeMirror)   Controls (run/pause/step/speed)   Results panel  │
│            │                          │                            ▲         │
│            ▼                          ▼                            │         │
│      Worker harness  ──────►  Simulation engine  ──────►  Canvas renderer    │
│      (load + watchdog)        (deterministic, tick loop)   (decoupled fps)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                        │ postMessage (code in, commands out)
                                ┌───────▼────────┐
                                │  Web Worker     │  ← player's algorithm runs here
                                │  (sandbox)      │
                                └─────────────────┘
```

**User code runs in a Web Worker.** This is the key safety/architecture
decision, for three reasons:

1. **Isolation** — the worker has no DOM access, so player code can't touch the
   page or cheat by reading engine internals.
2. **Interruptibility** — JavaScript can't interrupt its own infinite loop, but
   the main thread *can* `worker.terminate()`. A watchdog enforces a per-tick
   time budget and an overall run budget; on timeout the run ends and the player
   sees "your code timed out" instead of a frozen tab.
3. **Responsiveness** — headless scoring can run flat-out in the worker without
   janking the UI.

Player code is injected into the worker (via a Blob URL or `postMessage` +
`new Function`) and invoked through a thin protocol: main thread sends
`{seed, config}` and per-tick `state`; the worker replies with commands. To keep
the per-tick round-trip cheap, the engine can also hand the worker the level and
let it run the whole simulation, reporting back a command log for replay — decide
this once profiling shows whether message overhead matters.

**Code editor: CodeMirror 6, vendored locally.** Commit a prebuilt ESM bundle to
the repo — no CDN, no build step — so the editor loads offline and the game keeps
working with no connection. It's small, has a solid JavaScript mode, and sits
behind a thin wrapper so it stays swappable. Monaco (VS Code's editor) is the
alternative if full IntelliSense becomes a priority later — but it's heavy and
wants a bundler, so it's a Phase-7 consideration, not now.

**Simulation engine.** Plain ES module, no DOM dependency, so it runs in the
worker, in the main thread, and in tests. Owns the tick loop, seeded passenger
generation, command resolution, physics, and metric collection. Deterministic by
construction.

**Renderer.** Canvas 2D. Draws the shaft(s), the car(s), floor labels, and
waiting passengers as simple shapes/sprites. Render loop runs on
`requestAnimationFrame` and is **decoupled** from sim ticks: it interpolates
between tick states for smooth motion and supports 1×/2×/4×/max speed and a
single-step button. The renderer reads simulation state; it never feeds back
into it.

**Persistence: `localStorage`.** Stores progress (which levels are unlocked),
best stars + best metrics per level, and the player's last code per level so work
is never lost. Level definitions live as JS/JSON data modules in the repo.

**Suggested file layout:**

```
/elevator-game
  index.html
  /src
    main.js              # wires UI, editor, engine, renderer together
    /engine
      simulation.js      # tick loop, command resolution, physics
      passengers.js      # seeded traffic generation
      metrics.js         # wait/journey/throughput/energy collection
      rng.js             # seeded PRNG
    /sandbox
      worker.js          # runs player code; the API surface
      harness.js         # spawn worker, watchdog/timeout, messaging
    /render
      renderer.js        # Canvas drawing + interpolation
    /game
      levels.js          # level definitions (data)
      scoring.js         # composite score + star thresholds
      progress.js        # localStorage read/write
      ui.js              # panels, controls, results screen
    /reference
      fcfs.js  look.js   # built-in algorithms (par + hints + examples)
  /test
    simulation.test.js   # deterministic engine tests
```

---

## 6. Scoring and evaluation

A run is scored on metrics the player can see and reason about:

| Metric | Meaning | Why it's there |
|---|---|---|
| **Avg wait** | hall call → pickup, averaged | core responsiveness |
| **Avg journey** | request → drop-off, averaged | end-to-end experience |
| **Max wait** | worst single wait | catches starvation |
| **Throughput** | passengers delivered in the time limit | did it keep up? |
| **Distance / energy** | total floors traveled | efficiency, the late-game lever |
| **Delivered all?** | pass/fail gate | a run that strands people can't 3-star |

These combine into a single **composite score** via per-level weights (early
levels weight wait time; later levels add energy). Lower-is-better metrics are
normalized against the level's reference performance so the composite is
comparable across levels.

**Stars (the primary signal).** Three tiers, anchored to the built-in reference
algorithms rather than arbitrary numbers:

- ★ — beats naive FCFS (and delivers everyone). Clears the level.
- ★★ — roughly matches a good LOOK implementation.
- ★★★ — meets or beats the reference "par," the tuned target for the level.

**Fairness — score across multiple seeds.** Every scoring run executes the same
algorithm against several fixed seeds (e.g. 5) and averages. This stops players
from overfitting to one lucky passenger sequence and rewards genuinely general
algorithms — itself a worthwhile lesson.

**Milestone to advance:** earning ≥ 1★ unlocks the next level. Stars accumulate
and can gate later "worlds" (e.g. multi-elevator levels need N total stars),
giving completionists a reason to revisit and optimize.

**Alternatives considered** (stars chosen as primary for legibility, but these
can layer on):

- **Par / golf** — show a target number per metric ("par: 14-tick avg wait");
  pairs naturally with stars and makes the goal concrete.
- **Percentile vs. a built-in bot** — "you beat the LOOK bot by 12%."
- **Ghost replay sharing** — since there's no server, encode a run/seed in a URL
  so players can challenge each other without a leaderboard backend.
- **Letter grades** — cosmetic alternative to stars; same underlying score.

Recommendation: **stars as the headline, with the underlying metric breakdown
and a par target always visible.** A teaching tool should never show only a
score — it should show *why*.

---

## 7. Teaching feedback (the pedagogy payload)

What separates this from a generic coding puzzle is the post-run feedback:

- **Metric breakdown vs. par** — show each metric next to the target, with the
  weak one highlighted, so the player knows *what* to fix.
- **Visual flags during the run** — a passenger whose wait crosses a threshold
  turns from yellow to red; the player sees starvation happen.
- **Targeted hints (tiered, never the answer)** — pattern-detect common mistakes
  from the run trace and nudge in tiers: restate the goal/concept, then point at
  the specific symptom in their run, then name the technique. E.g. "your
  elevator passed a waiting passenger heading the same direction — look up the
  LOOK algorithm," or "you reversed direction with calls still ahead."
- **Replayable runs** — let the player re-watch the exact run that produced a
  score, at any speed, to debug behavior visually.
- **Worked reference algorithms (spoiler-gated)** — the naive FCFS baseline may
  be offered as a starting strawman so nobody faces a blank page, but the solving
  algorithms (LOOK and beyond) stay behind an opt-in, earned spoiler: revealed
  only after the level is cleared or via an explicit "show me one approach"
  action — never loaded by default.

All of this feedback is computed locally from the deterministic run trace — no
network or AI required. Build it behind a clean feedback interface, though, so a
later, optional, bring-your-own-key generative provider (see `CLAUDE.md`) can
slot in to add plain-English run explanations and richer prose without touching
the engine or the local analyzer. That layer is never bundled and never required
to play or to receive core feedback.

---

## 8. Level progression

One new idea per level; each level's twist is chosen to break the strategy that
won the previous one.

| Lvl | Setup | New concept | Why the old strategy breaks |
|---|---|---|---|
| 1 | 1 car, 5 floors, light random traffic | the loop; basic dispatch | (intro — FCFS clears it) |
| 2 | 1 car, 10 floors, moderate traffic | sweeping (SCAN/LOOK) | FCFS thrashes up and down |
| 3 | 1 car, up-peak (lobby → up) | directionality, batching | naive sweep wastes the down trip |
| 4 | 1 car, mixed up/down | serving both directions, anti-starvation | one-direction bias strands people |
| 5 | 1 car, small capacity, bursty | load management, return trips | car fills; you must leave people |
| 6 | 2 cars, independent calls | coordination / assignment | both cars chase the same call |
| 7 | 2–3 cars, tall building | zoning / express / destination dispatch | naive assignment idles cars |
| 8 | multi-car + rush + capacity | holistic optimization | everything at once |
| 9+ | curveballs | priority/VIP calls, out-of-service floor, energy budget, random surges | forces robustness |

Levels are data (`levels.js`): floor count, car count, capacity, traffic
profile + seeds, scoring weights, and star thresholds. Adding a level is editing
data, not code — important for iterating on difficulty.

**Tuning note:** every level needs a reference solution run to set honest star
thresholds. Build the level, run FCFS/LOOK/par against it, and derive thresholds
from those numbers. This is why the reference algorithms (§4) are infrastructure,
not just examples.

---

## 9. Build roadmap

Phased so there's a runnable, testable artifact at every step. Each phase has a
definition of done (DoD).

**Phase 0 — Project setup. ✅ DONE.** Repo, file layout, `index.html`, ES-module
loading, a tiny dev server for local testing.
*DoD met:* Canvas renders, modules load with no build step.

**Phase 1 — Simulation core (headless). ✅ DONE.** Domain model, fixed-tick engine,
seeded passenger generation, command resolution, metric collection, the built-in
FCFS + LOOK reference controllers, multi-seed scoring + reference-anchored stars,
and unit tests.
*DoD met:* runs a level headless with deterministic metrics; tests pass on repeat
runs with the same seed.

**Phase 2 — Visualization. ✅ DONE.** Canvas renderer for shaft(s)/car(s)/waiting
passengers (who warm calm→amber→red as they wait), interpolated animation
decoupled from ticks via recorded per-tick frames, and run/pause/step/speed/scrub
controls.
*DoD met:* watch a reference (or your own) algorithm drive a level at adjustable
speed.

**Phase 3 — Player code + sandbox. ✅ DONE.** Web Worker harness with a timeout
watchdog, the algorithm API running off the main thread, friendly error/warning
surfacing, and an in-page code editor. (Editor note: shipped as a lean,
offline, zero-dependency editor — textarea + syntax-highlight overlay + line
numbers — behind a swappable `createEditor()` wrapper, rather than vendoring
CodeMirror, to honor the no-build/offline/lean constraints; CodeMirror/Monaco can
drop in later through the same wrapper.)
*DoD met:* write a controller in the editor, run it sandboxed, watch it drive the
car; infinite loops are caught and reported, not fatal.

**Phase 4 — Scoring, stars + the reference gallery. ✅ DONE.** Scoring/stars are
in place from Phase 1 (composite score, multi-seed runs, reference-anchored
thresholds, results screen with the metric breakdown and feedback). This phase
added the **reference-algorithm gallery and comparison tool**:
- Built-in reference controllers in `src/reference/` — **FCFS, SSTF, SCAN, LOOK**
  (the elevator-scheduling family), each a clean, well-commented teaching artifact
  with a name, the concept it illustrates, and a blurb. (C-SCAN shipped here
  originally but was dropped when direction-aware boarding landed — a one-directional
  disk scheme can't pick up down-bound riders on a real bidirectional tower.)
- **One-click insert:** load any reference's source straight into the code editor
  to run, watch, and tinker with it.
- **Compare all:** run all the references on the *current* level and show their
  metrics/stars side by side, with the ability to visualize any of them in the
  Canvas — so a learner can feel, on any level, why one strategy beats another.
- **Spoiler-gated:** the gallery is a clearly-labeled, collapsed-by-default
  "reference approaches (spoilers)" panel — never shown by default; revealing it
  is the explicit opt-in the doctrine requires. FCFS is the sanctioned strawman;
  the four solving algorithms are the gated spoilers.
*DoD:* from any level, open the gallery, insert/compare/visualize the reference
algorithms and see accurate, reproducible stars and a par comparison.

**Phase 5 — Progression + persistence. ✅ DONE.** Level select with per-level star
badges and lock state, unlock logic (a level opens once the previous earns ≥ 1★),
`localStorage` for progress / best stars / per-level code, a "level unlocked"
toast, and resuming the last-played level on reload.
*DoD met:* progress and saved code survive a reload; levels unlock on ≥ 1★.

**Phase 6 — Content + polish. ✅ DONE.** The full eleven-level set (single-car →
multi-car → zoned skyscraper) plus visual polish. The remaining first-run
*onboarding tutorial* was deliberately deferred into **Phase 7**, where it can be
built once on top of the new guidance surface (tiered hints + concept/docs) instead
of being hand-rolled now and reworked later. Levels landed in staged PRs:
- **6A (done):** single-car curriculum — L3 up-peak, L4 hotel traffic, L5 small
  capacity, L6 tall high-rise (18 floors); adds the `hotel` spawn type.
- **6B (done):** multiple elevators — three coordination levels (L7 two-car
  "drive both," L8 three-car surge "dispatch the cars," L9 16-floor three-car
  tower with distance back on the scoreboard); all four reference controllers
  and the starter are now N-car aware (each waiting call is dispatched to the
  best-placed car, then each car runs its own strategy) and reduce exactly to
  the old single-car behavior when `numElevators === 1`.
- **6C (done):** zoned skyscraper — per-car floor ranges (`level.elevators[i] =
  {minFloor,maxFloor}`, zones tiling the building and overlapping on a shared
  sky-lobby) + a sky-lobby transfer model (a car carries a rider only as far as its
  range, dropping cross-building riders at the boundary to re-board the next zone's
  car; tracked via `finalDest`/`curOrigin`/`legTarget`, leaving `origin`/`dest`
  untouched so single-zone runs stay byte-identical). All references + starter became
  range-aware. Renderer shades zones and marks the sky-lobby. Levels L10 (20-floor,
  two zones) and L11 (24-floor, four-car capstone: two cars per zone).
- **Polish (done):** responsive layout — the page now reflows from the two-column
  desktop view (brief over the building on the left, editor/results on the right) to
  a single column on narrow screens, re-ordered to brief → editor → building so a
  phone user reads, writes, then watches; plus an inline (offline-safe) favicon and a
  meta description.
- **Deferred to Phase 7:** the first-run onboarding tutorial and the deeper
  educational layer (tiered hints, a concept/docs panel, richer post-run feedback).
*DoD met:* a new player can go from level 1 to the end on in-game guidance (briefs +
starter comments + the spoiler gallery); the onboarding tutorial in Phase 7 will make
that first run smoother still.

**Phase 7 — Pedagogy & educational depth. ✅ DONE.** Phase 6 makes the game
*complete*; Phase 7 makes it *teach*. This was the priority phase — everything in it
is judged against the one question from the doctrine (CLAUDE.md): does it help someone
*understand*? It was deliberately sequenced ahead of the engagement/sharing features
(now **Phase 8**). Shipped in staged PRs, like Phase 6:

- **7A — the guidance surface (done):** a local, frame-based run analyzer
  (`src/game/analyzer.js`) that detects named anti-patterns from the recorded run
  (stranded, starvation, passed-a-same-direction-call, over-travel, high wait, idled
  with work pending) and maps each to a non-spoiler, concept-linked message;
  **tiered hints** (`src/game/hints.js`, `ui.renderHints`) — Hint 1 the idea, Hint 2
  the analyzer's symptom-in-*your*-run, Hint 3 the technique — revealed one rung at a
  time, opt-in, never the answer; and **analyzer-driven post-run feedback** that names
  the single highest-impact thing and compares to par *and* the player's own previous
  best. Rules are data/heuristics, decoupled and tested (`test/analyzer.test.js`).
- **7B — A/B compare two algorithms side by side (done)** — the anchor feature
  (detailed below). Pick two of {your code, the four references}; both run on the same
  level + seed (seed 1, recorded) and replay in two buildings driven by one synced
  clock (`src/render/syncplayer.js`). A local curator (`src/game/compare.js`) reads the
  two deterministic frame streams and surfaces a ranked, timeline-ordered handful of
  **notable moments** — the directional fork, a rider left behind (fairness), commit
  vs. thrash, who finishes first, biggest spread — each a non-spoiler note with a tick
  the synced replay jumps to. Quiet when the two runs are near-identical. Tested in
  `test/compare.test.js`.
- **7C — concept/docs panel + onboarding + worked references (done):**
  - *A concept note* (`src/game/concepts.js`) — a collapsed "the concept" line on each
    brief naming the CS idea (scheduling, SCAN / LOOK, dispatch, zoning + sky-lobby)
    with a "read more" link out. Always available, distinct from the run-aware hints.
  - *First-run onboarding* — a one-time welcome overlay (4-step loop walkthrough),
    persisted via a `localStorage` flag and reopenable from a header "How it works"
    button; dismissed by button / Escape / backdrop.
  - *Earned, opt-in worked references* — each gallery algorithm has a `howItWorks`
    walkthrough; the naive baseline (FCFS) is free, the solving algorithms' are shown
    only once the level is cleared (≥ 1★) or via an explicit "reveal anyway" confirm.
  - Content is data and guarded by `test/content.test.js` (completeness + non-spoiler).

*A/B compare two algorithms side by side.* Replay two algorithms (the player's vs a
reference, or two references) on the **same level and the same seed**, with their
two buildings playing in sync. Crucially, the seed is **seed 1 only** — that's the
single run we visualize/replay — so the tool can pre-compute the comparison from the
two deterministic traces.

The headline feature is **notable-moment callouts**: a curated timeline of the few
*genuinely interesting* points where the two algorithms diverge, so the learner knows
exactly where to look instead of staring at the whole run. Each marker jumps the
synced replay to that tick with a short, non-spoiler note ("here the down-bound car
declines the up-rider and comes back for them, while the other grabs them and gets
dragged the wrong way"). It is **curated, not exhaustive** — detect candidates from
the traces, rank by teaching value, and surface only the standout handful, never
every tick. What counts as notable (the kinds of moments worth flagging):

- **Divergent boarding / the directional fork** — one car picks up a rider the other
  deliberately passes (e.g. a down-committed car declining an up-rider, then serving
  them on the return sweep). This is the SSTF-vs-LOOK floor-3 moment.
- **Wrong-way detour** — one algorithm carries a rider *away* from their destination
  (greedy thrash) while the other gives a direct ride.
- **Commit vs. thrash** — one holds its sweep direction where the other reverses to
  chase a nearer call.
- **Fairness / starvation** — a rider's wait crosses the amber/red threshold under one
  algorithm but not the other (the worst-case-vs-average trade-off made visible).
- **Big positional divergence** — at the same tick the two cars are serving very
  different parts of the building, or one finishes well ahead of the other.

Computed locally from the two recorded traces (no network, no AI — consistent with the
local-first feedback doctrine in §7); the analyzer that finds and ranks these moments
is the natural extension of the per-run anti-pattern analyzer. Pedagogically this is
"show, don't tell" plus the "observe the algorithms" goal: point the learner at the
exact instants where the choice of algorithm changes the outcome.

(Also possible later, behind the feedback interface: optional Monaco editor and an
optional bring-your-own-key generative provider for plain-English run/compare prose —
additive only, never bundled, never required. Because it deepens *explanation*, it
belongs with the Phase 7 pedagogy work, not the Phase 8 sharing features.)

**Phase 8 — Bonus: elevators that go sideways.** Pure fun, not curriculum. A friend
asked, "what if elevators could travel horizontally?" — so these bonus levels add a
second axis: a car can move not just up/down between floors but left/right along a
floor. Two themed levels, inspired by Roald Dahl's Great Glass Elevator and the
Gringotts mine-carts:

- **Always open.** Unlike the eleven curriculum levels (which unlock one at a time),
  the bonus levels are playable from the start — no clearing required. They sit apart
  from the unlock ladder; they're a sandbox to mess around in.
- **The new capability — a 2-D building.** A level can declare a grid (floors ×
  columns). A car has a `{floor, col}` position and gains two commands, `MOVE_LEFT` /
  `MOVE_RIGHT`, alongside the existing `MOVE_UP` / `MOVE_DOWN`. This is **additive**:
  any level without a grid is one column wide and behaves byte-for-byte as before
  (the same discipline that kept zoning and transfers from disturbing the older
  levels). Boarding on a grid is simplified for fun — a stopped car picks up whoever
  is waiting in its cell — rather than the directional-collective rule, which has no
  natural meaning in two dimensions.
- **The two levels.**
  - *The Great Glass Elevator* — one free-roaming car on an open grid, whimsical
    sparse traffic, "go anywhere" movement.
  - *Gringotts* — a deeper, busier grid with several carts shuttling between a lobby
    column and clustered vaults.
- **Honest stars, still.** Each bonus level ships with grid-aware reference
  controllers (a naive baseline + a solid Manhattan-distance dispatcher) so the
  1★/3★ thresholds stay reference-anchored, exactly like the curriculum.
- **Renderer.** A 2-D grid view (rooms in a grid, a car that slides both ways) for
  grid levels; the vertical-shaft renderer is untouched for the curriculum.

*DoD:* from the start, a player can open either bonus level and write a controller
that drives a car up/down AND left/right to deliver everyone; stars are
reference-anchored; none of the eleven curriculum levels change.

**Phase 9 — Elevator music: a procedural radio. ✅ DONE.** It's an elevator game; it
should have elevator music. This phase adds ambient, *programmatically generated* music with
a floating mute control and a GTA / Forza-style station picker — six "radio stations,"
each a different genre, each synthesized live in the browser. Pure atmosphere and fun;
it must never get in the way of playing or learning.

*Hard constraint — generate, never ship audio.* No `.wav` / `.mp3` / `.ogg` assets and
no streamed audio: every station is synthesized at runtime with the Web Audio API
(oscillators, a noise source, envelopes, filters, a small step sequencer / arpeggiator,
and synthesized drums). This keeps us fully client-side and offline (consistent with
the no-server / vendor-locally doctrine) and — because nothing is a recording — sidesteps
licensing entirely. For the same reason every station gets a **generic, descriptive,
non-trademarkable name** (no real station, label, artist, or brand references).

- **The synth engine** (`src/audio/`, behind a thin interface like the editor and the
  feedback provider). A small generative core: a master gain + mute, a tempo clock, a
  scheduler that looks ahead and queues notes (the standard Web-Audio "tick ahead with
  setTimeout, schedule precisely on the audio clock" pattern), and a few voice types
  (poly synth, bass, pad, arp, and noise-based drums). A **station** is data: a scale /
  key, tempo, chord progression, instrument palette, and drum pattern, plus a seeded
  RNG so each station improvises endlessly without repeating a short loop. The engine
  is DOM-free and swappable; the widget just tells it `play()`, `mute()`, `setStation()`.
- **The six stations** (names and recipes are a starting point, all tunable). Each is a
  distinct genre realized purely from synthesis:
  1. *Lobby Lounge* — the classic "elevator muzak": soft electric-piano / vibe arps,
     brushed light percussion, lush major-7th chords, slow. (The on-theme default.)
  2. *Velvet Hour* — smooth jazz / bossa: warm chords, walking-ish bass, swung brushes.
  3. *Corner Pocket* — boom-bap hip-hop: swung synth drums, dusty Rhodes-style chords,
     a laid-back ~85 BPM groove.
  4. *Night Circuit* — synthwave / electronic: saw-wave bass, bright arpeggios, a
     four-on-the-floor kick and hats, minor key.
  5. *Big Hair Boulevard* — '80s hair-rock: distorted square-wave power chords, driving
     drums, a pentatonic lead.
  6. *Eight-Bit Express* — chiptune: pure square / triangle waves and fast arpeggios, in
     the spirit of old game audio (and the most naturally "generated" of the lot).
- **The floating widget.** A small, draggable, always-reachable control that floats
  over the page: a mute / unmute toggle, the current station name, and prev / next (or a
  compact dropdown) to flip between stations — the car-radio feel. Keyboard-operable and
  labelled for screen readers; never covers the editor or Run button at common sizes.
- **Autoplay-safe and polite.** Browsers block audio until a user gesture, and surprise
  audio is hostile — so music is **muted/off by default** and only starts on an explicit
  unmute. It pauses when the tab is hidden (Page Visibility) and stays out of the way; a
  gentle default volume. (There's no `prefers-reduced-motion` analog for sound, so the
  always-available mute and off-by-default behavior are the accessibility story.)
- **Remembered settings.** Persist the player's audio choices — muted/on, chosen
  station, volume — in `localStorage` (a `settings` block in the existing store) so they
  carry across visits. **Fold the onboarding state in here too:** dismissing the welcome
  ("Let's go") already sets a persisted flag (Phase 7C), but Phase 9 should *verify it
  survives a reload* and unify it with the new settings so a returning player is never
  re-shown the intro and never has to re-set their radio.
- **Testing.** Audio output can't be asserted headlessly (no Web Audio in Node), so tests
  cover the data + persistence layer: the station registry (exactly six, unique generic
  names, each with a complete generator recipe), the settings store (mute / station /
  volume round-trip, and onboarding-seen persistence), and a headless-browser smoke check
  that the engine constructs an `AudioContext` and starts/stops without throwing. The
  synth core stays decoupled so it's swappable and never blocks the UI thread.

*DoD:* the game plays silently by default; one click unmutes procedurally-generated
music; a floating widget mutes/unmutes and switches among six generically-named,
synthesized stations; and mute state, chosen station, and "onboarding seen" all persist
across reloads. No audio files ship; nothing about gameplay, scoring, or the engine
changes.

**Phase 10 — Seed transparency & a seed switcher. ✅ DONE.** Right now the score is the average
over a level's fixed seeds (`[1,2,3,4,5]`) but the player can't *see* that: only seed 1
is ever visualized, and the per-seed numbers are invisible behind the aggregate. This
phase makes the multi-seed nature legible and explorable, and revisits whether five
seeds is the right number.

- **Make the aggregate honest and visible.** After a run, show a small **per-seed
  breakdown** alongside the averaged result — each seed's key metrics and stars — with a
  one-line explanation ("your score is the mean across these N runs, so you can't get
  lucky with one passenger sequence"). This directly answers the standing "overfitting
  to seeds" risk in §10.
- **A seed switcher on the visualization.** Today the replay is hardwired to
  `recordSeed = seeds[0]`. Add a control (a row of seed chips / a dropdown) to pick
  which seed to watch; selecting one re-runs *just that seed* with recording on and
  loads it into the existing replay. Player code re-runs through the sandbox worker;
  references re-run on the main thread. We keep recording a single seed at a time
  (re-run on demand) rather than fattening every run's payload with frames for all
  seeds — the replay path and memory stay as they are.
- **Watch the references per seed too.** The gallery's "watch" already records on
  demand; route it through the same seed selection so a learner can compare their car
  and a reference on the *same* seed they're studying.

*How many seeds? (decided: eight.)* Five is a defensible minimum but a little thin for
fairness, so we're moving every level from five scoring seeds to **eight**. Two
clarifications shaped the call:

- **More seeds ≠ a busier scenario.** Each seed already generates a full random
  passenger set; adding seeds doesn't make any single run more dynamic — it makes the
  *average* more representative and harder to overfit. If a scenario itself feels too
  tame, that's a spawn-count / traffic-shape change for that level, not a seed-count
  change. (Worth a separate pass if levels feel samey.)
- **The ceiling is the worker's time budget, not correctness.** Each extra scoring seed
  is one more full simulation per Run, inside the sandbox watchdog (`budgetMs`, ~4 s).
  The heavy levels (tall towers, the 24-floor capstone, long time limits) are the
  binding constraint — too many seeds there risks a *valid* solution falsely timing out.

  So we land on **eight** scoring seeds: a real anti-overfitting gain (the standard
  error of the mean shrinks ~1/√n, so the jump from five is worthwhile while returns
  past ~ten flatten), while staying comfortably inside the watchdog even on the heaviest
  level (verify by measuring the eight-seed run time on the 24-floor capstone; if it
  ever crowds the budget, fall back to a per-level seed count rather than dropping below
  eight elsewhere). Since the reference-anchored thresholds and the broad-seed delivery
  guards already hold across seeds 1–60, eight is safe — but re-run them after the change
  to be sure. A larger pool of **practice seeds** the player can stress-test against
  *without* every one counting toward the score (and hiding which seeds are the scored
  ones, per §10) is a worthwhile follow-on, but not required for this phase.

*DoD:* every level scores over **eight** seeds (up from five), verified within the
worker budget with star thresholds still honest; after a run the player can see each
scored seed's result and click any seed to watch it in the replay (their algorithm or a
reference); the engine and determinism are unchanged.

**Phase 11 — Tutorial mode: from naive to LOOK, one idea at a time.** A guided,
opt-in track that derives the elevator algorithm step by step: start with the naive
first-come-first-served controller, run it, *see* what goes wrong, fix that one thing,
run again, and repeat until you've built your way up to a strong algorithm (LOOK, with
SSTF shown as the greedy contrast). This is the hand-held counterpart to the
struggle-first curriculum — likely **two-plus phases**, so it's planned as a framework
(Phase 11) and then additional tracks (Phase 12).

*Reconciling with the doctrine (this is the crux).* CLAUDE.md is firm: productive
struggle, never paste the solution into a brief/hint/starter, spoilers are opt-in and
earned. A step-by-step walkthrough is the opposite of that — so the tutorial is treated
as the **sanctioned, opt-in exception**, the interactive sibling of the already-allowed
"show me one approach (spoiler)" action. It never replaces or pre-empts the curriculum
(you choose to enter it), and it preserves as much struggle as it can *inside* each
step: a step states the problem and the idea, invites you to make the change yourself,
and only reveals the exact change on a "show me" request. It also **shows rather than
tells** by reusing what Phases 7 + 10 already built — the run analyzer to *diagnose* the
problem from your real run, A/B compare to put this step's run next to the previous
one, the concept notes, and the tiered-hint voice — so each step is a felt before/after,
not a wall of prose.

*The track (single-car), each step one concrete idea + one scoped change:*
1. **FCFS** — serve one call at a time in arrival order (the shipped baseline). Run it;
   the analyzer names the symptom: it backtracks and drives past riders going its way.
2. **Collective pickup** — stop for same-direction riders as you pass them. (One change;
   watch average wait fall.)
3. **Commit to a direction (sweep / SCAN)** — keep a heading, serve everyone that way,
   reverse at the ends.
4. **Turn around early (LOOK)** — reverse the moment nothing's left ahead instead of
   running to an empty end; watch the distance drop.
5. **SSTF, as a contrast** — the greedy "nearest call" alternative: often a lower
   average wait, but it thrashes and can starve a far call. Names the trade-off rather
   than crowning a single "best."

*Architecture (reuse, don't reinvent).*
- **Content is data** (like levels / hints / concepts): a `tutorials` set of ordered
  steps; each step carries its intro, the named concept, the starting code (the prior
  step's solution), the scoped task, a revealable target ("show me the change"), and a
  success check (a metric improvement over the previous step, not a fixed number).
- Runs on **one fixed scenario + seed** so every step's before/after is reproducible and
  the improvement is unambiguous (no eight-seed averaging here — this is a lesson, not a
  score).
- **Every step is verified by code, not vibes:** each step's starting and target code
  compiles and runs, and each target measurably improves on the previous step on the
  fixed scenario, ending at LOOK-level performance — the same "ships with a reference
  solution" guarantee the levels have, applied to the lesson.
- **Staged delivery:** 11A — the tutorial data model + the step engine (advance / reveal
  / success-check) + verification tests, no UI; 11B — the guided UI (a tutorial panel:
  step intro, seeded editor, Run→diagnose, "show me the change", "next" gated on the
  success check, "exit"), with progress persisted in settings; 11C — the before/after
  view (this step vs last via the A/B machinery) + polish and the SSTF contrast.

*DoD (Phase 11):* from an opt-in entry point a learner is walked from FCFS to LOOK on a
fixed scenario; each step diagnoses the prior run's problem (via the analyzer), asks for
one scoped change (revealable on request), and shows a measurable improvement; tutorial
progress persists; the curriculum and its struggle-first default are untouched.

**Phase 12 — More tutorial tracks.** Once the framework exists, add tracks for the later
ideas on the same rails: **multi-car dispatch** (one car → several cars that bunch →
assign calls so they cover the building) and the **zoned skyscraper / sky-lobby
transfer**. Optional, additive, and a natural home for the bring-your-own-key generative
prose (richer plain-English step explanations) noted under Phase 7 — additive only,
never required.

---

## 10. Risks and open questions

- **Infinite-loop / runaway code** — mitigated by the Worker + watchdog, but
  needs real testing (tight loops, `while(true)`, huge allocations). Validate
  early in Phase 3.
- **Overfitting to seeds** — multi-seed scoring helps; may also want to hide the
  exact scoring seeds and show only practice seeds.
- **API ergonomics** — the `step`/command contract should get in front of a real
  learner ASAP (end of Phase 3). Awkwardness here undermines the whole tool.
- **Difficulty tuning** — depends entirely on good reference solutions per level;
  budget time for this in Phase 6.
- **Movement-model edge cases** — mid-shaft commitment, door-timing during
  direction changes, simultaneous arrivals. Nail these in Phase 1 tests.
- **Message-passing overhead** — per-tick main↔worker chatter could dominate at
  max speed; if so, switch to "run the whole sim in the worker, return a command
  log." Decide with a profile, not a guess.
- **Scope creep on multi-elevator** — the array-of-elevators API from day one is
  the hedge; resist adding car features until the single-car game is fun.

---

## 11. Stack summary

- **Runtime:** HTML5 + Canvas 2D, vanilla ES modules. No framework.
- **Editor:** CodeMirror 6, vendored locally (prebuilt ESM bundle in-repo, no
  CDN). Monaco optional, later.
- **Sandbox:** Web Workers + main-thread timeout watchdog.
- **Persistence:** `localStorage`; levels and content as data modules.
- **Tests:** plain assertions over the deterministic engine (run in Node or the
  browser); no heavy framework required.
- **Feedback:** local, rule-based analyzer over the deterministic run trace;
  optional bring-your-own-key generative provider behind a clean interface,
  later (never bundled, never required).
- **Hosting:** any static host (GitHub Pages, Netlify, etc.). No server-side
  process.
```
