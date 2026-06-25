// syncplayer.js — drive several recorded runs from ONE clock, in lock-step (Phase 7B).
//
// The A/B tool shows two buildings side by side and they MUST stay aligned: tick 200
// in one is tick 200 in the other, so the learner compares like with like. Rather than
// run two independent players (which would drift), this owns a single fractional tick
// cursor and paints every track from it each frame. Two runs rarely have the same
// length — a faster algorithm finishes sooner — so each track clamps to its own last
// frame and simply holds "done" while the other keeps going.
//
// Same contract and feel as render/playback.js (decoupled from sim ticks, RAF-driven,
// browser-only); this is the multi-track generalisation.

const MS_PER_TICK = 110; // wall-clock duration of one tick at 1× speed (matches playback.js)

/**
 * @param {Array<{frames:Array, renderer:{draw:Function, drawEmpty:Function}}>} tracks
 * @param {{onFrame?:(tick:number, perTrack:Array<{frame:object,i:number}>)=>void, onEnd?:()=>void}} [hooks]
 */
export function createSyncPlayer(tracks, hooks = {}) {
  // The shared timeline is as long as the LONGEST run, so the comparison plays until
  // both have finished.
  const last = Math.max(0, ...tracks.map((t) => Math.max(0, t.frames.length - 1)));
  let cursor = 0;
  let speed = 1;
  let playing = false;
  let raf = 0;
  let prevTs = 0;

  function paintTrack(track) {
    const tl = Math.max(0, track.frames.length - 1);
    if (!track.frames.length) { track.renderer.drawEmpty(); return null; }
    const i = Math.min(tl, Math.floor(cursor));
    const a = track.frames[i];
    const b = track.frames[Math.min(tl, i + 1)];
    const alpha = Math.min(1, Math.max(0, cursor - i));
    track.renderer.draw(a, b, alpha);
    return { frame: a, i };
  }

  function paint() {
    const per = tracks.map(paintTrack);
    hooks.onFrame?.(Math.min(Math.round(cursor), last), per);
  }

  function loop(ts) {
    if (!playing) return;
    if (!prevTs) prevTs = ts;
    const dt = ts - prevTs;
    prevTs = ts;
    cursor += (dt / MS_PER_TICK) * speed;
    if (cursor >= last) {
      cursor = last;
      paint();
      stopLoop();
      playing = false;
      hooks.onEnd?.();
      return;
    }
    paint();
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    prevTs = 0;
  }

  function play() {
    if (playing || last === 0) return;
    if (cursor >= last) cursor = 0;
    playing = true;
    prevTs = 0;
    raf = requestAnimationFrame(loop);
  }

  function pause() { playing = false; stopLoop(); }
  function toggle() { if (playing) pause(); else play(); }

  function step(delta = 1) {
    pause();
    cursor = clamp(Math.round(cursor) + delta, 0, last);
    paint();
  }

  function seek(t) {
    pause();
    cursor = clamp(t, 0, last);
    paint();
  }

  function restart() { seek(0); }

  function setSpeed(mult) { speed = mult; prevTs = 0; }

  function destroy() { pause(); }

  return {
    play, pause, toggle, step, seek, restart, setSpeed, destroy, paint,
    get tickCount() { return last; },
    get tick() { return Math.round(cursor); },
    get playing() { return playing; },
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
