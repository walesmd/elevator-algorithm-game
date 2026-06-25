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
  // Zoned ("skyscraper") levels: a faint tint behind each zone's reachable band
  // (alternating so neighbouring zones read apart) and a violet sky-lobby marker —
  // a cool accent that won't be mistaken for the amber/red starvation colours.
  zoneTint: ['rgba(108,194,255,0.045)', 'rgba(185,139,255,0.05)'],
  zoneEdge: ['rgba(108,194,255,0.20)', 'rgba(185,139,255,0.22)'],
  sky: '#b98bff',
  skyText: '#e7dcff',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} level - level definition (floors, cars, capacity, timing)
 */
export function createRenderer(canvas, level) {
  // 2-D bonus levels get a dedicated grid renderer; the vertical-shaft renderer below
  // is untouched for the curriculum.
  if ((level.numCols ?? 1) > 1) return createGridRenderer(canvas, level);

  const ctx = canvas.getContext('2d');
  const F = level.numFloors;
  const N = level.numElevators ?? 1;
  // Per-car floor range (zoned levels). Default: every car covers the whole building.
  const ranges = Array.from({ length: N }, (_, i) => {
    const r = (level.elevators && level.elevators[i]) || {};
    return { lo: r.minFloor ?? 0, hi: r.maxFloor ?? F - 1 };
  });
  const zoned = ranges.some((r) => r.lo > 0 || r.hi < F - 1);
  // Distinct zones (by range), for the alternating tint; and the sky-lobby floors
  // where one zone's top meets another's bottom (the shared transfer floors).
  const zoneIds = [...new Set(ranges.map((r) => `${r.lo}-${r.hi}`))];
  const zoneIndexOf = (i) => zoneIds.indexOf(`${ranges[i].lo}-${ranges[i].hi}`);
  const skyLobbies = [];
  for (let f = 0; f < F; f++) {
    if (ranges.some((r) => r.hi === f) && ranges.some((r) => r.lo === f)) skyLobbies.push(f);
  }
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

    // Shaft tracks (one per elevator). On a zoned level a shaft spans only its car's
    // reachable band [lo, hi] — so cars read as different-height shafts overlapping
    // at the sky-lobby — and gets a faint zone tint. Otherwise it runs full height.
    for (let i = 0; i < N; i++) {
      const cx = shaftCenterX(i);
      const w = geo.shaftVisW;
      const x = cx - w / 2;
      const r = ranges[i];
      const top = zoned ? yOf(r.hi) - geo.floorH / 2 : geo.padTop;
      const bottom = zoned ? yOf(r.lo) + geo.floorH / 2 : H - geo.padBottom;
      const h = bottom - top;

      if (zoned) {
        const z = zoneIndexOf(i) % C.zoneTint.length;
        ctx.fillStyle = C.zoneTint[z];
        roundRect(ctx, x, top, w, h, 8);
        ctx.fill();
      }
      ctx.fillStyle = C.shaft;
      roundRect(ctx, x, top, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = zoned ? C.zoneEdge[zoneIndexOf(i) % C.zoneEdge.length] : C.shaftEdge;
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

    drawSkyLobbies();
  }

  // Mark each sky-lobby: a dashed violet line across the building plus a small tag,
  // so the shared transfer floor is obvious. (No-op on a normal full-height level.)
  function drawSkyLobbies() {
    if (!skyLobbies.length) return;
    const left = geo.startX;
    const right = geo.buildingRight;
    for (const f of skyLobbies) {
      const y = Math.round(yOf(f)) + 0.5;
      ctx.save();
      ctx.strokeStyle = C.sky;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.restore();

      // "SKY LOBBY" tag tucked at the left edge of the hall lane.
      ctx.fillStyle = C.sky;
      ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('SKY LOBBY', left + 1, y - 2);
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
    if (iw <= 0 || ih <= 0) return; // cabin too small to draw into (very tall building)
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
      const ev = { floor: ranges[i].lo, dir: 'idle', doorOpen: 0, load: 0, capacity: level.capacity ?? 8, carCalls: [] };
      drawCar(ev, ranges[i].lo, 0, i);
    }
  }

  resize();
  return { draw, drawEmpty, resize };
}

// --- 2-D grid renderer (Phase 8 bonus levels) ------------------------------------
// A building that's floors × columns: a lattice of rooms, cars that slide both ways,
// waiting riders warming with their wait, and faint dots marking each car's drop-offs.
// Same interface as the shaft renderer: draw(a, b, alpha) / drawEmpty() / resize().
function createGridRenderer(canvas, level) {
  const ctx = canvas.getContext('2d');
  const F = level.numFloors;
  const COLS = level.numCols;
  const N = level.numElevators ?? 1;
  const sweep = (F + COLS) * (level.ticksPerFloor ?? 2);
  const warnTicks = level.starve?.warn ?? sweep * 2;
  const redTicks = level.starve?.red ?? sweep * 4;
  // A distinct hue per car so several carts are tellable apart.
  const carHues = ['#4cc2ff', '#b98bff', '#7fd6a8', '#ffcf6b'];

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

  function computeGeo() {
    const padTop = 12;
    const padBottom = 12;
    const padLeft = 22; // floor labels
    const padRight = 12;
    const gridW = Math.max(40, W - padLeft - padRight);
    const gridH = Math.max(40, H - padTop - padBottom);
    geo = {
      padTop,
      padLeft,
      cellW: gridW / COLS,
      cellH: gridH / F,
      gridW,
      gridH,
    };
  }

  const xOf = (col) => geo.padLeft + (col + 0.5) * geo.cellW; // centre x of a column
  const yOf = (floor) => H - 12 - (floor + 0.5) * geo.cellH; // centre y of a floor (0 at bottom)

  function clear() {
    ctx.clearRect(0, 0, W, H);
  }

  function drawGrid() {
    const left = geo.padLeft;
    const top = geo.padTop;
    // Cells: a subtle checker so columns read as distinct rooms.
    for (let f = 0; f < F; f++) {
      for (let c = 0; c < COLS; c++) {
        const x = left + c * geo.cellW;
        const y = yOf(f) - geo.cellH / 2;
        ctx.fillStyle = (f + c) % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, y, geo.cellW, geo.cellH);
      }
    }
    // Grid lines.
    ctx.strokeStyle = C.line || '#1d2731';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let f = 0; f <= F; f++) {
      const y = Math.round(H - 12 - f * geo.cellH) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(left + geo.gridW, y);
    }
    for (let c = 0; c <= COLS; c++) {
      const x = Math.round(left + c * geo.cellW) + 0.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + geo.gridH);
    }
    ctx.stroke();
    // Floor labels down the left gutter.
    ctx.fillStyle = '#5d6b77';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let f = 0; f < F; f++) ctx.fillText(String(f), left - 4, yOf(f));
  }

  function waitColor(w) {
    if (w >= redTicks) return '#ff5d52';
    if (w >= warnTicks) return '#ffcf6b';
    return '#74b6cf';
  }

  // Waiting riders, grouped by cell, drawn as warm-with-wait pips with a +N overflow.
  function drawWaiting(waiting) {
    const byCell = new Map();
    for (const p of waiting) {
      const k = `${p.floor}:${p.col}`;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(p);
    }
    const r = Math.max(2, Math.min(4, geo.cellH * 0.12));
    for (const [, people] of byCell) {
      const cx = xOf(people[0].col);
      const cy = yOf(people[0].floor);
      const per = Math.max(1, Math.floor((geo.cellW * 0.7) / (r * 2 + 2)));
      const shown = Math.min(people.length, per);
      const startX = cx - ((shown - 1) * (r * 2 + 2)) / 2;
      for (let k = 0; k < shown; k++) {
        ctx.beginPath();
        ctx.arc(startX + k * (r * 2 + 2), cy + geo.cellH * 0.28, r, 0, Math.PI * 2);
        ctx.fillStyle = waitColor(people[people.length - 1 - k].wait);
        ctx.fill();
      }
      if (people.length > shown) {
        ctx.fillStyle = '#5d6b77';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${people.length - shown}`, startX + shown * (r * 2 + 2), cy + geo.cellH * 0.28);
      }
    }
  }

  // A car's planned drop-offs, as faint dots in the car's hue.
  function drawCarCalls(ev, hue) {
    ctx.fillStyle = hue;
    ctx.globalAlpha = 0.5;
    for (const c of ev.carCalls) {
      ctx.beginPath();
      ctx.arc(xOf(c.col), yOf(c.floor) - geo.cellH * 0.28, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCar(posF, posC, load, capacity, hue, doorOpen) {
    const cw = Math.min(geo.cellW * 0.6, 60);
    const ch = Math.min(geo.cellH * 0.6, 48);
    const x = geo.padLeft + (posC + 0.5) * geo.cellW - cw / 2;
    const y = H - 12 - (posF + 0.5) * geo.cellH - ch / 2;
    const grad = ctx.createLinearGradient(x, y, x, y + ch);
    grad.addColorStop(0, hue);
    grad.addColorStop(1, shade(hue, -0.25));
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, cw, ch, 6);
    ctx.fill();
    ctx.strokeStyle = shade(hue, -0.4);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 0.5, y + 0.5, cw - 1, ch - 1, 6);
    ctx.stroke();
    // doorOpen brightens the cabin briefly so a pickup/drop is visible.
    if (doorOpen > 0.3) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, x + 4, y + 4, cw - 8, ch - 8, 4);
      ctx.fill();
    }
    ctx.fillStyle = '#04222f';
    ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${load}/${capacity}`, x + cw / 2, y + ch / 2);
  }

  function draw(a, b, alpha = 0) {
    if (!geo) resize();
    clear();
    drawGrid();
    if (!a) return;
    const next = b || a;
    const t = next === a ? 0 : alpha;
    drawWaiting(a.waiting);
    a.elevators.forEach((ev, i) => {
      const evB = next.elevators[i] || ev;
      const posF = ev.posF + (evB.posF - ev.posF) * t;
      const posC = ev.posC + (evB.posC - ev.posC) * t;
      const doorOpen = ev.doorOpen + (evB.doorOpen - ev.doorOpen) * t;
      const hue = carHues[i % carHues.length];
      drawCarCalls(ev, hue);
      drawCar(posF, posC, ev.load, ev.capacity, hue, doorOpen);
    });
  }

  function drawEmpty() {
    if (!geo) resize();
    clear();
    drawGrid();
    for (let i = 0; i < N; i++) drawCar(0, 0, 0, level.capacity ?? 8, carHues[i % carHues.length], 0);
  }

  resize();
  return { draw, drawEmpty, resize };
}

// Lighten (+) or darken (-) a #rrggbb hex by a fraction.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh) => {
    const v = Math.round(((n >> sh) & 255) * (1 + amt));
    return Math.max(0, Math.min(255, v));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return; // degenerate box — skip (avoids negative-radius arcTo)
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
