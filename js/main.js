// Bootstrap and the main loop.
//
// The simulation runs on wall-clock time and never on frame count, so a phone
// that throttles the tab, sleeps, or drops to 20fps still ages you correctly.
// Rendering is the only thing that pauses.

import * as E from './engine.js';
import * as D from './data.js';
import { createView } from './view3d/index.js';
import { debugEnabled } from './view3d/dev-flag.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { fmt } from './format.js';

const CANVAS = document.getElementById('scene');
const AUTOSAVE_EVERY = 10;      // seconds
const SECLUSION_AFTER = 300;    // a gap longer than this counts as closed-door
const IDLE_AFTER = 120;         // seconds without input before we throttle frames
const IDLE_FPS = 15;

/* ---------------------------------------------------------------- storage */

const storage = (() => {
  try {
    localStorage.setItem('__probe', '1');
    localStorage.removeItem('__probe');
    return localStorage;
  } catch {
    // Private mode, or storage denied. Play on; just do not persist.
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    };
  }
})();

/* -------------------------------------------------------------- the game */

const saved = E.loadState(storage);
const game = E.createGame({ state: saved });

if (!saved) {
  game.chronicle('You wake on a cold mountain with nothing but a name.', 'plain');
  game.chronicle('The air here is thin, and something in it is worth breathing.', 'plain');
}

// Respect the OS accessibility setting unless the player has overridden it.
const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
if (prefersReduced && saved === null) game.state.settings.reducedMotion = true;

/* ------------------------------------------------------------------ view */

// The debug harness is dev-only. The module itself is imported dynamically
// further down, so a shipped build never fetches it — but the renderer has to
// know before it makes its context, because reading the canvas back for a
// contact sheet needs preserveDrawingBuffer.
const DEBUG = debugEnabled();

let view;
try {
  view = createView({
    canvas: CANVAS,
    settings: game.state.settings,
    debug: DEBUG,
    onTap: () => { audio.boot(); audio.resume(); ui.handleWorldTap(); },
    onDoubleTap: () => view.setFraming(ui.tab === 'sect' ? 'sect' : 'world'),
  });
} catch (err) {
  document.getElementById('boot').innerHTML =
    `<div class="boot-mark">道</div><div class="boot-text" style="max-width:32ch;text-align:center;line-height:1.6">
     This device could not start WebGL, so the mountain cannot be drawn.<br><br>
     ${String(err && err.message ? err.message : err)}</div>`;
  throw err;
}

const audio = createAudio(game.state.settings);
const ui = createUI({
  game, view, audio, storage,
  onQuality: (q) => view.setQuality(q), // 'auto' included — setQuality resolves it
});

view.setReducedMotion(game.state.settings.reducedMotion);

/* --------------------------------------------------- engine -> the world */

game.on((ev) => {
  switch (ev.type) {
    case 'record':
      audio.record();
      ui.toast(`Dao Record — ${ev.record.name} (+${ev.record.bonus}% Qi/s)`, 'gold');
      break;
    case 'expedition:done':
      audio.expedition();
      ui.toast(`Party returned: 🌿 ${fmt(ev.herbs)} · 🪙 ${fmt(ev.stones)}${ev.cores ? ` · 💠 ${ev.cores}` : ''}`, 'jade');
      break;
    case 'wither':
      audio.wither();
      ui.toast('Your allotted years are spent. The body withers.', 'bad');
      break;
    case 'death':
      view.liftSoul();
      view.setFraming('rebirth');
      view.inkDissolve(1);
      setTimeout(() => view.inkDissolve(-1), 1600);
      break;
    case 'rebirth':
      if (ev.forced) {
        audio.rebirth();
        ui.toast(`The shell failed. ☸ +${fmt(ev.gained)} Dao Insight carried through.`, 'gold');
      }
      break;
    case 'mastery':
      ui.toast(`${D.TECHNIQUE_BY_ID[ev.id].name} — mastered.`, 'jade');
      break;
    default:
      break;
  }
});

/* --------------------------------------------------------------- offline */

(function resumeFromSeclusion() {
  if (!saved || !saved.lastSeen) return;
  const elapsed = (Date.now() - saved.lastSeen) / 1000;
  if (elapsed < 60) {
    // A short absence is simply simulated at full rate: kinder, and simpler.
    let left = Math.max(0, elapsed);
    while (left > 0) { const step = Math.min(5, left); game.tick(step); left -= step; }
    return;
  }
  const report = game.applyOffline(elapsed);
  if (report) setTimeout(() => ui.offlineModal(report), 500);
})();

/* ------------------------------------------------------------ the loop */

let lastFrame = performance.now();
let lastSim = Date.now();
let sinceSave = 0;
let lastInput = performance.now();
let renderAccumulator = 0;

function markInput() { lastInput = performance.now(); }
for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(evt, markInput, { passive: true });
}

function simulate() {
  const now = Date.now();
  let gap = (now - lastSim) / 1000;
  lastSim = now;
  if (gap <= 0) return;

  if (gap > SECLUSION_AFTER) {
    const report = game.applyOffline(gap);
    if (report) ui.offlineModal(report);
    return;
  }
  // Chunked so a long catch-up never hands the engine one enormous tick.
  while (gap > 0) {
    const step = Math.min(5, gap);
    game.tick(step);
    gap -= step;
  }
}

let hudAccumulator = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.5, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;

  simulate();
  ui.updateMinigames(dt);

  hudAccumulator += dt;
  if (hudAccumulator >= 0.25) {
    hudAccumulator = 0;
    ui.tickHeader();
  }

  sinceSave += dt;
  if (sinceSave >= AUTOSAVE_EVERY) { sinceSave = 0; persist(); }

  // Never draw an unattended meditation scene at full rate. The simulation
  // above has already run; only the picture is throttled.
  if (document.hidden) return;
  const idle = (nowMs - lastInput) / 1000 > IDLE_AFTER;
  if (idle) {
    renderAccumulator += dt;
    if (renderAccumulator < 1 / IDLE_FPS) return;
    view.render(renderAccumulator);
    renderAccumulator = 0;
    return;
  }
  renderAccumulator = 0;
  view.render(dt);
}

/* ------------------------------------------------------------- persist */

function persist() {
  game.state.lastSeen = Date.now();
  E.saveState(storage, game.state);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
  else { lastSim = Date.now(); lastFrame = performance.now(); markInput(); }
});
window.addEventListener('pagehide', persist);
window.addEventListener('blur', persist);

/* ----------------------------------------------------------------- go */

ui.refresh();
ui.bootDone();
ui.resumePendingForge();
ui.resumePendingTribulation();
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ PWA */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline play still works from cache */ });
  });
}

// Handy for debugging in the field; harmless in production.
window.myriad = { game, view, ui, audio, E, D };

/* ------------------------------------------------------------- debug rig */

if (DEBUG) {
  import('./view3d/debug.js')
    .then(({ createDebugPanel }) => createDebugPanel({ view }))
    .catch((err) => console.warn('[debug] harness unavailable', err));
}
