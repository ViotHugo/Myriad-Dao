// Broken rock, as geometry.
//
// Every outcrop in the scene used to be a THREE.ConeGeometry with five or six
// sides. A low-sided cone is a pyramid, and a pyramid is one of the few shapes
// the eye can name instantly and never mistakes for landscape — the ledge under
// the plum tree and the two spurs behind the pines all read as tents pitched in
// the valley. (Both of those are gone now — the plum stands on the platform
// since stage 5 and the spurs are part of the terrain — but the crag remains
// what every standing rock in the scene is cut from.)
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

/* ==================================================================== */
/*  extruded slabs — the platform, the meditation stone, the treads      */
/* ==================================================================== */

/**
 * Chipping, as a pure function of where a vertex is.
 *
 * `ExtrudeGeometry` is **not indexed**: a vertex on a shared edge is stored two
 * or three times, once per triangle that touches it. Jitter drawn from a
 * counter or an rng stream gives those copies different answers and the cap
 * tears open into confetti — which is not a subtle artefact, it is the whole
 * top face gone. Hashing the position instead means every copy asks the same
 * question and gets the same answer, so the surface stays welded. Same rule the
 * peaks are carved under, for the same reason.
 */
function chipAt(x, z, k) {
  const h = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

/**
 * A hand-authored plan, extruded into a slab, with the top face chipped.
 *
 * `outline` is `[x, z]` pairs — the plan, in world units, at the height it will
 * stand at. The extrusion runs *downward* from y = 0 so the top face is the
 * scene's zero and the composition contract does not have to know how thick the
 * rock is.
 *
 * `relief` is an optional function of (x, z) returning how far that part of the
 * top stands proud. It is applied to the bevel ring as well as to the cap, so
 * the *silhouette* moves with it — which at this camera is the only part of the
 * shape the player can actually see moving. `chip` is the small stuff on top of
 * that: ±0.05 of grit, so the edge is broken rather than milled.
 */
export function slabGeometry({
  outline, depth = 3.5, bevel = { thickness: 0.3, size: 0.45, segments: 2 },
  relief = null, chip = 0, seed = 1, tint = null,
} = {}) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 1,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel.thickness,
    bevelSize: bevel.size,
    bevelOffset: 0,
    bevelSegments: bevel.segments,
  });
  // Lying down: the shape's own y becomes world z, and the extrusion runs from
  // y = 0 down to y = -depth. (Rotating the other way puts the slab above its
  // own origin and inside out.)
  geo.rotateX(Math.PI / 2);

  const pos = geo.attributes.position;
  const top = -bevel.thickness - 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < top) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const lift = relief ? relief(x, z) : 0;
    pos.setXYZ(
      i,
      x + chipAt(x, z, seed) * chip,
      y + lift + chipAt(x, z, seed + 11) * chip,
      z + chipAt(x, z, seed + 23) * chip,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  if (tint) applyTint(geo, tint);
  return geo;
}

/**
 * Bake a per-vertex albedo multiplier from height: darker underneath, lighter
 * on top.
 *
 * The hemisphere fill already varies with the normal, so a *side* wall and a
 * *top* differ before this runs. What it cannot do is separate the underside
 * of an overhang from the wall beside it — both face outward, both take the
 * same sky — and the underside of the foreground island is the largest such
 * surface in the frame. Baking it into the albedo also means the separation
 * survives the sun swinging round eight realms, which a shading term does not.
 *
 * Read by the ink material's `tint` option; see makeInkMaterial.
 */
export function applyTint(geo, { top = 1.16, bottom = 0.58, from = 0, to = -3.5 } = {}) {
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, (pos.getY(i) - to) / (from - to)));
    t[i] = bottom + (top - bottom) * k * k;
  }
  geo.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
  return geo;
}

/**
 * Weld a list of geometries into one, keeping only what the ink shader reads.
 *
 * Two meshes sharing a material still cost two draw calls, and the foreground
 * has four static objects on two materials — the platform and its skirt, the
 * steps and the censer. Merged, that is two calls instead of four, which is the
 * whole of stage 5's draw-call budget paid for. `uv` is dropped on purpose:
 * nothing in `makeInkMaterial` samples a texture, and an attribute that only
 * some of the inputs carry is the one way a merge like this goes wrong.
 */
export function mergeGeometries(parts) {
  let verts = 0;
  let tris = 0;
  for (const g of parts) {
    verts += g.attributes.position.count;
    tris += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const tint = new Float32Array(verts);
  const idx = new Uint32Array(tris);
  let v = 0;
  let i = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.aTint;
    for (let k = 0; k < p.count; k++) {
      pos[(v + k) * 3] = p.getX(k); pos[(v + k) * 3 + 1] = p.getY(k); pos[(v + k) * 3 + 2] = p.getZ(k);
      nor[(v + k) * 3] = n.getX(k); nor[(v + k) * 3 + 1] = n.getY(k); nor[(v + k) * 3 + 2] = n.getZ(k);
      tint[v + k] = t ? t.getX(k) : 1;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[i++] = g.index.getX(k) + v;
    else for (let k = 0; k < p.count; k++) idx[i++] = k + v;
    v += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * The skirt below the platform: the same plan, flaring outward as it falls.
 *
 * It was a seven-sided cylinder, so the mass under the foreground island had
 * exactly the regular silhouette the platform above it has just stopped having
 * — and it is the *wider* of the two, so it is the one the eye reads at the
 * bottom of the frame. Built from the platform's own outline it cannot disagree
 * with it, and the per-ring jitter keeps it from lofting into a smooth cone.
 */
export function skirtGeometry({
  outline, from = -2.4, to = -16.5, flare = [1.15, 2.45], rings = 5, seed = 88, jag = 0.16,
} = {}) {
  const rand = mulberry32(seed);
  const n = outline.length;
  const stride = n + 1;
  const pos = [];
  const idx = [];
  const wob = Array.from({ length: (rings + 1) * n }, () => 1 + (rand() - 0.5) * jag);

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const y = from + (to - from) * t;
    const scale = flare[0] + (flare[1] - flare[0]) * t;
    for (let s = 0; s <= n; s++) {
      const [x, z] = outline[s % n];
      const k = scale * wob[r * n + (s % n)];
      pos.push(x * k, y, z * k);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < n; s++) {
      const a = r * stride + s;
      idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The mass under the island: it only ever ends up in shadow, so the tint
  // walks it from dark at the shoulder to nearly nothing at the bottom of the
  // frame, which is what keeps the island from ending on a visible cut.
  applyTint(g, { top: 0.9, bottom: 0.34, from, to });
  return g;
}
