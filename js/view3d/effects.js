// Set pieces: the tap ripple, the tribulation, the forge, the duel, the wheel.
//
// Restraint is the rule — the world is still almost all of the time, so that
// when the sky goes black it actually lands.

import * as THREE from 'three';
import { mulberry32 } from '../rng.js';
import {
  makeInkMaterial, makeGlowMaterial, makeParticleMaterial, makeMistMaterial,
  makeRuneRingMaterial,
} from './shaders.js';

const FIGURE_PROFILE = [
  new THREE.Vector2(0.001, 0.00), new THREE.Vector2(0.20, 0.04), new THREE.Vector2(0.185, 0.44),
  new THREE.Vector2(0.135, 0.62), new THREE.Vector2(0.065, 0.68), new THREE.Vector2(0.105, 0.77),
  new THREE.Vector2(0.085, 0.86), new THREE.Vector2(0.001, 0.89),
];

export const DUEL_ANCHOR = new THREE.Vector3(26, -5, -14);
export const FORGE_ANCHOR = new THREE.Vector3(5.2, 0, 3.4);

export function createEffects(env, tier) {
  const group = new THREE.Group();
  const rand = mulberry32(20260802);

  /* ============================================================ ripples */

  // A pool of expanding rings. Reused, never allocated during play.
  const RIPPLES = 6;
  const rippleMat = makeGlowMaterial(env, { color: '#35c98e', power: 1.0, strength: 1.4 });
  const ripples = [];
  for (let i = 0; i < RIPPLES; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 28, 1), rippleMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.userData.life = 0;
    group.add(m);
    ripples.push(m);
  }
  let rippleCursor = 0;

  function ripple(at = new THREE.Vector3(0, 0.3, 0), color = null) {
    const m = ripples[rippleCursor];
    rippleCursor = (rippleCursor + 1) % RIPPLES;
    m.position.copy(at);
    m.visible = true;
    m.userData.life = 1;
    m.scale.setScalar(0.4);
    if (color) m.material.uniforms.uColor.value.set(color);
    return m;
  }

  /* ======================================================== tribulation */

  const trib = new THREE.Group();
  trib.visible = false;
  group.add(trib);

  // The spiral of cloud that gathers overhead.
  const spiralMat = makeMistMaterial(env, { color: '#141821', opacity: 0.55, speed: 0.5 });
  const spiral = new THREE.Mesh(new THREE.RingGeometry(3, 26, 48, 3), spiralMat);
  spiral.rotation.x = -Math.PI / 2;
  spiral.position.y = 16;
  trib.add(spiral);

  const spiral2 = new THREE.Mesh(new THREE.RingGeometry(2, 17, 40, 3), spiralMat);
  spiral2.rotation.x = -Math.PI / 2;
  spiral2.position.y = 12.5;
  trib.add(spiral2);

  // Lightning: a jagged polyline, rebuilt on every strike.
  const BOLT_POINTS = 26;
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3));
  const boltMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const bolt = new THREE.Line(boltGeo, boltMat);
  bolt.frustumCulled = false;
  trib.add(bolt);

  function strikeBolt(targetY = 1.2, spread = 0.9) {
    const p = boltGeo.attributes.position.array;
    let x = (rand() - 0.5) * 5;
    let z = (rand() - 0.5) * 5;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const t = i / (BOLT_POINTS - 1);
      p[i * 3 + 0] = x * (1 - t) + (rand() - 0.5) * spread;
      p[i * 3 + 1] = 22 * (1 - t) + targetY * t;
      p[i * 3 + 2] = z * (1 - t) + (rand() - 0.5) * spread;
    }
    boltGeo.attributes.position.needsUpdate = true;
    boltMat.opacity = 1;
  }

  // The timing widget. It has to be the most legible thing on the screen: the
  // player is being asked to hit a window under pressure on a phone. A ring
  // lying flat on the ground reads as decoration and hides behind the body, so
  // this one stands upright and turns to face the camera every frame.
  const tribRingMat = makeRuneRingMaterial(env);
  const tribRing = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.15, 128, 1), tribRingMat);
  tribRing.position.set(0, 1.6, 0);
  tribRing.visible = false;
  tribRing.renderOrder = 20;
  group.add(tribRing);

  // Success: a shockwave along the ground and a beam to the heavens.
  const shockMat = makeGlowMaterial(env, { color: '#e8b34b', power: 0.8, strength: 2.0 });
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 44, 1), shockMat);
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = 0.2;
  shock.visible = false;
  group.add(shock);

  const beamMat = makeGlowMaterial(env, { color: '#ffe9a8', power: 1.6, strength: 0 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 60, 14, 1, true), beamMat);
  beam.position.y = 28;
  beam.visible = false;
  group.add(beam);

  /* ============================================================== forge */

  const forge = new THREE.Group();
  forge.position.copy(FORGE_ANCHOR);
  forge.visible = false;
  group.add(forge);

  const braMat = makeInkMaterial(env, { color: '#33383f', rim: 0.5, bands: 3, flat: true });
  const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.5, 8), braMat);
  brazier.position.y = 0.25;
  forge.add(brazier);
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.4), braMat);
  anvil.position.set(0.95, 0.14, 0);
  forge.add(anvil);

  const coalMat = makeGlowMaterial(env, { color: '#ff7a2b', power: 1.0, strength: 1.6 });
  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), coalMat);
  coals.position.y = 0.5;
  coals.scale.y = 0.4;
  forge.add(coals);

  const sparkMat = makeParticleMaterial(env, { color: '#ffb347', size: 8 });
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(tier.sparks * 3);
  const sparkVel = new Float32Array(tier.sparks * 3);
  const sparkLife = new Float32Array(tier.sparks);
  const sparkScale = new Float32Array(tier.sparks);
  const sparkSeed = new Float32Array(tier.sparks);
  for (let i = 0; i < tier.sparks; i++) { sparkScale[i] = 0.4 + rand() * 0.8; sparkSeed[i] = rand(); }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('aScale', new THREE.BufferAttribute(sparkScale, 1));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sparkSeed, 1));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  forge.add(sparks);

  // The reveal: the piece rises out of the fire and unfolds in its own light.
  const revealMat = makeInkMaterial(env, { color: '#8e9099', rim: 1.4, bands: 3, emissive: 0.5 });
  const revealGeo = new THREE.CylinderGeometry(0.02, 0.10, 1.5, 4, 1);
  revealGeo.rotateY(Math.PI / 4);
  revealGeo.scale(1, 1, 0.35);
  const reveal = new THREE.Mesh(revealGeo, revealMat);
  reveal.visible = false;
  forge.add(reveal);

  const revealGlowMat = makeGlowMaterial(env, { color: '#8e9099', power: 1.4, strength: 0 });
  const revealGlow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), revealGlowMat);
  revealGlow.visible = false;
  forge.add(revealGlow);

  const revealRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40, 1), makeGlowMaterial(env, { color: '#e8b34b', power: 0.8, strength: 1.6 }));
  revealRing.rotation.x = -Math.PI / 2;
  revealRing.visible = false;
  forge.add(revealRing);

  /* =============================================================== duel */

  const duel = new THREE.Group();
  duel.position.copy(DUEL_ANCHOR);
  duel.visible = false;
  group.add(duel);

  const platMat = makeInkMaterial(env, { color: '#333a44', rim: 0.5, bands: 3, flat: true });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.6, 1.6, 9, 1), platMat);
  duel.add(platform);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 3.0, 26, 9, 1), platMat);
  pillar.position.y = -13.6;
  duel.add(pillar);

  const rivalMat = makeInkMaterial(env, { color: '#7a2f3a', rim: 0.9, bands: 3 });
  const rivalGeo = new THREE.LatheGeometry(FIGURE_PROFILE, 10);
  rivalGeo.scale(1.9, 1.9, 1.9);
  const rivalFigure = new THREE.Mesh(rivalGeo, rivalMat);
  rivalFigure.position.set(1.9, 0.8, 0);
  duel.add(rivalFigure);

  const meMat = makeInkMaterial(env, { color: '#2f6b63', rim: 0.9, bands: 3 });
  const meFigure = new THREE.Mesh(rivalGeo, meMat);
  meFigure.position.set(-1.9, 0.8, 0);
  duel.add(meFigure);

  // The strike window: a ring that closes on the rival. Its *time* inside the
  // band is the engine's window fraction, so the picture is the probability.
  const clashMat = makeGlowMaterial(env, { color: '#e8b34b', power: 0.9, strength: 1.8 });
  const clashRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.0, 40, 1), clashMat);
  clashRing.position.set(1.9, 1.5, 0.6);
  clashRing.visible = false;
  duel.add(clashRing);

  const clashTarget = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1.0, 40, 1),
    makeGlowMaterial(env, { color: '#35c98e', power: 0.9, strength: 1.0 }),
  );
  clashTarget.position.copy(clashRing.position);
  clashTarget.visible = false;
  duel.add(clashTarget);

  const duelMist = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 18, 12, 2),
    makeMistMaterial(env, { color: '#8d99a8', opacity: 0.3, speed: 0.05 }),
  );
  duelMist.position.set(0, -6, -6);
  duel.add(duelMist);

  /* ============================================================= rebirth */

  // The nascent soul leaving a body that has run out of years.
  const soulMat = makeGlowMaterial(env, { color: '#9fd8ff', power: 1.5, strength: 0 });
  const soul = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), soulMat);
  soul.visible = false;
  group.add(soul);

  /* ============================================================== state */

  const anim = {
    trib: null,     // { phase, t }
    shock: 0,
    beam: 0,
    reveal: null,
    duelRing: null,
    soul: null,
    forgeHot: 0,
  };

  /* --------------------------------------------------------------- API */

  function setPalette(p) {
    rippleMat.uniforms.uColor.value.set(p.accent);
    for (const m of ripples) m.material.uniforms.uColor.value.set(p.accent);
    platMat.uniforms.uColor.value.set(p.ridges[1]);
    meMat.uniforms.uColor.value.set(p.robe);
  }

  function beginTribulation(chance) {
    trib.visible = true;
    tribRing.visible = true;
    tribRingMat.uniforms.uActive.value = 1;
    tribRingMat.uniforms.uWindow.value = chance;
    anim.trib = { t: 0 };
  }

  function setTribMarker(turns) {
    tribRingMat.uniforms.uMarker.value = turns;
  }

  function endTribulation(success) {
    anim.trib = null;
    trib.visible = false;
    tribRing.visible = false;
    tribRingMat.uniforms.uActive.value = 0;
    boltMat.opacity = 0;
    if (success) {
      shock.visible = true;
      shock.scale.setScalar(1);
      anim.shock = 1;
      beam.visible = true;
      anim.beam = 1;
    } else {
      strikeBolt(0.6, 2.2);
      anim.shock = 0;
    }
  }

  function showForge(on) {
    forge.visible = on;
    anim.forgeHot = on ? 1 : 0;
  }

  function revealArtifact(rarityKey, color) {
    reveal.visible = true;
    revealGlow.visible = true;
    revealRing.visible = rarityKey === 'immortal' || rarityKey === 'heaven';
    revealMat.uniforms.uColor.value.set(color);
    revealGlowMat.uniforms.uColor.value.set(color);
    revealGlowMat.uniforms.uStrength.value = rarityKey === 'immortal' ? 2.6 : rarityKey === 'heaven' ? 1.5 : 0.8;
    revealRing.scale.setScalar(0.5);
    anim.reveal = { t: 0, rarity: rarityKey };
  }

  function hideReveal() {
    reveal.visible = false;
    revealGlow.visible = false;
    revealRing.visible = false;
    anim.reveal = null;
  }

  function showDuel(on) {
    duel.visible = on;
    if (!on) { clashRing.visible = false; clashTarget.visible = false; anim.duelRing = null; }
  }

  /** `progress` 0..1 is where the closing ring is; `window` is the hit band. */
  function setClash(progress, windowFrac, active) {
    clashRing.visible = active;
    clashTarget.visible = active;
    if (!active) return;
    // The band sits at the end of the sweep; its width in time is `windowFrac`.
    const bandStart = 1 - windowFrac;
    clashTarget.scale.setScalar(THREE.MathUtils.lerp(2.6, 0.75, bandStart));
    clashRing.scale.setScalar(THREE.MathUtils.lerp(2.6, 0.75, progress));
    const inside = progress >= bandStart;
    clashMat.uniforms.uColor.value.set(inside ? '#ffe9a8' : '#e8b34b');
  }

  function knockback(won) {
    rivalFigure.position.x = won ? 2.9 : 1.6;
    meFigure.position.x = won ? -1.6 : -2.9;
    rivalFigure.rotation.z = won ? 0.35 : 0;
    meFigure.rotation.z = won ? 0 : -0.35;
  }

  function liftSoul(from = new THREE.Vector3(0, 1.2, 0)) {
    soul.visible = true;
    soul.position.copy(from);
    soulMat.uniforms.uStrength.value = 2.2;
    anim.soul = { t: 0 };
  }

  /* ------------------------------------------------------------ update */

  function update(dt, t, camera) {
    if (tribRing.visible && camera) tribRing.quaternion.copy(camera.quaternion);

    for (const m of ripples) {
      if (!m.visible) continue;
      m.userData.life -= dt * 1.6;
      if (m.userData.life <= 0) { m.visible = false; continue; }
      const k = 1 - m.userData.life;
      m.scale.setScalar(0.4 + k * 4.2);
      m.material.uniforms.uStrength.value = m.userData.life * 1.5;
    }

    if (anim.trib) {
      anim.trib.t += dt;
      spiral.rotation.z = -t * 0.5;
      spiral2.rotation.z = t * 0.8;
      spiral.scale.setScalar(1 + Math.sin(t * 0.9) * 0.04);
      // Strikes get more frequent the longer the heavens are kept waiting.
      if (rand() < dt * (0.6 + anim.trib.t * 0.12)) strikeBolt(8 + rand() * 8, 1.6);
      boltMat.opacity = Math.max(0, boltMat.opacity - dt * 5.5);
    }

    if (anim.shock > 0) {
      anim.shock -= dt * 0.85;
      shock.scale.setScalar(1 + (1 - anim.shock) * 22);
      shockMat.uniforms.uStrength.value = Math.max(0, anim.shock * 2.4);
      if (anim.shock <= 0) shock.visible = false;
    }
    if (anim.beam > 0) {
      anim.beam -= dt * 0.5;
      beamMat.uniforms.uStrength.value = Math.max(0, anim.beam * 1.8);
      beam.scale.set(1 + (1 - anim.beam) * 0.4, 1, 1 + (1 - anim.beam) * 0.4);
      if (anim.beam <= 0) beam.visible = false;
    }

    if (forge.visible) {
      coalMat.uniforms.uStrength.value = 1.2 + Math.sin(t * 3.1) * 0.35;
      for (let i = 0; i < tier.sparks; i++) {
        sparkLife[i] -= dt;
        if (sparkLife[i] <= 0) {
          sparkLife[i] = 0.5 + rand() * 1.1;
          sparkPos[i * 3 + 0] = (rand() - 0.5) * 0.5;
          sparkPos[i * 3 + 1] = 0.5;
          sparkPos[i * 3 + 2] = (rand() - 0.5) * 0.5;
          sparkVel[i * 3 + 0] = (rand() - 0.5) * 0.8;
          sparkVel[i * 3 + 1] = 0.9 + rand() * 1.6;
          sparkVel[i * 3 + 2] = (rand() - 0.5) * 0.8;
        }
        sparkPos[i * 3 + 0] += sparkVel[i * 3 + 0] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        sparkVel[i * 3 + 1] -= dt * 1.4;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }

    if (anim.reveal) {
      anim.reveal.t += dt;
      const k = Math.min(1, anim.reveal.t / 1.1);
      const ease = 1 - Math.pow(1 - k, 3);
      reveal.position.set(0, 0.6 + ease * 1.5, 0);
      reveal.rotation.y = anim.reveal.t * 1.4;
      reveal.rotation.z = Math.sin(anim.reveal.t * 2) * 0.06;
      revealGlow.position.copy(reveal.position);
      revealGlow.scale.setScalar(0.6 + ease * 0.8);
      if (revealRing.visible) {
        revealRing.position.y = reveal.position.y;
        revealRing.scale.setScalar(0.5 + anim.reveal.t * 3.5);
        revealRing.material.uniforms.uStrength.value = Math.max(0, 1.8 - anim.reveal.t * 1.2);
      }
    }

    if (duel.visible) {
      rivalFigure.position.y = 0.8 + Math.sin(t * 1.6) * 0.03;
      meFigure.position.y = 0.8 + Math.sin(t * 1.6 + 1) * 0.03;
      rivalFigure.rotation.z *= 1 - dt * 2;
      meFigure.rotation.z *= 1 - dt * 2;
    }

    if (anim.soul) {
      anim.soul.t += dt;
      soul.position.y += dt * 2.2;
      soul.position.x += Math.sin(anim.soul.t * 2) * dt * 0.6;
      soulMat.uniforms.uStrength.value = Math.max(0, 2.2 - anim.soul.t * 0.7);
      if (anim.soul.t > 3.2) { soul.visible = false; anim.soul = null; }
    }
  }

  return {
    group, trib, forge, duel,
    ripple, beginTribulation, endTribulation, strikeBolt, setTribMarker,
    showForge, revealArtifact, hideReveal,
    showDuel, setClash, knockback, liftSoul,
    setPalette, update,
  };
}
