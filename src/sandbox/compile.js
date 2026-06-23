// compile.js — turn a player's code string into a controller factory.
//
// Pure and DOM-free: the Web Worker uses it to build the player's controller, and
// Node tests import it directly. Compilation (syntax) errors and "you forgot to
// define createController" are turned into friendly messages here so the UI can
// show a kind sentence instead of a raw stack trace.
//
// Light hardening: the snippet runs with the worker-protocol and network globals
// shadowed to `undefined`, so buggy/curious player code can't hijack the worker's
// messaging or reach the network. This is not a security sandbox against hostile
// code (a Worker can still do plenty) — the real guarantees are isolation from the
// DOM and the main-thread watchdog. The threat model is *mistakes*, not malice.

const SHADOWED = [
  'self', 'globalThis', 'window', 'postMessage', 'onmessage', 'importScripts',
  'close', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker',
];

export class CompileError extends Error {
  // `kind` lets the UI title the failure accurately: a syntax error, code that
  // threw while loading, or a missing/wrong createController are different stories.
  constructor(message, kind = 'syntax') {
    super(message);
    this.name = 'CompileError';
    this.kind = kind;
  }
}

/**
 * @param {string} code - the player's source defining `createController`
 * @returns {(config:object) => {step:Function}} the controller factory
 * @throws {CompileError} with a player-friendly message
 */
export function compileController(code) {
  let getFactory;
  try {
    getFactory = new Function(
      ...SHADOWED,
      `"use strict";\n${code}\n;return typeof createController === 'function' ? createController : null;`
    );
  } catch (e) {
    throw new CompileError(`Syntax error in your code: ${e.message}`, 'syntax');
  }

  let factory;
  try {
    factory = getFactory(); // shadowed globals default to undefined
  } catch (e) {
    throw new CompileError(`Your code threw before the simulation started: ${e.message}`, 'load');
  }

  if (typeof factory !== 'function') {
    throw new CompileError(
      'Define a function named createController(config) that returns an object with a step(state) method.',
      'shape'
    );
  }
  return factory;
}
