// The landscape: sky dome, layered ridges, the meditation shelf, water, mist.
//
// All geometry is generated here at boot from seeded noise. Nothing is loaded
// from disk, which is what keeps the whole download under a megabyte.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { cameraBasis, placeAtDepth } from './framing.js';
import { stoneGeometry, slabGeometry, skirtGeometry, mergeGeometries } from './rock.js';
import { AURORA_COLOR, foregroundInk } from './palette.js';
import { sunDirection } from './time-of-day.js';
import { createCloudSea } from './cloud-sea.js';
import { TERRAIN, TARN, terrainField, terrainHeight } from './terrain-plan.js';
import {
  PLATFORM, platformOutline, stoneOutline, topRelief, STEPS, CENSER, SMOKE,
} from './platform-plan.js';
import { stepsGeometry, censerGeometry, smokeGeometry } from './props.js';
import { pineGeometry } from './trees.js';
import {
  makeSkyMaterial, makeRidgeMaterial, makeInkMaterial, makeWaterMaterial,
  makeMistMaterial, makeGraniteMaterial, makeSmokeMaterial,
} from './shaders.js';

/* ------------------------------------------------------------ CPU noise */

function noise1(seed) {
  const rand = mulberry32(seed);
  const table = new Float32Array(512);
  for (let i = 0; i < 512; i++) table[i] = rand();
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    const a = table[((i % 512) + 512) % 512];
    const b = table[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * t;
  };
}

function ridgedFbm(n, x, octaves = 4) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    // 1 - |2n-1| gives creases instead of blobs: mountains, not hills.
    v += amp * (1 - Math.abs(2 * n(x * freq) - 1));
    freq *= 2.07;
    amp *= 0.5;
  }
  return v;
}

/**
 * A ridge silhouette as a triangle strip.
 *
 * uv.y is measured *down from each column's own crest*, 1 at the skyline and 0
 * one `fade` band below it, going negative under that. It used to run 0 at the
 * bottom of the skirt — but the skirt is deliberately dragged far below the
 * frame so the strip never ends in mid-air, so "the bottom half" of the strip
 * was entirely off-screen and everything the player could actually see sat at
 * uv.y > 0.85. Any dissolve written against that coordinate does nothing, and
 * the ridge stays a flat opaque slab over the whole valley. Crest-relative, the
 * same smoothstep puts the ink where ink goes: a dark crest line thinning into
 * the mist beneath it.
 */
function ridgeGeometry({ width, height, depth, segments, seed, roughness = 1, fade = 1.15 }) {
  const n = noise1(seed);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];
  const span = Math.max(1e-3, height * fade);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * width;
    // Taper the ends so a layer never stops mid-air at the screen edge.
    const taper = Math.pow(Math.sin(Math.PI * t), 0.35);
    const h = height * (0.35 + ridgedFbm(n, t * 3.1 * roughness + seed * 0.01) * 1.15) * taper;
    const k = i * 2;
    positions[k * 3 + 0] = x; positions[k * 3 + 1] = -depth; positions[k * 3 + 2] = 0;
    positions[(k + 1) * 3 + 0] = x; positions[(k + 1) * 3 + 1] = h; positions[(k + 1) * 3 + 2] = 0;
    uvs[k * 2 + 0] = t; uvs[k * 2 + 1] = 1 - (h + depth) / span;
    uvs[(k + 1) * 2 + 0] = t; uvs[(k + 1) * 2 + 1] = 1;
    if (i < segments) {
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/* ------------------------------------------------------------- the world */

export function createWorld(env, tier, lighting) {
  const group = new THREE.Group();

  /* sky ------------------------------------------------------------- */
  const skyMat = makeSkyMaterial(env);
  skyMat.uniforms.uAuroraColor.value.set(AURORA_COLOR);
  // 64×32, not 32×20. The gradient is read from the ray through each fragment,
  // and a ray interpolated across a coarse sphere is a chord where it wants an
  // arc: the error is periodic in the segment, which lays a faint vertical seam
  // every 11° across the one surface in the frame with nothing else on it.
  // Quadrupling the segments quarters that; the dither takes what is left. The
  // sphere costs one draw call either way.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(760, 64, 32), skyMat);
  sky.frustumCulled = false;
  group.add(sky);

  /* fog -------------------------------------------------------------- */
  //
  // The single owner of the air, and the reason it is a real THREE.FogExp2
  // rather than a pair of loose numbers: the ink shaders read their fog colour
  // and density straight off this object, so there is exactly one place where
  // "what colour is the air" is answered, and it is answered with the day's
  // horizon colour — the same value the sky sphere's middle stop is drawn with.
  // Anything else and every distant surface is a slightly wrong rectangle
  // pasted onto the horizon.
  const fog = new THREE.FogExp2(0x8fa3b8, 0.018);

  /* ridges ----------------------------------------------------------- */
  // Five layers marching away from the shelf. Each is specified by where its
  // skyline should land in the frame, not by a height in world units: the
  // camera is authored and fixed, so the frame is the thing being composed and
  // the world coordinate is an implementation detail. placeAtDepth turns one
  // into the other.
  //
  // These crests were authored under the pre-lock camera, whose horizon sat at
  // v = 0.198: the cultivator looked out and *down* off a high shelf, so every
  // crest below is a valley wall beneath the skyline, and the skyline itself
  // belongs to the karst spires in scenery.js.
  //
  // Stage 0 froze the framing at a near-level lens with the horizon at
  // horizonV(FRAMINGS.world) = 0.45, and placeAtDepth moved these strips to
  // match without anyone touching a number here — which is exactly what
  // frame-space placement is for, and also exactly why it needs saying out
  // loud: they still land where they were told to land, but "below the horizon"
  // is no longer what that means. They read as distant ranges now, not valley
  // walls. Re-seating them is a later stage's job, against this camera.
  //
  // The old warning stands whatever the horizon is: the ridge strips are
  // opaque, so anything placed behind one is simply gone.
  const LAYERS = [
    { z: -58,  crestV: 0.440, segments: 128, roughness: 1.5 },
    { z: -96,  crestV: 0.404, segments: 112, roughness: 1.2 },
    { z: -152, crestV: 0.374, segments: 96,  roughness: 1.0 },
    { z: -232, crestV: 0.350, segments: 80,  roughness: 0.8 },
    { z: -336, crestV: 0.330, segments: 64,  roughness: 0.6 },
  ];
  // Turn a crest target into the height/base/width the strip builder wants.
  // `height` is scaled by 0.35..1.5 along the strip, so the band between the
  // highest and lowest crest is what `spread` controls.
  const solveLayer = (L, spread = 0.105) => {
    const top = placeAtDepth(0.5, L.crestV, L.z)[1];
    const bot = placeAtDepth(0.5, L.crestV + spread, L.z)[1];
    const height = (top - bot) / 1.15;
    const baseY = bot - 0.35 * height;
    const left = placeAtDepth(0, L.crestV, L.z)[0];
    const right = placeAtDepth(1, L.crestV, L.z)[0];
    return {
      ...L,
      height,
      baseY,
      // Down to well past the bottom of the frame, so the strip never ends
      // mid-air over the valley.
      depth: baseY - placeAtDepth(0.5, 1.35, L.z)[1],
      // Wide enough to survive the player swinging the camera through its arc.
      width: Math.abs(right - left) * 2.4,
    };
  };
  // Gapped on purpose: scenery.js slots its spire bands and cloud decks between
  // these numbers so a karst range can stand behind one ridge and in front of
  // the next. See SCENERY_ORDER there.
  const RIDGE_ORDER = [-6, -9, -12, -15, -18];
  const ridgeMats = [];
  const ridges = new THREE.Group();
  const layerCount = Math.min(tier.ridgeLayers, LAYERS.length);
  // Always keep the furthest layer: losing the skyline reads as a bug, losing a
  // middle layer reads as weather.
  const chosen = layerCount >= LAYERS.length
    ? LAYERS.map((l, i) => i)
    : [0, ...Array.from({ length: layerCount - 2 }, (_, i) => 1 + i * 2), LAYERS.length - 1];

  chosen.forEach((idx, slot) => {
    const L = LAYERS[idx];
    // `fade` is how far up the strip the ridge's own colour takes over. High
    // values keep the ink at the crest only and let the rest drown in mist —
    // which is what stops the nearest range reading as a black slab.
    const mat = makeRidgeMaterial(env, { fade: 0.40 - slot * 0.05, grain: 0.4 - slot * 0.05 });
    const S = solveLayer(L);
    // Nearer ranges dissolve over a taller band, so the stack recedes by the
    // *softness* of its feet as well as by its colour.
    const mesh = new THREE.Mesh(
      ridgeGeometry({ ...S, seed: 1000 + idx * 37, fade: 1.9 - slot * 0.22 }), mat,
    );
    mesh.position.set(placeAtDepth(0.5, S.crestV, S.z)[0], S.baseY, S.z);
    // These write no depth, so they are a painter's stack: the furthest layer
    // must go down first or a distant range paints over the ridge in front.
    // Keyed to the layer, not the slot, so dropping a middle layer at low
    // quality cannot renumber the stack the scenery interleaves itself into.
    mesh.renderOrder = RIDGE_ORDER[idx];
    mesh.userData.layer = idx;
    ridgeMats.push({ mat, layer: idx });
    ridges.add(mesh);
  });
  group.add(ridges);

  /* the shelf the cultivator sits on ---------------------------------- */
  //
  // Everything from here to the standing rocks is the foreground island, and
  // the island is the only thing the sun's shadow camera is fitted to. So it
  // is also the only thing that carries a shadow flag: `receiveShadow` is a
  // per-object uniform the renderer sets, so the far midground below shares
  // these same materials and pays nothing for a lookup that could only ever
  // come back "lit".
  // rim 0.25 → 0.08 → 0.02, in three stages, and the third one is the one that
  // finally killed it. A fresnel edge on the one surface in the frame that is
  // never seen edge-on is not an edge, it is a veil over the whole foreground —
  // and `uRimColor` is the palette's accent, which is the one colour the rules
  // say may not sit on a background element.
  //
  // 0.08 looked like a trace and was not, because the rim term is **additive**
  // and the albedo underneath it is not. Once this stage took the platform to
  // near-black, the rim was no longer a few percent of the surface's light —
  // it was almost all of it: `pow(1 - dot(n, v), 4)` runs at 0.55 across a top
  // seen from eight degrees above, and the grayscale sheet put the platform at
  // 82 against a midground of 67. The nearest rock in the picture was lighter
  // than the range behind it, which is the exact inversion the whole value
  // ladder exists to prevent, and it was arriving through a term that had
  // nothing to do with the palette at all.
  //
  // Flat shaded, too. The top is nine large triangles between the outline
  // points, each tipped a different way by the rim relief; smooth-shaded they
  // average into one even grey and the relief does nothing. Faceted, each takes
  // its own step off the three-band ramp, which is what makes a broken rock
  // terrace out of a slab.
  //
  // ---------------------------------------------------------------------
  // Stage 5: it is not a cylinder any more, and it is the darkest thing in
  // the frame
  //
  // Two faults, and they compounded. The shelf was
  // `CylinderGeometry(9.5, 12.5, 3.2, 7)` standing on a seven-sided apron — the
  // two largest objects in the picture, both regular polygons, concentric. A
  // regular polygon is the one silhouette the eye solves instantly, and it
  // solves it *in grayscale*, which is the instrument this build judges itself
  // with. And it was painted with the realm's `ground`, a mid tone: the nearest
  // rock in the frame came out lighter than ranges a hundred units behind it,
  // which is the value ladder running backwards through the foreground.
  //
  // So: a hand-authored eleven-point plan extruded with a small bevel
  // (platform-plan.js holds the drawing and the reason for every number),
  // chipped on top, and cut from `foregroundInk` — the realm's ink taken most
  // of the way to black, so the near band is the anchor the rest of the ladder
  // is read against rather than a pale slab in the middle of it.
  const groundMat = makeInkMaterial(env, { color: '#181c22', rim: 0.02, bands: 3, flat: true, tint: true });
  //
  // The slab and the mass under it are welded into one buffer. They share a
  // material and neither ever moves, so two meshes was two draw calls for one
  // object; the skirt is lofted from the platform's own outline, so the two
  // could not disagree about the silhouette even if somebody wanted them to.
  const outline = platformOutline();
  const shelf = new THREE.Mesh(mergeGeometries([
    slabGeometry({
      outline,
      depth: PLATFORM.depth,
      bevel: PLATFORM.bevel,
      relief: topRelief,
      chip: PLATFORM.chip,
      seed: 5,
      tint: { top: 1.15, bottom: 0.52, from: 0, to: -PLATFORM.depth },
    }),
    skirtGeometry({
      outline, from: -PLATFORM.depth + 0.4, to: -17.5, flare: [1.02, 2.4], rings: 5, seed: 88,
    }),
  ]), groundMat);
  shelf.position.y = PLATFORM.top;
  shelf.receiveShadow = true;
  group.add(shelf);

  // A meditation stone, slightly proud of the shelf — a seven-point plan rather
  // than the nine-sided cylinder that used to sit concentrically inside the
  // seven-sided one.
  const stoneMat = makeInkMaterial(env, { color: '#242a33', rim: 0.10, bands: 3, flat: true, tint: true });
  const stone = new THREE.Mesh(slabGeometry({
    outline: stoneOutline(),
    depth: 0.78,
    bevel: { thickness: 0.10, size: 0.14, segments: 1 },
    chip: 0.04,
    seed: 61,
    tint: { top: 1.2, bottom: 0.66, from: 0, to: -0.78 },
  }), stoneMat);
  stone.position.y = 0.32;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  /* worn steps, and the world past the crop ---------------------------- */
  //
  // The one cue in the picture that says the mountain does not stop at the edge
  // of the frame. They cross the back of the platform and leave by the side,
  // descending — which is not where they were first put. A flight running *off*
  // the back edge and down is completely invisible from this camera: the eye is
  // two units above a rim at y = 0, so the platform's own mass occludes every
  // point beyond its edge that lies below it. Measured, not guessed; see the
  // header of platform-plan.js.
  //
  // The treads and the censer go into one buffer for the same reason the
  // platform and its skirt do: same material, nothing moves, and the two of
  // them together are one draw call instead of two.
  const censerAt = [CENSER.at[0], topRelief(CENSER.at[0], CENSER.at[2]), CENSER.at[2]];
  const censerGeo = censerGeometry({ radius: CENSER.radius, height: CENSER.height });
  censerGeo.rotateY(CENSER.yaw);
  censerGeo.translate(censerAt[0], censerAt[1], censerAt[2]);
  censerGeo.computeVertexNormals();
  const dressing = new THREE.Mesh(
    mergeGeometries([stepsGeometry(STEPS), censerGeo]), stoneMat,
  );
  dressing.castShadow = true;
  dressing.receiveShadow = true;
  group.add(dressing);

  /* the thread of smoke off the burner --------------------------------- */
  //
  // The ribbon is a flat strip, so it is turned to face the lens — at this
  // camera's own bearing, worked out from the framing rather than typed in, so
  // it keeps facing the right way if the camera is ever re-solved.
  const smokeMat = makeSmokeMaterial(env, { lean: SMOKE.lean });
  const smoke = new THREE.Mesh(
    smokeGeometry({ height: SMOKE.height, width: SMOKE.width, rows: SMOKE.rows }), smokeMat,
  );
  {
    const eye = cameraBasis().pos;
    smoke.position.set(censerAt[0], censerAt[1] + CENSER.height * 1.15, censerAt[2]);
    smoke.rotation.y = Math.atan2(eye[0] - censerAt[0], eye[2] - censerAt[2]);
    smoke.renderOrder = 2;
  }
  group.add(smoke);

  // A few standing rocks, for the negative space to push against. One draw
  // call: five separate meshes here cost as much as the whole karst range.
  const ROCKS = 5;
  const rocks = new THREE.InstancedMesh(stoneGeometry(97), stoneMat, ROCKS);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  {
    const rrand = mulberry32(97);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let i = 0; i < ROCKS; i++) {
      const a = rrand() * Math.PI * 2;
      const r = 5.2 + rrand() * 3.4;
      const h = 0.7 + rrand() * 2.1;
      const rad = 0.35 + rrand() * 0.6;
      // The crag hangs below its origin, so it is placed by its crown.
      v.set(Math.cos(a) * r, h - 0.35, Math.sin(a) * r);
      q.setFromEuler(new THREE.Euler((rrand() - 0.5) * 0.25, rrand() * 3, (rrand() - 0.5) * 0.25));
      sc.set(rad, h, rad);
      rocks.setMatrixAt(i, m.compose(v, q, sc));
    }
    rocks.instanceMatrix.needsUpdate = true;
  }
  group.add(rocks);

  // The midground reads as ink laid over the haze, so it takes a near-flat dark
  // material with almost no rim. Lit, mid-grey geometry out there looked like
  // paper cut-outs pasted on the sky.
  //
  // Capped haze, like the ranks behind them. At seventy units the uncapped
  // exponential already takes 40% of the air colour, which lifted a near-black
  // rock to a mid grey — so the *nearest* thing in the midground came out
  // paler than the ranges twenty times further away, and the depth order of
  // the whole picture read backwards.
  const needleMat = makeInkMaterial(env, { color: '#18232a', rim: 0.20, bands: 2, flat: true, fogCap: 0.22 });

  // One instanced draw for the whole stand, stem and canopy together.
  //
  // It was two — a cylinder for the trunk and five `ConeGeometry` skirts — and
  // the cones were the problem rather than the draw call. A stack of cones is a
  // fir; a fir is the silhouette of a Christmas card; and these two trees are
  // the *only* man-height objects in the midground, which makes them the scale
  // cue for the entire landform. The eye sizes the mountain behind whatever it
  // decides these are. Layered horizontal plates with sky between them is what
  // a Chinese pine is, and it is why the stand now reads as Mount Hua rather
  // than as Bavaria. See trees.js.
  //
  // Only x, z and a scale here — the ground below decides the height.
  const PINES = [
    [-96, 0, -112, 0.95],
    [-70, 0, -104, 0.78],
  ];
  const pineTrunks = new THREE.InstancedMesh(
    pineGeometry({ seed: 17, tiers: 4 }), needleMat, PINES.length,
  );

  // The midground. Two pines on the near slope of the far shore, which is the
  // one place in the frame where something man-height can be seen against the
  // sky: they are the scale cue for the whole landform, the way the pavilion is
  // the scale cue for the host peak.
  //
  // They used to stand on two crag meshes floating in the haze, because there
  // was no ground for them to stand on. There is now, so each pine is seated by
  // *asking the ground how high it is* rather than by a hand-tuned y — and it
  // cannot come adrift the next time the section is retuned. Two draw calls
  // saved, and the spur that was a separate rock is part of the landform it was
  // pretending to be.
  const midground = new THREE.Group();
  midground.add(pineTrunks);
  const pine = pineTrunks;
  group.add(midground);

  /* the ground -------------------------------------------------------- */
  //
  // A subdivided plane displaced by low-frequency noise — the valley floor, the
  // hollow the tarn sits in, and the far shore whose crest is the skyline of
  // the land.
  //
  // What it replaces was a flat plane, and flat was not the fault on its own:
  // the fault is what a flat horizontal surface does at this camera. The eye is
  // at most 11° above it, so its far half is compressed into a couple of
  // percent of frame height and *every* gradient on it — including the fade
  // that was supposed to end it softly — collapses into one ruled horizontal
  // line across the picture. That was the razor-straight ground/sky seam, and
  // it could not be softened, because it was the projection flattening the
  // softness and not the shader failing to provide it.
  //
  // Relief is the only cue a grazing angle does not compress. The crest at
  // z = -110 stands between v 0.403 and 0.441 across the frame, and the cloud
  // sea's own far edge lands at 0.472 — so the ruled line is not softened, it
  // is *behind a ridgeline*. terrain-plan.js holds the section, and the suite
  // checks that margin at every column, in front as well as above: land behind
  // the sea's fade would be seen through the gap rather than covering it.
  const field = terrainField();
  const groundGeo = new THREE.PlaneGeometry(
    TERRAIN.width, TERRAIN.depth, TERRAIN.segX, TERRAIN.segZ,
  );
  // Lying down, and facing up: a plane rotated -90° about x keeps its winding,
  // so the ground's front faces are the ones the sky can see. (Rotated +90° it
  // is inside-out, back-face culled to nothing, and the valley is a hole.)
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + TERRAIN.centre[0];
      const z = pos.getZ(i) + TERRAIN.centre[1];
      pos.setXYZ(i, x, terrainHeight(x, z, field), z);
    }
    pos.needsUpdate = true;
  }
  groundGeo.computeVertexNormals();
  const terrainMat = makeGraniteMaterial(env, { color: '#242b35', fogCap: 0.18, sunEdge: 0.08, gain: 0.95 });
  const terrain = new THREE.Mesh(groundGeo, terrainMat);
  terrain.frustumCulled = false;
  group.add(terrain);

  // Seat the pines on it. The two entries in PINES carry x, z and a scale; the
  // height is the ground's to answer.
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const prand = mulberry32(6421);
    // The mesh occupies y 0..1.05 at unit scale, so the height it is asked for
    // is the height it comes out.
    PINES.forEach(([px, , pz, ps], p) => {
      const py = terrainHeight(px, pz, field);
      const h = 5.4 * ps;
      v.set(px, py, pz);
      q.setFromEuler(new THREE.Euler(0, prand() * Math.PI * 2, 0.05, 'YXZ'));
      sc.set(h * 0.72, h, h * 0.72);
      pineTrunks.setMatrixAt(p, m.compose(v, q, sc));
    });
    pineTrunks.instanceMatrix.needsUpdate = true;
  }

  /* water ------------------------------------------------------------- */
  // A tarn, in a hollow the ground actually has.
  //
  // The plane is still a plane — water is flat — but it is no longer the thing
  // that decides where the valley ends. It sits four units off the bed of a
  // closed hollow, so every edge of it is under a rim and there is no rectangle
  // to find. What is left is the one genuine case of two near-coplanar surfaces
  // in the scene, and near-coplanar surfaces a couple of hundred units out are
  // z-fighting waiting to happen: a small negative polygon offset pulls the
  // water toward the eye by far less than the hollow is deep and far more than
  // the depth buffer can resolve out there. That is the whole of the fix and it
  // costs nothing.
  let water = null;
  let waterMat = null;
  if (tier.water) {
    waterMat = makeWaterMaterial(env);
    waterMat.polygonOffset = true;
    waterMat.polygonOffsetFactor = -2;
    waterMat.polygonOffsetUnits = -4;
    // Inside the hollow's own radii, so the sheet stops before the rim does.
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(TARN.rx * 1.72, TARN.rz * 1.72, 1, 1), waterMat,
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(TARN.x, TARN.surface, TARN.z);
    water.renderOrder = -5;
    group.add(water);
  }

  /* mist -------------------------------------------------------------- */
  const mist = new THREE.Group();
  const mistMats = [];
  // The mist lies in the valley: below the ridge crests, above the shelf. Placed
  // by frame position for the same reason the ridges are — parked at a fixed
  // world height it drifted up over the skyline, and three translucent bands
  // across the range washed the peaks out to nothing.
  const MIST = [
    { z: -50,  top: 0.470, bottom: 0.760, opacity: 0.62 },
    { z: -165, top: 0.418, bottom: 0.618, opacity: 0.51 },
    { z: -280, top: 0.384, bottom: 0.552, opacity: 0.40 },
  ];
  for (let i = 0; i < Math.min(tier.mistBands, MIST.length); i++) {
    const M = MIST[i];
    const t = i / Math.max(1, MIST.length - 1);
    const mat = makeMistMaterial(env, { opacity: M.opacity, speed: 0.02 + t * 0.03 });
    mistMats.push(mat);
    const top = placeAtDepth(0.5, M.top, M.z);
    const bottom = placeAtDepth(0.5, M.bottom, M.z);
    const left = placeAtDepth(0, M.top, M.z);
    const right = placeAtDepth(1, M.top, M.z);
    const frameWidth = Math.abs(right[0] - left[0]);
    // Four times the frame it is seen through, not twice.
    //
    // These bands drift, and the drift used to wrap at ±(90 + 22i) world units
    // against a band 2.2 frames wide — which at z = -50 is a band 56 units
    // across sliding 180 units. Its own edge therefore crossed the picture,
    // and what the player saw was a soft-cornered white rectangle travelling
    // through the frame: the floating polygon sliver the sunset build was
    // failing on. It is not a z-fighting artefact and no depth offset could
    // have touched it — it is a plane, drawn where it was told, big enough to
    // see the end of.
    //
    // The limit below is derived from the band rather than authored: half its
    // own width, less the 14% each side that makeMistMaterial fades out, less
    // the frame it has to keep covered with the camera swung to either end of
    // its arc. Whatever the depth, the edge stays outside the picture.
    const width = frameWidth * 4;
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(width, top[1] - bottom[1], 28, 2), mat,
    );
    band.userData.homeX = top[0] + (i % 2 ? -1 : 1) * (5 + t * 22);
    band.userData.drift = Math.max(0, width * 0.5 - width * 0.14 - frameWidth * 0.68);
    band.userData.dir = i % 2 ? -1 : 1;
    // Offset alternately so three bands never line up into one slab.
    band.position.set(band.userData.homeX, (top[1] + bottom[1]) / 2, M.z);
    // The nearest ridge is at z = -58, so every mist band but the first hangs
    // behind it: interleave rather than veiling the whole stack.
    band.renderOrder = i === 0 ? -4 : RIDGE_ORDER[Math.min(4, i * 2)] + 1;
    mist.add(band);
  }
  group.add(mist);

  /* the sea of cloud ---------------------------------------------------- */
  //
  // Four horizontal layers filling the valley between the foreground island and
  // the ranks, drawn after the ridges so their feet drown in it. The mist bands
  // above are what the *air* does; this is what the air is standing on. See
  // cloud-sea.js for where the surface sits and why it is not where the brief
  // put it.
  const cloudSea = createCloudSea(env, tier);
  group.add(cloudSea.group);

  /* ------------------------------------------ the day, and the realm in it */
  //
  // Two inputs, one authority each:
  //
  //   `tod`  the hour — sky, air, exposure, and where the sun stands above the
  //          horizon. Already lerped by time-of-day.js; this only eases toward
  //          it so a realm change does not cut.
  //   `p`    the realm — its ink, its ridges, its bounce, its cloud, and the
  //          compass point its sun keys from.
  //
  // Everything downstream reads `cur`, which is the two of them resolved.

  const cur = {
    zenith: new THREE.Color(), horizon: new THREE.Color(), below: new THREE.Color(),
    ambient: new THREE.Color(), ground: new THREE.Color(), inkRim: new THREE.Color(),
    waterTop: new THREE.Color(), waterTint: new THREE.Color(),
    // The near band. Two rungs, both cut from the realm's ink: the island
    // itself, and the loose rock standing on it — which is a shade lighter so
    // that five rocks and a censer do not disappear into the platform they are
    // sitting on. Neither is the realm's `ground`, which is a mid tone meant
    // for the far shore.
    fore: new THREE.Color(), foreStone: new THREE.Color(),
    // The realm's two cloud values, eased here like everything else. The sea
    // reads them from `cur`, never from the palette directly, so a realm change
    // fades the cloud instead of cutting it.
    cloud: new THREE.Color(), cloudCrest: new THREE.Color(),
    ridges: LAYERS.map(() => new THREE.Color()),
    density: 0.018,
    dir: new THREE.Vector3(0.4, 0.1, 0.55).normalize(),
    // The sun as the light rig wants it: where, how hard, what colour, and what
    // colour it rims the cultivator with — which at night is not its own.
    sunColor: new THREE.Color(), sunPower: 0.6, rimColor: new THREE.Color(),
    // The two dials that live outside the scene graph, held here so the view
    // has one place to read them from. Both are lerped like everything else.
    exposure: 1, bloom: 0.4,
    flags: { stars: 0, aurora: 0, cloudSea: 0 },
  };

  const scratch = new THREE.Color();
  const scratchDir = new THREE.Vector3();

  /**
   * Paint the world at a realm and an hour. `immediate` snaps (boot, capture,
   * the QA scrubber); otherwise `mixAmount` is one frame's worth of easing.
   */
  function applyPalette(p, tod, immediate = false, mixAmount = 1) {
    const k = immediate ? 1 : mixAmount;
    const to = (c, hex) => c.lerp(scratch.set(hex), k);

    to(cur.zenith, tod.zenith);
    to(cur.horizon, tod.horizon);
    to(cur.below, tod.below);
    to(cur.sunColor, tod.sun);
    to(cur.rimColor, tod.rim);
    to(cur.ambient, p.ambient);
    to(cur.ground, p.ground);
    to(cur.inkRim, p.aura);
    to(cur.waterTint, p.water);
    to(cur.cloud, p.cloud);
    to(cur.cloudCrest, p.cloudCrest);
    to(cur.fore, foregroundInk(p.ink));
    to(cur.foreStone, foregroundInk(p.ink, 0.32));
    // Water holds the sky: bright toward the far bank where it carries the
    // skyline, darker in the near water where it carries the upper sky. Both
    // are the sky's own colours, or the river reads as a differently-coloured
    // hole in the valley floor.
    cur.waterTop.copy(cur.horizon).lerp(cur.zenith, 0.5);
    p.ridges.forEach((c, i) => to(cur.ridges[i], c));

    cur.density += (tod.fogDensity - cur.density) * k;
    cur.sunPower += (tod.sunPower - cur.sunPower) * k;
    cur.exposure += (tod.exposure - cur.exposure) * k;
    cur.bloom += (tod.bloom - cur.bloom) * k;
    // Bearing from the realm, elevation from the day — and lerped as a vector,
    // which takes the short way round. Easing the bearing as a number instead
    // would swing the sun through the lens on the two realm changes that key
    // from behind, and a key light passing across the camera is a flat frame.
    cur.dir.lerp(scratchDir.fromArray(sunDirection(p.bearing, tod.sunElevation)), k).normalize();

    const stars = tier.stars ? tod.stars : 0;
    cur.flags.stars += (stars - cur.flags.stars) * k;
    cur.flags.aurora += (p.flags.aurora - cur.flags.aurora) * k;
    cur.flags.cloudSea += (p.flags.cloudSea - cur.flags.cloudSea) * k;

    skyMat.uniforms.uZenith.value.copy(cur.zenith);
    skyMat.uniforms.uHorizon.value.copy(cur.horizon);
    skyMat.uniforms.uBelow.value.copy(cur.below);
    skyMat.uniforms.uSunColor.value.copy(cur.sunColor);
    skyMat.uniforms.uSunDir.value.copy(cur.dir);
    skyMat.uniforms.uStars.value = cur.flags.stars;
    skyMat.uniforms.uAurora.value = cur.flags.aurora;
    skyMat.uniforms.uCloudSea.value = cur.flags.cloudSea;

    // The fog object is the air, and the shaders read it rather than keeping a
    // second copy. `scene.fog` is this same instance.
    fog.color.copy(cur.horizon);
    fog.density = cur.density;
    env.uFogColor.value.copy(fog.color);
    env.uFogHigh.value.copy(cur.zenith);
    env.uFogDensity.value = fog.density;
    env.uRimColor.value.copy(cur.inkRim);

    // The sun, the sky bounce and the rim are the light rig's to write — it
    // owns both the THREE.Lights that render the shadow map and the uniforms
    // the ink shaders read, so there is no way for the two to disagree about
    // where the light is coming from.
    lighting.apply(cur);

    // After the rig, never before: the sea takes its sun colour and its sun
    // direction off the same `env` uniforms lighting.apply() has just written,
    // so there is no frame in which the cloud is lit from one place and the
    // rock from another.
    cloudSea.apply(cur.cloud, cur.cloudCrest);

    // The foreground band. Not `cur.ground` — that is the far shore's colour,
    // and painting the nearest rock in the frame with it is what put the
    // foreground *lighter* than the midground for four stages.
    groundMat.uniforms.uColor.value.copy(cur.fore);
    stoneMat.uniforms.uColor.value.copy(cur.foreStone);
    // The smoke is the one pale thing in the near band, so it takes the
    // brightest rung there is — the cloud's own crest.
    smokeMat.uniforms.uColor.value.copy(cur.cloudCrest);
    // The ground takes the realm's *nearest* ridge colour, and `ridges` is the
    // right ramp for it rather than a coincidence: those colours are authored
    // for valley walls seen through mist, which is exactly what this landform
    // is. (The *peaks* may never borrow them — they run pale at the far end and
    // against the sky they invert the ladder. See palette.js.)
    //
    // The nearest rung, not the second: the shore is the closest land in the
    // frame after the island itself, so it has to be the darkest thing out
    // there. Painted a rung lighter it came out brighter than the range behind
    // it, and a pale near ridge in front of dark far peaks reads as depth
    // running backwards — the same inversion the peaks ramp exists to prevent,
    // arrived at through the ground instead.
    terrainMat.color.copy(cur.ridges[0]);
    for (const { mat, layer } of ridgeMats) mat.uniforms.uColor.value.copy(cur.ridges[layer]);
    if (waterMat) {
      waterMat.uniforms.uTop.value.copy(cur.waterTop);
      waterMat.uniforms.uHorizon.value.copy(cur.horizon);
      waterMat.uniforms.uTint.value.copy(cur.waterTint);
    }
    for (const m of mistMats) m.uniforms.uColor.value.copy(cur.horizon);
  }

  function setStorm(amount) {
    skyMat.uniforms.uStorm.value = amount;
  }

  function update(dt, t, reduced = false) {
    // Reduced motion damps the smoke rather than freezing it: a thread of
    // incense that has stopped moving reads as a scratch on the glass.
    smokeMat.uniforms.uWind.value = reduced ? 0.3 : 1;

    // Mist bands drift laterally and turn back at the limit their own width
    // allows — see the band builder above for why that limit is not a constant.
    // Turning rather than wrapping, too: a wrap teleports the whole band, and
    // the fbm is in the band's own uv, so the pattern jumps with it.
    mist.children.forEach((b, i) => {
      const { homeX, drift } = b.userData;
      if (drift <= 0) return;
      b.position.x += dt * (0.35 + i * 0.12) * b.userData.dir;
      if (b.position.x > homeX + drift) { b.position.x = homeX + drift; b.userData.dir = -1; }
      if (b.position.x < homeX - drift) { b.position.x = homeX - drift; b.userData.dir = 1; }
    });
    cloudSea.update(dt, reduced);
  }

  return {
    group, sky, skyMat, fog, water, terrain, ridges, pine, mist, cloudSea,
    applyPalette, setStorm, update,
    /** The resolved day: what the exposure and bloom dials should be showing. */
    atmosphere: cur,
    materials: { groundMat, stoneMat, needleMat, terrainMat, smokeMat },
  };
}
