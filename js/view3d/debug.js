// The debug harness. Dev-only, loaded on demand, shipped to nobody.
//
// ---------------------------------------------------------------------------
// Why this is the first thing that got built
//
// "Does this look better" is not a gate. It is a feeling, and feelings about a
// picture change with the light in the room and how long you have been staring
// at it. Every art call from here on has to be answerable with something that
// does not depend on the person asking, so the instruments come before the art:
//
//   G  grayscale — the frame as pure value. An ink-wash landscape is a value
//      ladder before it is anything else, and colour is very good at hiding a
//      ladder that has collapsed. If the range and the sky are the same grey
//      here, the picture is broken no matter how it looks in colour.
//   W  wireframe — what is actually there, as opposed to what the fog is
//      letting you believe is there.
//   S  safe zones — the bottom 30% belongs to the UI and the top 12% to the
//      status bar. Anything composed into those bands is composed into a place
//      the player cannot see.
//   T  the day as a dial — dawn, day, sunset, night and round again,
//      continuously, with the realm's own ink held still underneath it. A
//      composition that only works at dusk is not a composition, it is a
//      coincidence, and this is the key that says which one you have.
//   C  four fixed cameras — the same shot every time, so two builds can be put
//      side by side and the difference is the build.
//
// And the contact sheet: four cameras × four times of day, sixteen frames, one
// image.
// That is the artefact a gate is argued over.
//
// main.js imports this module dynamically and only when the harness is asked
// for, so a shipped build never fetches the file at all.
// ---------------------------------------------------------------------------

import { CAMERA } from './camera-config.js';
import { composition, contactSheetPlan } from './framing.js';

export { debugEnabled } from './dev-flag.js';

const PANEL_CSS = `
#mdbg {
  position: fixed; top: 8px; left: 8px; z-index: 2147483000;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #d8e2ec; background: rgba(8, 11, 15, 0.82);
  border: 1px solid rgba(180, 200, 220, 0.22); border-radius: 6px;
  padding: 7px 9px; min-width: 216px; backdrop-filter: blur(3px);
  user-select: none; pointer-events: auto;
}
#mdbg[hidden] { display: none; }
#mdbg b { color: #e8b34b; font-weight: 600; }
#mdbg .mdbg-k { color: #7f8b99; }
#mdbg .mdbg-on { color: #35c98e; }
#mdbg .mdbg-off { color: #59626d; }
#mdbg .mdbg-bad { color: #e06a72; }
#mdbg hr { border: 0; border-top: 1px solid rgba(180, 200, 220, 0.16); margin: 5px 0; }
#mdbg input[type=range] { width: 100%; margin: 3px 0 0; accent-color: #e8b34b; }
#mdbg .mdbg-hint { color: #6d7783; font-size: 10px; }

#mdbg-safe { position: fixed; inset: 0; z-index: 2147482000; pointer-events: none; }
#mdbg-safe[hidden] { display: none; }
#mdbg-safe .band {
  position: absolute; left: 0; right: 0;
  background: rgba(224, 58, 72, 0.26);
  border-color: rgba(255, 120, 130, 0.75); border-style: solid; border-width: 0;
}
#mdbg-safe .band span {
  position: absolute; right: 6px; font: 10px/1 ui-monospace, monospace;
  color: #ffd9dc; text-shadow: 0 1px 2px #000;
}
#mdbg-safe .rule {
  position: absolute; left: 0; right: 0; height: 0;
  border-top: 1px dashed rgba(120, 220, 255, 0.85);
}
#mdbg-safe .rule span {
  position: absolute; left: 6px; top: 2px; font: 10px/1 ui-monospace, monospace;
  color: #9fe4ff; text-shadow: 0 1px 2px #000;
}
#mdbg-safe .figure {
  position: absolute; border: 1px solid rgba(120, 255, 180, 0.9);
  background: rgba(60, 220, 150, 0.10);
}
`;

/**
 * Build the panel and wire the keys. Returns a handle with `dispose()`; the
 * capture helper is also hung on `window.myriadDebug` so a headless driver — or
 * you, in a console — can reach it without a keystroke.
 */
export function createDebugPanel({ view, doc = document, win = window } = {}) {
  const style = doc.createElement('style');
  style.textContent = PANEL_CSS;
  doc.head.appendChild(style);

  /* --------------------------------------------------------------- state */

  const state = {
    grayscale: false,
    wireframe: false,
    safe: false,
    scrub: false,
    preset: -1, // -1 = the game's own camera
  };
  let time = 0.5;

  /* --------------------------------------------------------------- panel */

  const panel = doc.createElement('div');
  panel.id = 'mdbg';
  panel.innerHTML = `
    <div><b>debug</b> <span class="mdbg-k">\` hide · P sheet</span></div>
    <hr>
    <div id="mdbg-perf"></div>
    <div id="mdbg-frame"></div>
    <hr>
    <div id="mdbg-comp"></div>
    <hr>
    <div id="mdbg-toggles"></div>
    <input id="mdbg-tod" type="range" min="0" max="1" step="0.001" value="0.5">
    <div class="mdbg-hint">T scrub · ←/→ step · C camera</div>
  `;
  doc.body.appendChild(panel);

  const safe = doc.createElement('div');
  safe.id = 'mdbg-safe';
  safe.hidden = true;
  const z = CAMERA.safeZone;
  safe.innerHTML = `
    <div class="band" style="top:0;height:${z.top * 100}%;border-bottom-width:1px">
      <span style="bottom:3px">status bar · top ${Math.round(z.top * 100)}%</span>
    </div>
    <div class="band" style="bottom:0;height:${z.bottom * 100}%;border-top-width:1px">
      <span style="top:3px">UI · bottom ${Math.round(z.bottom * 100)}%</span>
    </div>
    <div class="rule" id="mdbg-horizon"><span></span></div>
    <div class="rule" id="mdbg-anchor"><span></span></div>
    <div class="figure" id="mdbg-figure"></div>
  `;
  doc.body.appendChild(safe);

  const $ = (id) => panel.querySelector(id) || safe.querySelector(id);
  const perfEl = $('#mdbg-perf');
  const frameEl = $('#mdbg-frame');
  const compEl = $('#mdbg-comp');
  const togglesEl = $('#mdbg-toggles');
  const todEl = $('#mdbg-tod');
  const horizonEl = $('#mdbg-horizon');
  const anchorEl = $('#mdbg-anchor');
  const figureEl = $('#mdbg-figure');

  /* ------------------------------------------------------------- actions */

  function apply() {
    view.qa.setGrayscale(state.grayscale);
    view.qa.setWireframe(state.wireframe);
    safe.hidden = !state.safe;
    view.qa.setTimeOfDay(state.scrub ? time : null);
    view.qa.setPose(state.preset < 0 ? null : CAMERA.debugPresets[state.preset].framing);
  }

  function cyclePreset() {
    // -1 → 0 → 1 → 2 → 3 → -1: the four fixed cameras, then back to the game's.
    state.preset = state.preset >= CAMERA.debugPresets.length - 1 ? -1 : state.preset + 1;
    apply();
  }

  function step(delta) {
    if (!state.scrub) { state.scrub = true; }
    time = Math.max(0, Math.min(1, time + delta));
    todEl.value = String(time);
    apply();
  }

  todEl.addEventListener('input', () => {
    time = Number(todEl.value);
    state.scrub = true;
    apply();
  });

  /* ---------------------------------------------------------------- keys */

  const KEYS = {
    g: () => { state.grayscale = !state.grayscale; apply(); },
    w: () => { state.wireframe = !state.wireframe; apply(); },
    s: () => { state.safe = !state.safe; apply(); },
    t: () => { state.scrub = !state.scrub; apply(); },
    c: cyclePreset,
    p: () => {
      // The capture borrows the camera and the sky and hands them back to the
      // game; `apply()` puts them back where the panel says they should be.
      downloadContactSheet(view).then(apply, (e) => { console.error('[debug] sheet failed', e); apply(); });
    },
    '`': () => { panel.hidden = !panel.hidden; },
    arrowleft: (e) => step(e.shiftKey ? -0.005 : -0.05),
    arrowright: (e) => step(e.shiftKey ? 0.005 : 0.05),
  };

  function onKey(e) {
    // Never eat a keystroke meant for a field, and never fight a browser
    // shortcut — Ctrl+S has to stay Save, not "safe zones".
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const fn = KEYS[e.key.toLowerCase()];
    if (!fn) return;
    e.preventDefault();
    fn(e);
  }
  win.addEventListener('keydown', onKey);

  /* -------------------------------------------------------------- readout */

  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const flag = (on, label) => `<span class="${on ? 'mdbg-on' : 'mdbg-off'}">${label}</span>`;

  function inBand(v, lo, hi) { return v >= lo && v <= hi; }

  let raf = 0;
  function tick() {
    raf = win.requestAnimationFrame(tick);
    if (panel.hidden && safe.hidden) return;

    const s = view.qa.stats();
    perfEl.innerHTML = `<b>${s.fps.toFixed(0)}</b> fps · <b>${s.calls}</b> draws · `
      + `<b>${s.triangles.toLocaleString()}</b> tris`;
    frameEl.innerHTML = `<span class="mdbg-k">${s.tier} · ${s.width}×${s.height} `
      + `(${s.aspect.toFixed(3)}) · ${s.bufferWidth}×${s.bufferHeight}</span>`;

    // The camera contract, measured at the aspect actually on screen — so a
    // desktop window shows you honestly how far the framing has drifted from
    // the portrait crop the game is authored for.
    const c = composition(s.pose, { aspect: s.aspect });
    const tol = CAMERA.composition.tolerance;
    const want = CAMERA.composition;
    const judge = (value, wanted, t) => (Math.abs(value - wanted) <= t ? '' : ' class="mdbg-bad"');
    compEl.innerHTML = `
      <div>horizon <b${judge(c.horizonV, want.horizonV, tol.horizonV)}>${pct(c.horizonV)}</b>
        <span class="mdbg-k">want ${pct(want.horizonV)}</span></div>
      <div>anchor <b${judge(c.anchorV, want.anchorV, tol.anchorV)}>${pct(c.anchorV)}</b>
        <span class="mdbg-k">want ${pct(want.anchorV)}</span></div>
      <div>figure <b${judge(c.characterHeightV, want.characterHeightV, tol.characterHeightV)}>${pct(c.characterHeightV)}</b>
        <span class="mdbg-k">want 12–15%</span></div>
      <div class="mdbg-k">camera ${s.framing} · fov ${s.pose.fov}</div>`;

    togglesEl.innerHTML = [
      flag(s.grayscale, 'G gray'), flag(s.wireframe, 'W wire'), flag(state.safe, 'S safe'),
      flag(state.scrub, `T ${state.scrub ? time.toFixed(2) : 'off'}`),
      flag(state.preset >= 0, `C ${state.preset < 0 ? 'game' : CAMERA.debugPresets[state.preset].label}`),
    ].join(' · ')
      // The day, always — the hour is the axis every art call after stage 2 is
      // judged across, so it is on screen whether QA is holding it or not.
      + `<div class="mdbg-k">day <b>${s.dayName}</b> ${s.day.toFixed(3)}`
      + ` · exp ${s.exposure.toFixed(2)} · fog ${s.fogDensity.toFixed(4)}`
      + ` · realm ${s.realm}</div>`;

    if (!safe.hidden) {
      horizonEl.style.top = `${c.horizonV * 100}%`;
      horizonEl.firstElementChild.textContent = `horizon ${pct(c.horizonV)}`;
      anchorEl.style.top = `${c.anchorV * 100}%`;
      anchorEl.firstElementChild.textContent = `anchor ${pct(c.anchorV)}`;
      // The figure's box, and it turns red when she leaves the band she is
      // meant to live in.
      figureEl.style.top = `${c.characterTopV * 100}%`;
      figureEl.style.height = `${Math.max(0, c.characterHeightV) * 100}%`;
      figureEl.style.left = `${(c.anchorU - 0.05) * 100}%`;
      figureEl.style.width = '10%';
      const ok = inBand(c.characterHeightV, 0.12, 0.15) && inBand(c.anchorV, 0.60, 0.62);
      figureEl.style.borderColor = ok ? 'rgba(120,255,180,0.9)' : 'rgba(255,120,130,0.95)';
    }
  }
  raf = win.requestAnimationFrame(tick);

  apply();

  win.myriadDebug = {
    state,
    view,
    panel,
    contactSheet: (opts) => contactSheet(view, opts),
    download: (opts) => downloadContactSheet(view, opts),
    plan: contactSheetPlan,
    composition: (framing, opts) => composition(framing || view.qa.stats().pose, opts),
  };

  return {
    dispose() {
      win.cancelAnimationFrame(raf);
      win.removeEventListener('keydown', onKey);
      panel.remove();
      safe.remove();
      style.remove();
      delete win.myriadDebug;
    },
  };
}

/* ------------------------------------------------------------ the sheet */

const SHEET = {
  cellWidth: 270,
  scale: 2,        // render at 2× and downsample: the sheet is read at a glance
  gutter: 8,
  pad: 10,
  header: 30,
  caption: 20,
  ink: '#0b0e12',
  paper: '#8e9099',
};

/**
 * Four cameras × four skies, captured into one image, plus each frame on its
 * own. Sixteen renders in one synchronous burst — nothing is allowed to animate
 * between them, so two runs of this on the same build produce the same picture
 * and a diff between builds is a real difference.
 *
 * Honours whatever the `G` key is currently set to, so `contactSheet()` with
 * grayscale on gives you the value-ladder sheet.
 */
export async function contactSheet(view, opts = {}) {
  const cfg = { ...SHEET, ...opts };
  const plan = contactSheetPlan();
  const cw = Math.round(cfg.cellWidth);
  const ch = Math.round(cw / CAMERA.referenceAspect);
  const rw = cw * cfg.scale;
  const rh = ch * cfg.scale;

  const sheet = document.createElement('canvas');
  sheet.width = cfg.pad * 2 + plan.columns * cw + (plan.columns - 1) * cfg.gutter;
  sheet.height = cfg.pad * 2 + cfg.header
    + plan.rows * (ch + cfg.caption) + (plan.rows - 1) * cfg.gutter;
  const g = sheet.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.fillStyle = cfg.ink;
  g.fillRect(0, 0, sheet.width, sheet.height);

  const cell = document.createElement('canvas');
  cell.width = rw;
  cell.height = rh;
  const cg = cell.getContext('2d');

  const before = view.qa.stats();
  const cells = [];

  try {
    for (let i = 0; i < plan.cells.length; i++) {
      const { preset, time, label } = plan.cells[i];
      const row = Math.floor(i / plan.columns);
      const col = i % plan.columns;

      view.qa.setPose(preset.framing);
      view.qa.setTimeOfDay(time.t);
      view.qa.captureFrame(rw, rh);
      // Read back immediately, in the same tick as the render.
      cg.drawImage(view.renderer.domElement, 0, 0, rw, rh);
      if (cfg.guides) drawGuides(cg, rw, rh);

      const x = cfg.pad + col * (cw + cfg.gutter);
      const y = cfg.pad + cfg.header + row * (ch + cfg.caption + cfg.gutter);
      g.drawImage(cell, x, y, cw, ch);
      g.fillStyle = cfg.paper;
      g.font = '12px ui-monospace, Menlo, Consolas, monospace';
      g.textBaseline = 'middle';
      g.fillText(label, x + 1, y + ch + cfg.caption / 2 + 1);

      cells.push({
        id: `${preset.id}-${time.id}`,
        label,
        preset: preset.id,
        time: time.id,
        t: time.t,
        width: rw,
        height: rh,
        dataUrl: cell.toDataURL('image/png'),
      });
    }
  } finally {
    // Whatever happened, hand the camera and the sky back to the game.
    view.qa.setPose(null);
    view.qa.setTimeOfDay(before.timeOfDay);
    view.resize();
  }

  g.fillStyle = cfg.paper;
  g.font = '13px ui-monospace, Menlo, Consolas, monospace';
  g.textBaseline = 'middle';
  g.fillText(
    `Myriad Dao — ${plan.rows}×${plan.columns} contact sheet · fov ${CAMERA.fov} · `
    + `horizon ${(CAMERA.composition.horizonV * 100).toFixed(0)}% · `
    + `${before.grayscale ? 'grayscale' : 'colour'} · ${new Date().toISOString().slice(0, 19)}Z`,
    cfg.pad, cfg.pad + cfg.header / 2,
  );

  return {
    width: sheet.width,
    height: sheet.height,
    rows: plan.rows,
    columns: plan.columns,
    grayscale: before.grayscale,
    dataUrl: sheet.toDataURL('image/png'),
    cells,
  };
}

/** The safe zones and the composition rules, burned into a captured cell. */
function drawGuides(g, w, h) {
  const z = CAMERA.safeZone;
  g.save();
  g.fillStyle = 'rgba(224, 58, 72, 0.24)';
  g.fillRect(0, 0, w, h * z.top);
  g.fillRect(0, h * (1 - z.bottom), w, h * z.bottom);
  g.strokeStyle = 'rgba(120, 220, 255, 0.9)';
  g.lineWidth = Math.max(1, w / 540);
  g.setLineDash([6, 5]);
  for (const v of [CAMERA.composition.horizonV, CAMERA.composition.anchorV]) {
    g.beginPath();
    g.moveTo(0, h * v);
    g.lineTo(w, h * v);
    g.stroke();
  }
  g.restore();
}

/** Same sheet, straight to the downloads folder. */
export async function downloadContactSheet(view, opts = {}) {
  const out = await contactSheet(view, opts);
  const a = document.createElement('a');
  a.href = out.dataUrl;
  a.download = `myriad-contact-sheet${out.grayscale ? '-gray' : ''}.png`;
  a.click();
  return out;
}
