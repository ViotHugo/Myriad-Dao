// Granite, as geometry.
//
// ---------------------------------------------------------------------------
// Six rocks, carved once
//
// A peak is a cylinder that has been broken. That is the whole method, and each
// of its three steps is doing a specific job that the previous range did not do
// at all:
//
//   the blank      `CylinderGeometry(radiusTop, radiusBottom, …)` with seven to
//                  nine sides and twelve to sixteen rows. Seven sides means the
//                  cross-section is *already* a polygon, so the silhouette
//                  changes as the instance spins; a smooth lathe has the same
//                  outline from every angle and spinning it buys nothing.
//                  `radiusTop` is never zero — between 0.15 and 0.6 of the
//                  bottom. A cylinder closed to a point is a cone, and a cone
//                  is the one shape the eye names instantly.
//
//   the ridges     every vertex is pushed along its own radius by ridged
//                  simplex noise, `1 - |noise(p · freq)|`, two octaves, sampled
//                  fast around the column and slow up it. Ordinary noise gives
//                  a lumpy taper — a melted candle. The fold at every zero
//                  crossing gives *fracture*: vertical creases running the
//                  height of the wall, which is what granite does and what the
//                  eye reads a mountain's surface off at any distance.
//
//   the shelves    two to four rings snapped inward, at rows chosen from the
//                  seed. Under flat shading the two triangle bands either side
//                  of a snapped ring turn nearly horizontal and catch a
//                  completely different amount of sun from the wall above and
//                  below — so the ledge reads as a line of light across the
//                  rock rather than as a groove in a model. Granite has ledges;
//                  it is the single cue that most says "sedimentary bedding cut
//                  by weather" instead of "extruded shape".
//
// Then the tops, which is what six meshes are *for*: a flat plateau with a
// pavilion on it, a notched saddle, a leaning spire, a through-arch, and two
// crowns. Negative space and a horizon line read at distances where no amount
// of surface detail survives.
//
// Everything is welded because every displacement is a pure function of the
// vertex's position. A cylinder shares its rim vertices between the torso and
// the caps, and it repeats the seam column at the wrap; feed those duplicates
// the same position and they come back with the same answer, so the mesh never
// splits along the seam and never shows a crack at a cap. Anything that reached
// for a vertex *index* instead would tear exactly there.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { makeNoise3, ridged3 } from './noise.js';
import { mulberry32 } from '../rng.js';

/* --------------------------------------------------------------- helpers */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Concatenate geometries into one buffer.
 *
 * Three's own merge helper lives in the addons, and the only thing vendored
 * from there is the post stack. This is the whole of what is needed: position,
 * uv and index, with the index rebased. Normals are recomputed at the end
 * rather than carried, because every piece has been displaced since it was
 * built and the normals it was born with describe a cylinder that no longer
 * exists.
 */
function mergeGeometries(parts) {
  let verts = 0;
  let tris = 0;
  for (const g of parts) {
    verts += g.attributes.position.count;
    tris += g.index.count;
  }
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const idx = new Uint32Array(tris);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const p = g.attributes.position.array;
    pos.set(p, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Which rows carry a shelf, and how far each is pulled in.
 *
 * Snapped to the mesh's own rows deliberately. A shelf at an arbitrary height
 * would need vertices inserted for it; snapped to a row it is one ring of
 * existing vertices moved, which costs nothing and — because the ring is a ring
 * — comes out level all the way round, which is the entire point of a ledge.
 */
function shelfRows(spec, rand) {
  const rows = new Map();
  const n = clamp(spec.shelves | 0, 2, 4);
  // Spread over the band where a wall actually terraces: not at the foot, where
  // it is buried, and not at the summit, where it would eat the top profile.
  for (let i = 0; i < n; i++) {
    const t = 0.24 + ((i + 0.35 + rand() * 0.3) / n) * 0.56;
    const row = Math.round(t * spec.heightSegments);
    if (row <= 0 || row >= spec.heightSegments) continue;
    // A hard undercut with a gentler step above it: a shelf you could stand on,
    // rather than a groove turned on a lathe.
    rows.set(row, 0.80 + rand() * 0.07);
    if (!rows.has(row + 1)) rows.set(row + 1, 0.92 + rand() * 0.04);
  }
  return rows;
}

/**
 * Break a cylinder. Every vertex moves along its own radius; nothing moves in
 * y, so the rows stay rows and the shelves stay level.
 */
function fracture(geo, spec, noise, rand) {
  const { height, ridge, squash = 1, heightSegments } = spec;
  const silhouette = spec.silhouette || {};
  const half = height / 2;
  const rows = shelfRows(spec, rand);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) continue;            // the cap centres sit on the axis
    const t = clamp((y + half) / height, 0, 1);
    const theta = Math.atan2(z, x);
    // Shape the mass before cutting its surface. Noise alone changes texture,
    // not outline: applied to a linear cylinder it leaves a corrugated tube.
    // These broad, overlapping erosion zones give the eye the Wuxia grammar
    // it expects — talus at the foot, a projecting shoulder, a pinched neck,
    // then an uneven crag below the crown. They stay smooth across rows, while
    // the three-lobed asymmetry prevents a circular plan from surviving.
    const base = (silhouette.base || 0) * (1 - t) ** 3;
    const shoulder = (silhouette.shoulder || 0) * Math.exp(-(((t - 0.30) / 0.16) ** 2));
    const waist = (silhouette.waist || 0) * Math.exp(-(((t - 0.67) / 0.13) ** 2));
    const crag = (silhouette.crag || 0) * smooth(0.72, 0.92, t) * (1 - smooth(0.93, 1, t));
    const buttress = 1 + (silhouette.asym || 0) * Math.cos(theta * 3 + spec.seed * 0.017) * (1 - t * 0.45);
    const mass = Math.max(0.58, (1 + base + shoulder - waist + crag) * buttress);
    // Fast around the column, slow up it: creases that run vertically.
    const n = ridged3(noise, x * ridge.freq, y * ridge.freq * 0.34, z * ridge.freq, { octaves: 2 });
    let rs = 1 + ridge.amp * (n - 0.62);
    const shelf = rows.get(Math.round(t * heightSegments));
    // On a shelf the noise is mostly stood down, so the ring comes out level
    // and the ledge is a clean line rather than a wobble.
    if (shelf !== undefined) rs = shelf * (1 + ridge.amp * (n - 0.62) * 0.45);
    // A radius may never reach the axis: it would fold the two triangles that
    // share the vertex through each other, and a face with its winding inverted
    // renders as a bright shard with the light on the wrong side of it.
    rs = Math.max(0.35, rs);
    // A slight curved drift moves successive rings off-axis. Unlike rotating
    // the finished instance, this creates an overhang and a different outline
    // on either side while keeping the foot planted and the cap welded.
    const driftEase = t * t * (3 - 2 * t);
    const dx = (silhouette.drift?.[0] || 0) * height * driftEase;
    const dz = (silhouette.drift?.[1] || 0) * height * driftEase;
    pos.setXYZ(i, x * rs * mass + dx, y, z * rs * mass * squash + dz);
  }
}

/**
 * The summit. Everything here is a pure function of the carved position, so the
 * cap and the torso stay welded through it.
 */
function shapeTop(geo, spec, noise) {
  const { height, top } = spec;
  const half = height / 2;
  const pos = geo.attributes.position;
  const rTop = spec.radiusBottom * spec.radiusTop;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = clamp((y + half) / height, 0, 1);

    if (top === 'saddle') {
      // A col between two horns. Measured across x, so the notch runs one way
      // and the instance's own spin decides which way that is on screen.
      const across = clamp(1 - Math.abs(x) / (rTop * 1.05), 0, 1);
      y -= 0.30 * height * smooth(0.74, 1, t) * across;
    } else if (top === 'crown') {
      // Not a disc. A summit that is flat to a millimetre is a machined part;
      // a couple of percent of relief on it is a summit.
      const n = ridged3(noise, x * 3.1 + 40, 7.3, z * 3.1 - 40, { octaves: 2 });
      y += (n - 0.55) * height * 0.16 * smooth(0.55, 1, t);
    }
    if (spec.lean) {
      // Off plumb, and in the mesh rather than in the instance: a leaning tower
      // spun about its own axis leans a different way from every angle, which
      // is variety an InstancedMesh can otherwise never have.
      x += spec.lean * height * t * t;
    }
    pos.setXYZ(i, x, y, z);
  }
}

/* -------------------------------------------------------------- pavilion */

/**
 * A pavilion, in silhouette: a plinth, four posts, and a roof with the corners
 * turned up. Forty triangles, merged into the plateau it stands on so it costs
 * no draw call of its own.
 *
 * It is here for one reason, and it is the same reason there are pines on the
 * summits: a mountain with nothing man-made on it is an abstract shape and
 * could be thirty metres tall. Put a building on it and it is instantly a
 * thousand. The roof line is the readable part at this size, so the eaves are
 * wide and the pitch is shallow — a hut with a steep roof reads as a rock.
 */
function pavilionGeometry(size) {
  const pos = [];
  const idx = [];
  const v = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };

  const s = size;
  const plinth = s * 0.62;      // half-width of the stone base
  const post = s * 0.062;       // half-width of a post
  const postH = s * 0.66;
  const eave = s * 0.92;        // half-width at the eaves
  const roofH = s * 0.52;

  // The plinth: a low box, so the pavilion sits on something.
  const py = s * 0.10;
  const b = [
    v(-plinth, 0, -plinth), v(plinth, 0, -plinth), v(plinth, 0, plinth), v(-plinth, 0, plinth),
    v(-plinth, py, -plinth), v(plinth, py, -plinth), v(plinth, py, plinth), v(-plinth, py, plinth),
  ];
  quad(b[4], b[5], b[6], b[7]);                    // top
  quad(b[1], b[0], b[4], b[5]);
  quad(b[2], b[1], b[5], b[6]);
  quad(b[3], b[2], b[6], b[7]);
  quad(b[0], b[3], b[7], b[4]);

  // Four posts. Square section, and only the two outward faces of each are
  // built — the inside of a post is never seen and this is a silhouette.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx * plinth * 0.72;
    const cz = sz * plinth * 0.72;
    const p = [
      v(cx - post, py, cz - post), v(cx + post, py, cz - post),
      v(cx + post, py, cz + post), v(cx - post, py, cz + post),
      v(cx - post, py + postH, cz - post), v(cx + post, py + postH, cz - post),
      v(cx + post, py + postH, cz + post), v(cx - post, py + postH, cz + post),
    ];
    quad(p[1], p[0], p[4], p[5]);
    quad(p[2], p[1], p[5], p[6]);
    quad(p[3], p[2], p[6], p[7]);
    quad(p[0], p[3], p[7], p[4]);
  }

  // The roof: a shallow pyramid with the eave corners lifted, which is the one
  // line that says this building is Chinese and not a garden shed.
  const ry = py + postH;
  const lift = roofH * 0.30;
  const apex = v(0, ry + roofH, 0);
  const corners = [
    v(-eave, ry + lift, -eave), v(eave, ry + lift, -eave),
    v(eave, ry + lift, eave), v(-eave, ry + lift, eave),
  ];
  const mids = [
    v(0, ry - roofH * 0.06, -eave * 0.82), v(eave * 0.82, ry - roofH * 0.06, 0),
    v(0, ry - roofH * 0.06, eave * 0.82), v(-eave * 0.82, ry - roofH * 0.06, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % 4];
    const m = mids[i];
    idx.push(apex, c0, m, apex, m, c1);
    // The eave's underside, so the roof is a solid and not a pair of sheets.
    idx.push(c0, c1, m);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

/* ---------------------------------------------------------------- pieces */

/** One broken cylinder: the blank, fractured and shelved. */
function brokenCylinder(spec, seed) {
  const geo = new THREE.CylinderGeometry(
    spec.radiusBottom * spec.radiusTop, spec.radiusBottom, spec.height,
    spec.radialSegments, spec.heightSegments,
  );
  fracture(geo, spec, makeNoise3(seed), mulberry32(seed + 7));
  return geo;
}

/**
 * The through-arch: two splayed legs and a crown that spans them.
 *
 * Carving a hole out of a solid would mean deleting faces and stitching a
 * tunnel, which is a lot of machinery for one silhouette. Three broken
 * cylinders merged into one buffer give the same read — negative space under a
 * mass, wide at the ground and closing at the springing — for the same draw
 * call and none of the topology.
 */
function archPeak(spec) {
  const legH = spec.height * 0.46;
  const crownH = spec.height * 0.60;
  const gap = spec.radiusBottom * 0.66;
  const parts = [];

  for (const [side, seed] of [[-1, spec.seed + 11], [1, spec.seed + 29]]) {
    const leg = {
      ...spec,
      height: legH,
      radiusBottom: spec.radiusBottom * 0.42,
      radiusTop: 0.60,
      heightSegments: Math.max(8, spec.heightSegments - 4),
      shelves: 2,
    };
    const g = brokenCylinder(leg, seed);
    // Splayed: the foot stands wide and the head comes in to meet the crown,
    // so the opening is an arch rather than a slot. The gap between the legs is
    // about a third of the whole width — closed up much past that and the two
    // legs read as one stalk, which turns a through-arch into a mushroom.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = clamp((pos.getY(i) + legH / 2) / legH, 0, 1);
      const spread = gap * (1 + 0.55 * (1 - t) * (1 - t));
      pos.setX(i, pos.getX(i) + side * spread);
    }
    g.translate(0, legH / 2, 0);
    parts.push(g);
  }

  const crown = {
    ...spec,
    height: crownH,
    radiusBottom: spec.radiusBottom * 0.72,
    heightSegments: Math.max(8, spec.heightSegments - 3),
    shelves: 3,
  };
  const g = brokenCylinder(crown, spec.seed + 53);
  // Widened across the legs, so the mass genuinely bridges them.
  g.scale(1.50, 1, 1);
  g.translate(0, legH + crownH / 2, 0);
  shapeTop(g, { ...crown, top: 'crown', height: crownH }, makeNoise3(spec.seed + 71));
  parts.push(g);

  const merged = mergeGeometries(parts);
  // Built standing on y = 0 already; the caller's contract is the same as
  // every other peak's.
  merged.translate(0, -spec.height / 2, 0);
  return merged;
}

/* ------------------------------------------------------------------ API */

/**
 * A peak, standing on y = 0 with its summit at `spec.height`, and about
 * `radiusBottom` in radius. Instanced by scenery.js; nothing here knows where
 * it stands.
 */
export function peakGeometry(spec) {
  let geo;
  if (spec.top === 'arch') {
    geo = archPeak(spec);
  } else {
    geo = brokenCylinder(spec, spec.seed);
    shapeTop(geo, spec, makeNoise3(spec.seed + 91));
  }

  if (spec.top === 'plateau') {
    // The crown is flat and wide, so something can stand on it.
    const size = spec.radiusBottom * spec.radiusTop * 0.85;
    const pav = pavilionGeometry(size);
    pav.translate(0, spec.height / 2, 0);
    geo = mergeGeometries([geo, pav]);
  }

  // Feet on the ground: everything above is built about the origin, and every
  // placement in peak-plan.js names where the *foot* goes.
  geo.translate(0, spec.height / 2, 0);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
