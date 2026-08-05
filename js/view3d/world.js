// The landscape: sky dome, layered ridges, the meditation shelf, water, mist.
//
// All geometry is generated here at boot from seeded noise. Nothing is loaded
// from disk, which is what keeps the whole download under a megabyte.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { placeAtDepth } from './framing.js';
import { cragGeometry, stoneGeometry } from './rock.js';
import { AURORA_COLOR } from './palette.js';
import { sunDirection } from './time-of-day.js';
import {
  makeSkyMaterial, makeRidgeMaterial, makeInkMaterial, makeWaterMaterial,
  makeMistMaterial,
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
  // rim 0.25 → 0.08. Two reasons, and both are about a plane rather than about
  // this colour. A fresnel edge on the one surface in the frame that is never
  // seen edge-on is not an edge, it is a veil over the whole foreground — and
  // `uRimColor` is the palette's accent, which is the one colour the rules say
  // may not sit on a background element. It is still not zero: a trace of sky
  // along the far lip is what keeps the shelf from ending on a cut.
  const groundMat = makeInkMaterial(env, { color: '#2b3038', rim: 0.08, bands: 3 });
  const shelf = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 12.5, 3.2, 7, 1), groundMat);
  shelf.position.y = -1.6;
  shelf.receiveShadow = true;
  group.add(shelf);

  const apron = new THREE.Mesh(new THREE.CylinderGeometry(13, 26, 14, 7, 1, true), groundMat);
  apron.position.y = -9.6;
  apron.receiveShadow = true;
  group.add(apron);

  // A meditation stone, slightly proud of the shelf.
  const stoneMat = makeInkMaterial(env, { color: '#39404a', rim: 0.4, bands: 3, flat: true });
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.5, 9, 1), stoneMat);
  stone.position.y = 0.15;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

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
  const trunkMat = makeInkMaterial(env, { color: '#141922', rim: 0.16, bands: 2, fogCap: 0.22 });
  const needleMat = makeInkMaterial(env, { color: '#18232a', rim: 0.20, bands: 2, flat: true, fogCap: 0.22 });
  const spurMat = makeInkMaterial(env, { color: '#151b24', rim: 0.14, bands: 2, flat: true, fogCap: 0.18 });

  // Pines as two instanced draws rather than six meshes per tree: at two trees
  // that was twelve draw calls for scenery the player barely registers.
  const PINES = [
    [-38, -4.6, -64, 1.2],
    [-49, -5.6, -78, 1.0],
  ];
  const TIERS_PER_PINE = 5;
  const pineTrunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.08, 0.22, 4.6, 5), trunkMat, PINES.length,
  );
  const pineNeedles = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 0.85, 6, 1), needleMat, PINES.length * TIERS_PER_PINE,
  );
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const prand = mulberry32(6421);
    PINES.forEach(([px, py, pz, ps], p) => {
      const yaw = prand() * Math.PI * 2;
      v.set(px, py + 2.3 * ps, pz);
      q.setFromEuler(new THREE.Euler(0, yaw, 0.16, 'YXZ'));
      sc.set(ps, ps, ps);
      pineTrunks.setMatrixAt(p, m.compose(v, q, sc));
      for (let i = 0; i < TIERS_PER_PINE; i++) {
        const rad = (1.35 - i * 0.24) * ps;
        v.set(px + (-0.10 - i * 0.09) * ps, py + (1.9 + i * 0.62) * ps, pz);
        q.setFromEuler(new THREE.Euler(0, yaw, -0.06, 'YXZ'));
        sc.set(rad, ps, rad * 0.6);
        pineNeedles.setMatrixAt(p * TIERS_PER_PINE + i, m.compose(v, q, sc));
      }
    });
    pineTrunks.instanceMatrix.needsUpdate = true;
    pineNeedles.instanceMatrix.needsUpdate = true;
  }

  // The midground. The authored camera is yawed, so the band of the frame
  // between the shelf and the first range looks out at roughly world x -26,
  // z -40 — which was empty sky in every realm. A stand of pines and a rock
  // spur out there gives the eye something to cross on the way up, and gives
  // the mist something to wrap around.
  // Far enough back to stay small, and set low so the canopies only just break
  // the mist line — a few strokes, not a forest. The plum and the karst range
  // carry the middle distance now; a third pine only crowded them.
  const midground = new THREE.Group();
  const mrand = mulberry32(6421);
  midground.add(pineTrunks, pineNeedles);
  const pine = pineTrunks;
  // A shoulder of rock for them to stand on, mostly drowned in the haze.
  // Crags, not cones: a six-sided cone at this size is unmistakably a pyramid.
  for (const [x, y, z, r, h] of [[-39, -11.5, -66, 9, 12], [-52, -14, -80, 11, 13]]) {
    const spur = new THREE.Mesh(
      cragGeometry({ seed: 200 + r, sides: 9, rings: 5, taper: 0.36, jag: 0.36, drift: 0.26 }),
      spurMat,
    );
    spur.position.set(x, y, z);
    spur.scale.set(r, h, r * 0.9);
    spur.rotation.y = mrand() * Math.PI;
    midground.add(spur);
  }
  group.add(midground);

  /* water ------------------------------------------------------------- */
  // A river in the valley floor, not a sea.
  //
  // This was a 900 x 320 plane at z = -175, and a horizontal plane that big,
  // seen from above, has its far edge converge on the horizon: it reached
  // v = 0.34 in the frame and painted over the entire cloud sea and both far
  // ranks — an untextured slab across the middle of every composition. (Its
  // ripple noise is scaled in world units, so at that distance it averages out
  // to nothing, which is why it read as flat paint rather than as water.) Cut
  // to the valley floor, it lands at v 0.51..0.79, under the mist, where a
  // river belongs — and it is still the water the sect framing looks down on.
  let water = null;
  let waterMat = null;
  if (tier.water) {
    waterMat = makeWaterMaterial(env);
    water = new THREE.Mesh(new THREE.PlaneGeometry(320, 130, 1, 1), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(-60, -31, -105);
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
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.abs(right[0] - left[0]) * 2.2, top[1] - bottom[1], 28, 2), mat,
    );
    // Offset alternately so three bands never line up into one slab.
    band.position.set(top[0] + (i % 2 ? -1 : 1) * (5 + t * 22), (top[1] + bottom[1]) / 2, M.z);
    // The nearest ridge is at z = -58, so every mist band but the first hangs
    // behind it: interleave rather than veiling the whole stack.
    band.renderOrder = i === 0 ? -4 : RIDGE_ORDER[Math.min(4, i * 2)] + 1;
    mist.add(band);
  }
  group.add(mist);

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

    groundMat.uniforms.uColor.value.copy(cur.ground);
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

  function update(dt, t) {
    // Mist bands drift laterally and wrap, so nothing ever visibly loops.
    mist.children.forEach((b, i) => {
      b.position.x += dt * (0.35 + i * 0.12) * (i % 2 ? -1 : 1);
      const limit = 90 + i * 22;
      if (b.position.x > limit) b.position.x = -limit;
      if (b.position.x < -limit) b.position.x = limit;
    });
  }

  return {
    group, sky, skyMat, fog, water, ridges, pine, mist,
    applyPalette, setStorm, update,
    /** The resolved day: what the exposure and bloom dials should be showing. */
    atmosphere: cur,
    materials: { groundMat, stoneMat, trunkMat, needleMat },
  };
}
