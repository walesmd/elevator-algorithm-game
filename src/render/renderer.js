// renderer.js — Canvas visualization. STUB (Phase 2).
//
// The renderer turns engine state into the picture players watch: the shaft(s),
// the car(s), floor labels, and waiting passengers (a rider whose wait crosses a
// threshold turns red, so starvation is *seen* before it's read). It must stay
// read-only with respect to the simulation — it draws state, never mutates it —
// and run on requestAnimationFrame, decoupled from sim ticks, interpolating
// between tick snapshots for smooth motion.
//
// Planned interface:
//   const renderer = createRenderer(canvas, level);
//   renderer.draw(state, alpha);  // alpha = 0..1 interpolation between ticks
//
// See PROJECT_PLAN.md §5 (Renderer) and the Phase 2 roadmap.

export function createRenderer(/* canvas, level */) {
  return {
    draw() {
      throw new Error('renderer not implemented yet (Phase 2)');
    },
  };
}
