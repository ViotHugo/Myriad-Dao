// The cultivator — and everything the player's numbers do to their body.
//
// The figure is built from primitives at boot and never rebuilt; realm, age,
// artifacts and buffs move colours, scales and visibility instead. That keeps a
// state change free, which matters when the HUD updates four times a second.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { makeInkMaterial, makeGlowMaterial, makeParticleMaterial, makeRuneRingMaterial } from './shaders.js';
import { ageBracket } from './palette.js';

/** A Points cloud with per-particle scale and seed, ready to animate. */
function makeSwarm(count, material) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const scale = new Float32Array(count);
  const seed = new Float32Array(count);
  const rand = mulberry32(count * 7919 + 13);
  for (let i = 0; i < count; i++) {
    scale[i] = 0.4 + rand() * 0.9;
    seed[i] = rand();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setDrawRange(0, count);
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, geo, pos, seed, scale, count };
}

/** A cheap tapered blade. Four radial segments is plenty at this size. */
function bladeGeometry(length = 1.15) {
  const g = new THREE.CylinderGeometry(0.015, 0.075, length, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, 0.34);
  return g;
}

export function createAvatar(env, tier) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  /* ------------------------------------------------------------ the body */

  const robeMat = makeInkMaterial(env, { color: '#6b6257', rim: 0.7, bands: 4 });
  const trimMat = makeInkMaterial(env, { color: '#8f8577', rim: 0.9, bands: 5, emissive: 0 });
  const skinMat = makeInkMaterial(env, { color: '#b9a893', rim: 0.85, bands: 4 });
  const hairMat = makeInkMaterial(env, { color: '#171a1f', rim: 0.6, bands: 3 });

  // Folded legs: one squashed mass reads better than two bad legs.
  const lap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), robeMat);
  lap.scale.set(1.18, 0.5, 1.0);
  lap.position.y = 0.3;
  body.add(lap);

  // Robe: a lathe from hem to collar. The silhouette is the character.
  const profile = [
    new THREE.Vector2(0.001, 0.24), new THREE.Vector2(0.68, 0.26), new THREE.Vector2(0.60, 0.46),
    new THREE.Vector2(0.46, 0.70), new THREE.Vector2(0.36, 0.92), new THREE.Vector2(0.30, 1.06),
    new THREE.Vector2(0.19, 1.14), new THREE.Vector2(0.001, 1.16),
  ];
  const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), robeMat);
  body.add(robe);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.035, 6, 18), trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.11;
  body.add(collar);

  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.045, 6, 22), trimMat);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 0.66;
  body.add(sash);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.10, 0.14, 8), skinMat);
  neck.position.y = 1.20;
  body.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 14), skinMat);
  head.scale.set(0.92, 1.06, 0.94);
  head.position.y = 1.38;
  body.add(head);

  // A cap that sits above the brow. A longer theta swallows the whole face and
  // the cultivator reads as a black ball.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.213, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.40), hairMat);
  hair.position.y = 1.395;
  body.add(hair);

  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), hairMat);
  knot.position.y = 1.60;
  knot.scale.set(1, 1.25, 1);
  body.add(knot);

  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 5), trimMat);
  pin.position.y = 1.60;
  pin.rotation.z = Math.PI / 2.5;
  body.add(pin);

  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.42, 7, 1), hairMat);
  beard.position.set(0, 1.10, 0.135);
  beard.rotation.x = Math.PI;
  beard.scale.set(1, 0.001, 0.7); // grown in by age
  body.add(beard);

  // Arms folded into a meditation mudra.
  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.34, 4, 8), robeMat);
    upper.position.set(side * 0.29, 0.86, 0.02);
    upper.rotation.z = side * 0.55;
    upper.rotation.x = -0.25;
    body.add(upper);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.30, 4, 8), robeMat);
    fore.position.set(side * 0.29, 0.60, 0.18);
    fore.rotation.z = side * 1.15;
    fore.rotation.x = -0.35;
    body.add(fore);
  }
  const hands = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skinMat);
  hands.scale.set(1.5, 0.55, 1.0);
  hands.position.set(0, 0.58, 0.24);
  body.add(hands);

  /* --------------------------------------------------------------- aura */

  // A tight rim, not a bubble: a low fresnel power domes the whole sphere and
  // the cultivator ends up inside a visible glass ball.
  const auraMat = makeGlowMaterial(env, { color: '#35c98e', power: 3.6, strength: 0.0 });
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), auraMat);
  aura.scale.set(1.0, 1.15, 1.0);
  aura.position.y = 0.72;
  group.add(aura);

  const haloMat = makeGlowMaterial(env, { color: '#ffd76a', power: 1.6, strength: 0, core: 0.7 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 8, 40), haloMat);
  halo.position.set(0, 1.42, -0.16);
  halo.visible = false;
  group.add(halo);

  /* -------------------------------------------------- the qi that gathers */

  // (spec B) Qi accumulates as a visible column around the meditator and turns
  // gold at the bottleneck. This is the bar, rendered as weather.
  const moteMat = makeParticleMaterial(env, { color: '#35c98e', size: 9 });
  const motes = makeSwarm(tier.qiMotes, moteMat);
  group.add(motes.points);
  const motePhase = new Float32Array(motes.count);
  const moteRadius = new Float32Array(motes.count);
  const moteSpeed = new Float32Array(motes.count);
  {
    const rand = mulberry32(4242);
    for (let i = 0; i < motes.count; i++) {
      motePhase[i] = rand() * Math.PI * 2;
      moteRadius[i] = 0.7 + rand() * 1.5;
      moteSpeed[i] = 0.25 + rand() * 0.6;
    }
  }

  /* ------------------------------------------------------ the twelve gates */

  const meridianMat = makeGlowMaterial(env, { color: '#8fd8c0', power: 1.4, strength: 1.1, core: 1 });
  const meridianGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const meridians = new THREE.InstancedMesh(meridianGeo, meridianMat, 12);
  meridians.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  meridians.count = 0;
  group.add(meridians);

  const meridianPoints = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const side = i % 2 ? 1 : -1;
    meridianPoints.push(new THREE.Vector3(
      side * (0.10 + Math.sin(t * Math.PI) * 0.16),
      0.34 + t * 1.02,
      0.06 + Math.sin(t * Math.PI * 2) * 0.05,
    ));
  }

  const filamentGeo = new THREE.BufferGeometry().setFromPoints(meridianPoints);
  const filament = new THREE.Line(
    filamentGeo,
    new THREE.LineBasicMaterial({ color: 0x8fd8c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(filament);

  /* -------------------------------------------------- power at high realms */

  // A rotating dashed rune ring from Spirit Severing on.
  const runeMat = makeRuneRingMaterial(env);
  runeMat.uniforms.uActive.value = 0;
  const runeRing = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.85, 64, 1), runeMat);
  runeRing.rotation.x = -Math.PI / 2;
  runeRing.position.y = 0.06;
  runeRing.visible = false;
  group.add(runeRing);

  // Floating swords: the classic sign that a cultivator has stopped needing hands.
  const swordMat = makeInkMaterial(env, { color: '#9fb3c8', rim: 1.1, bands: 3, emissive: 0.15 });
  const floatSwords = new THREE.InstancedMesh(bladeGeometry(1.0), swordMat, tier.floatSwords);
  floatSwords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  floatSwords.count = 0;
  group.add(floatSwords);

  /* ------------------------------------------------------------ artifacts */

  // Bound gear renders on the avatar: a blade that orbits, a robe that changes
  // material, motes that circle the hand.
  const artifactSwordMat = makeInkMaterial(env, { color: '#8e9099', rim: 1.2, bands: 3, emissive: 0.2 });
  const artifactSword = new THREE.Mesh(bladeGeometry(1.3), artifactSwordMat);
  artifactSword.visible = false;
  group.add(artifactSword);

  const artifactSwordTwin = new THREE.Mesh(bladeGeometry(1.15), artifactSwordMat);
  artifactSwordTwin.visible = false;
  group.add(artifactSwordTwin);

  const swordGlowMat = makeGlowMaterial(env, { color: '#8e9099', power: 2.4, strength: 0.4 });
  const swordGlow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), swordGlowMat);
  // Stretched along the blade so it reads as a lit edge, not a floating orb.
  swordGlow.scale.set(0.55, 2.8, 0.55);
  swordGlow.visible = false;
  group.add(swordGlow);

  const ringMoteMat = makeParticleMaterial(env, { color: '#e8b34b', size: 13 });
  const ringMotes = makeSwarm(3, ringMoteMat);
  ringMotes.points.visible = false;
  group.add(ringMotes.points);

  /* -------------------------------------------------------- technique motifs */

  // Thousand Leaves Sword Intent — leaves that fall along one line.
  const leafMat = makeParticleMaterial(env, { color: '#9ccf9a', size: 6, additive: false });
  const leaves = makeSwarm(Math.round(tier.qiMotes * 0.25), leafMat);
  leaves.points.visible = false;
  group.add(leaves.points);

  // Flowing River Qi Art — a current that circles the body.
  const riverMat = makeGlowMaterial(env, { color: '#5fd8ff', power: 3.0, strength: 0.5 });
  const river = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.10, 8, 40), riverMat);
  river.rotation.x = -Math.PI / 2.4;
  river.position.y = 0.72;
  river.visible = false;
  group.add(river);

  // Turtle Breath Sutra — a slow shell-like shimmer.
  const shellMat = makeGlowMaterial(env, { color: '#a8d8c0', power: 4.0, strength: 0.35 });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.42, 16, 12), shellMat);
  shell.position.y = 0.7;
  shell.visible = false;
  group.add(shell);

  /* ------------------------------------------------------------- sync */

  const state = {
    realm: 0, capped: false, progress: 0, meridians: 0, withered: false,
    ageFrac: 0, techniques: {}, artifacts: {},
  };
  const auraColor = new THREE.Color('#35c98e');
  const goldColor = new THREE.Color('#e8b34b');
  const tmpMat = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);

  function setPalette(p) {
    robeMat.uniforms.uColor.value.set(p.robe);
    trimMat.uniforms.uColor.value.set(p.trim);
    auraColor.set(p.aura);
    auraMat.uniforms.uColor.value.copy(auraColor);
    moteMat.uniforms.uColor.value.copy(auraColor);
    meridianMat.uniforms.uColor.value.set(p.accent);
    filament.material.color.set(p.accent);
    runeMat.uniforms.uIdle.value.set(p.accent);
    swordMat.uniforms.uColor.value.set(p.trim);
  }

  /** Read the view model. Cheap enough to call every HUD frame. */
  function sync(vm, rarityColors) {
    state.realm = vm.realm;
    state.capped = vm.capped;
    state.progress = vm.progress;
    state.withered = vm.withered;

    // Age reads off age/lifespan, so a 500-year-old Nascent Soul is still young.
    const bracket = ageBracket(vm.lifespan === Infinity ? 0 : vm.age / vm.lifespan);
    hairMat.uniforms.uColor.value.set(bracket.hair);
    beard.scale.y = Math.max(0.001, bracket.beard);

    // Aura appears at Qi Condensation and strengthens with realm.
    const auraStrength = vm.realm >= 1 ? 0.14 + vm.realm * 0.05 : 0;
    auraMat.uniforms.uStrength.value = auraStrength * (vm.withered ? 0.3 : 1);
    auraMat.uniforms.uColor.value.copy(state.capped ? goldColor : auraColor);
    moteMat.uniforms.uColor.value.copy(state.capped ? goldColor : auraColor);

    halo.visible = vm.realm >= 7;
    haloMat.uniforms.uStrength.value = vm.realm >= 7 ? 1.4 : 0;

    runeRing.visible = vm.realm >= 5;
    floatSwords.count = vm.realm >= 5 ? Math.min(tier.floatSwords, 2 + (vm.realm - 5) * 2) : 0;

    meridians.count = vm.meridians;
    state.meridians = vm.meridians;
    for (let i = 0; i < vm.meridians; i++) {
      tmpMat.compose(meridianPoints[i], tmpQ.identity(), tmpS);
      meridians.setMatrixAt(i, tmpMat);
    }
    meridians.instanceMatrix.needsUpdate = true;
    filament.material.opacity = vm.meridians >= 2 ? Math.min(0.75, vm.meridians / 12) : 0;
    filamentGeo.setDrawRange(0, Math.max(0, vm.meridians));

    // Bound artifacts, rendered on the body.
    const sword = vm.artifacts.sword;
    artifactSword.visible = !!sword;
    artifactSwordTwin.visible = !!sword && vm.realm >= 5;
    swordGlow.visible = !!sword;
    if (sword) {
      const c = rarityColors[sword.rarity] || '#8e9099';
      artifactSwordMat.uniforms.uColor.value.set(c);
      swordGlowMat.uniforms.uColor.value.set(c);
      swordGlowMat.uniforms.uStrength.value = sword.rarity === 'immortal' ? 0.85 : 0.35;
      swordGlowMat.uniforms.uPulse.value = sword.rarity === 'immortal' ? 1 : 0;
    }

    const robeArt = vm.artifacts.robe;
    if (robeArt) {
      const c = rarityColors[robeArt.rarity] || null;
      trimMat.uniforms.uColor.value.set(c);
      // Earth grade and above puts a glowing outline on the trim; Immortal breathes.
      const tierIdx = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'].indexOf(robeArt.rarity);
      trimMat.uniforms.uEmissive.value = tierIdx >= 2 ? 0.25 + (tierIdx - 2) * 0.3 : 0;
    } else {
      trimMat.uniforms.uEmissive.value = 0;
    }

    const ringArt = vm.artifacts.ring;
    ringMotes.points.visible = !!ringArt;
    if (ringArt) {
      const tierIdx = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'].indexOf(ringArt.rarity);
      ringMotes.geo.setDrawRange(0, Math.max(1, Math.min(3, 1 + Math.floor(tierIdx / 2))));
      ringMoteMat.uniforms.uColor.value.set(rarityColors[ringArt.rarity] || '#e8b34b');
    }

    // Technique motifs.
    leaves.points.visible = (vm.techniques.leaves || 0) > 0;
    river.visible = (vm.techniques.river || 0) > 0;
    riverMat.uniforms.uStrength.value = 0.18 + (vm.techniques.river || 0) * 0.06;
    shell.visible = (vm.techniques.turtle || 0) > 0;
    shellMat.uniforms.uStrength.value = 0.10 + (vm.techniques.turtle || 0) * 0.06;
  }

  /* ------------------------------------------------------------- animate */

  let breath = 0;
  function update(dt, t, reduced) {
    breath += dt * (state.withered ? 0.5 : 0.9);
    const b = Math.sin(breath) * (reduced ? 0.004 : 0.012);
    body.scale.set(1 + b * 0.4, 1 - b * 0.3, 1 + b * 0.4);
    body.position.y = b * 0.5;

    // The qi column: a rising spiral whose density and reach track progress.
    const active = Math.max(0.12, state.progress);
    const shown = Math.round(motes.count * active);
    motes.geo.setDrawRange(0, shown);
    const swirl = state.capped ? 2.1 : 1.0;
    for (let i = 0; i < shown; i++) {
      const life = ((t * moteSpeed[i] * swirl) + motePhase[i]) % 1;
      const ang = motePhase[i] * 6.28 + life * Math.PI * 4 * swirl;
      const rise = life * (2.4 + state.realm * 0.12);
      const r = moteRadius[i] * (1 - life * 0.55) * (0.65 + active * 0.5);
      motes.pos[i * 3 + 0] = Math.cos(ang) * r;
      motes.pos[i * 3 + 1] = 0.15 + rise;
      motes.pos[i * 3 + 2] = Math.sin(ang) * r;
    }
    motes.geo.attributes.position.needsUpdate = true;
    moteMat.uniforms.uFade.value = state.capped ? 1.0 : 0.55 + active * 0.4;

    if (!reduced) {
      runeRing.rotation.z = t * 0.22;
      halo.rotation.z = t * 0.12;
      river.rotation.z = t * 0.5;
    }

    // Floating swords bob out of phase so the group never pulses as one.
    for (let i = 0; i < floatSwords.count; i++) {
      const a = t * 0.35 + (i / Math.max(1, floatSwords.count)) * Math.PI * 2;
      tmpV.set(Math.cos(a) * 2.0, 1.5 + Math.sin(t * 1.1 + i) * 0.18, Math.sin(a) * 2.0);
      tmpQ.setFromEuler(new THREE.Euler(Math.PI * 0.5, 0, -a + Math.PI / 2));
      tmpMat.compose(tmpV, tmpQ, tmpS);
      floatSwords.setMatrixAt(i, tmpMat);
    }
    if (floatSwords.count) floatSwords.instanceMatrix.needsUpdate = true;

    if (artifactSword.visible) {
      artifactSword.position.set(0.95, 1.05 + Math.sin(t * 1.3) * 0.09, 0.35);
      artifactSword.rotation.set(0.1, t * 0.4, -0.22 + Math.sin(t * 0.9) * 0.05);
      swordGlow.position.copy(artifactSword.position);
      swordGlow.rotation.copy(artifactSword.rotation);
      if (artifactSwordTwin.visible) {
        artifactSwordTwin.position.set(-0.95, 1.0 + Math.sin(t * 1.3 + 2) * 0.09, 0.35);
        artifactSwordTwin.rotation.set(0.1, -t * 0.4, 0.22 - Math.sin(t * 0.9) * 0.05);
      }
    }

    if (ringMotes.points.visible) {
      for (let i = 0; i < 3; i++) {
        const a = t * 1.4 + (i * Math.PI * 2) / 3;
        ringMotes.pos[i * 3 + 0] = Math.cos(a) * 0.42;
        ringMotes.pos[i * 3 + 1] = 0.60 + Math.sin(t * 2 + i) * 0.06;
        ringMotes.pos[i * 3 + 2] = 0.26 + Math.sin(a) * 0.30;
      }
      ringMotes.geo.attributes.position.needsUpdate = true;
    }

    if (leaves.points.visible) {
      for (let i = 0; i < leaves.count; i++) {
        const s = leaves.seed[i];
        const life = (t * (0.10 + s * 0.10) + s) % 1;
        leaves.pos[i * 3 + 0] = (s - 0.5) * 6.5 + Math.sin(t * 0.5 + s * 12) * 0.7;
        leaves.pos[i * 3 + 1] = 3.6 - life * 3.9;
        leaves.pos[i * 3 + 2] = (((s * 7) % 1) - 0.5) * 4.0;
      }
      leaves.geo.attributes.position.needsUpdate = true;
    }
  }

  return {
    group, body, head, aura, auraMat, motes, runeRing, runeMat,
    setPalette, sync, update,
    materials: { robeMat, trimMat, skinMat, hairMat, auraMat, moteMat },
  };
}
