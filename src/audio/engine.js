// engine.js — the procedural radio: synthesize a station live with the Web Audio API.
//
// Nothing is a recording — every sound is built from oscillators and noise, so the game
// stays offline and licence-free (Phase 9 doctrine). The station data (stations.js) is
// pure; this is the only browser-coupled half. It runs entirely on the main thread but
// does almost nothing per frame: a lookahead scheduler wakes ~every 25ms and queues the
// next slice of notes precisely on the audio clock (the standard Web-Audio pattern), so
// it never blocks the UI and never touches the game engine.
//
// Autoplay-safe: no AudioContext is created until the player explicitly unmutes (a user
// gesture), and audio suspends when the tab is hidden.

import { getStations, getStation, generateBar, midiToFreq } from './stations.js';

const LOOKAHEAD_MS = 25; // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.18; // seconds of audio to queue in advance

export function createRadio({ stationId, muted = true, volume = 0.6 } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let distortCurve = null;

  let station = getStation(stationId);
  let isMuted = muted;
  let hiddenTab = false;
  let vol = volume;

  let timer = 0;
  let nextBarTime = 0; // audio-clock time the next bar starts
  let barIndex = 0;

  // --- audio graph (built lazily on first unmute) ---------------------------------
  function ensureContext() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);
    // A second of white noise, reused for all percussion.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // A soft clipping curve for the distorted (hair-rock) voices.
    const n = 1024;
    distortCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      distortCurve[i] = Math.tanh(x * 3);
    }
  }

  // --- voices ---------------------------------------------------------------------
  function pitched(type, freq, t, dur, gain, distort) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, gain);
    // A gentle attack/decay so notes don't click.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (distort) {
      const ws = ctx.createWaveShaper();
      ws.curve = distortCurve;
      osc.connect(ws);
      node = ws;
    }
    node.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, gain, filterType, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function kick(t, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function playEvent(ev, t, spb) {
    switch (ev.voice) {
      case 'kick': return kick(t, ev.gain);
      case 'snare': return noise(t, 0.18, ev.gain, 'bandpass', 1800, 1.2);
      case 'hat': return noise(t, 0.05, ev.gain, 'highpass', 7000, 0.8);
      default: {
        const type = station.voices[ev.voice] || 'sine';
        pitched(type, midiToFreq(ev.midi), t, ev.dur * spb, ev.gain, ev.voice === 'lead' && station.voices.distort);
      }
    }
  }

  // --- scheduler ------------------------------------------------------------------
  function scheduleBar(startTime) {
    const spb = 60 / station.bpm; // seconds per beat
    const swing = station.swing || 0;
    for (const ev of generateBar(station, barIndex)) {
      let t = startTime + ev.beat * spb;
      const frac = ev.beat - Math.floor(ev.beat);
      if (swing && Math.abs(frac - 0.5) < 0.01) t += swing * spb * 0.5; // delay the "and"s
      playEvent(ev, t, spb);
    }
    barIndex++;
    return startTime + 4 * spb; // 4 beats per bar
  }

  function tick() {
    if (!ctx) return;
    while (nextBarTime < ctx.currentTime + SCHEDULE_AHEAD) {
      nextBarTime = scheduleBar(nextBarTime);
    }
  }

  function startAudio() {
    ensureContext();
    if (ctx.state === 'suspended') ctx.resume();
    if (nextBarTime < ctx.currentTime) nextBarTime = ctx.currentTime + 0.1;
    if (!timer) timer = setInterval(tick, LOOKAHEAD_MS);
    tick();
  }

  function stopAudio() {
    if (timer) { clearInterval(timer); timer = 0; }
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  // effective playing = the player wants sound AND the tab is visible
  function apply() {
    if (!isMuted && !hiddenTab) startAudio();
    else stopAudio();
  }

  return {
    get muted() { return isMuted; },
    get stationId() { return station.id; },
    get stationName() { return station.name; },
    get volume() { return vol; },
    stations: getStations(),

    setMuted(m) { isMuted = !!m; apply(); },
    toggleMute() { isMuted = !isMuted; apply(); return isMuted; },

    setStation(id) {
      station = getStation(id);
      barIndex = 0;
      if (ctx) nextBarTime = ctx.currentTime + 0.05; // restart the loop on the new station promptly
      return station;
    },
    // prev/next around the dial.
    cycle(dir) {
      const list = getStations();
      const i = list.findIndex((s) => s.id === station.id);
      return this.setStation(list[(i + dir + list.length) % list.length].id);
    },

    setVolume(v) {
      vol = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = vol;
    },

    // Page Visibility: hush while the tab is in the background, resume when it returns.
    setHidden(h) { hiddenTab = !!h; apply(); },

    destroy() { stopAudio(); if (ctx) ctx.close(); ctx = null; },
  };
}
