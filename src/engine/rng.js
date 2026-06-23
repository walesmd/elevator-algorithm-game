// rng.js — tiny seeded pseudo-random number generator.
//
// The whole game is deterministic: a (level, seed) pair must always produce the
// exact same passenger stream and therefore the same run, score, and feedback.
// We get that by driving every random choice through mulberry32, a small, fast,
// well-distributed 32-bit PRNG. No external dependency, runs identically in the
// browser, a Web Worker, and Node.

/**
 * Create a seeded random generator.
 * @param {number} seed - any integer; the same seed yields the same sequence.
 * @returns {() => number} a function returning floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer in [0, n) from a generator.
 * @param {() => number} rng
 * @param {number} n
 */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}
