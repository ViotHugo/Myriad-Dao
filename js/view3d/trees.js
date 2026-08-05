// Pines, as geometry.
//
// A Chinese pine is not a cone. 松 is drawn — and grows — as a bare, often
// leaning stem carrying a few **horizontal plates** of foliage with sky between
// them, and the sky between them is most of the shape. A cone is a fir, it is
// the silhouette of a Christmas card, and a row of them across a Chinese
// mountain reads as Bavaria.
//
// It also matters more here than the size of these things suggests, because at
// this camera a pine is the only object in the midground that is *man-height*.
// It is the scale cue for the whole landform: whatever shape it is, the eye
// takes it as "a tree" and sizes the mountain behind it accordingly. A shape
// that reads as the wrong tree sizes the mountain to the wrong continent.
//
// Three or four discs, each with a jittered outline and a slight droop at the
// rim so it catches the light as a plate rather than as a card. Flat shaded by
// the material, which is what turns the droop into a visible edge.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';

/**
 * A pine occupying y in [0, ~1.1], radius about 0.5 at the widest plate, so
 * callers scale it by the height they want.
 *
 * The stem runs the whole height rather than stopping under the lowest plate:
 * the gap between the plates is the shape, and a stem that does not cross it is
 * three discs floating in a row.
 */
export function pineGeometry({ seed = 3, tiers = 4 } = {}) {
  const rand = mulberry32(seed);
  const pos = [];
  const idx = [];

  const ring = (y, r, sides, jag = 0) => {
    const base = pos.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const k = r * (1 + (rand() - 0.5) * jag);
      pos.push(Math.cos(a) * k, y, Math.sin(a) * k);
    }
    return base;
  };

  // The stem: four-sided, tapering, and leaning very slightly so the plates do
  // not stack concentrically.
  const lean = (rand() - 0.5) * 0.06;
  const b0 = ring(0, 0.055, 4);
  const b1 = ring(1.05, 0.026, 4);
  for (let i = 0; i < 4; i++) pos[(b1 + i) * 3] += lean;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(b0 + i, b1 + i, b0 + j, b0 + j, b1 + i, b1 + j);
  }

  // The plates. Each is a shallow double cone: a raised centre, a rim that
  // droops, and no two rims the same radius or the same heading.
  const PLATES = [
    { y: 0.30, r: 0.50 }, { y: 0.53, r: 0.40 }, { y: 0.74, r: 0.29 }, { y: 0.91, r: 0.18 },
  ];
  for (let t = 0; t < Math.min(tiers, PLATES.length); t++) {
    const p = PLATES[t];
    const sides = 7;
    const y = p.y + (rand() - 0.5) * 0.04;
    const rim = ring(y - 0.035 - p.r * 0.10, p.r, sides, 0.34);
    // Spin each plate off its neighbours, or the outlines line up into a cone.
    const spin = rand() * 0.9;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + spin;
      const k = Math.hypot(pos[(rim + i) * 3], pos[(rim + i) * 3 + 2]);
      pos[(rim + i) * 3] = Math.cos(a) * k + lean * (y / 1.05);
      pos[(rim + i) * 3 + 2] = Math.sin(a) * k;
    }
    const crown = pos.length / 3;
    pos.push(lean * (y / 1.05), y + 0.05, 0);
    const under = pos.length / 3;
    pos.push(lean * (y / 1.05), y - 0.06, 0);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      idx.push(rim + i, crown, rim + j);      // the lit top of the plate
      idx.push(rim + j, under, rim + i);      // and its shaded underside
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
