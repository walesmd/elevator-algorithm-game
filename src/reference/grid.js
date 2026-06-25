// grid.js — reference controllers for the 2-D "sideways" bonus levels (Phase 8).
//
// The curriculum's references (FCFS/SSTF/SCAN/LOOK) only move up and down, so they
// can't serve a grid. These two anchor the stars on grid levels the same honest way:
//   gridNaive  — the 1-star baseline: one errand at a time, ignore riders en route.
//   gridSmart  — the 3-star "par": always head to the nearest pending stop, picking up
//                whoever is on the way (a 2-D nearest-stop server with simple dispatch).
// Both drive every car and use Manhattan distance with deterministic tie-breaking, so
// runs are reproducible. They are scoring references, not gallery entries — plain
// createController exports.

// Manhattan distance between a car and a {floor,col} cell.
const dist = (e, c) => Math.abs(c.floor - e.floor) + Math.abs(c.col - e.col);

// One command that drives a car one step toward a target cell (vertical first, then
// horizontal), or STOPs once it's standing on the cell.
function toward(e, target) {
  if (!target) return { action: 'IDLE' };
  if (e.floor < target.floor) return { action: 'MOVE_UP' };
  if (e.floor > target.floor) return { action: 'MOVE_DOWN' };
  if (e.col < target.col) return { action: 'MOVE_RIGHT' };
  if (e.col > target.col) return { action: 'MOVE_LEFT' };
  return { action: 'STOP' };
}

// Nearest cell to a car from a list (ties → lower floor, then lower column).
function nearestCell(e, cells) {
  let best = null;
  let bd = Infinity;
  for (const c of cells) {
    const d = dist(e, c);
    if (d < bd || (d === bd && best && (c.floor < best.floor || (c.floor === best.floor && c.col < best.col)))) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// gridNaive — each car runs ONE errand at a time. Carrying riders? go drop the nearest
// one. Empty? claim the nearest waiting cell no other car is already going for. It never
// picks anyone up while carrying, so it makes a separate trip for almost everyone.
export function gridNaive() {
  return {
    step(state) {
      const cars = state.elevators;
      const target = cars.map((e) => (e.load > 0 ? nearestCell(e, e.carCalls) : null));
      for (const call of state.hallCalls) {
        let pick = -1;
        let bd = Infinity;
        cars.forEach((e, i) => {
          if (target[i]) return; // already has an errand
          const d = dist(e, call);
          if (d < bd) { bd = d; pick = i; }
        });
        if (pick !== -1) target[pick] = call;
      }
      return cars.map((e, i) => (e.ready ? toward(e, target[i]) : { action: 'IDLE' }));
    },
  };
}

// gridSmart — each car heads to the nearest pending stop among its drop-offs PLUS the
// pickups assigned to it (when it has room), so it grabs riders on the way instead of
// making dedicated empty trips. A waiting cell is assigned to the nearest car with room.
export function gridSmart() {
  return {
    step(state) {
      const cars = state.elevators;
      const mine = cars.map(() => []);
      for (const call of state.hallCalls) {
        let pick = -1;
        let bd = Infinity;
        cars.forEach((e, i) => {
          if (e.load >= e.capacity) return;
          const d = dist(e, call);
          if (d < bd) { bd = d; pick = i; }
        });
        if (pick !== -1) mine[pick].push(call);
      }
      return cars.map((e, i) => {
        if (!e.ready) return { action: 'IDLE' };
        const stops = e.load < e.capacity ? e.carCalls.concat(mine[i]) : e.carCalls;
        return toward(e, nearestCell(e, stops));
      });
    },
  };
}
