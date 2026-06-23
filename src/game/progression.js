// progression.js — which levels are open, given what the player has earned.
//
// The rule (PROJECT_PLAN §8): the first level is always open, and each later level
// unlocks once the one before it earns at least one star. Pure and deterministic —
// it takes a `getStars(id) -> number` lookup rather than reaching into localStorage
// itself, so the rule is testable in Node and decoupled from where stars are stored.

/**
 * Is `id` unlocked, given a stars lookup?
 * @param {Array<{id:string}>} levels - ordered level list
 * @param {string} id
 * @param {(id:string)=>number} getStars - best stars earned on a level (0 if none)
 */
export function isUnlocked(levels, id, getStars) {
  const idx = levels.findIndex((l) => l.id === id);
  if (idx < 0) return false; // unknown level
  if (idx === 0) return true; // the first level is always open
  return (getStars(levels[idx - 1].id) || 0) >= 1;
}

/** How many levels are currently open (handy for "world" gates / progress UI). */
export function unlockedCount(levels, getStars) {
  return levels.reduce((n, l) => n + (isUnlocked(levels, l.id, getStars) ? 1 : 0), 0);
}
