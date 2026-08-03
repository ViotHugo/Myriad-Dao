// Broken rock, as geometry.
//
// Every outcrop in the scene used to be a THREE.ConeGeometry with five or six
// sides. A low-sided cone is a pyramid, and a pyramid is one of the few shapes
// the eye can name instantly and never mistakes for landscape — the ledge under
// the plum tree and the two spurs behind the pines all read as tents pitched in
// the valley.
//
// A crag is the fix, and it is only three ideas: an outline that is not a
// circle, a cross-section that changes as it falls, and a drift off the
// vertical so the mass is not a solid of revolution. It costs the same draw
// call.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';

/**
 * An outcrop occupying y in [-1, 0], radius about 1 at its top.
 *
 * Built top-down because that is how it is used: the flat-ish crown is where
 * something stands, and the mass falls away beneath it into whatever haze is
 * down there. `jag` is how broken it is, `taper` how much it narrows going down,
 * `drift` how far it leans out of plumb over its own height.
 */
export function cragGeometry({
  seed = 1, sides = 9, rings = 5, taper = 0.42, jag = 0.30, drift = 0.22, crown = 0.14,
} = {}) {
  const rand = mulberry32(seed);
  // An irregular plan, so the silhouette differs from every angle.
  const outline = Array.from({ length: sides }, () => 0.66 + rand() * 0.46);
  // A wobble per ring and side: bedding that does not line up into a cone.
  const wob = Array.from({ length: (rings + 1) * sides }, () => 1 + (rand() - 0.5) * jag);

  const pos = [];
  const idx = [];
  const stride = sides + 1;

  // Rings run foot-to-crown so the winding matches every other lathed shape in
  // the scene. Built crown-down instead, the same index order faces every
  // triangle inward, back-face culling shows the inside of the rock, and the
  // shading comes out inverted — a dark crag renders as a white slab.
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;                       // 0 at the foot, 1 at the crown
    const fall = 1 - t;
    const width = 1 - taper * fall * fall;
    const lean = fall * fall * drift;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const rad = outline[s % sides] * width * wob[r * sides + (s % sides)];
      pos.push(Math.cos(a) * rad + lean, t - 1, Math.sin(a) * rad - lean * 0.5);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * stride + s;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  // A crown that is nearly flat — this is a ledge, not a summit — but domed
  // just enough that it catches the light differently from the walls.
  const top = pos.length / 3;
  pos.push(0, crown, 0);
  for (let s = 0; s < sides; s++) idx.push(rings * stride + s, top, rings * stride + s + 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A standing stone: the same rock, stubbier and pointed, for the shelf. */
export function stoneGeometry(seed = 7) {
  return cragGeometry({ seed, sides: 7, rings: 4, taper: 0.62, jag: 0.42, drift: 0.10, crown: 0.05 });
}
