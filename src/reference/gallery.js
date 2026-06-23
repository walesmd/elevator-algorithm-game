// gallery.js — the ordered roster of reference algorithms for the comparison tool.
//
// Each entry flattens a reference module into one object the UI can use directly:
// { id, name, concept, blurb, spoiler, source, createController }. The order is a
// teaching progression: the naive baseline, then a greedy idea, then the sweep
// family. FCFS is the sanctioned strawman (spoiler:false); the rest are gated
// behind the opt-in "reference approaches (spoilers)" reveal in the UI.
//
// These are the algorithms that map to a real bidirectional elevator. (C-SCAN, a
// one-directional disk-scheduling scheme, was dropped: with real direction-aware
// boarding it can never pick up down-bound riders, so it can't serve a real tower.)

import * as fcfs from './fcfs.js';
import * as sstf from './sstf.js';
import * as scan from './scan.js';
import * as look from './look.js';

export const gallery = [fcfs, sstf, scan, look].map((mod) => ({
  ...mod.meta,
  source: mod.source,
  createController: mod.createController,
}));

export function getReference(id) {
  return gallery.find((g) => g.id === id) || null;
}
