// The wuxia landscape: ten thousand peaks in a sea of cloud, a plum tree in
// blossom, cranes on the thermals, water falling a very long way.
//
// All of it is generated here from seeded noise and instanced primitives — no
// models, no textures. The whole module costs about a dozen draw calls.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import {
  makeInkMaterial, makeCloudMaterial, makeFallMaterial, makeParticleMaterial,
  makeGraniteMaterial, makeMistMaterial, makeBlossomMaterial,
} from './shaders.js';
import { sceneryProgress } from './progress.js';
import { placeAtDepth } from './framing.js';
import { peakGeometry } from './peaks.js';
import { PEAK_MESHES, peakPlacements } from './peak-plan.js';
import { pineGeometry } from './trees.js';
import { PLUM, plumSkeleton, framingBranch } from './plum-plan.js';

/* ==================================================================== */
/*  geometry                                                             */
/* ==================================================================== */

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
 * A skeleton — a list of `{ from, to, r0, r1 }` in plum-plan.js's plain-array
 * form — turned into instance transforms for one tapered cylinder.
 *
 * The cylinder itself is built **tapered**, and that is not a nicety. Drawn at
 * one radius per segment, a chain of them is a chain of pipes: every joint is a
 * flat disc of the same diameter as the one before it, the ends are cut square,
 * and the whole tree reads as scaffolding — which is exactly what the first
 * pass of this looked like on the contact sheet. A fixed taper in the mesh
 * costs nothing, keeps one draw call, and turns a pipe into a limb. The
 * instance's radial scale is the segment's *base* radius; the tip comes out at
 * `BRANCH_TAPER` of it, and a joint where the next base is slightly wider than
 * the last tip is a knot, which is what old plum wood is made of.
 */
export const BRANCH_TAPER = 0.72;

/** 0.55 in sRGB, expressed in the linear light the live palette carries. */
const BARK_SINK = 0.55 ** 2.2;

function branchInstances(segments, matrix = null) {
  const up = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  return segments.map((s) => {
    from.fromArray(s.from);
    to.fromArray(s.to);
    if (matrix) { from.applyMatrix4(matrix); to.applyMatrix4(matrix); }
    const dir = to.clone().sub(from);
    const len = dir.length() || 1e-4;
    const scale = matrix ? matrix.getMaxScaleOnAxis() : 1;
    return {
      pos: from.clone().lerp(to, 0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(up, dir.divideScalar(len)),
      scale: new THREE.Vector3(s.r0 * scale, len, s.r0 * scale),
      tip: to.clone(),
    };
  });
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
  const tmpColor = new THREE.Color();

  /* ------------------------------------------------------ fourteen peaks */

  // Three ranks, six meshes, fourteen rocks. Where each one stands is solved in
  // frame space by peak-plan.js — say where the summit and the foot should land
  // in the picture and framing.js returns the world position that puts them
  // there. Choosing world coordinates directly, the obvious alternative,
  // quietly threw half of every range off the side of the screen: the world
  // framing looks down a diagonal, so the visible slice of x at z = -140 is
  // [-147, -65], nowhere near zero.
  //
  // What lives here is what the *renderer* has to know: how much air each rank
  // takes, and which ink it is cut from.
  //
  // `fogCap` is the most air a rank may take, not the amount. Uncapped exp² fog
  // is total by four hundred units, which is right for mist and wrong for
  // mountains — an ink-wash horizon is pale, not absent — and it fails at the
  // near end too: at a hundred and sixty units the uncapped exponential already
  // takes 40% of a bright air colour, which lifts near-black rock to a mid grey
  // and puts the *closest* rank paler than one twenty times further away.
  const BANDS = {
    hero: { fogCap: 0.22, tier: 0 },
    supporting: { fogCap: 0.42, tier: 1 },
    distant: { fogCap: 0.60, tier: 2 },
  };

  const peaks = new THREE.Group();
  const peakSets = [];
  const placements = peakPlacements().slice(0, Math.max(3, tier.peaks));

  // One material for the whole range, and one draw call per unique rock.
  //
  // The three ranks differ in two things and both are per *instance*: the ink
  // they are cut from, carried on `instanceColor`, and how much air they take,
  // carried on an instanced attribute. Three materials would mean grouping the
  // instances by rank as well as by mesh, which is eighteen draw calls for
  // fourteen rocks. The material's own colour is white because the ink is the
  // instance's; see setPalette below.
  const peakMat = makeGraniteMaterial(env, { color: '#ffffff', fogCap: 0.42 });

  PEAK_MESHES.forEach((spec, mi) => {
    const mine = placements.filter((p) => p.meshIndex === mi);
    if (!mine.length) return;
    const geo = peakGeometry(spec);
    const caps = new Float32Array(mine.length);
    mine.forEach((p, i) => { caps[i] = BANDS[p.band].fogCap; });
    geo.setAttribute('aFogCap', new THREE.InstancedBufferAttribute(caps, 1));

    const im = new THREE.InstancedMesh(geo, peakMat, mine.length);
    mine.forEach((p, i) => {
      tmpV.set(p.position[0], p.position[1], p.position[2]);
      // Every instance gets its own heading and its own couple of degrees off
      // plumb, and no two in the set share either — a mesh drawn twice at the
      // same rotation is the picket fence this whole stage exists to remove.
      tmpQ.setFromEuler(new THREE.Euler(p.tilt[0], p.yaw, p.tilt[1], 'YXZ'));
      tmpS.setScalar(p.scale);
      im.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS));
      im.setColorAt(i, new THREE.Color('#ffffff'));
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    peaks.add(im);
    // `ranks` is where each instance sits in the composition's own order —
    // heroes first, distant last — which is what lets the progression reveal
    // the range from the front without renumbering anything.
    peakSets.push({ mesh: im, spec, ranks: mine.map((p) => placements.indexOf(p)), placements: mine });
  });
  group.add(peaks);

  /* ------------------------------------------------- pines on the summits */

  // Scale. A peak with nothing on it is an abstract shape and could be three
  // metres tall; put a tree on its shoulder and it is instantly three hundred.
  // The host carries a pavilion for the same reason, built into its own mesh.
  // One instanced draw for every tree in the range.
  const pineMat = makeInkMaterial(env, {
    color: '#101820', rim: 0.30, bands: 2, flat: true, fogCap: 0.34,
  });
  let summitPines = null;
  const pineRanks = [];
  {
    // Only on the crowns that are broad enough to stand on, and only on the two
    // near ranks — a tree on a peak four hundred units away is a subpixel.
    const wooded = placements.filter((p) => (
      p.band !== 'distant' && (p.mesh.top === 'plateau' || p.mesh.top === 'crown')
    ));
    const perSummit = 3;
    if (wooded.length) {
      summitPines = new THREE.InstancedMesh(pineGeometry(), pineMat, wooded.length * perSummit);
      let n = 0;
      for (const p of wooded) {
        // Sized as a *fraction* of the crown, never a multiple of it: a pine on
        // a summit is a serration on the silhouette, a few pixels of it. Scaled
        // the other way round they come out taller than the peaks they stand on,
        // which not only looks absurd but destroys the cue they exist to give.
        const crown = p.mesh.radiusBottom * p.mesh.radiusTop * p.scale;
        for (let k = 0; k < perSummit; k++) {
          const a = rand() * Math.PI * 2;
          const r = crown * (0.35 + rand() * 0.55);
          const scale = crown * (0.16 + rand() * 0.12) * (k === 0 ? 1.4 : 1);
          tmpV.set(
            p.summit[0] + Math.cos(a) * r,
            p.summit[1] - crown * 0.08,
            p.summit[2] + Math.sin(a) * r,
          );
          tmpQ.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.14, rand() * 6.28, (rand() - 0.5) * 0.14, 'YXZ'));
          tmpS.set(scale, scale * (1.5 + rand() * 0.8), scale);
          summitPines.setMatrixAt(n, tmpMat.compose(tmpV, tmpQ, tmpS));
          pineRanks.push(placements.indexOf(p));
          n++;
        }
      }
      summitPines.count = n;
      summitPines.instanceMatrix.needsUpdate = true;
      summitPines.frustumCulled = false;
      summitPines.renderOrder = -12;
      group.add(summitPines);
    }
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

  /* --------------------------------------- the plum, and the framing branch */

  // Old wood: near-black, angular, standing on the platform's back-left corner
  // and leaning out over the drop.
  //
  // ---------------------------------------------------------------------
  // What this replaces, and why the replacement is not a better fractal
  //
  // The foreground tree was a recursive branch function — grow, throw two or
  // three children at a randomised angle, recurse five deep — which is a
  // perfectly good *deciduous* tree, and that was the fault. At the opening
  // realm the progression puts the blossom count near zero, so what shipped in
  // every first screenshot of this game was a bare self-similar fan of twigs: a
  // European oak in February, standing in a Chinese mountain range. It could
  // not be fixed by adding pink to the ends, because the silhouette was already
  // saying something else.
  //
  // 梅 is a chain of decisions rather than a recursion, and plum-plan.js holds
  // the drawing — four to six trunk lengths with a hard angular turn at every
  // joint, three or four mains, two or three subs on each, and nothing below
  // that.
  //
  // ---------------------------------------------------------------------
  // One mesh, two trees
  //
  // The framing branch is the same wood, so it is the same instanced draw: both
  // skeletons are baked into world space and concatenated. Which is also why
  // neither of them sways. A group rotation on the tree would swing its wood
  // and not its blossom — the blossom has to live in one world-space mesh
  // shared with the branch, or it is a second draw call for forty flowers — and
  // 0.012 radians of it was 0.4% of the frame anyway. The foreground's motion
  // is the petals and the thread of smoke; the wood is old and does not move.
  //
  // rim 0.30 → 0.09, and it is the same fault the shelf had one stage earlier,
  // arrived at from the other end. A fresnel term is only an *edge* on a
  // silhouette, and on a cylinder most of the visible surface is near-grazing:
  // `pow(1 - dot(n, v), 4)` runs high over the whole limb rather than at its
  // outline. At 0.30 that was two thirds of the light on the framing branch,
  // and no sun and no palette could touch it — the near-black device in the
  // corner rendered as a pale grey pipe. It never showed on the old tree
  // because that was sixteen units away and pencil-thin.
  const barkMat = makeInkMaterial(env, { color: '#120e12', rim: 0.09, bands: 2 });
  const branchGeo = new THREE.CylinderGeometry(BRANCH_TAPER, 1, 1, 5, 1);

  const tree = plumSkeleton({ seed: 77, subs: tier.plumDepth >= 5 ? 3 : 2 });
  const seat = new THREE.Matrix4().compose(
    new THREE.Vector3(...PLUM.at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(PLUM.tilt, PLUM.yaw, PLUM.lean, 'YXZ')),
    new THREE.Vector3(PLUM.scale, PLUM.scale, PLUM.scale),
  );
  const frame = framingBranch();

  const treeParts = branchInstances(tree.segments, seat);
  const frameParts = branchInstances(frame.segments);
  const parts = treeParts.concat(frameParts);

  const branches = new THREE.InstancedMesh(branchGeo, barkMat, parts.length);
  parts.forEach((s, i) => branches.setMatrixAt(i, tmpMat.compose(s.pos, s.quat, s.scale)));
  branches.instanceMatrix.needsUpdate = true;
  branches.castShadow = true;
  branches.frustumCulled = false;
  const plum = branches;
  group.add(branches);

  // Where the flowers go: the tree's tips in world space, and the framing
  // branch's, interleaved so the two come into bloom together as the count
  // climbs. One framing tip per three of the tree's, because the framing branch
  // is three times closer to the lens — a flower on it is three times the
  // flower on the tree, and evenly shared the corner would carry most of the
  // blossom in the picture. It is a near-black device, not the subject.
  const treeTips = tree.tips.map((t) => new THREE.Vector3(...t).applyMatrix4(seat));
  const frameTips = frame.tips.map((t) => new THREE.Vector3(...t));
  const tips = [];
  treeTips.forEach((t, i) => {
    tips.push(t);
    if (i % 3 === 2 && frameTips.length) tips.push(frameTips[Math.floor(i / 3) % frameTips.length]);
  });

  // Blossom: five tiny petals per flower is too much geometry at this count, so
  // each is a small disc — but a *lit* one now. It used to be drawn with the
  // glow material, which is a fresnel shell: brightest at the silhouette, empty
  // in the middle, and on a disc facing anywhere near the camera it renders as
  // a ring. Two hundred and sixty tiny rings is not blossom. See
  // makeBlossomMaterial for the rest of the argument.
  const blossomMat = makeBlossomMaterial(env, { color: '#f5d0dc', roughness: 0.7, emissive: 0.16 });
  const blossomGeo = new THREE.CircleGeometry(0.055, 5);
  const blossomCount = Math.min(tier.blossoms, tips.length * 26);
  const blossoms = new THREE.InstancedMesh(blossomGeo, blossomMat, blossomCount);
  blossoms.frustumCulled = false;
  const brand = mulberry32(4242);
  const nearWhite = new THREE.Color('#fff2f4');
  const petalPink = new THREE.Color('#f5d0dc');
  for (let i = 0; i < blossomCount; i++) {
    const tip = tips[i % tips.length];
    // Clustered, not scattered: 梅 flowers in knots on bare wood, so the spread
    // around a tip is small and the gaps between tips are left empty. Wider for
    // the flowers added late, so a tree coming into full bloom spreads out from
    // its own tips rather than getting denser in the same place.
    const spread = 0.16 + (i / blossomCount) * 0.26;
    tmpV.set(
      tip.x + (brand() - 0.5) * spread,
      tip.y + (brand() - 0.5) * spread,
      tip.z + (brand() - 0.5) * spread,
    );
    tmpQ.setFromEuler(new THREE.Euler(brand() * 3, brand() * 3, brand() * 3));
    const sc = 0.75 + brand() * 0.75;
    blossoms.setMatrixAt(i, tmpMat.compose(tmpV, tmpQ, tmpS.set(sc, sc, sc)));
    // #f5d0dc through to near-white, per flower. A single pink at this size
    // averages out to one flat tint; the spread is what gives a cluster depth.
    blossoms.setColorAt(i, tmpColor.copy(petalPink).lerp(nearWhite, brand() * brand()));
  }
  blossoms.instanceMatrix.needsUpdate = true;
  if (blossoms.instanceColor) blossoms.instanceColor.needsUpdate = true;
  group.add(blossoms);

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
    // The three aerial tiers — near, mid, far — derived from the realm's ink
    // and the day's air by aerialTiers() in time-of-day.js. Never the ridge
    // ramp: those colours are authored for valley walls seen against mist and
    // run pale at the far end, and borrowed for the skyline they made the
    // furthest rank *lighter* than the air behind it, which reads as a smudge
    // rather than as distance.
    const ink = p.peaks || p.ridges;
    // Per instance, not per material: one material draws all three ranks, and
    // what separates them is the ink each rock is cut from and the cap on how
    // much air it may take. `instanceColor` multiplies the material's own
    // colour, which is white, so this *is* the diffuse.
    for (const set of peakSets) {
      set.placements.forEach((pk, i) => {
        set.mesh.setColorAt(i, tmpColor.set(ink[Math.min(BANDS[pk.band].tier, ink.length - 1)]));
      });
      if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
    }
    pineMat.uniforms.uColor.value.set(ink[0]);
    birdMat.uniforms.uColor.value.set(ink[0]);
    // Near-black, and taken further there than the palette asks.
    //
    // `bark` is authored per realm at around luminance 20, which sounds like
    // near-black and is not, once a limb this close to the lens turns its lit
    // face to the sun: on the contact sheet the framing branch came back at 90,
    // level with the peaks it is standing in front of. BARK_SINK is the linear
    // equivalent of taking it 45% toward black in sRGB — the same move
    // `foregroundInk` makes on the platform, done as a multiply because what
    // arrives here is the *live* palette, whose entries are already THREE
    // colours in linear light rather than the hexes world.js is handed.
    barkMat.uniforms.uColor.value.copy(p.bark || tmpColor.set('#1b1519')).multiplyScalar(BARK_SINK);
    // A stock material, so it is `.color` and `.emissive` rather than a
    // uniform — and both, or a realm's blossom changes hue while the light it
    // gives off stays the last realm's.
    blossomMat.color.set(p.blossom || '#f5d0dc');
    blossomMat.emissive.set(p.blossom || '#f5d0dc');
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
    peaks: 0,            // how many of the fourteen are standing
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

    // The range grows from the front. Instances are ordered by the
    // composition — the three heroes, then the supporting mass, then the
    // skyline — so truncating the count reveals the distance last, which is
    // what "the peaks come out of the cloud as you climb" has to mean when
    // there are fourteen of them instead of ninety-six.
    // The floor is the three heroes and the whole distant skyline — nine —
    // because peak-plan.js orders the reveal that way and a range with no
    // horizon reads as unfinished rather than as unearned. See REVEAL there.
    prog.peaks = Math.max(9, Math.round(placements.length * next.peakFraction));
    for (const set of peakSets) {
      set.mesh.count = set.ranks.filter((r) => r < prog.peaks).length;
    }
    if (summitPines) {
      summitPines.count = pineRanks.filter((r) => r < prog.peaks).length;
    }

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
    // Full bloom catches the bloom pass; a tree in bud does not. The dial is
    // the emissive term, which is the only part of this material that can push
    // a flower over the composer's 0.85 threshold.
    blossomMat.emissiveIntensity = 0.10 + smooth.blossom * 0.14;
    petalShown = Math.round(petalCount * prog.petalRate);
    petalGeo.setDrawRange(0, petalShown);

    // Petals: a slow fall with a sideways drift, respawning at the tree.
    for (let i = 0; i < petalShown; i++) {
      const s = petalSeed[i];
      const life = ((t * (0.045 + s * 0.05) * wind) + s) % 1;
      const swirl = Math.sin(life * 9.0 + s * 12.0) * 1.6;
      // Off the crown of the tree, and over the rim behind it. The tree stands
      // on the platform now, so a petal that fell straight down would land on
      // the rock beside the cultivator and sit there; the drift carries them
      // out past the edge, which is where the drop is.
      petalPos[i * 3 + 0] = PLUM.at[0] + swirl + (s - 0.5) * 4.4 - life * 5.2;
      petalPos[i * 3 + 1] = PLUM.at[1] + 6.4 - life * 20.0;
      petalPos[i * 3 + 2] = PLUM.at[2] + Math.cos(life * 7.0 + s * 9.0) * 1.8 + (s - 0.5) * 3.2 - life * 2.6;
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

  }

  return { group, peaks, plum, cranes, petals, setPalette, sync, update, peakSets };
}
