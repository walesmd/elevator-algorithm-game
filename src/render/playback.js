// playback.js — drives the renderer over a recorded run.
//
// The simulation is a sequence of discrete tick frames; this turns it into a
// watchable animation. It owns *time*, not drawing: each requestAnimationFrame it
// advances a fractional tick cursor by wall-clock elapsed × speed, picks the two
// frames straddling the cursor, and asks the renderer to paint the blend. That's
// the "decoupled from ticks" rule — the render rate and the sim rate are unrelated,
// and slow/fast machines see the same motion, just at different smoothness.
//
// Nothing here touches the engine; it only reads frames. It's main-thread/browser
// code (requestAnimationFrame / performance.now), so the engine and tests never
// import it.

const MS_PER_TICK = 110; // wall-clock duration of one tick at 1× speed

/**
 * @param {Array<object>} frames - recorded run (from runSimulation(..., {record:true}))
 * @param {{draw:Function}} renderer
 * @param {{onFrame?:(frame:object, tick:number)=>void, onEnd?:()=>void}} [hooks]
 */
export function createPlayer(frames, renderer, hooks = {}) {
  const last = Math.max(0, frames.length - 1);
  let cursor = 0; // fractional tick position
  let speed = 1;
  let playing = false;
  let raf = 0;
  let prevTs = 0;

  function frameAt(t) {
    const i = Math.min(last, Math.floor(t));
    const a = frames[i];
    const b = frames[Math.min(last, i + 1)];
    const alpha = t - i;
    return { a, b, alpha, i };
  }

  function paint() {
    if (!frames.length) {
      renderer.drawEmpty();
      return;
    }
    const { a, b, alpha, i } = frameAt(cursor);
    renderer.draw(a, b, alpha);
    hooks.onFrame?.(a, i);
  }

  function tick(ts) {
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
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    prevTs = 0;
  }

  function play() {
    if (playing || !frames.length) return;
    if (cursor >= last) cursor = 0; // replay from the top once finished
    playing = true;
    prevTs = 0;
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    stopLoop();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  // Advance exactly one tick and hold, so a learner can inspect a single decision.
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

  function restart() {
    seek(0);
  }

  function setSpeed(mult) {
    speed = mult;
    prevTs = 0; // avoid a jump on the next frame
  }

  function destroy() {
    pause();
  }

  return {
    play,
    pause,
    toggle,
    step,
    seek,
    restart,
    setSpeed,
    destroy,
    paint,
    get tickCount() {
      return last;
    },
    get tick() {
      return Math.round(cursor);
    },
    get playing() {
      return playing;
    },
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
