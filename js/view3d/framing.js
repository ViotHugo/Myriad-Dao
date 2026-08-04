// The maths to compose against the locked camera.
//
// The scenery is a painting, not a simulation: a peak matters because of where
// its summit lands in the frame, not where it stands in world space. Placing by
// world coordinate means re-guessing every number the moment the camera is
// retuned — and guessing badly, because the world framing looks down a diagonal,
// so the visible slice of world x at z = -140 is not something centred on zero.
// Half a range placed "around x = 0" is simply off-screen.
//
// So this module inverts the projection: name a depth and a point in the frame,
// get back the world position that lands there. It is deliberately free of
// Three.js — the same arithmetic runs in the test suite.
//
// The camera itself lives in camera-config.js, alone, so that "the framing" is
// a thing you can read in one sitting. This file only does arithmetic to it.

import { CAMERA } from './camera-config.js';

/** Named framings. Opening the Sect tab moves the camera; it does not hide the world. */
export const FRAMINGS = CAMERA.framings;

/**
 * Portrait phone, the frame the composition is authored for. Wider screens see
 * more to the sides, which is why placement overscans rather than filling
 * exactly to the edges.
 */
export const REFERENCE_ASPECT = CAMERA.referenceAspect;

/**
 * The camera basis for a framing, matching what the rig builds each update:
 * position from yaw/pitch/dist about the target, then `lookAt(target)` with
 * world up. Returned as plain arrays.
 */
export function cameraBasis(f = FRAMINGS.world) {
  const [tx, ty, tz] = f.target;
  const cp = Math.cos(f.pitch);
  // Mirrors the rig's own position formula, including its slight vertical bias.
  const pos = [
    tx + Math.sin(f.yaw) * cp * f.dist,
    ty + Math.sin(f.pitch) * f.dist + f.dist * 0.06,
    tz + Math.cos(f.yaw) * cp * f.dist,
  ];

  // Three's lookAt: z points back toward the camera, x = up × z, y = z × x.
  const z = norm([pos[0] - tx, pos[1] - ty, pos[2] - tz]);
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return { pos, x, y, z };
}

/**
 * Where in the frame a world point lands, as fractions of width and height
 * (0,0 top-left; 1,1 bottom-right). `behind` is true when the point is on the
 * wrong side of the camera, where the fractions are meaningless.
 */
export function frameOf(p, { framing = FRAMINGS.world, aspect = REFERENCE_ASPECT } = {}) {
  const b = cameraBasis(framing);
  const v = [p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]];
  const cz = dot(v, b.z);
  if (cz >= -1e-6) return { u: NaN, v: NaN, behind: true };
  const tanH = Math.tan((framing.fov * Math.PI) / 360);
  const ndcX = dot(v, b.x) / -cz / (tanH * aspect);
  const ndcY = dot(v, b.y) / -cz / tanH;
  return { u: ndcX * 0.5 + 0.5, v: 0.5 - ndcY * 0.5, behind: false };
}

/**
 * The inverse: the world point on the plane `z = worldZ` that lands at frame
 * position (u, v). Both projection equations are affine in (x, y) once the
 * depth plane is fixed, so this is a two-by-two solve rather than a search.
 */
export function placeAtDepth(u, v, worldZ, { framing = FRAMINGS.world, aspect = REFERENCE_ASPECT } = {}) {
  const b = cameraBasis(framing);
  const tanH = Math.tan((framing.fov * Math.PI) / 360);
  // Target NDC, and the slope each axis must satisfy against depth.
  const a = (u * 2 - 1) * tanH * aspect;
  const c = (1 - v * 2) * tanH;

  // camX + a·camZ = 0 and camY + c·camZ = 0, with cam* affine in world x,y.
  const konst = (axis) => (
    axis[0] * -b.pos[0] + axis[1] * -b.pos[1] + axis[2] * (worldZ - b.pos[2])
  );
  const r1 = [b.x[0] + a * b.z[0], b.x[1] + a * b.z[1], konst(b.x) + a * konst(b.z)];
  const r2 = [b.y[0] + c * b.z[0], b.y[1] + c * b.z[1], konst(b.y) + c * konst(b.z)];

  const det = r1[0] * r2[1] - r2[0] * r1[1];
  if (Math.abs(det) < 1e-9) return null; // degenerate: the plane is edge-on
  return [
    (-r1[2] * r2[1] + r2[2] * r1[1]) / det,
    (-r1[0] * r2[2] + r2[0] * r1[2]) / det,
    worldZ,
  ];
}

/** World units per frame-height at a given depth — how big to build things. */
export function unitsPerFrame(worldZ, opts = {}) {
  const top = placeAtDepth(0.5, 0, worldZ, opts);
  const bottom = placeAtDepth(0.5, 1, worldZ, opts);
  if (!top || !bottom) return 1;
  return Math.abs(top[1] - bottom[1]);
}

/**
 * Where the horizon lands, as a fraction down the frame.
 *
 * Not the skyline — the true horizon, the vanishing line of the ground plane,
 * which is a property of the lens and the tilt and nothing else. `lookAt` with
 * world up leaves no roll, so every horizontal direction at infinity projects
 * to the same height and this one number is the whole line. It is also
 * independent of aspect, which is why the contract can name it and mean it on
 * any screen.
 */
export function horizonV(framing = FRAMINGS.world) {
  const b = cameraBasis(framing);
  // Straight ahead, flattened onto the ground plane: a direction, not a point,
  // so this is where that direction goes when it is infinitely far away.
  const d = norm([-b.z[0], 0, -b.z[2]]);
  const tanH = Math.tan((framing.fov * Math.PI) / 360);
  const ndcY = dot(d, b.y) / -dot(d, b.z) / tanH;
  return 0.5 - ndcY * 0.5;
}

/** How much of the frame's height a vertical world segment covers. */
export function spanV(from, to, opts = {}) {
  const a = frameOf(from, opts);
  const b = frameOf(to, opts);
  if (a.behind || b.behind) return NaN;
  return Math.abs(a.v - b.v);
}

/**
 * The composition contract, measured rather than asserted: what a framing
 * actually does to the horizon and to the figure standing at the anchor.
 *
 * This is what the debug panel reads out live and what the test suite checks,
 * so the numbers on screen during QA and the numbers the gate passes on are the
 * same numbers.
 */
export function composition(framing = FRAMINGS.world, { aspect = REFERENCE_ASPECT } = {}) {
  const c = CAMERA.composition;
  const foot = c.characterAnchor;
  const head = [foot[0], foot[1] + c.characterHeight, foot[2]];
  const base = frameOf(foot, { framing, aspect });
  const crown = frameOf(head, { framing, aspect });
  return {
    horizonV: horizonV(framing),
    anchorU: base.u,
    anchorV: base.v,
    characterTopV: crown.v,
    characterHeightV: base.v - crown.v,
  };
}

/**
 * Every combination the contact sheet captures: four cameras across four
 * skies, in row-major order. Pure, so the count and the labels can be asserted
 * without a renderer anywhere near them.
 */
export function contactSheetPlan() {
  const cells = [];
  for (const preset of CAMERA.debugPresets) {
    for (const time of CAMERA.timesOfDay) {
      cells.push({ preset, time, label: `${preset.label} · ${time.label}` });
    }
  }
  return {
    columns: CAMERA.timesOfDay.length,
    rows: CAMERA.debugPresets.length,
    cells,
  };
}

/* ------------------------------------------------------------ tiny vectors */

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
