// The things somebody put there.
//
// Everything else in the frame is geology or weather. These two are the only
// objects in the picture that had to be *carried up the mountain*, and that is
// their whole job: a landscape with no human trace in it is scenery, and a
// landscape with one is a place where somebody lives. The cultivator alone does
// not do it — she could be passing through.
//
// Both are built as single buffers rather than as assemblies of primitives. A
// censer made of a lathe, three cylinders and a torus is four draw calls for an
// object forty pixels across; merged it is one, and the budget for this whole
// stage is about four.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { applyTint } from './rock.js';
import { PLATFORM, stepTop } from './platform-plan.js';

/* ------------------------------------------------------------- the steps */

/**
 * Worn treads, all of them in one buffer.
 *
 * Each is a small irregular prism sunk into the platform: only the tread and a
 * sliver of riser is ever above the rock, which is what a step cut into a
 * mountain path looks like and also means the geometry never has to agree with
 * the relief under it. Six points per outline, jittered per step from its own
 * seed, so no two treads share a silhouette.
 *
 * Each tread's height comes from `stepTop()`, which seats it on the rock
 * directly under it — the platform's own relief included. Authored as an
 * absolute world height instead, the flight ended up buried: see the note on
 * `STEPS` in platform-plan.js.
 */
export function stepsGeometry(steps) {
  const pos = [];
  const idx = [];

  for (const s of steps) {
    const rand = mulberry32(s.seed);
    const sides = 6;
    const plan = [];
    for (let i = 0; i < sides; i++) {
      // Angles pushed off the even division, so the tread is not a hexagon.
      const a = ((i + 0.5) / sides) * Math.PI * 2 + (rand() - 0.5) * 0.42;
      const wear = 0.80 + rand() * 0.34;
      const lx = Math.cos(a) * (s.w / 2) * wear;
      const lz = Math.sin(a) * (s.d / 2) * wear;
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      plan.push([s.at[0] + lx * c - lz * sn, s.at[1] + lx * sn + lz * c]);
    }

    const tread = stepTop(s);
    const first = pos.length / 3;
    for (const [x, z] of plan) pos.push(x, tread + (rand() - 0.5) * 0.05, z);
    // The base is flared. A prism with vertical sides is a crate, and six of
    // them along a skyline read as cargo rather than as a path — the batter is
    // what says the tread was cut out of the rock it is standing on.
    const bot = pos.length / 3;
    for (const [x, z] of plan) {
      pos.push(s.at[0] + (x - s.at[0]) * 1.32, tread - s.h, s.at[1] + (z - s.at[1]) * 1.32);
    }
    // The tread, as a fan.
    for (let i = 1; i < sides - 1; i++) idx.push(first, first + i, first + i + 1);
    // The riser.
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      idx.push(first + i, bot + i, first + j, first + j, bot + i, bot + j);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Worn stone is *pale* stone, and here that is doing a job as well as telling
  // the truth. The platform is near-black by design, and at this camera the
  // whole flight occupies about two percent of frame height between the rim and
  // the figure — dark treads on dark rock are simply not there. Polished by
  // feet, the treads come out at roughly twice the platform's albedo and the
  // risers stay in shadow, which is the only reading the path gets.
  applyTint(g, { top: 1.65, bottom: 0.68, from: PLATFORM.top + 0.5, to: PLATFORM.top - 0.4 });
  return g;
}

/* ------------------------------------------------------------ the censer */

/**
 * A small three-legged burner, in one buffer: legs, body, rim, ears.
 *
 * Forty pixels tall in the shipped frame, so the only thing that survives is
 * the silhouette — three legs, a swelling body, a flat rim and two upright ears
 * is what says 鼎 rather than "pot" at that size, and it is six rings and two
 * boxes to say it.
 */
export function censerGeometry({ radius = 0.44, height = 0.62, seed = 21 } = {}) {
  const rand = mulberry32(seed);
  const pos = [];
  const idx = [];
  const sides = 7;

  const ring = (y, r) => {
    const base = pos.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const k = r * (1 + (rand() - 0.5) * 0.10);
      pos.push(Math.cos(a) * k, y, Math.sin(a) * k);
    }
    return base;
  };
  const skin = (a, b) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      idx.push(a + i, b + i, a + j, a + j, b + i, b + j);
    }
  };

  // The body: a foot that pinches in, a belly, and a rim that flares back out.
  const r0 = ring(height * 0.22, radius * 0.62);
  const r1 = ring(height * 0.58, radius * 1.00);
  const r2 = ring(height * 0.86, radius * 0.86);
  const r3 = ring(height, radius * 0.98);
  skin(r0, r1); skin(r1, r2); skin(r2, r3);
  // A lid the ash sits in — domed, so the top is not a hole.
  const cap = pos.length / 3;
  pos.push(0, height * 1.04, 0);
  for (let i = 0; i < sides; i++) idx.push(r3 + i, cap, r3 + ((i + 1) % sides));

  // Three legs, splayed. A four-legged vessel reads as furniture.
  for (let l = 0; l < 3; l++) {
    const a = (l / 3) * Math.PI * 2 + 0.4;
    const cx = Math.cos(a) * radius * 0.56;
    const cz = Math.sin(a) * radius * 0.56;
    const w = radius * 0.15;
    const base = pos.length / 3;
    for (const [dx, dz] of [[-w, -w], [w, -w], [w, w], [-w, w]]) {
      pos.push(cx + dx * 1.35, 0, cz + dz * 1.35);
    }
    for (const [dx, dz] of [[-w, -w], [w, -w], [w, w], [-w, w]]) {
      pos.push(cx + dx, height * 0.30, cz + dz);
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      idx.push(base + i, base + 4 + i, base + j, base + j, base + 4 + i, base + 4 + j);
    }
  }

  // Two ears on the rim: the detail that names the object.
  for (const side of [-1, 1]) {
    const cx = side * radius * 0.86;
    const w = radius * 0.11;
    const base = pos.length / 3;
    for (const y of [height * 0.92, height * 1.30]) {
      for (const [dx, dz] of [[-w, -w], [w, -w], [w, w], [-w, w]]) pos.push(cx + dx, y, dz);
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      idx.push(base + i, base + 4 + i, base + j, base + j, base + 4 + i, base + 4 + j);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* -------------------------------------------------------------- the smoke */

/**
 * The ribbon the smoke rises on: a narrow strip that widens as it climbs.
 *
 * A strip, not a particle stream. Motes read as sparks or as dust; smoke off a
 * stick of incense in still air is a *continuous* thread that only breaks up
 * near the top, and a thread is one quad column. The sway is in the vertex
 * shader (see makeSmokeMaterial), so this costs one draw call and no per-frame
 * work at all.
 *
 * `uv.y` runs 0 at the censer to 1 at the top, which is the coordinate
 * everything in the material is written against.
 */
export function smokeGeometry({ height = 3.1, width = 0.3, rows = 16 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    // Widening, but not linearly: a thread for the first third, then it opens.
    const w = width * (0.18 + t * t * 1.6);
    for (let c = 0; c < 2; c++) {
      pos.push((c - 0.5) * w, t * height, 0);
      uv.push(c, t);
    }
    if (r < rows) {
      const a = r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}
