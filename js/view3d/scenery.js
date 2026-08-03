// The wuxia landscape: ten thousand peaks in a sea of cloud, a plum tree in
// blossom, cranes on the thermals, water falling a very long way.
//
// All of it is generated here from seeded noise and instanced primitives — no
// models, no textures. The whole module costs about a dozen draw calls.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import {
  makeInkMaterial, makeCloudMaterial, makeFallMaterial, makeParticleMaterial,
  makeGlowMaterial, makeRockMaterial, makeMistMaterial,
} from './shaders.js';
import { sceneryProgress } from './progress.js';
import { placeAtDepth } from './framing.js';
import { cragGeometry } from './rock.js';

/** GLSL `fract`, so the CPU can replay what the vertex shader does to a seed. */
function fract1(x) { return x - Math.floor(x); }

/* ==================================================================== */
/*  geometry                                                             */
/* ==================================================================== */

/**
 * The blank a karst spire is carved from: a straight fluted column, one unit
 * tall, with bedding ledges cut into its radius.
 *
 * Deliberately unshaped. All the silhouette — the taper, the waist, the
 * shoulder, the overhang, the lean — is applied per instance in the vertex
 * shader (see KARST_PROFILE in shaders.js), because an InstancedMesh draws one
 * geometry and a repeated silhouette reads as a picket fence however cleverly
 * the instances are scattered. Baking the shape here, as the first version did,
 * bought ninety-six copies of the same rock.
 *
 * What stays here is what has to vary per *vertex*: the vertical ribs that make
 * the wall fluted rather than turned on a lathe, and the horizontal ledges that
 * say sedimentary rock. `uv.x` carries the angle around the column, so the
 * shader never has to call atan and never picks up a seam where it wraps.
 */
function karstColumn({ seed = 1, sides = 9, rings = 18, strata = 9, rib = 0.26 } = {}) {
  const rand = mulberry32(seed);
  const ribs = Array.from({ length: sides }, () => 1 - rib * rand());
  const kinks = Array.from({ length: rings + 1 }, () => rand());

  const pos = [];
  const uvs = [];
  const idx = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    // Bedding planes: small steps in radius so the rock shows horizontal strata.
    const step = Math.round(t * strata) / strata;
    const ledge = 1 + (step - t) * 0.5;
    const wobble = 1 + (kinks[r] - 0.5) * 0.12;
    for (let s = 0; s <= sides; s++) {
      const f = s / sides;
      const a = f * Math.PI * 2;
      const rad = ledge * wobble * ribs[s % sides];
      pos.push(Math.cos(a) * rad, t, Math.sin(a) * rad);
      uvs.push(f, t);
    }
  }
  const stride = sides + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * stride + s;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  // Cap the summit. The shader's taper decides how wide this cap ends up, so
  // the same mesh gives both a needle and a flat-topped mesa.
  const apex = pos.length / 3;
  pos.push(0, 1, 0);
  uvs.push(0.5, 1);
  for (let s = 0; s < sides; s++) {
    const a = rings * stride + s;
    idx.push(a, apex, a + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  return g;
}

/** A pine in silhouette: a bare stem and three stacked skirts. Two draws' worth
 *  of shape in one, and the only thing in the frame that gives a peak a size. */
function pineGeometry() {
  const pos = [];
  const idx = [];
  const ring = (y, r, n) => {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    return base;
  };
  // stem
  const b0 = ring(0, 0.05, 4);
  const b1 = ring(0.45, 0.035, 4);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(b0 + i, b1 + i, b0 + j, b0 + j, b1 + i, b1 + j);
  }
  // three skirts, each a shallow cone
  for (const [y, r, h] of [[0.34, 0.42, 0.40], [0.58, 0.32, 0.36], [0.80, 0.20, 0.32]]) {
    const base = ring(y, r, 6);
    const tip = pos.length / 3;
    pos.push(0, y + h, 0);
    for (let i = 0; i < 6; i++) idx.push(base + i, tip, base + ((i + 1) % 6));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A far bird: two swept triangles. At this distance a bird *is* its silhouette. */
function birdGeometry() {
  const pos = [0, 0, 0, -1, 0.34, 0.30, -0.42, 0.02, -0.10, 1, 0.34, 0.30, 0.42, 0.02, -0.10];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex([0, 1, 2, 0, 4, 3]);
  g.computeVertexNormals();
  return g;
}

/** A crane in silhouette: swept wings, a long neck, trailing legs. One mesh. */
function craneGeometry() {
  const pos = [];
  const idx = [];
  const push = (...v) => { pos.push(...v); return pos.length / 3 - 1; };

  const nose = push(0, 0, -1.15);          // beak
  const chest = push(0, 0, -0.25);
  const tail = push(0, 0, 0.95);
  const lTip = push(-1.75, 0.30, 0.18);    // wings sweep back and up
  const rTip = push(1.75, 0.30, 0.18);
  const lMid = push(-0.72, 0.10, -0.10);
  const rMid = push(0.72, 0.10, -0.10);

  idx.push(nose, chest, lMid, nose, rMid, chest);
  idx.push(chest, lMid, tail, chest, tail, rMid);
  idx.push(lMid, lTip, tail, rMid, tail, rTip);
  idx.push(chest, lTip, lMid, chest, rMid, rTip);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Recursive plum branches, returned as instance transforms for a single tapered
 * segment. Plum is all angle and hesitation: short runs, hard turns, no
 * symmetry — the opposite of a pine.
 */
function plumBranches(rand, { depth = 5, length = 2.4, thick = 0.16 } = {}) {
  const out = [];
  const tips = [];
  const up = new THREE.Vector3(0, 1, 0);

  function grow(from, dir, len, rad, level) {
    const to = from.clone().addScaledVector(dir, len);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const mid = from.clone().lerp(to, 0.5);
    out.push({ pos: mid, quat: q, scale: new THREE.Vector3(rad, len, rad) });

    if (level <= 0) { tips.push(to.clone()); return; }
    // Two or three children, each thrown well off the parent's line.
    const n = rand() < 0.32 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const axis = new THREE.Vector3(rand() - 0.5, rand() * 0.25, rand() - 0.5).normalize();
      const bend = 0.45 + rand() * 0.62;
      const child = dir.clone().applyAxisAngle(axis, bend).normalize();
      // Plum reaches upward and sideways more than it droops.
      child.y = Math.max(child.y, -0.12);
      child.normalize();
      grow(to, child, len * (0.60 + rand() * 0.18), rad * 0.66, level - 1);
    }
  }

  const base = new THREE.Vector3(0, 0, 0);
  const lean = new THREE.Vector3(0.28 + rand() * 0.2, 1, -0.12).normalize();
  grow(base, lean, length, thick, depth);
  return { segments: out, tips };
}

/* ==================================================================== */
/*  the scenery                                                          */
/* ==================================================================== */

export function createScenery(env, tier) {
  const group = new THREE.Group();
  const rand = mulberry32(0x5eed);
  const tmpMat = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);

  /* ---------------------------------------------- ten thousand peaks */

  // Three ranks marching into the haze. Each is composed in frame space — say
  // where the summit and the foot should land in the picture, and framing.js
  // returns the world position that puts them there. The alternative, choosing
  // world coordinates directly, quietly threw half of every range off the side
  // of the screen: the world framing looks down a diagonal, so the visible
  // slice of x at z = -140 is [-147, -65], nowhere near zero.
  //
  // Ordering: the ridges in world.js are a painter's stack with gaps at
  // -6/-9/-12/-15/-18, and each rank slots into the gap matching its depth, so
  // a range can stand behind one ridge line and in front of the next.
  const BANDS = [
    {
      name: 'near', order: -13, share: 0.24,
      z: [-165, -230], rim: 0.30, fogCap: 0.22, strata: 0.20, lean: 4.4, foot: 0.20, sun: 1.0,
      feet: [0.40, 0.52], rise: [0.10, 0.34], ceiling: 0.115, clusters: 4, slender: [0.032, 0.034],
      geo: { sides: 9, rings: 18, strata: 11, rib: 0.30 },
    },
    {
      name: 'mid', order: -16, share: 0.34,
      z: [-255, -345], rim: 0.24, fogCap: 0.42, strata: 0.14, lean: 3.4, foot: 0.17, sun: 0.8,
      feet: [0.33, 0.43], rise: [0.07, 0.245], ceiling: 0.132, clusters: 6, slender: [0.036, 0.038],
      geo: { sides: 8, rings: 14, strata: 8, rib: 0.24 },
    },
    {
      name: 'far', order: -19, share: 0.42,
      z: [-365, -530], rim: 0.16, fogCap: 0.60, strata: 0.08, lean: 2.4, foot: 0.14, sun: 0.55,
      feet: [0.285, 0.365], rise: [0.05, 0.175], ceiling: 0.152, clusters: 9, slender: [0.042, 0.044],
      geo: { sides: 6, rings: 10, strata: 6, rib: 0.20 },
    },
  ];

  // Where the host peak stands. A range with no hierarchy is a texture: the eye
  // finds nothing to land on and reads the whole thing as pattern. Chinese
  // landscape names the dominant mass 主山, the host, and everything else is its
  // guest — so one pillar of the near rank is forced tall, forced forward, and
  // put on a third rather than the middle.
  const HOST = { u: 0.335, footV: 0.545, headV: 0.107, z: -158 };

  const peaks = new THREE.Group();
  const spireSets = [];
  const spireMats = [];
  const summits = [];   // world positions of the tallest near/mid pillars

  if (tier.spires > 0) {
    BANDS.forEach((band, bi) => {
      const count = Math.max(2, Math.round(tier.spires * band.share));
      // Aerial perspective: the far rank is paler and less contrasty, which is
      // the only cue that says "these are twenty kilometres away" in a picture
      // with no texture and no atmosphere model. The colours come from the
      // palette's `peaks` ramp, which is authored against the sky — never from
      // the ridge ramp, which is authored against mist and runs pale.
      const mat = makeRockMaterial(env, {
        rim: band.rim, fogCap: band.fogCap, strata: band.strata,
        lean: band.lean, foot: band.foot, sun: band.sun,
      });
      const geo = karstColumn({ seed: 11 + bi * 17, ...band.geo });
      // The seed each instance is carved by. Without it every pillar in the
      // rank is the same rock painted ninety-six times.
      const seeds = new Float32Array(count);
      for (let i = 0; i < count; i++) seeds[i] = rand();
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      const im = new THREE.InstancedMesh(geo, mat, count);

      // Massifs, not a picket fence. Karst erodes in clusters: one dominant
      // pillar with a crowd of lesser ones at its feet, then a gap, then the
      // next cluster. Scattering uniformly across the frame instead — the
      // obvious thing — produces evenly spaced needles of even height, which
      // reads as a fence and not as a mountain range.
      const centres = Array.from({ length: band.clusters }, (_, c) => (
        // Overscan past both edges: the player can swing the camera through a
        // 0.62 rad arc, and a range that stops dead at the frame edge gives the
        // whole illusion away the first time they drag.
        -0.34 + (c + 0.28 + rand() * 0.44) * (1.68 / band.clusters)
      ));

      for (let i = 0; i < count; i++) {
        const host = bi === 0 && i === 0;
        const z = host ? HOST.z : band.z[0] + (band.z[1] - band.z[0]) * rand();
        const centre = centres[i % centres.length];
        // Two uniforms summed is a cheap bell curve: dense at the cluster's
        // heart, thinning at its edges.
        const u = host ? HOST.u : centre + ((rand() + rand()) - 1) * 0.16;
        const footV = host
          ? HOST.footV
          : band.feet[0] + (band.feet[1] - band.feet[0]) * rand();
        // Prominence is skewed hard toward the low end so each cluster gets a
        // few tall pillars and many short ones, which is what gives the range a
        // silhouette instead of a plateau. The first of every cluster is forced
        // tall, so no cluster comes out uniformly stunted.
        const lead = i < centres.length;
        const p = lead ? 0.82 + rand() * 0.18 : Math.pow(rand(), 1.8);
        const rise = band.rise[0] + (band.rise[1] - band.rise[0]) * p;
        const headV = host ? HOST.headV : Math.max(band.ceiling, footV - rise);
        const foot = placeAtDepth(u, footV, z);
        const head = placeAtDepth(u, headV, z);
        if (!foot || !head) continue;

        const h = head[1] - foot[1];
        // Karst are slender: width well under a tenth of height, or they read
        // as buttes. Thinner as they recede, so the far rank stays needle-like.
        const w = h * (band.slender[0] + rand() * band.slender[1]) * (host ? 1.28 : 1);
        tmpV.set(foot[0], foot[1], z);
        // The spin is what makes one geometry read as many; the shader's own
        // lean does the rest, so the matrix keeps the pillar upright.
        tmpQ.setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0, 'YXZ'));
        tmpS.set(w, h, w);
        im.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));

        // Remember the commanding summits: pines go up there, and a pine is the
        // only thing in the picture that tells you how big a rock is.
        //
        // The shader leans each pillar off plumb, so its summit is not above its
        // foot. Replaying that shear here — same seed, same arithmetic — is what
        // puts the trees on the rock instead of beside it.
        if (bi < 2 && (host || (lead && rand() < 0.75))) {
          const lean = band.lean * w;
          summits.push({
            x: foot[0] + (fract1(seeds[i] * 13.77) - 0.5) * lean,
            y: head[1],
            z: z + (fract1(seeds[i] * 17.31) - 0.5) * lean * 0.8,
            w,
          });
        }
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.renderOrder = band.order;
      peaks.add(im);
      spireSets.push(im);
      spireMats.push(mat);
    });
  }
  group.add(peaks);

  /* ------------------------------------------------- pines on the summits */

  // Scale. A karst pillar with nothing on it is an abstract shape and could be
  // three metres tall; put a tree on its shoulder and it is instantly three
  // hundred. One instanced draw for the whole range.
  const pineMat = makeInkMaterial(env, {
    color: '#101820', rim: 0.30, bands: 2, flat: true, fogCap: 0.34,
  });
  let summitPines = null;
  if (summits.length) {
    const perSummit = 3;
    summitPines = new THREE.InstancedMesh(pineGeometry(), pineMat, summits.length * perSummit);
    let n = 0;
    for (const s of summits) {
      // Sized as a *fraction* of the pillar's width, never a multiple of it: a
      // pine on a karst summit is a serration on the silhouette, a few pixels
      // of it. Scaled the other way round they came out taller than the peaks
      // they stand on, which not only looks absurd but destroys the very cue
      // they are there to give.
      //
      // The summit is where the shader's taper leaves it, so the cap is a
      // fraction of the pillar's full width — the trees have to crowd in.
      const cap = s.w * 0.34;
      for (let k = 0; k < perSummit; k++) {
        const a = rand() * Math.PI * 2;
        const r = cap * rand();
        const scale = s.w * (0.13 + rand() * 0.11) * (k === 0 ? 1.45 : 1);
        tmpV.set(s.x + Math.cos(a) * r, s.y - s.w * 0.05, s.z + Math.sin(a) * r);
        tmpQ.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.14, rand() * 6.28, (rand() - 0.5) * 0.14, 'YXZ'));
        tmpS.set(scale, scale * (1.5 + rand() * 0.8), scale);
        summitPines.setMatrixAt(n++, tmpMat.compose(tmpV, tmpQ, tmpS));
      }
    }
    summitPines.count = n;
    summitPines.instanceMatrix.needsUpdate = true;
    summitPines.frustumCulled = false;
    summitPines.renderOrder = -12;
    group.add(summitPines);
  }

  /* -------------------------------------------------- the sea of cloud */

  // One deck per rank of peaks, laid across the height its feet stand at, so
  // the range rises *out of* the cloud instead of floating above a separate
  // band of it. Each is drawn just after its own rank: spires further back are
  // veiled, and the ones in front still occlude it through the depth buffer.
  // Standing bands, not floors. A horizontal deck under a camera pitched 0.17
  // rad is seen almost edge-on: however shallow it is, its far edge converges on
  // the horizon at v = 0.198 — precisely where the summits are — and veils the
  // whole range. A plane facing the camera instead occupies exactly the slice of
  // frame it is given, so the cloud can be told to stop at the feet of its own
  // rank and stay there.
  // Each deck spans the strip of frame its own rank stands in, and `height`
  // says how far up that strip the billows are allowed to reach — so the cloud
  // pools around the feet of one rank and stops there, leaving the rank behind
  // it clear above. Three of them, stacked, are what turn a flat grey midground
  // into distance you can count.
  const DECKS = [
    { z: -200, top: 0.335, bottom: 0.640, order: -11, opacity: 0.95, scale: 0.028, speed: 0.10, height: 0.92, soft: 0.20 },
    { z: -315, top: 0.268, bottom: 0.470, order: -14, opacity: 0.88, scale: 0.040, speed: 0.14, height: 0.88, soft: 0.24 },
    { z: -460, top: 0.212, bottom: 0.372, order: -17, opacity: 0.76, scale: 0.054, speed: 0.17, height: 0.84, soft: 0.28 },
  ];

  const cloudDecks = [];
  const cloudMats = [];
  const sprayMats = [];   // mist-material puffs; they take a colour but no crest
  for (let i = 0; i < Math.min(tier.cloudDecks, DECKS.length); i++) {
    const d = DECKS[i];
    const mat = makeCloudMaterial(env, {
      opacity: d.opacity, scale: d.scale, speed: d.speed, vertical: true,
      height: d.height, soft: d.soft,
    });
    cloudMats.push(mat);

    const top = placeAtDepth(0.5, d.top, d.z);
    const bottom = placeAtDepth(0.5, d.bottom, d.z);
    const left = placeAtDepth(0, d.top, d.z);
    const right = placeAtDepth(1, d.top, d.z);
    // Wide enough to survive the player swinging the camera through its arc.
    const span = Math.abs(right[0] - left[0]) * 2.4;
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(span, top[1] - bottom[1], 1, 1), mat);
    deck.position.set(top[0], (top[1] + bottom[1]) / 2, d.z);
    deck.userData.baseY = deck.position.y;
    deck.renderOrder = d.order;
    cloudDecks.push(deck);
    group.add(deck);
  }

  /* ------------------------------------------------------- plum tree */

  // Old wood: near-black, angular, and leaning out over the drop.
  const barkMat = makeInkMaterial(env, { color: '#1b1519', rim: 0.30, bands: 2 });
  const branchGeo = new THREE.CylinderGeometry(0.34, 0.62, 1, 5, 1);
  const { segments, tips } = plumBranches(mulberry32(77), { depth: tier.plumDepth, length: 2.5, thick: 0.17 });

  const branches = new THREE.InstancedMesh(branchGeo, barkMat, segments.length);
  segments.forEach((s, i) => branches.setMatrixAt(i, tmpMat.compose(s.pos, s.quat, s.scale)));
  branches.instanceMatrix.needsUpdate = true;

  const plum = new THREE.Group();
  plum.add(branches);
  // Sized so the whole tree — including where it meets rock — sits between the
  // HUD and the cultivate pad.
  plum.position.set(-7.5, -5.0, -16.3);
  plum.rotation.y = -0.5;
  plum.scale.setScalar(1.15);
  group.add(plum);

  // A shelf of rock for it to stand on, so it does not hang in the haze.
  //
  // This was a six-sided cone with its apex right where the trunk meets it, so
  // the tree stood on the point of a pyramid — the most conspicuously artificial
  // thing in the frame. A crag gives it a crown to grow out of and a broken wall
  // that falls away below.
  const ledgeMat = makeInkMaterial(env, { color: '#232a35', rim: 0.35, bands: 2, flat: true });
  // Small: it is sixteen units from the camera, where a couple of world units
  // is already a large piece of the frame. The crown sits just under the trunk
  // and the mass falls away steeply out of the bottom of the picture.
  const ledge = new THREE.Mesh(
    cragGeometry({ seed: 512, sides: 10, rings: 6, taper: 0.66, jag: 0.34, drift: 0.34, crown: 0.05 }),
    ledgeMat,
  );
  ledge.position.set(-7.6, -5.15, -16.5);
  ledge.scale.set(2.9, 9.0, 2.7);
  ledge.rotation.y = 0.6;
  group.add(ledge);

  // Blossom: five tiny petals per flower is too much geometry at this count, so
  // each is a flat disc that always faces up-ish and catches the rim light.
  const blossomMat = makeGlowMaterial(env, { color: '#f6d3e0', power: 1.1, strength: 1.15, core: 0.9 });
  const blossomGeo = new THREE.CircleGeometry(0.055, 5);
  const blossomCount = Math.min(tier.blossoms, tips.length * 3);
  const blossoms = new THREE.InstancedMesh(blossomGeo, blossomMat, blossomCount);
  const brand = mulberry32(4242);
  for (let i = 0; i < blossomCount; i++) {
    const tip = tips[i % tips.length];
    tmpV.set(
      tip.x + (brand() - 0.5) * 0.55,
      tip.y + (brand() - 0.5) * 0.55,
      tip.z + (brand() - 0.5) * 0.55,
    );
    tmpQ.setFromEuler(new THREE.Euler(brand() * 3, brand() * 3, brand() * 3));
    const sc = 0.7 + brand() * 0.8;
    blossoms.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS.set(sc, sc, sc)));
  }
  blossoms.instanceMatrix.needsUpdate = true;
  plum.add(blossoms);

  /* ------------------------------------------------------- petals */

  // Blossom comes off the tree and goes over the edge. This is the single
  // cheapest thing in the scene that makes it feel inhabited by weather.
  const petalMat = makeParticleMaterial(env, { color: '#f6d3e0', size: 9, additive: false });
  const petalCount = tier.petals;
  const petalGeo = new THREE.BufferGeometry();
  const petalPos = new Float32Array(petalCount * 3);
  const petalScale = new Float32Array(petalCount);
  const petalSeed = new Float32Array(petalCount);
  for (let i = 0; i < petalCount; i++) {
    petalScale[i] = 0.45 + rand() * 0.85;
    petalSeed[i] = rand();
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  petalGeo.setAttribute('aScale', new THREE.BufferAttribute(petalScale, 1));
  petalGeo.setAttribute('aSeed', new THREE.BufferAttribute(petalSeed, 1));
  const petals = new THREE.Points(petalGeo, petalMat);
  petals.frustumCulled = false;
  group.add(petals);

  /* -------------------------------------------------------- cranes */

  const craneMat = makeInkMaterial(env, { color: '#e6ecf2', rim: 0.9, bands: 2, flat: true });
  const cranes = new THREE.InstancedMesh(craneGeometry(), craneMat, tier.cranes);
  cranes.frustumCulled = false;
  const craneOrbits = [];
  for (let i = 0; i < tier.cranes; i++) {
    // In front of the near rank, so they read as closer than the peaks, and
    // circling the upper third of the frame where there is open sky. Their
    // orbit centres used to be picked in world coordinates and landed at
    // u = 1.4 — a whole flock of cranes wheeling just off the right edge.
    const z = -112 - rand() * 44;
    const c = placeAtDepth(0.18 + rand() * 0.64, 0.12 + rand() * 0.16, z);
    craneOrbits.push({
      cx: c[0], cy: c[1], cz: z,
      r: 12 + rand() * 20,
      speed: (0.055 + rand() * 0.05) * (rand() > 0.5 ? 1 : -1),
      phase: rand() * Math.PI * 2,
      bob: 0.5 + rand() * 1.4,
      scale: 1.5 + rand() * 1.6,
    });
  }
  if (tier.cranes > 0) group.add(cranes);

  /* ---------------------------------------------------- the skein */

  // A line of small birds crossing the range. Cranes are the ceremony; this is
  // the ordinary traffic of a living valley, and it costs one draw call. A
  // landscape with nothing moving in it does not read as still, it reads as
  // abandoned — and the eye finds a moving speck before it finds anything else,
  // so a dozen of them do more for the picture being *inhabited* than another
  // fifty peaks would.
  const BIRDS = 14;
  const birdMat = makeInkMaterial(env, {
    color: '#1b2129', rim: 0.20, bands: 2, flat: true, fogCap: 0.30,
  });
  const birds = new THREE.InstancedMesh(birdGeometry(), birdMat, BIRDS);
  birds.frustumCulled = false;
  birds.renderOrder = -10;
  const birdSkein = [];
  for (let i = 0; i < BIRDS; i++) {
    // A ragged V: each bird trails the one ahead and a little to the side.
    const rank = Math.floor(i / 2);
    const side = i % 2 ? 1 : -1;
    birdSkein.push({
      lag: rank * (0.030 + rand() * 0.012),
      side: side * rank * (0.9 + rand() * 0.5),
      lift: (rand() - 0.5) * 1.8,
      beat: rand() * 6.28,
      scale: 0.62 + rand() * 0.3,
    });
  }
  group.add(birds);

  // The line they fly, solved once. Crossing the open sky just above the far
  // rank, from off one edge to off the other — placeAtDepth is a 2×2 solve and
  // there is no reason to run fourteen of them every frame.
  const BIRD_Z = -300;
  const birdFrom = placeAtDepth(-0.30, 0.205, BIRD_Z);
  const birdTo = placeAtDepth(1.30, 0.165, BIRD_Z);
  const birdSpan = Math.hypot(birdTo[0] - birdFrom[0], birdTo[1] - birdFrom[1]);

  /* ----------------------------------------------------- waterfall */

  let fall = null;
  let fallMat = null;
  let fallMist = null;
  if (tier.waterfall) {
    // A thread of water off the flank of the near rank, landing in the cloud
    // that pools at its feet — the one silhouette that says how far down it is.
    // Held above the ridge crests (v 0.33 and below) because the ridge strips
    // are opaque: dropped into the valley it was simply painted over.
    const FALL = { u: 0.225, z: -150, top: 0.243, bottom: 0.404 };
    const ftop = placeAtDepth(FALL.u, FALL.top, FALL.z);
    const fbot = placeAtDepth(FALL.u, FALL.bottom, FALL.z);
    const fheight = ftop[1] - fbot[1];
    fallMat = makeFallMaterial(env, { opacity: 0.62 });
    fall = new THREE.Mesh(new THREE.PlaneGeometry(fheight * 0.26, fheight, 1, 1), fallMat);
    fall.position.set(ftop[0], (ftop[1] + fbot[1]) / 2, FALL.z);
    fall.rotation.y = 0.22;
    fall.renderOrder = -4;
    group.add(fall);

    // Where it lands, it turns back into cloud.
    //
    // Spray is a puff, not a deck. Built on the cloud material it inherited the
    // sea's skyline logic — a solid mass under a billow-cut horizon — and on a
    // plane this small the billow field barely varies across it, so the mass was
    // uniform and the "spray" rendered as a hard white bar hanging in the
    // gorge. The mist material is the right shape for it: an fbm body that
    // fades on all four sides and never touches its own rectangle.
    const mistMat = makeMistMaterial(env, { opacity: 0.85, speed: 0.16 });
    fallMist = new THREE.Mesh(
      new THREE.PlaneGeometry(fheight * 0.72, fheight * 0.34, 1, 1), mistMat,
    );
    fallMist.position.set(fbot[0], fbot[1] + fheight * 0.05, FALL.z + 1);
    fallMist.renderOrder = -3;
    sprayMats.push(mistMat);
    group.add(fallMist);
  }

  /* -------------------------------------------------------- bamboo */

  let bamboo = null;
  const bambooSway = [];
  if (tier.bamboo > 0) {
    const bambooMat = makeInkMaterial(env, { color: '#2c4a35', rim: 0.75, bands: 3 });
    const culm = new THREE.CylinderGeometry(0.055, 0.075, 5.2, 5, 1);
    bamboo = new THREE.InstancedMesh(culm, bambooMat, tier.bamboo);
    for (let i = 0; i < tier.bamboo; i++) {
      const a = 2.1 + rand() * 1.5;
      const r = 6.6 + rand() * 3.2;
      bambooSway.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        h: 0.7 + rand() * 0.7, phase: rand() * 6.28, lean: (rand() - 0.5) * 0.16,
      });
    }
    bamboo.frustumCulled = false;
    group.add(bamboo);
  }

  /* ------------------------------------------------------- fireflies */

  // Spirit motes over the valley: only lit on the night realms.
  const fireflyMat = makeParticleMaterial(env, { color: '#cfe8b8', size: 8 });
  const fireflyCount = tier.fireflies;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(fireflyCount * 3);
  const ffScale = new Float32Array(fireflyCount);
  const ffSeed = new Float32Array(fireflyCount);
  for (let i = 0; i < fireflyCount; i++) { ffScale[i] = 0.4 + rand() * 0.7; ffSeed[i] = rand(); }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aScale', new THREE.BufferAttribute(ffScale, 1));
  ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
  const fireflies = new THREE.Points(ffGeo, fireflyMat);
  fireflies.frustumCulled = false;
  fireflies.visible = false;
  if (fireflyCount > 0) group.add(fireflies);

  /* ==================================================================== */

  function setPalette(p) {
    // The peaks ramp, not the ridge ramp. The ridge colours are authored for
    // valley walls seen against mist and run pale at the far end; borrowed for
    // the skyline they made the furthest rank *lighter* than the air behind it,
    // which reads as a smudge rather than as distance. See palette.js.
    const ink = p.peaks || p.ridges;
    spireMats.forEach((m, i) => {
      m.uniforms.uColor.value.set(ink[Math.min(i, ink.length - 1)]);
      if (p.sun) {
        m.uniforms.uSunColor.value.set(p.sun.color);
        m.uniforms.uSun.value = p.sun.power * BANDS[i].sun;
      }
    });
    pineMat.uniforms.uColor.value.set(ink[0]);
    birdMat.uniforms.uColor.value.set(ink[0]);
    barkMat.uniforms.uColor.value.set(p.bark || '#1b1519');
    blossomMat.uniforms.uColor.value.set(p.blossom || '#f6d3e0');
    petalMat.uniforms.uColor.value.set(p.blossom || '#f6d3e0');
    craneMat.uniforms.uColor.value.set(p.crane || '#e6ecf2');
    for (const m of cloudMats) {
      m.uniforms.uColor.value.set(p.cloud || '#aab6c4');
      m.uniforms.uCrest.value.set(p.cloudCrest || '#e8eef4');
    }
    for (const m of sprayMats) m.uniforms.uColor.value.set(p.cloudCrest || '#e8eef4');
    if (fallMat) fallMat.uniforms.uColor.value.set(p.cloudCrest || '#cfe0ea');
    fireflyMat.uniforms.uColor.value.set(p.accent);
  }

  /* ------------------------------------------------------------ progress */

  // The landscape is a readout. Everything below is driven by how far the
  // player has actually come, so the view out of the window answers "how am I
  // doing?" before any number does.
  const prog = {
    peakCount: BANDS.map(() => 0),   // per rank
    cloudDrop: 0,
    blossom: 0,          // 0 bare .. 1 full bloom
    petalRate: 0,
    cranes: 0,
    bamboo: 0,
    fireflies: 0,
  };
  const smooth = { cloudDrop: 0, blossom: 0 };
  let petalShown = 0;

  function sync(vm) {
    const next = sceneryProgress(vm, tier);

    spireSets.forEach((im, i) => {
      const max = im.instanceMatrix.count;
      prog.peakCount[i] = Math.max(3, Math.round(max * next.peakFraction));
      im.count = prog.peakCount[i];
    });

    prog.cloudDrop = next.cloudDrop;
    prog.blossom = next.blossom;
    prog.petalRate = next.petalRate;

    prog.cranes = next.cranes;
    cranes.count = Math.min(tier.cranes, next.cranes);

    prog.bamboo = Math.min(bambooSway.length, next.bamboo);
    if (bamboo) bamboo.count = prog.bamboo;

    prog.fireflies = Math.min(fireflyCount, next.fireflies);
    fireflies.visible = prog.fireflies > 0;
    ffGeo.setDrawRange(0, prog.fireflies);

    if (fall) {
      fall.visible = next.waterfall;
      if (fallMist) fallMist.visible = next.waterfall;
      fall.scale.x = next.waterfallWidth;
    }
  }

  function update(dt, t, reduced) {
    const wind = reduced ? 0.25 : 1;

    // Ease the progression-driven values so a breakthrough does not snap the
    // landscape into its next shape.
    smooth.cloudDrop += (prog.cloudDrop - smooth.cloudDrop) * Math.min(1, dt * 0.6);
    smooth.blossom += (prog.blossom - smooth.blossom) * Math.min(1, dt * 0.5);
    for (const deck of cloudDecks) deck.position.y = deck.userData.baseY - smooth.cloudDrop;

    blossoms.count = Math.round(blossomCount * smooth.blossom);
    blossomMat.uniforms.uStrength.value = 0.55 + smooth.blossom * 0.75;
    petalShown = Math.round(petalCount * prog.petalRate);
    petalGeo.setDrawRange(0, petalShown);

    // Petals: a slow fall with a sideways drift, respawning at the tree.
    for (let i = 0; i < petalShown; i++) {
      const s = petalSeed[i];
      const life = ((t * (0.045 + s * 0.05) * wind) + s) % 1;
      const swirl = Math.sin(life * 9.0 + s * 12.0) * 1.6;
      petalPos[i * 3 + 0] = -7.5 + swirl + (s - 0.5) * 6.0 - life * 4.0;
      petalPos[i * 3 + 1] = 3.4 - life * 18.0;
      petalPos[i * 3 + 2] = -16.3 + Math.cos(life * 7.0 + s * 9.0) * 2.2 + (s - 0.5) * 4.0;
    }
    petalGeo.attributes.position.needsUpdate = true;

    // The skein crosses the range and comes round again. One leader sets the
    // line; everything behind it is that line, lagged.
    for (let i = 0; i < BIRDS; i++) {
      const b = birdSkein[i];
      const k = (((t * 0.021 * wind) - b.lag) % 1 + 1) % 1;
      const wander = Math.sin(k * 5.2 + b.beat) * 0.035;
      tmpV.set(
        birdFrom[0] + (birdTo[0] - birdFrom[0]) * k + b.side * birdSpan * 0.012,
        birdFrom[1] + (birdTo[1] - birdFrom[1]) * k + (wander + b.lift * 0.006) * birdSpan,
        BIRD_Z + b.side * 1.6,
      );
      // The wingbeat is the whole animation: at this size a bird is a flicker.
      const beat = Math.sin(t * 3.1 * wind + b.beat + b.lag * 9.0);
      const sc = b.scale * birdSpan * 0.011;
      tmpQ.setFromEuler(new THREE.Euler(beat * 0.30, 0.16, 0, 'YXZ'));
      tmpS.set(sc, sc * (0.55 + Math.abs(beat) * 0.75), sc);
      birds.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
    }
    birds.instanceMatrix.needsUpdate = true;

    // Cranes ride a slow circle, banking into the turn.
    for (let i = 0; i < cranes.count; i++) {
      const o = craneOrbits[i];
      const a = t * o.speed * wind + o.phase;
      tmpV.set(
        o.cx + Math.cos(a) * o.r,
        o.cy + Math.sin(t * 0.25 * wind + o.phase) * o.bob,
        o.cz + Math.sin(a) * o.r,
      );
      // Face along the tangent, and roll into the circle.
      const heading = -a + (o.speed > 0 ? Math.PI : 0);
      tmpQ.setFromEuler(new THREE.Euler(0, heading, o.speed > 0 ? 0.28 : -0.28, 'YXZ'));
      // A shallow wingbeat: the silhouette narrows and widens.
      const beat = 1 + Math.sin(t * 1.7 * wind + o.phase) * 0.16;
      tmpS.set(o.scale, o.scale * beat, o.scale);
      cranes.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
    }
    if (cranes.count > 0) cranes.instanceMatrix.needsUpdate = true;

    // Bamboo leans on the wind, each culm on its own phase.
    for (let i = 0; bamboo && i < bamboo.count; i++) {
      const b = bambooSway[i];
      const s = Math.sin(t * 0.7 * wind + b.phase) * 0.05 * wind;
      tmpV.set(b.x, 2.4 * b.h - 1.2, b.z);
      tmpQ.setFromEuler(new THREE.Euler(s * 0.6, b.phase, b.lean + s, 'YXZ'));
      tmpS.set(1, b.h, 1);
      bamboo.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
    }
    if (bamboo && bamboo.count > 0) bamboo.instanceMatrix.needsUpdate = true;

    // Fireflies bob in the updraught over the valley.
    if (fireflies.visible) {
      for (let i = 0; i < prog.fireflies; i++) {
        const s = ffSeed[i];
        const rise = ((t * (0.02 + s * 0.03) * wind) + s) % 1;
        ffPos[i * 3 + 0] = -30 + (s - 0.5) * 46 + Math.sin(t * 0.5 + s * 20) * 2.4;
        ffPos[i * 3 + 1] = -14 + rise * 16;
        ffPos[i * 3 + 2] = -46 - ((s * 7) % 1) * 42;
      }
      ffGeo.attributes.position.needsUpdate = true;
      fireflyMat.uniforms.uFade.value = 0.55 + Math.sin(t * 1.3) * 0.2;
    }

    // The plum sways as one piece — the trunk is old and does not bend much.
    plum.rotation.z = Math.sin(t * 0.32 * wind) * 0.012 * wind;
  }

  return { group, peaks, plum, cranes, petals, setPalette, sync, update, spireSets };
}
