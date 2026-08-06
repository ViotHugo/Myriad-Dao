// Cloth, as geometry.
//
// Everything the cultivator wears is one primitive: a grid of quads over a set
// of rows. A pleated skirt is rings of segments; a sleeve is two rings and a
// rolled mouth; a collar panel is a four-point strip with a little thickness; a
// sash tail is a flattened section swept down a line. Written once, they all
// weld into two draw calls at the end (see `mergeGeometries`), which is the only
// reason a figure can afford this many parts at all.
//
// The plan — every number, and the reason for it — is in `figure-plan.js`. This
// file knows how to build what that file describes and nothing else.

import * as THREE from 'three';
import { applyTint } from './rock.js';

/**
 * A grid of quads from `rows × columns` of world-space points.
 *
 * Rows run up the garment and columns run around it. What the caller does *not*
 * have to get right is the winding, and that is deliberate: half of these
 * surfaces are swept along an axis that points downward, where "counterclockwise
 * around the axis" is clockwise seen from the camera, and a garment built with
 * the winding backwards renders inside out — back faces culled, the front of the
 * robe simply missing, and nothing anywhere throws. So the builder decides:
 * every face is compared with the direction away from the shape's own centre,
 * and the whole index is flipped if the majority came out facing in. Every
 * surface in this file is closed and convex enough for that test to be exact.
 *
 * `flat` is the default because it is what makes a pleat a pleat: a
 * non-indexed buffer gives every triangle its own vertices, so
 * `computeVertexNormals` hands each facet its own normal and the toon ramp
 * steps at the fold instead of washing across it. Smooth is opt-in, for the
 * few things that are genuinely round.
 */
export function quiltGeometry(rows, { closed = false, flat = true, orient = true } = {}) {
  const R = rows.length;
  const C = rows[0].length;
  const pos = new Float32Array(R * C * 3);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const p = rows[r][c];
      const i = (r * C + c) * 3;
      pos[i] = p[0];
      pos[i + 1] = p[1];
      pos[i + 2] = p[2];
    }
  }
  const spans = closed ? C : C - 1;
  const idx = [];
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < spans; c++) {
      const c1 = (c + 1) % C;
      const a = r * C + c;
      const b = r * C + c1;
      const d = (r + 1) * C + c;
      const e = (r + 1) * C + c1;
      idx.push(a, b, d, b, e, d);
    }
  }
  if (orient && facesInward(pos, idx)) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (flat) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

/** Does the majority of this surface, by area, face its own centre? */
function facesInward(pos, idx) {
  const n = pos.length / 3;
  const mid = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    mid[0] += pos[i * 3];
    mid[1] += pos[i * 3 + 1];
    mid[2] += pos[i * 3 + 2];
  }
  mid[0] /= n; mid[1] /= n; mid[2] /= n;

  let vote = 0;
  const at = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  for (let i = 0; i < idx.length; i += 3) {
    const a = at(idx[i]);
    const b = at(idx[i + 1]);
    const c = at(idx[i + 2]);
    const face = cross(
      [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    );
    const out = [
      (a[0] + b[0] + c[0]) / 3 - mid[0],
      (a[1] + b[1] + c[1]) / 3 - mid[1],
      (a[2] + b[2] + c[2]) / 3 - mid[2],
    ];
    // Unnormalised on purpose: the dot is then weighted by the triangle's own
    // area, so a hem made of a hundred slivers cannot outvote a cap.
    vote += face[0] * out[0] + face[1] * out[1] + face[2] * out[2];
  }
  return vote < 0;
}

/** A ring of points at a height, at `radius(segment)`. Bearings, not angles. */
function ring(segments, height, radiusAt) {
  return segments.map((s, i) => {
    const r = radiusAt(s, i);
    return [Math.sin(s.angle) * r, typeof height === 'function' ? height(s, i) : height, Math.cos(s.angle) * r];
  });
}

/**
 * 裳 — the pleated lower robe.
 *
 * A lathe in everything but name: the profile is `rings`, and the only thing
 * that makes it cloth is that the radius is multiplied per *segment* by the
 * pleat table's alternating ridge and valley, and that the bottom row is the
 * plan's wandering hem rather than a level circle.
 *
 * The pleats fade out toward the waist (`fade`) because they have to: a fold
 * gathered under a sash is a fold that has been pulled flat, and pleats that
 * run at full depth into the belt read as fluting on a column instead.
 */
export function pleatedSkirtGeometry({ rings, segments, radiusAt, fade = 0.45 }) {
  const top = rings[rings.length - 1][0];
  const rows = [];
  // The hem row is the plan's own wobble; every row above it is a ring height.
  rows.push(ring(segments, (s) => s.hem, (s) => radiusAt(s.hem) * s.scale));
  for (const [y, r] of rings) {
    if (y <= rings[0][0]) continue;
    // 1 at the hem, `1 - fade` at the waist.
    const k = 1 - fade * ((y - rings[0][0]) / Math.max(1e-4, top - rings[0][0]));
    rows.push(ring(segments, y, (s) => r * (1 + (s.scale - 1) * k)));
  }
  return quiltGeometry(rows, { closed: true });
}

/**
 * The contrasting band at the hem: the same wobble, lifted proud of the cloth.
 *
 * It is a separate mesh in the trim tone rather than a stripe on the robe
 * because the robe has no texture and never will — the whole renderer is
 * untextured, so a band of another colour has to be another piece of geometry.
 */
export function hemBandGeometry({ segments, radiusAt, height, lift }) {
  const rows = [
    ring(segments, (s) => s.hem, (s) => radiusAt(s.hem) * s.scale + lift),
    ring(segments, (s) => s.hem + height, (s) => radiusAt(s.hem + height) * s.scale + lift),
  ];
  return quiltGeometry(rows, { closed: true });
}

/**
 * 袍 — the upper robe, from under the sash to the neck.
 *
 * Softer folds than the skirt (`fold`), because this is cloth stretched over a
 * body rather than cloth hanging off a belt, and a closing row at the top so
 * the neck opening is a hole in a solid rather than a view of the inside of the
 * shader.
 */
export function robeGeometry({ rings, segments, fold = 0.4 }) {
  const rows = rings.map(([y, r]) => ring(segments, y, (s) => r * (1 + (s.scale - 1) * fold)));
  const [topY] = rings[rings.length - 1];
  rows.push(ring(segments, topY + 0.012, () => 0.03));
  return quiltGeometry(rows, { closed: true });
}

/**
 * A collar panel: the plan's two edge lines, given a little thickness.
 *
 * Thickness rather than a flat strip for one reason — a single-sided ribbon is
 * invisible from behind, and the QA profile camera looks at this figure from
 * the side. Four columns closed into a prism costs sixteen vertices and cannot
 * disappear.
 */
export function collarPanelGeometry(rows, thickness = 0.008) {
  const grid = rows.map(([outer, inner]) => {
    const n = radial(outer);
    const push = (p, k) => [p[0] + n[0] * k, p[1], p[2] + n[2] * k];
    return [push(outer, thickness), push(inner, thickness), push(inner, -thickness), push(outer, -thickness)];
  });
  return quiltGeometry(grid, { closed: true });
}

/** The outward radial direction at a point — the surface normal of a lathe. */
function radial(p) {
  const l = Math.hypot(p[0], p[2]) || 1;
  return [p[0] / l, 0, p[2] / l];
}

/**
 * A tapered tube between two points: the arms, and the sleeves that hang off
 * them.
 *
 * `mouth` rolls the far end back on itself — an open tube seen from below is a
 * hole with the inside of the shader in it, and a sleeve is mostly seen from
 * below. Two extra rows turn it into a lip.
 */
export function tubeGeometry({ from, to, rTop, rBot, sides = 10, mouth = 0, capTop = true }) {
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const dir = axis.map((v) => v / len);
  // Any two directions across the axis. The axis is never world-vertical here —
  // every sleeve and arm leans — but the fallback keeps it honest if one ever is.
  const ref = Math.abs(dir[1]) > 0.94 ? [0, 0, 1] : [0, 1, 0];
  const u = norm(cross(ref, dir));
  const v = cross(dir, u);

  const at = (t, r, extra = 0) => {
    const c = [
      from[0] + axis[0] * t + dir[0] * extra,
      from[1] + axis[1] * t + dir[1] * extra,
      from[2] + axis[2] * t + dir[2] * extra,
    ];
    return Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      const cs = Math.cos(a) * r;
      const sn = Math.sin(a) * r;
      return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn];
    });
  };

  const rows = [];
  if (mouth > 0) {
    // Rolled lip: up inside the tube, then out to the rim, then down the body.
    rows.push(at(1, rBot * 0.62, -mouth));
    rows.push(at(1, rBot, 0));
  } else {
    rows.push(at(1, rBot));
  }
  rows.push(at(0, rTop));
  if (capTop) rows.push(at(0, rTop * 0.25, -0.01));
  return quiltGeometry(rows, { closed: true });
}

/**
 * 广袖 — a sleeve, built as a stack of **horizontal** rings.
 *
 * `rings` is `[y, centre x, centre z, radius]` from the shoulder down to the
 * mouth, and the horizontality is the whole point: cloth hangs under gravity
 * whatever the arm inside it is doing. Swept along a slanted axis instead — the
 * obvious way to build a tube — the mouth comes out slanted too, and at this
 * scale that put the far lip of the cuff thirteen centimetres inside the rock
 * she is sitting on, where a trim band this stage exists to show cannot be seen.
 *
 * `roll` turns the mouth back on itself. An open tube seen from below is a hole
 * with the inside of the shader in it, and a wide sleeve is mostly seen from
 * below.
 */
export function drapeGeometry({ rings, sides = 12, roll = 0 }) {
  const ringAt = (y, cx, cz, r) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  });
  const rows = [];
  const mouth = rings[rings.length - 1];
  if (roll > 0) rows.push(ringAt(mouth[0] + roll, mouth[1], mouth[2], mouth[3] * 0.62));
  // Rows have to run upward, and `rings` is authored top-down.
  for (let i = rings.length - 1; i >= 0; i--) rows.push(ringAt(...rings[i]));
  const top = rings[0];
  rows.push(ringAt(top[0] + 0.012, top[1], top[2], top[3] * 0.3));
  return quiltGeometry(rows, { closed: true });
}

/** The band round a sleeve's mouth, matching the one at the hem. */
export function drapeBandGeometry({ rings, height, lift, sides = 12 }) {
  const [y, cx, cz, r] = rings[rings.length - 1];
  const [y1, cx1, cz1, r1] = rings[rings.length - 2];
  const k = Math.min(1, height / Math.max(1e-4, y1 - y));
  return drapeGeometry({
    rings: [
      [y + height, cx + (cx1 - cx) * k, cz + (cz1 - cz) * k, r + (r1 - r) * k + lift],
      [y, cx, cz, r + lift],
    ],
    sides,
  });
}

/**
 * A ribbon swept down a line: the sash tails, and the tassel's cords.
 *
 * The section is a flattened rectangle whose wide axis runs *around* the body,
 * so a tail lies against the skirt the way a ribbon does rather than standing
 * on edge like a fin.
 */
export function ribbonGeometry({ points, width, thickness = 0.018, taper = 0.55 }) {
  const rows = points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tan = norm([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]);
    const out = radial(p);
    const across = norm(cross(tan, out));
    const k = 1 - taper * (i / Math.max(1, points.length - 1));
    const w = (width * k) / 2;
    const t = (thickness * k) / 2;
    const corner = (sw, st) => [
      p[0] + across[0] * sw * w + out[0] * st * t,
      p[1] + across[1] * sw * w + out[1] * st * t,
      p[2] + across[2] * sw * w + out[2] * st * t,
    ];
    return [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
  });
  return quiltGeometry(rows, { closed: true });
}

/**
 * The fake ambient occlusion the robe is graded with: a per-vertex albedo
 * multiplier that darkens toward the hem.
 *
 * Cloth in a fold is darker at the bottom of the fold and darker again where it
 * pools on the ground, and none of that is something a hemisphere light and a
 * key can produce on a lathe — both are functions of the normal, and every
 * point round a ring has the same normal at the same height. Baking it into the
 * albedo is a lerp at build time and it survives the sun swinging round eight
 * realms, which a shading term would not.
 */
export function gradeToHem(geo, { hem, waist, bottom = 0.60, top = 1.12 }) {
  return applyTint(geo, { top, bottom, from: waist, to: hem });
}

/* --------------------------------------------------------------- vectors */

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
