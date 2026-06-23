// progression.test.js — unlock rules (Phase 5). Run: `node test/progression.test.js`.
//
// The rule: level 1 is always open; every later level opens once the one before it
// earns >= 1 star. isUnlocked takes a stars lookup so it's testable without a browser.

import { isUnlocked, unlockedCount } from '../src/game/progression.js';
import { levels } from '../src/game/levels.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

const starsFrom = (map) => (id) => map[id] || 0;

// --- The shipped two-level ladder -------------------------------------------
{
  const [l1, l2] = levels;
  const none = starsFrom({});
  assert(isUnlocked(levels, l1.id, none), 'level 1 is always unlocked (no progress)');
  assert(!isUnlocked(levels, l2.id, none), 'level 2 is locked until level 1 is cleared');

  const oneStar = starsFrom({ [l1.id]: 1 });
  assert(isUnlocked(levels, l2.id, oneStar), 'level 2 unlocks once level 1 earns >= 1 star');

  const threeStar = starsFrom({ [l1.id]: 3 });
  assert(isUnlocked(levels, l2.id, threeStar), 'more stars on level 1 keeps level 2 unlocked');

  assert(unlockedCount(levels, none) === 1, 'with no progress, exactly one level is open');
  // Clearing level 1 opens the NEXT level only — the ladder unlocks one rung at a
  // time (don't assume the total level count).
  assert(unlockedCount(levels, oneStar) === Math.min(2, levels.length), 'clearing level 1 opens exactly the next level');
  if (levels.length >= 3) {
    assert(!isUnlocked(levels, levels[2].id, oneStar), 'level 3 stays locked until level 2 is cleared');
  }
}

// --- A longer synthetic ladder: unlocks chain one at a time -----------------
{
  const chain = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const stars = starsFrom({ a: 2, b: 1 }); // a and b cleared, c not yet
  assert(isUnlocked(chain, 'a', stars), 'a (first) open');
  assert(isUnlocked(chain, 'b', stars), 'b open (a cleared)');
  assert(isUnlocked(chain, 'c', stars), 'c open (b cleared)');
  assert(!isUnlocked(chain, 'd', stars), 'd locked (c not cleared)');
  assert(unlockedCount(chain, stars) === 3, 'three of four open');
  assert(!isUnlocked(chain, 'zzz', stars), 'an unknown level id is not unlocked');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
