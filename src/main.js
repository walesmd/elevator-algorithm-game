// main.js — wires the foundation together: brief -> editor -> run -> results.
//
// Scope note: for now the player's code is evaluated on the main thread via
// new Function(). That is a TEMPORARY foundation shortcut. Phase 3 moves it into
// the Web Worker sandbox (see src/sandbox/) so untrusted code can't block the
// tab and infinite loops can be timed out. The interface below (code string ->
// controller factory) is what the worker harness will implement, so swapping it
// in won't touch the engine or scorer.

import { levels, getLevel } from './game/levels.js';
import { scoreLevel } from './game/scoring.js';
import { saveResult, getBest, saveCode, loadCode } from './game/progress.js';
import { renderBrief, renderResults } from './game/ui.js';

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

function run(editor, resultsEl) {
  const code = editor.value;
  saveCode(currentLevel.id, code);
  let result;
  try {
    const factory = buildController(code);
    result = scoreLevel(currentLevel, factory);
  } catch (e) {
    renderResults(resultsEl, { error: e.message });
    return;
  }
  saveResult(currentLevel.id, result.stars, result.composite);
  renderResults(resultsEl, result, getBest(currentLevel.id));
}

function selectLevel(level, els) {
  currentLevel = level;
  renderBrief(els.brief, level);
  els.editor.value = loadCode(level.id) || STARTER_CODE;
  els.results.innerHTML = '<p class="hint">Press Run to score your algorithm.</p>';
  for (const btn of els.levelBar.children) {
    btn.classList.toggle('active', btn.dataset.id === level.id);
  }
}

function init() {
  const els = {
    brief: document.getElementById('brief'),
    editor: document.getElementById('editor'),
    results: document.getElementById('results'),
    runBtn: document.getElementById('run'),
    resetBtn: document.getElementById('reset'),
    levelBar: document.getElementById('level-bar'),
  };

  for (const level of levels) {
    const btn = document.createElement('button');
    btn.textContent = level.name.split('—')[0].trim();
    btn.dataset.id = level.id;
    btn.addEventListener('click', () => selectLevel(level, els));
    els.levelBar.appendChild(btn);
  }

  els.runBtn.addEventListener('click', () => run(els.editor, els.results));
  els.resetBtn.addEventListener('click', () => {
    els.editor.value = STARTER_CODE;
  });

  selectLevel(currentLevel, els);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
