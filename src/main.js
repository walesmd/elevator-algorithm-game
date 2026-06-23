// main.js — wires it together: brief -> editor -> run (sandboxed) -> watch + results.
//
// Phase 3: the player's code now runs in a sandboxed Web Worker (src/sandbox/),
// off the main thread, behind a watchdog — an infinite loop ends the run with a
// friendly message instead of freezing the tab. The worker runs the deterministic
// engine across every seed and records one seed's frames; the trusted scoring/stars
// math stays here on the main thread (game/scoring.js), and the recorded frames
// feed the Phase-2 Canvas replay. The editor is a lean wrapper (render/editor.js)
// so a heavier editor can swap in later without touching this file.

import { levels } from './game/levels.js';
import { scoreFromPlayerRuns, scoreLevel } from './game/scoring.js';
import { runSimulation } from './engine/simulation.js';
import { saveResult, getBest, saveCode, loadCode } from './game/progress.js';
import { renderBrief, renderResults, renderComparison } from './game/ui.js';
import { createRenderer } from './render/renderer.js';
import { createPlayer } from './render/playback.js';
import { createEditor } from './render/editor.js';
import { createHarness } from './sandbox/harness.js';
import { gallery, getReference } from './reference/gallery.js';

// A deliberately naive starter — the sanctioned "strawman". It serves the oldest
// call and drops riders, one errand at a time. It works, but it's beatable on
// purpose. The good algorithms are NOT shipped here.
const STARTER_CODE = `// You write createController. The engine calls step(state) each tick and you
// return one command per elevator: MOVE_UP, MOVE_DOWN, STOP, or IDLE.
//
// state.elevators[0] = { floor, ready, load, capacity, carCalls, ... }
// state.hallCalls    = [ { floor, direction }, ... ]  // people waiting
//
// This starter just chases the oldest call. Can you make riders wait less?
function createController(config) {
  return {
    step(state) {
      const e = state.elevators[0];
      if (!e.ready) return [{ action: 'IDLE' }];

      // Where are we headed? Drop a rider if we have one, else the oldest call.
      let target = null;
      if (e.load > 0) target = e.carCalls[0];
      else if (state.hallCalls.length > 0) target = state.hallCalls[0].floor;

      if (target == null) return [{ action: 'IDLE' }];
      if (e.floor < target) return [{ action: 'MOVE_UP' }];
      if (e.floor > target) return [{ action: 'MOVE_DOWN' }];
      return [{ action: 'STOP' }];
    },
  };
}
`;

let currentLevel = levels[0];
let els = null;
let editor = null;
let harness = null;
let running = false;
let galleryReady = false;
const viz = { renderer: null, player: null, speed: 1 };

async function run() {
  if (running) return; // ignore re-entry while a run is in flight
  const level = currentLevel; // the run belongs to THIS level; the worker is async
  const code = editor.getValue();
  saveCode(level.id, code);
  setRunning(true);

  try {
    const res = await harness.score({ code, level, seeds: level.seeds, recordSeed: level.seeds[0] });
    if (currentLevel !== level) return; // switched levels mid-run — drop the stale result
    const result = scoreFromPlayerRuns(level, res.perSeed.map((p) => p.metrics), res.warnings);
    saveResult(level.id, result.stars, result.composite);
    renderResults(els.results, result, getBest(level.id));
    if (res.frames && res.frames.length) {
      visualize(res.frames, level.seeds[0], result.metrics.total);
    }
  } catch (err) {
    if (currentLevel !== level) return; // a failure for a level we already left
    renderResults(els.results, { error: messageOf(err), errorTitle: titleFor(err) });
    resetStage(); // don't leave a prior successful replay animating under an error
  } finally {
    setRunning(false);
  }
}

function setRunning(on) {
  running = on;
  els.runBtn.disabled = on;
  els.runBtn.textContent = on ? 'Running…' : 'Run';
  // Freeze the gallery while a sandboxed run is in flight, so a Watch/Compare can't
  // clobber the replay/HUD that the pending run is about to populate.
  els.compareBtn.disabled = on;
  for (const b of els.galleryList.querySelectorAll('button')) b.disabled = on;
  if (on) els.results.innerHTML = '<p class="hint">Running your algorithm in a sandbox…</p>';
}

function messageOf(err) {
  if (err && typeof err === 'object' && err.message) return err.message;
  return String(err);
}

function titleFor(err) {
  switch (err && err.kind) {
    case 'timeout': return 'Your code timed out';
    case 'syntax': return "Your code didn't compile";
    case 'load': return 'Your code crashed before the run started';
    case 'shape': return "Your code isn't set up right";
    case 'worker': return "The sandbox couldn't start";
    case 'runtime': return 'Your code hit an error mid-run';
    default: return "Your code didn't run";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Hand the recorded frames to the player to replay. We watch the first scoring
// seed; the score itself is the average across all seeds, so the view is one
// honest slice of what was measured.
function visualize(frames, vizSeed, total) {
  if (viz.player) viz.player.destroy();
  viz.player = createPlayer(frames, viz.renderer, { onFrame: updateHud, onEnd: syncPlayPause });

  els.stageEmpty.hidden = true;
  els.hud.hidden = false;
  els.hudSeed.textContent = `seed ${vizSeed}`;
  els.hudTotal.textContent = String(total);
  els.scrub.max = String(viz.player.tickCount);
  els.scrub.value = '0';
  setControlsEnabled(true);

  viz.player.setSpeed(viz.speed);
  viz.player.play();
  syncPlayPause();
}

function updateHud(frame, tick) {
  els.hudTime.textContent = String(frame.t);
  els.hudDelivered.textContent = String(frame.delivered);
  els.hudTotal.textContent = String(frame.total);
  els.hudRiding.textContent = String(frame.riding);
  els.hudWaiting.textContent = String(frame.waiting.length);
  els.hudDistance.textContent = String(frame.distance);
  els.scrub.value = String(tick);
  els.tickLabel.textContent = `${tick} / ${viz.player.tickCount}`;
}

function syncPlayPause() {
  const playing = viz.player && viz.player.playing;
  els.pp.textContent = playing ? '❚❚ Pause' : '▶ Play';
  els.pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function setControlsEnabled(on) {
  els.pp.disabled = !on;
  els.step.disabled = !on;
  els.restart.disabled = !on;
  els.scrub.disabled = !on;
}

function repaint() {
  if (viz.player) viz.player.paint();
  else if (viz.renderer) viz.renderer.drawEmpty();
}

// Tear down any replay and show the static building on the current renderer. Used
// when switching levels and when a run fails (so an error isn't contradicted by a
// previous run still happily animating).
function resetStage() {
  if (viz.player) {
    viz.player.destroy();
    viz.player = null;
  }
  if (viz.renderer) viz.renderer.drawEmpty();
  els.stageEmpty.hidden = false;
  els.hud.hidden = true;
  setControlsEnabled(false);
  els.scrub.max = '0';
  els.scrub.value = '0';
  els.tickLabel.textContent = '— / —';
  syncPlayPause();
}

// --- Reference-algorithm gallery (opt-in, spoiler-gated) -------------------

// Populated lazily the first time the panel is opened (see bindControls), so the
// spoiler algorithms' descriptions aren't even in the DOM until the learner opts in.
function populateGallery() {
  els.galleryList.innerHTML = gallery
    .map(
      (g) => `<div class="algo" data-id="${g.id}">
        <div class="algo-head"><b>${escapeHtml(g.name)}</b>${
          g.spoiler
            ? '<span class="algo-tag spoiler">spoiler</span>'
            : '<span class="algo-tag base">baseline</span>'
        }</div>
        <div class="algo-concept">${escapeHtml(g.concept)}</div>
        <p class="algo-blurb">${escapeHtml(g.blurb)}</p>
        <div class="algo-btns">
          <button data-act="insert">Insert into editor</button>
          <button data-act="watch">Watch on this level</button>
        </div>
      </div>`
    )
    .join('');
}

// True unless the editor holds custom work that an overwrite would destroy. Lets
// Insert/Reset replace freely when there's nothing to lose, and ask first when
// there is. (Edits are also autosaved per level, so level-switching never loses
// work; this guards only the deliberate replace actions.)
function safeToReplaceEditor() {
  const cur = editor.getValue().trim();
  if (cur === '' || cur === STARTER_CODE.trim()) return true;
  if (gallery.some((g) => g.source.trim() === cur)) return true;
  return typeof confirm !== 'function' || confirm('Replace the code in the editor? Your current version will be overwritten.');
}

// Drop a reference's source into the editor so the player can run, watch, tinker.
function insertReference(id) {
  const ref = getReference(id);
  if (!ref || !safeToReplaceEditor()) return;
  editor.setValue(ref.source);
  saveCode(currentLevel.id, ref.source); // keep the editor and saved code in sync
  editor.focus();
}

// Bring an element into view, honoring prefers-reduced-motion.
function revealInView(el, block) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block });
}

// Replay a reference algorithm on the current level (trusted code, run on the main
// thread — no sandbox needed) and show it in the Canvas.
function watchReference(id) {
  if (running) return; // don't fight an in-flight player run for the replay/HUD
  const ref = getReference(id);
  if (!ref) return;
  const seed = currentLevel.seeds[0];
  const rec = runSimulation(currentLevel, seed, ref.createController, { record: true });
  if (!rec.frames.length) return;
  visualize(rec.frames, seed, rec.metrics.total);
  els.hudSeed.textContent = `${ref.name} · seed ${seed}`;
  revealInView(els.canvas, 'center');
}

// Score all five references on the current level and show them side by side,
// then scroll the table into view so the result is right where you're looking.
function compareAll() {
  if (running) return;
  const rows = gallery.map((g) => {
    const r = scoreLevel(currentLevel, g.createController);
    return { id: g.id, name: g.name, stars: r.stars, metrics: r.metrics, deliveredAll: r.metrics.deliveredAll };
  });
  renderComparison(els.comparison, rows);
  revealInView(els.comparison, 'start');
}

function selectLevel(level) {
  currentLevel = level;
  renderBrief(els.brief, level);
  editor.setValue(loadCode(level.id) || STARTER_CODE);
  els.results.innerHTML = '<p class="hint">Press Run to score your algorithm and watch it drive the building.</p>';
  els.comparison.innerHTML = ''; // stale: it was for the previous level
  for (const btn of els.levelBar.children) {
    btn.classList.toggle('active', btn.dataset.id === level.id);
  }
  // Build a renderer sized for THIS level's geometry, then show the static building.
  viz.renderer = createRenderer(els.canvas, level);
  resetStage();
}

function bindControls() {
  els.runBtn.addEventListener('click', run);
  els.resetBtn.addEventListener('click', () => {
    if (!safeToReplaceEditor()) return;
    editor.setValue(STARTER_CODE);
    saveCode(currentLevel.id, STARTER_CODE);
    editor.focus();
  });

  // Reveal-on-demand: build the (spoiler) gallery the first time the panel opens,
  // so gated algorithms' code/descriptions aren't in the DOM until the player opts in.
  els.gallery.addEventListener('toggle', () => {
    if (els.gallery.open && !galleryReady) {
      populateGallery();
      galleryReady = true;
    }
  });

  els.pp.addEventListener('click', () => {
    viz.player?.toggle();
    syncPlayPause();
  });
  els.step.addEventListener('click', () => {
    viz.player?.step(1);
    syncPlayPause();
  });
  els.restart.addEventListener('click', () => {
    viz.player?.restart();
    syncPlayPause();
  });
  els.scrub.addEventListener('input', () => {
    viz.player?.seek(Number(els.scrub.value));
    syncPlayPause();
  });

  // Reference gallery: insert/watch (delegated), compare-all, and watch-from-table.
  els.galleryList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.algo')?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'insert') insertReference(id);
    else if (btn.dataset.act === 'watch') watchReference(id);
  });
  els.compareBtn.addEventListener('click', compareAll);
  els.comparison.addEventListener('click', (e) => {
    const btn = e.target.closest('button.cmp-watch');
    if (btn) watchReference(btn.dataset.id);
  });
  for (const btn of els.speedBar.children) {
    btn.addEventListener('click', () => {
      viz.speed = Number(btn.dataset.speed);
      viz.player?.setSpeed(viz.speed);
      for (const b of els.speedBar.children) {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    });
  }

  // Keep the canvas crisp and correctly laid out as the panel resizes.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (viz.renderer) {
        viz.renderer.resize();
        repaint();
      }
    });
    ro.observe(els.stageWrap);
  } else {
    window.addEventListener('resize', () => {
      if (viz.renderer) {
        viz.renderer.resize();
        repaint();
      }
    });
  }
}

function init() {
  els = {
    brief: document.getElementById('brief'),
    editorMount: document.getElementById('editor'),
    results: document.getElementById('results'),
    runBtn: document.getElementById('run'),
    resetBtn: document.getElementById('reset'),
    levelBar: document.getElementById('level-bar'),
    canvas: document.getElementById('stage'),
    stageWrap: document.querySelector('.stage-wrap'),
    stageEmpty: document.getElementById('stage-empty'),
    hud: document.getElementById('hud'),
    hudSeed: document.getElementById('hud-seed'),
    hudTime: document.getElementById('hud-time'),
    hudDelivered: document.getElementById('hud-delivered'),
    hudTotal: document.getElementById('hud-total'),
    hudRiding: document.getElementById('hud-riding'),
    hudWaiting: document.getElementById('hud-waiting'),
    hudDistance: document.getElementById('hud-distance'),
    pp: document.getElementById('pp'),
    step: document.getElementById('step'),
    restart: document.getElementById('restart'),
    scrub: document.getElementById('scrub'),
    tickLabel: document.getElementById('tick-label'),
    speedBar: document.querySelector('.speeds'),
    gallery: document.getElementById('gallery'),
    galleryList: document.getElementById('gallery-list'),
    comparison: document.getElementById('comparison'),
    compareBtn: document.getElementById('compare-all'),
  };

  harness = createHarness({ budgetMs: 4000 });
  // Autosave the editor per level on every edit, so switching levels or reloading
  // never loses work (deliberate Insert/Reset are guarded separately).
  editor = createEditor(els.editorMount, {
    value: STARTER_CODE,
    onChange: (code) => saveCode(currentLevel.id, code),
  });

  for (const level of levels) {
    const btn = document.createElement('button');
    btn.textContent = level.name.split('—')[0].trim();
    btn.dataset.id = level.id;
    btn.addEventListener('click', () => selectLevel(level));
    els.levelBar.appendChild(btn);
  }

  bindControls();
  selectLevel(currentLevel);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
