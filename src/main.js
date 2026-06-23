// main.js — wires the foundation together: brief -> editor -> run -> watch + results.
//
// Scope note: for now the player's code is evaluated on the main thread via
// new Function(). That is a TEMPORARY foundation shortcut. Phase 3 moves it into
// the Web Worker sandbox (see src/sandbox/) so untrusted code can't block the
// tab and infinite loops can be timed out. The interface below (code string ->
// controller factory) is what the worker harness will implement, so swapping it
// in won't touch the engine, scorer, or the Phase-2 visualization.
//
// Phase 2 adds the live view: a Run scores the code across every seed (as before)
// AND records one representative seed with full frames, which the Canvas renderer
// replays at a watchable, scrubbable speed. Scoring and watching share the one
// deterministic engine, so what you see is exactly what was scored.

import { levels } from './game/levels.js';
import { scoreLevel } from './game/scoring.js';
import { runSimulation } from './engine/simulation.js';
import { saveResult, getBest, saveCode, loadCode } from './game/progress.js';
import { renderBrief, renderResults } from './game/ui.js';
import { createRenderer } from './render/renderer.js';
import { createPlayer } from './render/playback.js';

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
const viz = { renderer: null, player: null, speed: 1 };

function buildController(code) {
  // TEMPORARY main-thread eval (Phase 3 -> Web Worker). Surfaces syntax/runtime
  // errors so the player sees a friendly message rather than a blank run.
  const getFactory = new Function(
    `${code}\nreturn typeof createController === 'function' ? createController : null;`
  );
  const factory = getFactory();
  if (!factory) throw new Error('Define a function named createController(config).');
  return factory;
}

function run() {
  const code = els.editor.value;
  saveCode(currentLevel.id, code);

  let factory;
  try {
    factory = buildController(code);
  } catch (e) {
    renderResults(els.results, { error: e.message });
    return;
  }

  const result = scoreLevel(currentLevel, factory);
  saveResult(currentLevel.id, result.stars, result.composite);
  renderResults(els.results, result, getBest(currentLevel.id));

  visualize(factory);
}

// Record one representative seed and hand it to the player to replay. We watch the
// first scoring seed; the score itself is still the average across all seeds, so
// the view is honest about (one slice of) what was measured.
function visualize(factory) {
  const vizSeed = currentLevel.seeds[0];
  let rec;
  try {
    rec = runSimulation(currentLevel, vizSeed, factory, { record: true });
  } catch (e) {
    // The engine is defensive (it catches controller throws per tick), so this is
    // unexpected — fail soft and leave the static view rather than breaking Run.
    console.error('visualization run failed:', e);
    return;
  }

  if (viz.player) viz.player.destroy();
  viz.player = createPlayer(rec.frames, viz.renderer, { onFrame: updateHud, onEnd: syncPlayPause });

  els.stageEmpty.hidden = true;
  els.hud.hidden = false;
  els.hudSeed.textContent = `seed ${vizSeed}`;
  els.hudTotal.textContent = String(rec.metrics.total);
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

function selectLevel(level) {
  currentLevel = level;
  renderBrief(els.brief, level);
  els.editor.value = loadCode(level.id) || STARTER_CODE;
  els.results.innerHTML = '<p class="hint">Press Run to score your algorithm and watch it drive the building.</p>';
  for (const btn of els.levelBar.children) {
    btn.classList.toggle('active', btn.dataset.id === level.id);
  }

  // Reset the stage to a fresh, static building sized for THIS level's geometry.
  if (viz.player) {
    viz.player.destroy();
    viz.player = null;
  }
  viz.renderer = createRenderer(els.canvas, level);
  viz.renderer.drawEmpty();
  els.stageEmpty.hidden = false;
  els.hud.hidden = true;
  setControlsEnabled(false);
  els.scrub.max = '0';
  els.scrub.value = '0';
  els.tickLabel.textContent = '— / —';
  syncPlayPause();
}

function bindControls() {
  els.runBtn.addEventListener('click', run);
  els.resetBtn.addEventListener('click', () => {
    els.editor.value = STARTER_CODE;
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
    editor: document.getElementById('editor'),
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
  };

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
