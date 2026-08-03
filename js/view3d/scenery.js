// The wuxia landscape: ten thousand peaks in a sea of cloud, a plum tree in
// blossom, cranes on the thermals, water falling a very long way.
//
// All of it is generated here from seeded noise and instanced primitives — no
// models, no textures. The whole module costs about a dozen draw calls.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import {
  makeInkMaterial, makeCloudMaterial, makeFallMaterial, makeParticleMaterial,
  makeGlowMaterial,
} from './shaders.js';
import { sceneryProgress } from './progress.js';
import { placeAtDepth } from './framing.js';

/** Hermite smoothstep, matching the GLSL one. */
function smoothstep01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/* ==================================================================== */
/*  geometry                                                             */
/* ==================================================================== */

/**
 * A karst spire: the sheer, fluted, top-heavy column of Zhangjiajie and the
 * Mount Hua ridgeline. Built as a ring-and-column lattice so vertical grooves
 * run its whole height — that fluting is what stops it reading as a cone.
 */
function spireGeometry({
  seed = 1, sides = 9, rings = 20, taperStart = 0.66, taperTo = 0.14, strata = 9,
  waist = 0.10, shoulder = 0.0,
} = {}) {
  const rand = mulberry32(seed);
  const flute = Array.from({ length: sides }, () => 0.80 + rand() * 0.34);
  const kinks = Array.from({ length: rings + 1 }, () => rand());

  const pos = [];
  const nrm = [];
  const idx = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    // The karst silhouette is a near-vertical wall that only pinches in near
    // the summit. Tapering smoothly from the base — the obvious thing — gives
    // a cone, and a field of cones reads as a row of cypress trees.
    let wall = 1 - smoothstep01(taperStart, 1.0, t) * (1 - taperTo);
    // Undercut: the pillar is narrowest a little above its foot, which is what
    // makes it look like it was dissolved out of a plateau rather than piled up.
    wall *= 1 - waist * Math.sin(Math.min(1, t / 0.45) * Math.PI);
    // An optional shoulder — a lesser summit off the main one. Real ranges are
    // full of them and a field of single-summit needles is not a range.
    if (shoulder > 0) {
      wall += shoulder * Math.exp(-Math.pow((t - 0.62) / 0.10, 2)) * 0.55;
    }
    // Bedding planes: small steps in radius so the rock shows horizontal strata.
    const step = Math.round(t * strata) / strata;
    const ledge = 1 + (step - t) * 0.55;
    const wobble = 1 + (kinks[r] - 0.5) * 0.10;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const f = flute[s % sides];
      const rad = wall * ledge * wobble * f;
      pos.push(Math.cos(a) * rad, t, Math.sin(a) * rad);
      nrm.push(Math.cos(a), 0.22, Math.sin(a));
    }
  }
  const stride = sides + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * stride + s;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  // Cap the summit so the sky does not show through the top.
  const apex = pos.length / 3;
  pos.push(0, 1.0 + taperTo * 0.7, 0);
  nrm.push(0, 1, 0);
  for (let s = 0; s < sides; s++) {
    const a = rings * stride + s;
    idx.push(a, apex, a + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
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
      name: 'near', order: -13, share: 0.26,
      z: [-160, -228], color: '#1d2632', rim: 0.40, bands: 3, fogCap: 0.42,
      foot: [0.29, 0.42], rise: [0.07, 0.28], ceiling: 0.126, clusters: 5, slender: [0.044, 0.046],
      geo: { sides: 9, rings: 18, taperStart: 0.70, taperTo: 0.10, strata: 11, waist: 0.13, shoulder: 0.18 },
    },
    {
      name: 'mid', order: -16, share: 0.36,
      z: [-250, -340], color: '#2b3745', rim: 0.32, bands: 3, fogCap: 0.56,
      foot: [0.25, 0.35], rise: [0.05, 0.205], ceiling: 0.146, clusters: 7, slender: [0.048, 0.050],
      geo: { sides: 7, rings: 13, taperStart: 0.62, taperTo: 0.16, strata: 8, waist: 0.10, shoulder: 0.10 },
    },
    {
      name: 'far', order: -19, share: 0.38,
      z: [-360, -520], color: '#3d4b5e', rim: 0.22, bands: 2, fogCap: 0.70,
      foot: [0.215, 0.295], rise: [0.035, 0.140], ceiling: 0.164, clusters: 9, slender: [0.054, 0.056],
      geo: { sides: 6, rings: 9, taperStart: 0.55, taperTo: 0.22, strata: 6, waist: 0.08, shoulder: 0.0 },
    },
  ];

  const peaks = new THREE.Group();
  const spireSets = [];
  const spireMats = [];

  if (tier.spires > 0) {
    BANDS.forEach((band, bi) => {
      const count = Math.max(1, Math.round(tier.spires * band.share));
      // Aerial perspective: the far rank is paler and less contrasty, which is
      // the only cue that says "these are twenty kilometres away" in a picture
      // with no texture and no atmosphere shader.
      const mat = makeInkMaterial(env, {
        color: band.color, rim: band.rim, bands: band.bands, flat: true,
        fogCap: band.fogCap,
      });
      const geo = spireGeometry({ seed: 11 + bi * 17, ...band.geo });
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
        const z = band.z[0] + (band.z[1] - band.z[0]) * rand();
        const centre = centres[i % centres.length];
        // Two uniforms summed is a cheap bell curve: dense at the cluster's
        // heart, thinning at its edges.
        const u = centre + ((rand() + rand()) - 1) * 0.16;
        const footV = band.foot[0] + (band.foot[1] - band.foot[0]) * rand();
        // Prominence is skewed hard toward the low end so each cluster gets a
        // few tall pillars and many short ones, which is what gives the range a
        // silhouette instead of a plateau. The first of every cluster is forced
        // tall, so no cluster comes out uniformly stunted.
        const lead = i < centres.length;
        const p = lead ? 0.82 + rand() * 0.18 : Math.pow(rand(), 1.8);
        const rise = band.rise[0] + (band.rise[1] - band.rise[0]) * p;
        const foot = placeAtDepth(u, footV, z);
        const head = placeAtDepth(u, Math.max(band.ceiling, footV - rise), z);
        if (!foot || !head) continue;

        const h = head[1] - foot[1];
        // Karst are slender: width well under a tenth of height, or they read
        // as buttes. Thinner as they recede, so the far rank stays needle-like.
        const w = h * (band.slender[0] + rand() * band.slender[1]);
        tmpV.set(foot[0], foot[1], z);
        // A few degrees of lean on some of them; perfectly plumb pillars look
        // manufactured. The spin is what makes one geometry read as many.
        tmpQ.setFromEuler(new THREE.Euler(
          (rand() - 0.5) * 0.09, rand() * Math.PI * 2, (rand() - 0.5) * 0.11, 'YXZ',
        ));
        tmpS.set(w, h, w);
        im.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
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
  const DECKS = [
    { z: -205, top: 0.300, bottom: 0.560, order: -11, opacity: 0.62, scale: 0.030, speed: 0.10 },
    { z: -310, top: 0.252, bottom: 0.430, order: -14, opacity: 0.50, scale: 0.040, speed: 0.14 },
    { z: -450, top: 0.212, bottom: 0.340, order: -17, opacity: 0.40, scale: 0.052, speed: 0.17 },
  ];

  const cloudDecks = [];
  const cloudMats = [];
  for (let i = 0; i < Math.min(tier.cloudDecks, DECKS.length); i++) {
    const d = DECKS[i];
    const mat = makeCloudMaterial(env, {
      opacity: d.opacity, scale: d.scale, speed: d.speed, vertical: true,
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
  const ledgeMat = makeInkMaterial(env, { color: '#232a35', rim: 0.35, bands: 2, flat: true });
  const ledge = new THREE.Mesh(new THREE.ConeGeometry(4.6, 9, 6, 1), ledgeMat);
  ledge.position.set(-7.9, -9.6, -16.8);
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
    fallMist = new THREE.Mesh(
      new THREE.PlaneGeometry(fheight * 0.80, fheight * 0.30, 1, 1),
      makeCloudMaterial(env, { opacity: 0.8, scale: 0.09, speed: 0.22, vertical: true }),
    );
    fallMist.position.set(fbot[0], fbot[1] + fheight * 0.05, FALL.z + 1);
    fallMist.renderOrder = -3;
    cloudMats.push(fallMist.material);
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
    // Ridge colours 0/2/4 run near-to-far, so the ranks inherit the realm's own
    // aerial perspective instead of a fixed grey.
    const rank = [0, 2, 4];
    spireMats.forEach((m, i) => m.uniforms.uColor.value.set(p.ridges[rank[i]] || p.ridges[0]));
    barkMat.uniforms.uColor.value.set(p.bark || '#1b1519');
    blossomMat.uniforms.uColor.value.set(p.blossom || '#f6d3e0');
    petalMat.uniforms.uColor.value.set(p.blossom || '#f6d3e0');
    craneMat.uniforms.uColor.value.set(p.crane || '#e6ecf2');
    for (const m of cloudMats) {
      m.uniforms.uColor.value.set(p.cloud || '#aab6c4');
      m.uniforms.uCrest.value.set(p.cloudCrest || '#e8eef4');
    }
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
