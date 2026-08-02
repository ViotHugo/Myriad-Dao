// Every sound in this game is synthesised at runtime. There are no audio files,
// and there is no music loop — the guqin is generated, sparse, and never repeats.

const GONG_PENTATONIC = [0, 2, 4, 7, 9]; // gong, shang, jue, zhi, yu
const ROOT = 174.61; // F3, low enough to sit under everything

export function createAudio(settings = {}) {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let echo = null;
  let booted = false;
  let musicTimer = null;
  let nextNoteAt = 0;

  const state = {
    sfx: settings.sfx !== false,
    music: settings.music !== false,
    haptics: settings.haptics !== false,
  };

  /* --------------------------------------------------------------- boot */

  /** Audio may only start inside a user gesture. Called from the first tap. */
  function boot() {
    if (booted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch {
      return; // no audio device, or the browser refused. The game plays on.
    }
    booted = true;

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = state.sfx ? 0.85 : 0;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = state.music ? 0.35 : 0;
    musicBus.connect(master);

    // "Valley echo": a feedback delay with the top rolled off, so repeats
    // recede into the mountains instead of stacking into mush.
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = 0.38;
    const fb = ctx.createGain();
    fb.gain.value = 0.44;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    delay.connect(wet);
    wet.connect(master);
    echo = delay;

    scheduleMusic();
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  /* ------------------------------------------------------------- voices */

  /** A plucked string: fast transient, filtered body, exponential decay. */
  function pluck(freq, { at = 0, gain = 0.3, decay = 1.6, bus = sfxBus, send = 0.35, type = 'triangle' } = {}) {
    if (!ctx || !bus) return;
    const t = now() + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.setValueAtTime(freq * 7, t);
    body.frequency.exponentialRampToValueAtTime(Math.max(220, freq * 1.6), t + decay * 0.7);
    body.Q.value = 1.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(body); body.connect(g); g.connect(bus);
    if (echo && send > 0) {
      const s = ctx.createGain();
      s.gain.value = send * gain;
      g.connect(s); s.connect(echo);
    }
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** A short filtered noise burst — nail on string, sparks, impacts. */
  function noise(at = 0, { gain = 0.2, decay = 0.18, freq = 2200, q = 0.9, type = 'bandpass' } = {}) {
    if (!ctx || !sfxBus) return;
    const t = now() + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * (decay + 0.05)));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filt); filt.connect(g); g.connect(sfxBus);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  function tone(freq, { at = 0, gain = 0.2, decay = 0.5, type = 'sine', send = 0.2 } = {}) {
    if (!ctx || !sfxBus) return;
    const t = now() + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g); g.connect(sfxBus);
    if (echo && send > 0) {
      const s = ctx.createGain();
      s.gain.value = send * gain;
      g.connect(s); s.connect(echo);
    }
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  const semitone = (n) => ROOT * Math.pow(2, n / 12);

  /* ---------------------------------------------------------- the guqin */

  // Sparse generative plucks on the gong-mode pentatonic. Gaps are long and
  // uneven; phrases are one to three notes. Nothing is ever scheduled twice.
  function scheduleMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = setInterval(() => {
      if (!ctx || !state.music) return;
      const t = ctx.currentTime;
      if (nextNoteAt < t) nextNoteAt = t + 0.5;
      while (nextNoteAt < t + 1.5) {
        const phrase = 1 + Math.floor(Math.random() * 3);
        let at = nextNoteAt - t;
        let degree = Math.floor(Math.random() * GONG_PENTATONIC.length);
        for (let i = 0; i < phrase; i++) {
          const octave = Math.random() < 0.28 ? 12 : Math.random() < 0.18 ? 24 : 0;
          pluck(semitone(GONG_PENTATONIC[degree] + octave), {
            at,
            gain: 0.12 + Math.random() * 0.10,
            decay: 2.2 + Math.random() * 2.4,
            bus: musicBus,
            send: 0.55,
          });
          at += 0.28 + Math.random() * 0.55;
          // Step by one degree, occasionally leap. Never a repeating figure.
          degree = (degree + (Math.random() < 0.7 ? 1 : 2) * (Math.random() < 0.5 ? 1 : -1)
            + GONG_PENTATONIC.length * 2) % GONG_PENTATONIC.length;
        }
        nextNoteAt = t + at + 2.0 + Math.random() * 5.0;
      }
    }, 400);
  }

  /* ------------------------------------------------------------ haptics */

  function buzz(pattern) {
    if (!state.haptics) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* some browsers refuse; fine */ }
    }
  }

  /* --------------------------------------------------------------- cues */

  let tapDegree = 0;
  const sfx = {
    tap() {
      // Walks the pentatonic so repeated tapping is a phrase, not a click.
      tapDegree = (tapDegree + 1) % GONG_PENTATONIC.length;
      pluck(semitone(GONG_PENTATONIC[tapDegree] + 24), { gain: 0.16, decay: 0.55, send: 0.25 });
      noise(0, { gain: 0.05, decay: 0.05, freq: 3600 });
      buzz(8);
    },
    purchase() {
      pluck(semitone(12), { gain: 0.20, decay: 0.9 });
      pluck(semitone(19), { at: 0.06, gain: 0.16, decay: 1.1 });
      buzz(12);
    },
    breakthrough() {
      // A rising three-note motif — the sound of one more step.
      [0, 4, 7].forEach((n, i) => {
        pluck(semitone(n + 12), { at: i * 0.13, gain: 0.26, decay: 1.6, send: 0.5 });
      });
      buzz([14, 40, 22]);
    },
    ascend() {
      // The gong: a struck bell with a slow, inharmonic bloom.
      tone(semitone(-12), { gain: 0.36, decay: 5.5, type: 'sine', send: 0.7 });
      tone(semitone(-12) * 1.51, { at: 0.01, gain: 0.14, decay: 4.2, type: 'sine', send: 0.7 });
      tone(semitone(-12) * 2.02, { at: 0.02, gain: 0.09, decay: 3.4, type: 'sine', send: 0.7 });
      noise(0, { gain: 0.18, decay: 0.5, freq: 900, q: 0.4 });
      buzz([30, 60, 30, 120]);
    },
    deviation() {
      // Two detuned saws beating against each other. It should feel wrong.
      tone(semitone(1), { gain: 0.18, decay: 1.3, type: 'sawtooth', send: 0.1 });
      tone(semitone(1) * 1.031, { gain: 0.18, decay: 1.3, type: 'sawtooth', send: 0.1 });
      noise(0, { gain: 0.12, decay: 0.6, freq: 320, q: 0.5, type: 'lowpass' });
      buzz([60, 40, 60]);
    },
    forge(rarityIndex = 0) {
      const base = semitone(12 + rarityIndex * 3);
      tone(base, { gain: 0.24, decay: 1.0, type: 'triangle', send: 0.4 });
      noise(0, { gain: 0.16, decay: 0.12, freq: 5200 });
      if (rarityIndex >= 4) {
        // Immortal gets an arpeggio; you should hear it from the next room.
        [0, 4, 7, 12, 16].forEach((n, i) => {
          pluck(semitone(n + 24), { at: 0.10 + i * 0.09, gain: 0.22, decay: 2.4, send: 0.6 });
        });
        buzz([20, 40, 20, 40, 90]);
      } else buzz(rarityIndex >= 3 ? [16, 30, 16] : 14);
    },
    clashHit() {
      noise(0, { gain: 0.22, decay: 0.14, freq: 3000, q: 2.2 });
      tone(semitone(7 + 12), { gain: 0.18, decay: 0.4, type: 'square', send: 0.2 });
      buzz(18);
    },
    clashMiss() {
      noise(0, { gain: 0.13, decay: 0.22, freq: 700, q: 0.7 });
      buzz(6);
    },
    victory() {
      [0, 7, 12].forEach((n, i) => pluck(semitone(n + 12), { at: i * 0.10, gain: 0.24, decay: 1.8, send: 0.5 }));
      buzz([20, 50, 20]);
    },
    defeat() {
      [7, 3, 0].forEach((n, i) => pluck(semitone(n), { at: i * 0.14, gain: 0.20, decay: 1.6, send: 0.4 }));
      buzz([80]);
    },
    record() {
      // A small bell, two octaves up, with a long tail.
      tone(semitone(24), { gain: 0.20, decay: 2.6, type: 'sine', send: 0.65 });
      tone(semitone(31), { at: 0.05, gain: 0.12, decay: 2.2, type: 'sine', send: 0.65 });
      buzz([10, 30, 10]);
    },
    expedition() {
      pluck(semitone(4), { gain: 0.18, decay: 1.2, send: 0.4 });
      pluck(semitone(9), { at: 0.1, gain: 0.14, decay: 1.4, send: 0.4 });
      buzz(10);
    },
    pill() {
      tone(semitone(16), { gain: 0.16, decay: 0.7, type: 'sine', send: 0.3 });
      noise(0.02, { gain: 0.06, decay: 0.3, freq: 1400 });
      buzz(10);
    },
    meridian() {
      pluck(semitone(2 + 12), { gain: 0.22, decay: 1.8, send: 0.55 });
      pluck(semitone(9 + 12), { at: 0.08, gain: 0.16, decay: 2.0, send: 0.55 });
      buzz([12, 24, 12]);
    },
    rebirth() {
      tone(semitone(-12), { gain: 0.30, decay: 6.0, type: 'sine', send: 0.8 });
      [0, 2, 4, 7, 9, 12].forEach((n, i) =>
        pluck(semitone(n + 12), { at: 0.25 + i * 0.16, gain: 0.18, decay: 3.0, send: 0.7 }));
      buzz([40, 80, 40, 80, 200]);
    },
    wither() {
      tone(semitone(-1), { gain: 0.16, decay: 2.4, type: 'sawtooth', send: 0.2 });
      buzz([100, 60, 100]);
    },
  };

  /* ----------------------------------------------------------- settings */

  function set(key, value) {
    state[key] = !!value;
    if (!ctx) return;
    if (key === 'sfx' && sfxBus) sfxBus.gain.value = value ? 0.85 : 0;
    if (key === 'music' && musicBus) musicBus.gain.value = value ? 0.35 : 0;
  }

  const guarded = {};
  for (const [name, fn] of Object.entries(sfx)) {
    guarded[name] = (...args) => {
      if (!booted || !ctx) return;
      if (!state.sfx && name !== 'tap') { buzzOnly(name); return; }
      if (!state.sfx) { buzzOnly(name); return; }
      try { fn(...args); } catch { /* audio must never break the game */ }
    };
  }
  // Haptics stay on even with sound off — they are a separate setting.
  function buzzOnly(name) {
    if (name === 'tap') buzz(8);
    else if (name === 'ascend' || name === 'rebirth') buzz([30, 60, 30, 120]);
    else buzz(12);
  }

  return {
    boot, resume, set,
    get booted() { return booted; },
    get state() { return { ...state }; },
    ...guarded,
  };
}
