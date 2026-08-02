// The landscape: sky dome, layered ridges, the meditation shelf, water, mist.
//
// All geometry is generated here at boot from seeded noise. Nothing is loaded
// from disk, which is what keeps the whole download under a megabyte.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
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
 * A ridge silhouette as a triangle strip. uv.y runs 0 at the base (where it
 * dissolves into fog) to 1 at the skyline.
 */
function ridgeGeometry({ width, height, depth, segments, seed, roughness = 1 }) {
  const n = noise1(seed);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (t - 0.5) * width;
    // Taper the ends so a layer never stops mid-air at the screen edge.
    const taper = Math.pow(Math.sin(Math.PI * t), 0.35);
    const h = height * (0.35 + ridgedFbm(n, t * 3.1 * roughness + seed * 0.01) * 1.15) * taper;
    const k = i * 2;
    positions[k * 3 + 0] = x; positions[k * 3 + 1] = -depth; positions[k * 3 + 2] = 0;
    positions[(k + 1) * 3 + 0] = x; positions[(k + 1) * 3 + 1] = h; positions[(k + 1) * 3 + 2] = 0;
    uvs[k * 2 + 0] = t; uvs[k * 2 + 1] = 0;
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

export function createWorld(env, tier) {
  const group = new THREE.Group();

  /* sky ------------------------------------------------------------- */
  const skyMat = makeSkyMaterial(env);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 20), skyMat);
  sky.frustumCulled = false;
  group.add(sky);

  /* ridges ----------------------------------------------------------- */
  // Five layers marching away from the shelf, each flatter, paler and slower
  // than the last. This is the entire sense of depth in the composition.
  // Heights are tuned against the authored camera: the near crest must sit
  // inside a portrait frame, not above it.
  const LAYERS = [
    { z: -58,  width: 260, height: 10, depth: 20, segments: 128, roughness: 1.5 },
    { z: -96,  width: 340, height: 14, depth: 26, segments: 112, roughness: 1.2 },
    { z: -152, width: 460, height: 19, depth: 34, segments: 96,  roughness: 1.0 },
    { z: -232, width: 640, height: 25, depth: 44, segments: 80,  roughness: 0.8 },
    { z: -336, width: 860, height: 33, depth: 58, segments: 64,  roughness: 0.6 },
  ];
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
    const mat = makeRidgeMaterial(env, { fade: 0.88 - slot * 0.10, grain: 0.4 - slot * 0.05 });
    const mesh = new THREE.Mesh(ridgeGeometry({ ...L, seed: 1000 + idx * 37 }), mat);
    mesh.position.set(0, -2, L.z);
    // These write no depth, so they are a painter's stack: the furthest layer
    // must go down first or a distant range paints over the ridge in front.
    mesh.renderOrder = -10 + (chosen.length - 1 - slot);
    mesh.userData.layer = idx;
    ridgeMats.push({ mat, layer: idx });
    ridges.add(mesh);
  });
  group.add(ridges);

  /* the shelf the cultivator sits on ---------------------------------- */
  const groundMat = makeInkMaterial(env, { color: '#2b3038', rim: 0.25, bands: 3 });
  const shelf = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 12.5, 3.2, 7, 1), groundMat);
  shelf.position.y = -1.6;
  group.add(shelf);

  const apron = new THREE.Mesh(new THREE.CylinderGeometry(13, 26, 14, 7, 1, true), groundMat);
  apron.position.y = -9.6;
  group.add(apron);

  // A meditation stone, slightly proud of the shelf.
  const stoneMat = makeInkMaterial(env, { color: '#39404a', rim: 0.4, bands: 3, flat: true });
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.5, 9, 1), stoneMat);
  stone.position.y = 0.15;
  group.add(stone);

  // A few standing rocks, for the negative space to push against.
  const rocks = new THREE.Group();
  const rrand = mulberry32(97);
  for (let i = 0; i < 5; i++) {
    const a = rrand() * Math.PI * 2;
    const r = 5.2 + rrand() * 3.4;
    const h = 0.7 + rrand() * 2.1;
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(0.35 + rrand() * 0.6, h, 5, 1),
      stoneMat,
    );
    rock.position.set(Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r);
    rock.rotation.set((rrand() - 0.5) * 0.25, rrand() * 3, (rrand() - 0.5) * 0.25);
    rocks.add(rock);
  }
  group.add(rocks);

  // A wind-bent pine, the one vertical the eye can rest on.
  const pine = new THREE.Group();
  const trunkMat = makeInkMaterial(env, { color: '#1e2229', rim: 0.5, bands: 3 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 4.6, 5), trunkMat);
  trunk.position.y = 2.3;
  trunk.rotation.z = 0.16;
  pine.add(trunk);
  const needleMat = makeInkMaterial(env, { color: '#22322c', rim: 0.6, bands: 3, flat: true });
  for (let i = 0; i < 4; i++) {
    const tier2 = new THREE.Mesh(new THREE.ConeGeometry(1.5 - i * 0.28, 0.5, 6, 1), needleMat);
    tier2.position.set(-0.45 - i * 0.12, 3.0 + i * 0.62, 0);
    tier2.rotation.z = -0.1;
    tier2.scale.z = 0.55;
    pine.add(tier2);
  }
  pine.position.set(-7.4, 0, 1.6);
  group.add(pine);

  /* water ------------------------------------------------------------- */
  let water = null;
  let waterMat = null;
  if (tier.water) {
    waterMat = makeWaterMaterial(env);
    water = new THREE.Mesh(new THREE.PlaneGeometry(900, 320, 1, 1), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -26, -175);
    water.renderOrder = -5;
    group.add(water);
  }

  /* mist -------------------------------------------------------------- */
  const mist = new THREE.Group();
  const mistMats = [];
  for (let i = 0; i < tier.mistBands; i++) {
    const t = i / Math.max(1, tier.mistBands - 1);
    const mat = makeMistMaterial(env, {
      opacity: 0.34 - t * 0.13,
      speed: 0.02 + t * 0.03,
    });
    mistMats.push(mat);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(340 + t * 380, 26 + t * 20, 24, 2), mat);
    band.position.set((i % 2 ? -1 : 1) * (8 + t * 30), -8 - t * 5 + i * 1.4, -40 - t * 220);
    band.renderOrder = -8 + i;
    mist.add(band);
  }
  group.add(mist);

  /* ------------------------------------------------------ realm palette */

  const cur = {
    top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(),
    fog: new THREE.Color(), ambient: new THREE.Color(), light: new THREE.Color(),
    ground: new THREE.Color(), rim: new THREE.Color(),
    waterTop: new THREE.Color(), waterHorizon: new THREE.Color(), waterTint: new THREE.Color(),
    ridges: LAYERS.map(() => new THREE.Color()),
    density: 0.01,
    dir: new THREE.Vector3(),
    flags: { stars: 0, aurora: 0, moon: 0, cloudSea: 0 },
  };

  /** Snap every colour to a palette with no transition (used at boot). */
  function applyPalette(p, immediate = false, mixAmount = 1) {
    const k = immediate ? 1 : mixAmount;
    cur.top.lerp(new THREE.Color(p.sky.top), k);
    cur.mid.lerp(new THREE.Color(p.sky.mid), k);
    cur.horizon.lerp(new THREE.Color(p.sky.horizon), k);
    cur.fog.lerp(new THREE.Color(p.fog.color), k);
    cur.ambient.lerp(new THREE.Color(p.ambient), k);
    cur.light.lerp(new THREE.Color(p.light.color), k);
    cur.ground.lerp(new THREE.Color(p.ground), k);
    cur.rim.lerp(new THREE.Color(p.aura), k);
    cur.waterTop.lerp(new THREE.Color(p.water.top), k);
    cur.waterHorizon.lerp(new THREE.Color(p.water.horizon), k);
    cur.waterTint.lerp(new THREE.Color(p.water.tint), k);
    p.ridges.forEach((c, i) => cur.ridges[i].lerp(new THREE.Color(c), k));
    cur.density += (p.fog.density - cur.density) * k;
    cur.dir.lerp(new THREE.Vector3(...p.light.dir).normalize(), k);
    for (const f of ['stars', 'aurora', 'moon', 'cloudSea']) {
      const target = tier.stars || f !== 'stars' ? p.flags[f] : 0;
      cur.flags[f] += (target - cur.flags[f]) * k;
    }

    skyMat.uniforms.uTop.value.copy(cur.top);
    skyMat.uniforms.uMid.value.copy(cur.mid);
    skyMat.uniforms.uHorizon.value.copy(cur.horizon);
    skyMat.uniforms.uStars.value = cur.flags.stars;
    skyMat.uniforms.uAurora.value = cur.flags.aurora;
    skyMat.uniforms.uMoon.value = cur.flags.moon;
    skyMat.uniforms.uCloudSea.value = cur.flags.cloudSea;
    skyMat.uniforms.uAccent.value.set(p.accent);

    env.uFogColor.value.copy(cur.fog);
    env.uFogDensity.value = cur.density;
    env.uAmbient.value.copy(cur.ambient);
    env.uLightColor.value.copy(cur.light);
    env.uLightDir.value.copy(cur.dir);
    env.uRimColor.value.copy(cur.rim);

    groundMat.uniforms.uColor.value.copy(cur.ground);
    for (const { mat, layer } of ridgeMats) mat.uniforms.uColor.value.copy(cur.ridges[layer]);
    if (waterMat) {
      waterMat.uniforms.uTop.value.copy(cur.waterTop);
      waterMat.uniforms.uHorizon.value.copy(cur.waterHorizon);
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
    group, sky, skyMat, water, ridges, pine, mist,
    applyPalette, setStorm, update,
    materials: { groundMat, stoneMat, trunkMat, needleMat },
  };
}
