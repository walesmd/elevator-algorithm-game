// progress.js — persistence via localStorage.
//
// Stores per-level best stars/metrics and the player's last code so nothing is
// lost between sessions. Everything is guarded so the module is safe to import
// in non-browser contexts (e.g. Node tests) where localStorage doesn't exist.

const KEY = 'elevator-game:v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(data) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or unavailable — fail silently, game still works */
  }
}

export function loadProgress() {
  const data = read();
  return data.levels || {};
}

export function getBest(levelId) {
  const levels = loadProgress();
  return levels[levelId] || { stars: 0, composite: null };
}

export function saveResult(levelId, stars, composite) {
  const data = read();
  data.levels = data.levels || {};
  const prev = data.levels[levelId] || { stars: 0, composite: null };
  const better = composite != null && (prev.composite == null || composite < prev.composite);
  data.levels[levelId] = {
    stars: Math.max(prev.stars || 0, stars || 0),
    composite: better ? composite : prev.composite,
  };
  write(data);
  return data.levels[levelId];
}

export function saveCode(levelId, code) {
  const data = read();
  data.code = data.code || {};
  data.code[levelId] = code;
  write(data);
}

export function loadCode(levelId) {
  const data = read();
  return (data.code && data.code[levelId]) || null;
}

// One-shot UI flags (e.g. "has seen the welcome / onboarding"), persisted so a
// returning player isn't shown the intro again.
export function getFlag(name) {
  const flags = read().flags || {};
  return !!flags[name];
}

export function setFlag(name, value = true) {
  const data = read();
  data.flags = data.flags || {};
  data.flags[name] = value;
  write(data);
}

// Remember which level the player was last on, so a reload resumes there.
export function saveLastLevel(levelId) {
  const data = read();
  data.lastLevel = levelId;
  write(data);
}

export function loadLastLevel() {
  return read().lastLevel || null;
}
