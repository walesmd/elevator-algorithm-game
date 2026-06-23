// metrics.js — turn a finished run into the numbers players are judged on.
//
// Pure function: hand it the passenger records (with their pickup/drop ticks
// filled in by the simulation), the total distance the cars traveled, and the
// tick the run ended on. It returns the summary the scorer and the UI consume.
//
// Lower is better for wait, journey, max-wait, and distance. Throughput and
// deliveredAll are the "did it actually work" signals.

/**
 * @param {{passengers:Array, distance:number, endTick:number, timeLimit:number}} run
 */
export function summarize({ passengers, distance, endTick }) {
  const total = passengers.length;
  const pickedUp = passengers.filter((p) => p.pickupTick != null);
  const delivered = passengers.filter((p) => p.dropTick != null);

  const waits = pickedUp.map((p) => p.pickupTick - p.spawnTick);
  const journeys = delivered.map((p) => p.dropTick - p.spawnTick);

  // Max wait counts everyone: a passenger never picked up is measured to the
  // end of the run, so starvation shows up instead of being hidden.
  let maxWait = 0;
  for (const p of passengers) {
    const w = (p.pickupTick != null ? p.pickupTick : endTick) - p.spawnTick;
    if (w > maxWait) maxWait = w;
  }

  return {
    avgWait: mean(waits),
    avgJourney: mean(journeys),
    maxWait,
    throughput: total ? delivered.length / total : 1,
    distance,
    delivered: delivered.length,
    total,
    deliveredAll: delivered.length === total,
    endTick,
  };
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
