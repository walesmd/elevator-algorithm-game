// renderer.js — Canvas visualization (Phase 2).
//
// Turns engine frames into the picture players watch: the shaft(s), the car(s),
// floor labels, and the people waiting on each floor. Two doctrine points shape it:
//
//   - Show, don't tell. A rider who has waited too long warms from calm → amber →
//     red, so starvation is *seen* on screen before it's read in the metrics.
//   - Read-only. The renderer draws engine state and never mutates it. It knows
//     nothing about scoring; hand it a frame, it paints.
//
// It is decoupled from sim ticks: `draw(a, b, alpha)` takes two consecutive frames
// and an interpolation factor (0..1). Only the continuous things — car position and
// door openness — are interpolated; the discrete world (who is waiting, who is
// aboard) is read from frame `a`. The playback loop owns timing and picks a/b/alpha.

const C = {
  shaft: '#0c1218',
  shaftEdge: '#2b3742',
  rail: '#1a2530',
  bandA: 'rgba(255,255,255,0.012)',
  line: '#1d2731',
  label: '#9aa7b2',
  labelDim: '#5d6b77',
  car: '#4cc2ff',
  carHi: '#7ad4ff',
  carEdge: '#2a8fc4',
  door: '#0b1f2b',
  doorEdge: '#103040',
  cabin: '#06121a',
  rider: '#d7eefb',
  riderEmpty: 'rgba(255,255,255,0.08)',
  callDir: '#8b97a3', // hall up/down arrows — neutral; the ▲/▼ shape carries direction
  carCall: '#4cc2ff', // car's planned stops — shares the car's colour
  waitOk: '#74b6cf',
  waitWarn: '#ffcf6b',
  waitRed: '#ff5d52',
  ghost: '#7f8b96',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} level - level definition (floors, cars, capacity, timing)
 */
export function createRenderer(canvas, level) {
  const ctx = canvas.getContext('2d');
  const F = level.numFloors;
  const N = level.numElevators ?? 1;
  // Wait thresholds scale with the building, where `sweep` = the ticks to cross it
  // once. Calibrated (see test/recording-derived tuning) so a strong algorithm
  // stays all-green, the beatable baseline shows some amber, and a car that strands
  // people turns red — i.e. the colour is a signal, not noise. Levels can override
  // via `level.starve = { warn, red }`.
  const sweep = F * (level.ticksPerFloor ?? 2);
  const warnTicks = level.starve?.warn ?? sweep * 2;
  const redTicks = level.starve?.red ?? sweep * 4;

  let W = 0;
  let H = 0;
  let geo = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = Math.max(300, Math.floor(rect.width));
    H = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeGeo();
  }

  // The drawing area is split into: a thin floor-label gutter, a hall lane where
  // people wait, then N shaft columns. The hall+shafts block is centred in the
  // available width so a single-elevator building doesn't sit lopsided with dead
  // space on one side.
  function computeGeo() {
    const padTop = 12;
    const padBottom = 12;
    const padRight = 14;
    const padLeft = 6;
    const labelW = 22;
    const areaLeft = padLeft + labelW + 6;
    const areaRight = W - padRight;
    const areaW = Math.max(80, areaRight - areaLeft);
    const hallW = clamp(Math.round(areaW * 0.28), 60, 132);
    const shaftColW = clamp((areaW - hallW) / N, 56, 150);
    const buildingW = hallW + shaftColW * N;
    const startX = areaLeft + Math.max(0, (areaW - buildingW) / 2);
    const shaftAreaX = startX + hallW;
    geo = {
      padTop,
      padBottom,
      labelW,
      startX,
      hallW,
      shaftAreaX,
      shaftColW,
      shaftVisW: Math.min(shaftColW * 0.82, 116),
      carW: Math.min(shaftColW * 0.6, 82),
      buildingRight: shaftAreaX + shaftColW * N,
      floorH: (H - padTop - padBottom) / F,
    };
  }

  // Continuous floor coordinate -> y of the floor's centre line. Floor 0 at bottom.
  function yOf(pos) {
    return H - geo.padBottom - (pos + 0.5) * geo.floorH;
  }

  function shaftCenterX(i) {
    return geo.shaftAreaX + (i + 0.5) * geo.shaftColW;
  }

  function clear() {
    ctx.clearRect(0, 0, W, H);
  }

  function drawBuilding() {
    const { floorH } = geo;
    const bandLeft = geo.startX;
    const bandRight = geo.buildingRight;
    // Floor bands, separators, and labels.
    for (let f = 0; f < F; f++) {
      const top = yOf(f) - floorH / 2;
      if (f % 2 === 0) {
        ctx.fillStyle = C.bandA;
        ctx.fillRect(bandLeft, top, bandRight - bandLeft, floorH);
      }
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bandLeft, Math.round(top) + 0.5);
      ctx.lineTo(bandRight, Math.round(top) + 0.5);
      ctx.stroke();

      ctx.fillStyle = C.labelDim;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(f), bandLeft - 6, yOf(f));
    }

    // Shaft tracks (one per elevator).
    for (let i = 0; i < N; i++) {
      const cx = shaftCenterX(i);
      const w = geo.shaftVisW;
      const x = cx - w / 2;
      const top = geo.padTop;
      const h = H - geo.padTop - geo.padBottom;
      ctx.fillStyle = C.shaft;
      roundRect(ctx, x, top, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = C.shaftEdge;
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, top + 0.5, w - 1, h - 1, 8);
      ctx.stroke();
      // Guide rails down each side of the shaft.
      ctx.strokeStyle = C.rail;
      ctx.beginPath();
      ctx.moveTo(Math.round(x + 5) + 0.5, top + 6);
      ctx.lineTo(Math.round(x + 5) + 0.5, top + h - 6);
      ctx.moveTo(Math.round(x + w - 5) + 0.5, top + 6);
      ctx.lineTo(Math.round(x + w - 5) + 0.5, top + h - 6);
      ctx.stroke();
    }
  }

  // Small chevrons on the shaft marking floors the car intends to stop at
  // (its passengers' destinations). Helps the learner see the car's "plan".
  function drawCarCalls(ev, i) {
    const cx = shaftCenterX(i);
    const w = geo.shaftVisW;
    const x = cx + w / 2 - 9;
    ctx.fillStyle = C.carCall;
    for (const f of ev.carCalls) {
      if (f === ev.floor) continue;
      const y = yOf(f);
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCar(ev, pos, doorOpen, i) {
    const cx = shaftCenterX(i);
    const carW = geo.carW;
    const carH = Math.min(geo.floorH * 0.8, 64);
    const x = cx - carW / 2;
    const y = yOf(pos) - carH / 2;

    // Cabin shell.
    const grad = ctx.createLinearGradient(x, y, x, y + carH);
    grad.addColorStop(0, C.carHi);
    grad.addColorStop(1, C.car);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, carW, carH, 7);
    ctx.fill();
    ctx.strokeStyle = C.carEdge;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 0.5, y + 0.5, carW - 1, carH - 1, 7);
    ctx.stroke();

    // Interior (drawn first, then doors slide over it).
    const inset = 5;
    const ix = x + inset;
    const iy = y + inset;
    const iw = carW - inset * 2;
    const ih = carH - inset * 2;
    ctx.save();
    roundRect(ctx, ix, iy, iw, ih, 4);
    ctx.clip();
    ctx.fillStyle = C.cabin;
    ctx.fillRect(ix, iy, iw, ih);
    drawRiders(ev, ix, iy, iw, ih);
    ctx.restore();

    // Sliding doors: two panels meeting in the middle when closed (doorOpen=0),
    // retracting to the sides when open (doorOpen=1).
    const half = iw / 2;
    const panelW = half * (1 - doorOpen);
    if (panelW > 0.4) {
      ctx.fillStyle = C.door;
      ctx.fillRect(ix, iy, panelW, ih);
      ctx.fillRect(ix + iw - panelW, iy, panelW, ih);
      ctx.strokeStyle = C.doorEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(ix + panelW) + 0.5, iy);
      ctx.lineTo(Math.round(ix + panelW) + 0.5, iy + ih);
      ctx.moveTo(Math.round(ix + iw - panelW) + 0.5, iy);
      ctx.lineTo(Math.round(ix + iw - panelW) + 0.5, iy + ih);
      ctx.stroke();
    }

    // Load badge + travel direction caret, above the cabin — or below it when the
    // car is at the top floor, so the label never clips off the top of the shaft.
    ctx.fillStyle = C.label;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    const caret = ev.dir === 'up' ? '▲ ' : ev.dir === 'down' ? '▼ ' : '';
    const above = y - 3 >= geo.padTop + 11;
    ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(`${caret}${ev.load}/${ev.capacity}`, cx, above ? y - 3 : y + carH + 3);
  }

  // Capacity as a grid of pips: filled = a rider aboard, outlined = a free seat.
  function drawRiders(ev, ix, iy, iw, ih) {
    const cap = Math.max(1, ev.capacity);
    const cols = Math.min(cap, Math.max(2, Math.round(Math.sqrt(cap * (iw / ih)))));
    const rows = Math.ceil(cap / cols);
    const r = Math.max(1.6, Math.min(iw / cols, ih / rows) * 0.26);
    const cw = iw / cols;
    const chh = ih / rows;
    for (let k = 0; k < cap; k++) {
      const col = k % cols;
      const rowFromTop = Math.floor(k / cols);
      const px = ix + (col + 0.5) * cw;
      const py = iy + ih - (rowFromTop + 0.5) * chh; // fill from the floor up
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (k < ev.load) {
        ctx.fillStyle = C.rider;
        ctx.fill();
      } else {
        ctx.strokeStyle = C.riderEmpty;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // The hall: everyone waiting, grouped by floor, drawn as pips that warm with
  // their wait. A ▲/▼ marks which directions are calling from that floor.
  function drawWaiting(waiting) {
    const byFloor = new Map();
    for (const p of waiting) {
      if (!byFloor.has(p.floor)) byFloor.set(p.floor, []);
      byFloor.get(p.floor).push(p);
    }
    const hallLeft = geo.startX;
    const laneRight = geo.shaftAreaX - 8;
    for (const [floor, people] of byFloor) {
      const y = yOf(floor);
      let up = false;
      let down = false;
      for (const p of people) {
        if (p.dir === 'up') up = true;
        else down = true;
      }
      // Direction arrows at the outer edge of the hall lane.
      ctx.font = '9px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.callDir;
      if (up) ctx.fillText('▲', hallLeft, y - 5);
      if (down) ctx.fillText('▼', hallLeft, y + 6);

      // Pips, newest nearest the shaft, capped with a "+N" overflow.
      const r = Math.min(5, Math.max(3, geo.floorH * 0.16));
      const gap = r * 2 + 3;
      const firstX = laneRight - r;
      const pipLeft = hallLeft + 14;
      const maxPips = Math.max(1, Math.floor((firstX - pipLeft) / gap));
      const shown = Math.min(people.length, maxPips);
      for (let k = 0; k < shown; k++) {
        const p = people[people.length - 1 - k];
        const px = firstX - k * gap;
        ctx.beginPath();
        ctx.arc(px, y, r, 0, Math.PI * 2);
        ctx.fillStyle = waitColor(p.wait);
        ctx.fill();
      }
      const hidden = people.length - shown;
      if (hidden > 0) {
        ctx.fillStyle = C.labelDim;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`+${hidden}`, firstX - shown * gap, y);
      }
    }
  }

  function waitColor(w) {
    if (w >= redTicks) return C.waitRed;
    if (w >= warnTicks) return C.waitWarn;
    return C.waitOk;
  }

  /**
   * Paint one interpolated frame.
   * @param {object} a - the frame we're transitioning from (discrete state source)
   * @param {object} [b] - the next frame (for position/door interpolation)
   * @param {number} [alpha] - 0..1 between a and b
   */
  function draw(a, b, alpha = 0) {
    if (!geo) resize();
    clear();
    drawBuilding();
    if (!a) return;
    const next = b || a;
    const t = next === a ? 0 : alpha;
    drawWaiting(a.waiting);
    a.elevators.forEach((ev, i) => {
      const evB = next.elevators[i] || ev;
      const pos = ev.pos + (evB.pos - ev.pos) * t;
      const doorOpen = ev.doorOpen + (evB.doorOpen - ev.doorOpen) * t;
      drawCarCalls(ev, i);
      drawCar(ev, pos, doorOpen, i);
    });
  }

  // The static "before you press Run" view: the building with idle cars at the
  // lobby and nobody waiting yet.
  function drawEmpty() {
    if (!geo) resize();
    clear();
    drawBuilding();
    for (let i = 0; i < N; i++) {
      const ev = { floor: 0, dir: 'idle', doorOpen: 0, load: 0, capacity: level.capacity ?? 8, carCalls: [] };
      drawCar(ev, 0, 0, i);
    }
  }

  resize();
  return { draw, drawEmpty, resize };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
