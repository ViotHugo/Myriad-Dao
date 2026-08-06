// The cultivator — and everything the player's numbers do to their body.
//
// The figure is built from primitives at boot and never rebuilt; realm, age,
// artifacts and buffs move colours, scales and visibility instead. That keeps a
// state change free, which matters when the HUD updates four times a second.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import { makeInkMaterial, makeGlowMaterial, makeParticleMaterial, makeRuneRingMaterial } from './shaders.js';
import { ageBracket } from './palette.js';
import { mergeGeometries } from './rock.js';
import {
  FIGURE, PLEATS, COLLAR, SASH, ARMS, POSE, SLEEVE_TRIM,
  bodyRadius, skirtRings, robeRings, pleatSegments, collarPanels, sashTails,
} from './figure-plan.js';
import {
  pleatedSkirtGeometry, hemBandGeometry, robeGeometry, collarPanelGeometry,
  tubeGeometry, drapeGeometry, drapeBandGeometry, ribbonGeometry, gradeToHem,
} from './garment.js';

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

  /**
   * Every solid part of her casts into the sun's shadow map, and none of them
   * receives.
   *
   * Casting is the whole point: the wedge of shade under the hem is what says
   * she is sitting on the rock rather than pasted in front of it, and it is
   * the single cheapest thing in this stage.
   *
   * Not receiving is the less obvious half. The shadow camera covers thirty
   * world units at 1024 texels, so she is about sixty texels tall — enough to
   * lay a clean shadow *on the shelf*, nowhere near enough to resolve her own
   * folds, and asking it to try gives a figure crawling with acne. Her own
   * form is carried by the toon ramp and the rim light, which is what they are
   * for. Nothing here glows, so nothing here is a light either.
   */
  const solid = (mesh) => { mesh.castShadow = true; return mesh; };

  /* ------------------------------------------------------------ the body */
  //
  // Stage 6: she is not a lathe any more.
  //
  // What was here was one `LatheGeometry` from hem to collar with two tori
  // round it — a cone, and the eye names a cone in about a tenth of a second.
  // Every piece below exists to take one specific decision away from that
  // reading: a pleated skirt so the light breaks across the cloth, a crossed
  // collar so the shape is a Chinese robe and not a bell, sleeve mass so the
  // outline has arms in it, and a sash with ends so somebody tied it.
  //
  // All of it is authored in `figure-plan.js` and built by `garment.js`, and
  // all of it welds down into three draw calls at the bottom of this section —
  // fewer than the eight separate primitives it replaces.

  const robeMat = makeInkMaterial(env, { color: '#6b6257', rim: 0.7, bands: 4, tint: true });
  const trimMat = makeInkMaterial(env, { color: '#8f8577', rim: 0.9, bands: 5, emissive: 0 });
  const innerMat = makeInkMaterial(env, { color: '#c9c0ae', rim: 0.9, bands: 4 });
  const skinMat = makeInkMaterial(env, { color: '#b9a893', rim: 0.85, bands: 4 });
  const hairMat = makeInkMaterial(env, { color: '#171a1f', rim: 0.6, bands: 3 });

  const segments = pleatSegments();

  /* 裳 — the pleated lower robe, and the band at its hem -------------------- */

  const robeParts = [
    gradeToHem(
      pleatedSkirtGeometry({ rings: skirtRings(), segments, radiusAt: bodyRadius }),
      { hem: FIGURE.hem - PLEATS.hemWobble, waist: FIGURE.waist },
    ),
    robeGeometry({ rings: robeRings(), segments }),
  ];

  const trimParts = [
    hemBandGeometry({
      segments, radiusAt: bodyRadius, height: PLEATS.trim.height, lift: PLEATS.trim.lift,
    }),
  ];

  /* 广袖 — arms, and the sleeves that are most of what is seen of them ------ */

  for (const arm of ARMS) {
    robeParts.push(tubeGeometry({
      from: arm.shoulder, to: arm.elbow, rTop: arm.upper[0], rBot: arm.upper[1], sides: 8,
    }));
    robeParts.push(tubeGeometry({
      from: arm.elbow, to: arm.wrist, rTop: arm.fore[0], rBot: arm.fore[1], sides: 8,
    }));
    robeParts.push(drapeGeometry({ rings: arm.sleeve.rings, sides: 12, roll: SLEEVE_TRIM.roll }));
    trimParts.push(drapeBandGeometry({
      rings: arm.sleeve.rings, height: SLEEVE_TRIM.height, lift: SLEEVE_TRIM.lift, sides: 12,
    }));
  }

  /* 交领右衽 — the crossed collar, and the inner robe under it -------------- */

  const innerParts = [];
  for (const panel of collarPanels()) {
    const geo = collarPanelGeometry(panel.rows);
    (panel.tone === 'inner' ? innerParts : trimParts).push(geo);
  }

  /* 腰带 — two bands, a knot off to the front-left, and the tails ----------- */

  for (const band of SASH.bands) {
    const torus = new THREE.TorusGeometry(bodyRadius(band.y) + band.lift, band.tube, 6, 26);
    torus.rotateX(Math.PI / 2);
    torus.translate(0, band.y, 0);
    trimParts.push(torus);
  }
  {
    const knotGeo = new THREE.SphereGeometry(1, 10, 7);
    knotGeo.scale(...SASH.knot.size);
    knotGeo.rotateY(SASH.knot.tilt);
    knotGeo.translate(...SASH.knot.at);
    trimParts.push(knotGeo);
  }

  // The tails stay their own mesh: they are the one part of the garment with a
  // free end, so they are the part stage 8 has to be able to move.
  const tails = new THREE.Mesh(
    mergeGeometries(sashTails().map((tail) => ribbonGeometry({ points: tail.points, width: tail.width }))),
    trimMat,
  );
  body.add(solid(tails));

  const robe = new THREE.Mesh(mergeGeometries(robeParts), robeMat);
  body.add(solid(robe));
  const trim = new THREE.Mesh(mergeGeometries(trimParts), trimMat);
  body.add(solid(trim));
  const innerCollar = new THREE.Mesh(mergeGeometries(innerParts), innerMat);
  body.add(solid(innerCollar));

  /* the head, and the hands resting against the robe ---------------------- */

  const skinParts = [];
  {
    const neck = new THREE.CylinderGeometry(0.085, 0.10, 0.14, 8);
    neck.translate(0, FIGURE.neck, 0);
    skinParts.push(neck);
  }
  for (const arm of ARMS) {
    const hand = new THREE.SphereGeometry(arm.hand.r, 10, 8);
    hand.scale(1.15, 0.60, 1.0);
    hand.rotateY(arm.hand.tilt);
    hand.translate(...arm.hand.at);
    skinParts.push(hand);
  }
  const skin = new THREE.Mesh(mergeGeometries(skinParts), skinMat);
  body.add(solid(skin));

  // The head is its own group so the tilt in POSE turns everything that grows
  // out of it — hair, knot, pin, beard — and not just the skull.
  const headGroup = new THREE.Group();
  headGroup.position.y = FIGURE.head;
  headGroup.rotation.set(
    (POSE.headNodDeg * Math.PI) / 180,
    (POSE.headTurnDeg * Math.PI) / 180,
    (-POSE.headTiltDeg * Math.PI) / 180,
  );
  body.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 14), skinMat);
  head.scale.set(0.92, 1.06, 0.94);
  headGroup.add(solid(head));

  // A cap that sits above the brow. A longer theta swallows the whole face and
  // the cultivator reads as a black ball.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.213, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.40), hairMat);
  hair.position.y = 0.015;
  headGroup.add(solid(hair));

  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), hairMat);
  knot.position.y = 0.22;
  knot.scale.set(1, 1.25, 1);
  headGroup.add(solid(knot));

  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 5), trimMat);
  pin.position.y = 0.22;
  pin.rotation.z = Math.PI / 2.5;
  headGroup.add(solid(pin));

  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.42, 7, 1), hairMat);
  beard.position.set(0, -0.28, 0.135);
  beard.rotation.x = Math.PI;
  beard.scale.set(1, 0.001, 0.7); // grown in by age
  headGroup.add(solid(beard));

  // She faces +z; a few degrees toward the lens is what opens the collar V.
  body.rotation.y = POSE.bodyYaw;

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
    // fog: false — see the bolt in effects.js. The world's air is applied by
    // the ink shaders; a stock material silently picking up `scene.fog` as well
    // would be the second opinion about the air that stage 2 exists to remove.
    new THREE.LineBasicMaterial({
      color: 0x8fd8c0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
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
  const WHITE = new THREE.Color('#ffffff');
  const tmpMat = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);

  function setPalette(p) {
    robeMat.uniforms.uColor.value.set(p.robe);
    // The trim is the palette's own, lifted toward white.
    //
    // Not a re-authoring of eight palettes — a *contrast* decision that belongs
    // to the figure. `robe` and `trim` are 98 and 133 in luminance at realm 0,
    // a step of 1.36×, and a 7-pixel band at 1.36× against the cloth behind it
    // is a smudge rather than a collar. The collar is the one element that
    // decides what this shape is, so it gets the step it needs to be seen: 1.6×
    // for the sash, hem and collar, 2× for the inner robe showing above it.
    trimMat.uniforms.uColor.value.set(p.trim).lerp(WHITE, 0.18);
    // 中衣 is the same silk, paler again: the inner collar has to read as a
    // *second* layer above the first, and two tones a realm apart would read as
    // two garments from two different palettes.
    innerMat.uniforms.uColor.value.set(p.trim).lerp(WHITE, 0.50);
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
