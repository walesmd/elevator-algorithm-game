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
import { scoreFromPlayerRuns, scoreLevel, compositeOf } from './game/scoring.js';
import { runSimulation } from './engine/simulation.js';
import { saveResult, getBest, saveCode, loadCode, saveLastLevel, loadLastLevel, getFlag, setFlag, getSetting, setSetting } from './game/progress.js';
import { createRadio } from './audio/engine.js';
import { isUnlocked } from './game/progression.js';
import { renderBrief, renderResults, renderComparison, renderHints, renderSeedSwitcher, renderTutorialStep, renderTutorialResult } from './game/ui.js';
import { analyze } from './game/analyzer.js';
import { getTutorial, tutorialScenario, startCodeForStep, stepCleared, stepMetrics, tutorialPar } from './game/tutorial.js';
import { createRenderer } from './render/renderer.js';
import { createPlayer } from './render/playback.js';
import { createSyncPlayer } from './render/syncplayer.js';
import { findMoments } from './game/compare.js';
import { createEditor } from './render/editor.js';
import { createHarness } from './sandbox/harness.js';
import { gallery, getReference } from './reference/gallery.js';
import { STARTER_CODE } from './game/starter.js';

let currentLevel = levels[0];
let els = null;
let editor = null;
let harness = null;
let running = false;
let galleryReady = false;
// Tiered-hints state for the current level (reset on level switch). `revealed` is how
// many of the three rungs the player has opened; `runHint` is the analyzer's
// run-specific Hint 2, refreshed after each run.
let hintState = { revealed: 0, runHint: null };
const viz = { renderer: null, player: null, speed: 1 };
// Seed switcher (Phase 10): which seed is in the replay, and what's being shown so a
// seed click can re-run the right thing — the player's last-run code or a reference.
let vizSeed = null;
let vizSource = null; // { type:'player', code } | { type:'ref', id }
let lastRunCode = null; // the code from the most recent scored run (for seed re-runs)
// A/B compare (Phase 7B): two renderers driven by one synced player.
const cmp = { rA: null, rB: null, player: null };
let cmpSpeed = 1;
// Guided tutorial (Phase 11B): the opt-in, sanctioned walkthrough that derives the
// elevator algorithm one idea at a time. While `active`, the editor/stage/run path are
// reused but driven against the fixed tutorial scenario instead of the current level.
const TUTORIAL = getTutorial();
const tut = { active: false, index: 0, revealed: false };

async function run() {
  if (running) return; // ignore re-entry while a run is in flight
  if (tut.active) return runTutorialStep();
  const level = currentLevel; // the run belongs to THIS level; the worker is async
  const code = editor.getValue();
  saveCode(level.id, code);
  setRunning(true);

  try {
    const res = await harness.score({ code, level, seeds: level.seeds, recordSeed: level.seeds[0] });
    if (currentLevel !== level) return; // switched levels mid-run — drop the stale result
    const result = scoreFromPlayerRuns(level, res.perSeed.map((p) => p.metrics), res.warnings);

    // Diagnose the run (using the seed we visualize, so feedback matches what's shown).
    // prevBest is read BEFORE saveResult so "a new best!" is accurate.
    const prevBest = getBest(level.id);
    // Per-seed breakdown (Phase 10): surface each scored seed, with its composite so the
    // results card can flag the worst one and let the player click any seed to watch it.
    result.perSeed = res.perSeed.map((p) => ({ seed: p.seed, metrics: p.metrics, composite: compositeOf(p.metrics, level.weights) }));
    result.analysis = analyze({
      frames: res.frames || [], metrics: result.metrics, par: result.par,
      level, prevBest, stars: result.stars,
    });
    hintState.runHint = result.analysis.runHint;
    renderHints(els.hints, level, hintState); // refresh Hint 2 with this run's symptom

    // Which levels were locked before we record this result?
    const lockedBefore = levels.filter((l) => !isUnlocked(levels, l.id, starsOf));
    saveResult(level.id, result.stars, result.composite);
    renderResults(els.results, result, getBest(level.id));
    renderLevelBar(); // reflect new stars and any freshly unlocked level
    const justUnlocked = lockedBefore.filter((l) => isUnlocked(levels, l.id, starsOf));
    if (justUnlocked.length) {
      showToast(`🎉 ${justUnlocked.map((l) => l.name.split('—')[0].trim()).join(', ')} unlocked!`);
    }

    if (res.frames && res.frames.length) {
      lastRunCode = code;
      vizSource = { type: 'player', code };
      vizSeed = level.seeds[0];
      visualize(res.frames, vizSeed, result.metrics.total);
      renderSeedSwitcher(els.seedSwitcher, level.seeds, vizSeed);
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
  els.startTutorial.disabled = on; // don't let the mode toggle race an in-flight run
  // Freeze the gallery while a sandboxed run is in flight, so a Watch/Compare can't
  // clobber the replay/HUD that the pending run is about to populate.
  els.compareBtn.disabled = on;
  els.compareAbBtn.disabled = on;
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
  els.seedSwitcher.hidden = true;
  els.seedSwitcher.innerHTML = '';
  vizSource = null;
  vizSeed = null;
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
          ${g.howItWorks ? '<button data-act="how">How it works</button>' : ''}
        </div>
        <div class="algo-how" hidden></div>
      </div>`
    )
    .join('');
}

// The starter for a level — bonus (grid) levels ship their own; everyone else gets
// the standard one.
function starterFor(level) {
  return level.starter || STARTER_CODE;
}

// True unless the editor holds custom work that an overwrite would destroy. Lets
// Insert/Reset replace freely when there's nothing to lose, and ask first when
// there is. (Edits are also autosaved per level, so level-switching never loses
// work; this guards only the deliberate replace actions.)
function safeToReplaceEditor() {
  const cur = editor.getValue().trim();
  if (cur === '' || cur === STARTER_CODE.trim() || cur === starterFor(currentLevel).trim()) return true;
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

// Reveal a reference's worked explanation — EARNED: a solving algorithm's walkthrough
// is shown freely once you've cleared this level (>= 1 star), otherwise only after an
// explicit "reveal anyway" (so it stays opt-in, per the spoiler doctrine). The naive
// baseline (FCFS) isn't a spoiler, so it's always free.
function revealHowItWorks(card, id) {
  const ref = getReference(id);
  if (!ref || !ref.howItWorks) return;
  const out = card.querySelector('.algo-how');
  if (!out || !out.hidden) return; // already shown
  const earned = !ref.spoiler || starsOf(currentLevel.id) >= 1;
  if (!earned) {
    const ok = typeof confirm !== 'function' ||
      confirm('This walks through how the algorithm works. You’ll learn more by clearing the level on your own first — reveal it anyway?');
    if (!ok) return;
  }
  out.textContent = ref.howItWorks;
  out.hidden = false;
  const btn = card.querySelector('button[data-act="how"]');
  if (btn) btn.disabled = true;
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
  const seed = vizSeed && currentLevel.seeds.includes(vizSeed) ? vizSeed : currentLevel.seeds[0];
  const rec = runSimulation(currentLevel, seed, ref.createController, { record: true });
  if (!rec.frames.length) return;
  vizSource = { type: 'ref', id };
  vizSeed = seed;
  visualize(rec.frames, seed, rec.metrics.total);
  els.hudSeed.textContent = `${ref.name} · seed ${seed}`;
  renderSeedSwitcher(els.seedSwitcher, currentLevel.seeds, vizSeed);
  revealInView(els.canvas, 'center');
}

// Re-run whatever's currently shown (the player's last run, or a reference) on a chosen
// seed and load it into the replay — the heart of the seed switcher. Player code re-runs
// in the sandbox; references run on the main thread.
async function visualizeSeed(seed) {
  if (!vizSource || running) return;
  const level = currentLevel;
  vizSeed = seed;
  renderSeedSwitcher(els.seedSwitcher, level.seeds, vizSeed);
  if (vizSource.type === 'ref') {
    const ref = getReference(vizSource.id);
    const rec = runSimulation(level, seed, ref.createController, { record: true });
    if (rec.frames.length) {
      visualize(rec.frames, seed, rec.metrics.total);
      els.hudSeed.textContent = `${ref.name} · seed ${seed}`;
    }
    return;
  }
  // Player code: re-run just this seed in the sandbox to record it.
  setSeedChipsBusy(true);
  try {
    const res = await harness.score({ code: vizSource.code, level, seeds: [seed], recordSeed: seed });
    if (level !== currentLevel) return;
    if (res.frames && res.frames.length) {
      visualize(res.frames, seed, res.perSeed[0].metrics.total);
    }
  } catch (err) {
    /* a seed re-run that fails leaves the prior replay in place; the run already scored */
  } finally {
    if (level === currentLevel) setSeedChipsBusy(false);
  }
}

function setSeedChipsBusy(on) {
  for (const b of els.seedSwitcher.querySelectorAll('.seed-chip')) b.disabled = on;
}

// Score all the references on the current level and show them side by side,
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

// --- A/B compare: two algorithms, two buildings, one synced clock (Phase 7B) --

// Fill both pickers with "Your code" + the gallery algorithms. Done lazily when the
// (spoiler) gallery first opens, so reference names aren't in the DOM until opted in.
function populateCompareSelects() {
  const opts = ['<option value="__player__">Your code</option>']
    .concat(gallery.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`))
    .join('');
  els.cmpA.innerHTML = opts;
  els.cmpB.innerHTML = opts;
  els.cmpA.value = '__player__'; // a useful default: your code…
  els.cmpB.value = 'look'; // …against par (LOOK)
}

// Resolve a picker choice to a recorded run on (level, seed). The player's code runs
// in the sandbox (async); references run on the main thread (trusted, sync).
async function resolveRun(choice, level, seed) {
  if (choice === '__player__') {
    const res = await harness.score({ code: editor.getValue(), level, seeds: [seed], recordSeed: seed });
    return { frames: res.frames || [], metrics: res.perSeed[0] && res.perSeed[0].metrics, label: 'Your code' };
  }
  const ref = getReference(choice);
  const rec = runSimulation(level, seed, ref.createController, { record: true });
  return { frames: rec.frames, metrics: rec.metrics, label: ref.id.toUpperCase() };
}

async function compareAB() {
  if (running) return; // don't fight an in-flight scoring run for the worker/HUD
  const level = currentLevel;
  const seed = level.seeds[0];
  els.compareView.hidden = false;
  els.compareSub.textContent = 'Running both algorithms…';
  els.cmpMoments.innerHTML = '';
  els.compareAbBtn.disabled = true;
  revealInView(els.compareView, 'start');
  try {
    const A = await resolveRun(els.cmpA.value, level, seed);
    const B = await resolveRun(els.cmpB.value, level, seed);
    if (level !== currentLevel) return; // switched levels mid-run
    if (!A.frames.length || !B.frames.length) {
      els.compareSub.textContent = 'One side produced no run (your code may have errored or timed out). Fix it and try again.';
      return;
    }
    setupCompare(level, seed, A, B);
  } catch (err) {
    els.compareSub.textContent = `Couldn’t run the comparison: ${messageOf(err)}`;
  } finally {
    els.compareAbBtn.disabled = false;
  }
}

function setupCompare(level, seed, A, B) {
  if (cmp.player) cmp.player.destroy();
  cmp.rA = createRenderer(els.cmpStageA, level); // canvases are visible now, so they size correctly
  cmp.rB = createRenderer(els.cmpStageB, level);
  setCompareLabel(els.cmpLabelA, A.label);
  setCompareLabel(els.cmpLabelB, B.label);
  els.compareSub.textContent = `${level.name.split('—')[0].trim()} · seed ${seed} · ${A.label} vs ${B.label} (both on the same traffic)`;

  cmp.player = createSyncPlayer(
    [{ frames: A.frames, renderer: cmp.rA }, { frames: B.frames, renderer: cmp.rB }],
    { onFrame: updateCompareHud, onEnd: syncCmpPlayPause }
  );
  els.cmpScrub.max = String(cmp.player.tickCount);
  els.cmpScrub.value = '0';
  renderMoments(findMoments(A, B, level));
  cmp.player.setSpeed(cmpSpeed);
  cmp.player.play();
  syncCmpPlayPause();
}

function setCompareLabel(el, text) {
  el.querySelector('span:last-child').textContent = text;
}

function updateCompareHud(tick, per) {
  els.cmpScrub.value = String(tick);
  els.cmpTick.textContent = `${tick} / ${cmp.player.tickCount}`;
  const fmt = (p) =>
    p && p.frame
      ? `t=${p.frame.t} · delivered ${p.frame.delivered}/${p.frame.total} · riding ${p.frame.riding} · waiting ${p.frame.waiting.length} · dist ${p.frame.distance}`
      : '';
  els.cmpHudA.textContent = fmt(per[0]);
  els.cmpHudB.textContent = fmt(per[1]);
}

function syncCmpPlayPause() {
  const playing = cmp.player && cmp.player.playing;
  els.cmpPp.textContent = playing ? '❚❚ Pause' : '▶ Play';
}

function renderMoments(moments) {
  if (!moments.length) {
    els.cmpMoments.innerHTML =
      '<p class="compare-empty">These two run almost identically on this level — try two more different strategies (say, FCFS vs LOOK) to see where the choice of algorithm actually changes the outcome.</p>';
    return;
  }
  els.cmpMoments.innerHTML = `
    <h3>Notable moments</h3>
    <p class="moments-intro">The few points where the two strategies diverge. Click one to jump both replays there and watch.</p>
    ${moments
      .map(
        (m) => `<button class="moment kind-${m.kind}" data-t="${m.t}" type="button">
          <span class="moment-head"><span class="moment-jump">▶ t=${m.t}</span> <span class="moment-title">${escapeHtml(m.title)}</span></span>
          <p class="moment-note">${escapeHtml(m.note)}</p>
        </button>`
      )
      .join('')}`;
}

function closeCompare() {
  if (cmp.player) { cmp.player.destroy(); cmp.player = null; }
  cmp.rA = null;
  cmp.rB = null;
  els.compareView.hidden = true;
}

// --- Progression: level select, unlock state, persistence -----------------

const starsOf = (id) => getBest(id).stars || 0;
const starGlyphs = (n) => '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);

// Rebuild the level bar from saved progress: each level shows its best stars, the
// active one is highlighted, and a locked level is disabled with a hint to clear
// the one before it. Called on select and after every run (stars/unlocks change).
function renderLevelBar() {
  // Preserve keyboard/screen-reader focus across the rebuild (WCAG 2.4.3): note
  // which level button held focus, then restore it on the freshly-built one.
  const focusedId = els.levelBar.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  els.levelBar.replaceChildren();
  levels.forEach((level, idx) => {
    // A "Bonus" divider before the always-open bonus group.
    if (level.bonus && (idx === 0 || !levels[idx - 1].bonus)) {
      const sep = document.createElement('span');
      sep.className = 'lvl-sep';
      sep.textContent = 'Bonus';
      sep.setAttribute('aria-hidden', 'true'); // decorative; each button carries its own label
      els.levelBar.appendChild(sep);
    }
    const unlocked = isUnlocked(levels, level.id, starsOf);
    // Curriculum buttons read "Level N"; bonus buttons read their themed name.
    const name = level.bonus
      ? level.name.split('—').slice(1).join('—').trim()
      : level.name.split('—')[0].trim();
    const isActive = level.id === currentLevel.id;
    const btn = document.createElement('button');
    btn.className = 'lvl';
    btn.dataset.id = level.id;
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('bonus', !!level.bonus);
    if (isActive) btn.setAttribute('aria-current', 'page'); // mark the current level (not colour-only)
    if (unlocked) {
      const s = starsOf(level.id);
      btn.innerHTML = `${escapeHtml(name)} <span class="lvl-stars" aria-label="${s} of 3 stars">${starGlyphs(s)}</span>`;
    } else {
      // Locked: kept focusable via aria-disabled (NOT the `disabled` attribute, which
      // assistive tech skips) so a screen-reader user can reach it and hear why.
      // selectLevel() guards the click, so activating it is a no-op.
      const prevName = levels[idx - 1].name.split('—')[0].trim();
      btn.setAttribute('aria-disabled', 'true');
      btn.innerHTML = `${escapeHtml(name)} <span class="lvl-lock" aria-hidden="true">🔒</span>`;
      btn.title = `Earn at least one ★ on ${prevName} to unlock`;
      btn.setAttribute('aria-label', `${name} — locked. ${btn.title}`);
    }
    btn.addEventListener('click', () => selectLevel(level));
    els.levelBar.appendChild(btn);
  });
  if (focusedId) {
    const restore = [...els.levelBar.children].find((b) => b.dataset.id === focusedId);
    if (restore) restore.focus();
  }
}

// Where to land on load: the last-played level if it's still unlocked, else level 1.
function resumeLevel() {
  const last = loadLastLevel();
  const lvl = levels.find((l) => l.id === last);
  return lvl && isUnlocked(levels, lvl.id, starsOf) ? lvl : levels[0];
}

function selectLevel(level) {
  if (!isUnlocked(levels, level.id, starsOf)) return; // defensive — locked buttons are disabled
  currentLevel = level;
  saveLastLevel(level.id);
  renderBrief(els.brief, level);
  hintState = { revealed: 0, runHint: null }; // hints are per-level; start fresh
  renderHints(els.hints, level, hintState);
  editor.setValue(loadCode(level.id) || starterFor(level));
  els.results.innerHTML = '<p class="hint">Press Run to score your algorithm and watch it drive the building.</p>';
  els.comparison.innerHTML = ''; // stale: it was for the previous level
  closeCompare(); // the A/B view was for the previous level's geometry/traffic
  // The reference gallery + A/B compare are the up/down scheduling algorithms; they
  // don't apply to the 2-D bonus levels, so hide that whole panel there.
  els.gallery.hidden = (level.numCols ?? 1) > 1;
  renderLevelBar();
  // Build a renderer sized for THIS level's geometry, then show the static building.
  viz.renderer = createRenderer(els.canvas, level);
  resetStage();
}

// --- Phase 9: procedural elevator-music radio ----------------------------------

let radio = null;

function setupRadio() {
  radio = createRadio({
    stationId: getSetting('audioStation', 'lobby-lounge'),
    muted: getSetting('audioMuted', true), // off by default — autoplay-safe, never a surprise
    volume: getSetting('audioVolume', 0.6),
  });
  renderRadio();

  els.radioMute.addEventListener('click', () => {
    const muted = radio.toggleMute(); // the click is the user gesture that lets audio start
    setSetting('audioMuted', muted);
    renderRadio();
  });
  const flip = (dir) => {
    radio.cycle(dir);
    setSetting('audioStation', radio.stationId);
    renderRadio();
  };
  els.radioPrev.addEventListener('click', () => flip(-1));
  els.radioNext.addEventListener('click', () => flip(1));

  // Hush while the tab is in the background; resume when it returns (if unmuted).
  document.addEventListener('visibilitychange', () => radio.setHidden(document.hidden));

  // A returning player who left the radio ON can't be auto-started (browsers block
  // audio until a gesture), so resume on their first interaction with the page.
  if (!radio.muted) {
    const resume = () => {
      radio.setMuted(false);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }
}

function renderRadio() {
  const muted = radio.muted;
  els.radio.classList.toggle('muted', muted);
  els.radioMute.classList.toggle('on', !muted);
  els.radioMute.textContent = muted ? '🔇' : '🔊';
  els.radioMute.setAttribute('aria-pressed', String(!muted));
  els.radioMute.title = muted ? 'Play the music' : 'Mute the music';
  els.radioName.textContent = radio.stationName;
  const st = radio.stations.find((s) => s.id === radio.stationId);
  els.radioGenre.textContent = muted ? 'muted' : (st ? st.genre : '');
}

// --- Onboarding: a one-time welcome, reopenable from the header (Phase 7C) -----

function showOnboarding() {
  els.onboarding.hidden = false;
  els.onboardingGo.focus();
}

function dismissOnboarding() {
  els.onboarding.hidden = true;
  setFlag('onboarded', true); // don't auto-show again
}

// --- Guided tutorial: an opt-in, step-by-step walk from FCFS to LOOK (Phase 11B) ---
//
// The sanctioned counterpart to the struggle-first curriculum (see CLAUDE.md + the
// Phase 11 note). It reuses the editor, the sandboxed run path, the Canvas replay, and
// the run analyzer — but swaps the brief for a lesson card, runs against ONE fixed
// scenario, diagnoses the real run, and gates "next" on actually applying the idea. The
// exact change is only ever shown on an explicit "show me" (the spoiler reveal).

const tutStepKey = (i) => `tutorialCode:${TUTORIAL.steps[i].id}`;
const clampStep = (i) => Math.max(0, Math.min(TUTORIAL.steps.length - 1, i | 0));

function enterTutorial() {
  if (tut.active || running) return;
  tut.active = true;
  closeCompare();
  els.levelBar.hidden = true; // the curriculum's level picker isn't part of the walkthrough
  els.gallery.hidden = true; // nor the spoiler gallery
  els.hints.innerHTML = ''; // the tutorial provides its own guidance
  els.startTutorial.textContent = 'Exit tutorial';
  els.startTutorial.classList.add('active');
  els.resetBtn.textContent = 'Reset step';
  // A renderer sized for the tutorial's geometry (12 floors, one car).
  viz.renderer = createRenderer(els.canvas, tutorialScenario);
  loadTutorialStep(clampStep(getSetting('tutorialProgress', 0)));
  revealInView(els.brief, 'start');
}

function exitTutorial() {
  if (!tut.active) return;
  tut.active = false;
  els.levelBar.hidden = false;
  els.startTutorial.textContent = 'Guided tutorial';
  els.startTutorial.classList.remove('active');
  els.resetBtn.textContent = 'Reset to starter';
  // Rebuild the normal brief / hints / editor / stage / gallery for the current level.
  selectLevel(currentLevel);
}

// Show a step: its lesson card, the editor seeded with the learner's saved work for this
// step (or the previous step's solution), and a clean stage. Reaching a step records it
// as progress, so re-entering the tutorial later resumes here.
function loadTutorialStep(index) {
  tut.index = clampStep(index);
  tut.revealed = false;
  const step = TUTORIAL.steps[tut.index];
  setSetting('tutorialProgress', Math.max(getSetting('tutorialProgress', 0), tut.index));
  renderTutorialStep(els.brief, { step, index: tut.index, total: TUTORIAL.steps.length, revealed: tut.revealed });
  const saved = getSetting(tutStepKey(tut.index), null);
  editor.setValue(saved != null ? saved : startCodeForStep(tut.index));
  els.results.innerHTML =
    '<p class="hint">Press <b>Run</b> to watch this step’s algorithm drive the building, then read the diagnosis.</p>';
  resetStage();
}

// Reveal the exact change for this step (the spoiler) — opt-in, per the doctrine. Drops
// the step's target code into the editor; the learner still reads it and presses Run.
function revealTutorialChange() {
  if (!tut.active) return;
  const step = TUTORIAL.steps[tut.index];
  editor.setValue(step.code);
  setSetting(tutStepKey(tut.index), step.code);
  tut.revealed = true;
  renderTutorialStep(els.brief, { step, index: tut.index, total: TUTORIAL.steps.length, revealed: true });
  editor.focus();
}

function resetTutorialStep() {
  const code = startCodeForStep(tut.index);
  editor.setValue(code);
  setSetting(tutStepKey(tut.index), code);
  editor.focus();
}

function advanceTutorial() {
  if (!tut.active) return;
  const last = TUTORIAL.steps.length - 1;
  if (tut.index >= last) {
    exitTutorial();
    showToast('🎓 Tutorial complete — now take what you built to the levels!');
    return;
  }
  loadTutorialStep(tut.index + 1);
  revealInView(els.brief, 'start');
}

// Run the current step's code in the sandbox (the editor holds untrusted, edited code),
// diagnose the real run, gate "next" on it actually applying the idea, and replay it.
async function runTutorialStep() {
  if (running || !tut.active) return;
  const step = TUTORIAL.steps[tut.index];
  const code = editor.getValue();
  setSetting(tutStepKey(tut.index), code);
  const seed = tutorialScenario.seed;
  setRunning(true);
  try {
    const res = await harness.score({ code, level: tutorialScenario, seeds: [seed], recordSeed: seed });
    if (!tut.active) return; // exited mid-run
    const metrics = res.perSeed[0].metrics;
    const analysis = analyze({ frames: res.frames || [], metrics, par: tutorialPar(), level: tutorialScenario });
    const cleared = stepCleared(step, metrics);
    const last = TUTORIAL.steps.length - 1;
    // Clearing a step unlocks the next as resume progress.
    if (cleared) setSetting('tutorialProgress', Math.max(getSetting('tutorialProgress', 0), Math.min(tut.index + 1, last)));
    const prevStep = tut.index > 0 ? TUTORIAL.steps[tut.index - 1] : null;
    renderTutorialResult(els.results, {
      metrics,
      analysis,
      cleared,
      prevStep,
      prevMetrics: prevStep ? stepMetrics(prevStep) : null,
      isLast: tut.index === last,
    });
    if (res.frames && res.frames.length) {
      vizSource = null; // no seed switcher / per-seed table in the tutorial
      vizSeed = seed;
      visualize(res.frames, seed, metrics.total);
      els.hudSeed.textContent = `tutorial · ${step.id.toUpperCase()}`;
    }
  } catch (err) {
    if (!tut.active) return;
    renderResults(els.results, { error: messageOf(err), errorTitle: titleFor(err) });
    resetStage();
  } finally {
    setRunning(false);
  }
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3500);
}

function bindControls() {
  els.runBtn.addEventListener('click', run);

  // Guided tutorial (Phase 11B): the header button toggles the mode; the lesson card
  // carries its own Exit and the spoiler reveal; "Next step" lives in the results card.
  els.startTutorial.addEventListener('click', () => (tut.active ? exitTutorial() : enterTutorial()));
  els.brief.addEventListener('click', (e) => {
    if (!tut.active) return;
    if (e.target.closest('.tut-exit')) exitTutorial();
    else if (e.target.closest('.tut-reveal')) revealTutorialChange();
  });

  // Onboarding: header button re-opens it; "Let's go" / Escape / backdrop dismiss it.
  els.howItWorks.addEventListener('click', showOnboarding);
  els.onboardingGo.addEventListener('click', dismissOnboarding);
  els.onboarding.addEventListener('click', (e) => { if (e.target === els.onboarding) dismissOnboarding(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.onboarding.hidden) dismissOnboarding();
  });

  // Tiered hints: each click reveals the next rung (capped at 3), then re-renders.
  els.hints.addEventListener('click', (e) => {
    if (!e.target.closest('.hint-reveal')) return;
    hintState.revealed = Math.min(3, hintState.revealed + 1);
    renderHints(els.hints, currentLevel, hintState);
  });

  // Seed switcher: chips on the replay, and clickable rows in the per-seed breakdown.
  els.seedSwitcher.addEventListener('click', (e) => {
    const chip = e.target.closest('.seed-chip');
    if (chip && !chip.disabled) visualizeSeed(Number(chip.dataset.seed));
  });
  els.results.addEventListener('click', (e) => {
    if (tut.active) {
      if (e.target.closest('.tut-next')) advanceTutorial(); // success-gated "next step"
      return;
    }
    const row = e.target.closest('tr.watchable');
    if (!row || !lastRunCode) return;
    vizSource = { type: 'player', code: lastRunCode }; // the breakdown is the player's run
    visualizeSeed(Number(row.dataset.seed));
    revealInView(els.canvas, 'center');
  });

  els.resetBtn.addEventListener('click', () => {
    if (tut.active) { resetTutorialStep(); return; } // reset to THIS step's starting code
    if (!safeToReplaceEditor()) return;
    const code = starterFor(currentLevel);
    editor.setValue(code);
    saveCode(currentLevel.id, code);
    editor.focus();
  });

  // Reveal-on-demand: build the (spoiler) gallery the first time the panel opens,
  // so gated algorithms' code/descriptions aren't in the DOM until the player opts in.
  els.gallery.addEventListener('toggle', () => {
    if (els.gallery.open && !galleryReady) {
      populateGallery();
      populateCompareSelects();
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
    else if (btn.dataset.act === 'how') revealHowItWorks(btn.closest('.algo'), id);
  });
  els.compareBtn.addEventListener('click', compareAll);
  els.comparison.addEventListener('click', (e) => {
    const btn = e.target.closest('button.cmp-watch');
    if (btn) watchReference(btn.dataset.id);
  });

  // A/B compare: run, close, synced transport, moment jumps, speed.
  els.compareAbBtn.addEventListener('click', compareAB);
  els.compareClose.addEventListener('click', closeCompare);
  els.cmpPp.addEventListener('click', () => { cmp.player?.toggle(); syncCmpPlayPause(); });
  els.cmpStep.addEventListener('click', () => { cmp.player?.step(1); syncCmpPlayPause(); });
  els.cmpRestart.addEventListener('click', () => { cmp.player?.restart(); syncCmpPlayPause(); });
  els.cmpScrub.addEventListener('input', () => { cmp.player?.seek(Number(els.cmpScrub.value)); syncCmpPlayPause(); });
  els.cmpMoments.addEventListener('click', (e) => {
    const btn = e.target.closest('button.moment');
    if (!btn || !cmp.player) return;
    cmp.player.seek(Number(btn.dataset.t));
    syncCmpPlayPause();
  });
  for (const btn of els.cmpSpeeds.children) {
    btn.addEventListener('click', () => {
      cmpSpeed = Number(btn.dataset.speed);
      cmp.player?.setSpeed(cmpSpeed);
      for (const b of els.cmpSpeeds.children) {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    });
  }
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
  // Keep the A/B canvases crisp on resize too (only when the compare view is open).
  const resizeCompare = () => {
    if (!cmp.player || els.compareView.hidden) return;
    cmp.rA?.resize();
    cmp.rB?.resize();
    cmp.player.paint();
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (viz.renderer) {
        viz.renderer.resize();
        repaint();
      }
      resizeCompare();
    });
    ro.observe(els.stageWrap);
    window.addEventListener('resize', resizeCompare);
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
    hints: document.getElementById('hints'),
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
    seedSwitcher: document.getElementById('seed-switcher'),
    speedBar: document.querySelector('.speeds'),
    gallery: document.getElementById('gallery'),
    galleryList: document.getElementById('gallery-list'),
    comparison: document.getElementById('comparison'),
    compareBtn: document.getElementById('compare-all'),
    // A/B compare (Phase 7B)
    cmpA: document.getElementById('cmp-a'),
    cmpB: document.getElementById('cmp-b'),
    compareAbBtn: document.getElementById('compare-ab'),
    compareView: document.getElementById('compare-view'),
    compareSub: document.getElementById('compare-sub'),
    compareClose: document.getElementById('compare-close'),
    cmpLabelA: document.getElementById('cmp-label-a'),
    cmpLabelB: document.getElementById('cmp-label-b'),
    cmpStageA: document.getElementById('cmp-stage-a'),
    cmpStageB: document.getElementById('cmp-stage-b'),
    cmpHudA: document.getElementById('cmp-hud-a'),
    cmpHudB: document.getElementById('cmp-hud-b'),
    cmpPp: document.getElementById('cmp-pp'),
    cmpStep: document.getElementById('cmp-step'),
    cmpRestart: document.getElementById('cmp-restart'),
    cmpScrub: document.getElementById('cmp-scrub'),
    cmpTick: document.getElementById('cmp-tick'),
    cmpSpeeds: document.getElementById('cmp-speeds'),
    cmpMoments: document.getElementById('cmp-moments'),
    toast: document.getElementById('toast'),
    // Onboarding (Phase 7C)
    onboarding: document.getElementById('onboarding'),
    onboardingGo: document.getElementById('onboarding-go'),
    howItWorks: document.getElementById('how-it-works'),
    // Guided tutorial (Phase 11B)
    startTutorial: document.getElementById('start-tutorial'),
    // Radio (Phase 9)
    radio: document.getElementById('radio'),
    radioMute: document.getElementById('radio-mute'),
    radioPrev: document.getElementById('radio-prev'),
    radioNext: document.getElementById('radio-next'),
    radioName: document.getElementById('radio-name'),
    radioGenre: document.getElementById('radio-genre'),
  };

  harness = createHarness({ budgetMs: 4000 });
  // Autosave the editor per level on every edit, so switching levels or reloading
  // never loses work (deliberate Insert/Reset are guarded separately). In tutorial mode
  // edits autosave per STEP instead, so the walkthrough's code never overwrites a level's
  // saved work (and the learner's in-progress step code survives a reload).
  editor = createEditor(els.editorMount, {
    value: STARTER_CODE,
    onChange: (code) => {
      if (tut.active) setSetting(tutStepKey(tut.index), code);
      else saveCode(currentLevel.id, code);
    },
  });

  bindControls();
  setupRadio();
  // The level bar is built by selectLevel -> renderLevelBar. Resume where the
  // player left off (if that level is still unlocked), else start at level 1.
  selectLevel(resumeLevel());
  // First-time visitors get the welcome overlay once; returning players don't.
  if (!getFlag('onboarded')) showOnboarding();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
