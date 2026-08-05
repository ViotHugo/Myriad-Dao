// The post stack.
//
// ---------------------------------------------------------------------------
// Four passes, and why the last one is not optional
//
//   RenderPass        the world, into a linear buffer with no ceiling
//   UnrealBloomPass   what is brighter than 0.85, spread and added back
//   ShaderPass        the game's own material: ACES, paper, vignette, dissolve
//
// The stack used to be a single fullscreen pass that a quality tier could turn
// off, and turning it off cost the player nothing but grain. That is no longer
// true: the scene renders in linear light and it is the last pass that tone
// maps and encodes it, so a tier without it would be showing raw linear values
// on an sRGB screen — a picture roughly forty percent too dark, with crushed
// shadows. The grade is part of the pipeline, not a garnish, so it runs on
// every tier and only the bloom is a quality setting.
//
// Bloom is half resolution by construction: UnrealBloomPass starts its mip
// chain at half the size it is given and never touches the full-resolution
// buffer, which is what makes five blurred mips affordable on a phone.
//
// No DOF and no SSAO. Both cost more than everything above put together, and
// this is a landscape read at arm's length on a handset.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { EffectComposer } from '../../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three-addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three-addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/three-addons/postprocessing/UnrealBloomPass.js';

/**
 * The bloom, as three numbers. Gentle: this is ink, not neon.
 *
 * `strength` is the *day* strength and the starting value; the time of day
 * drives it live (0.40 by day, 0.55 at night). That is not decoration: at an
 * exposure of 0.75 the handful of bright things left in a night frame — the
 * moon, the qi, a lantern — are most of what the eye has to read, and a bloom
 * tuned for noon leaves them as flat dots.
 */
export const BLOOM = { threshold: 0.85, strength: 0.4, radius: 0.6 };

/**
 * Assemble the composer.
 *
 * `postMat` is the material from shaders.js — handed to ShaderPass whole, so
 * the uniforms the game already drives (flash, dissolve, darken, grayscale)
 * stay exactly where they were and nothing has to be re-plumbed.
 */
export function createPost({ renderer, scene, camera, postMat, tier }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  // Our own target rather than the composer's default, for one reason: the
  // scene is drawn into this and nowhere else, so this is the only surface
  // where antialiasing can happen. HalfFloat because the buffer has to hold
  // values above 1 for the bloom threshold to mean anything.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    samples: tier.msaa || 0,
  });
  target.texture.name = 'scene';

  const composer = new EffectComposer(renderer, target);
  composer.renderToScreen = true;

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold,
  );
  bloom.enabled = !!tier.bloom;
  composer.addPass(bloom);

  const grade = new ShaderPass(postMat);
  composer.addPass(grade);

  /** Resize everything the composer owns to the current drawing buffer. */
  function setSize(cssWidth, cssHeight, pixelRatio) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(cssWidth, cssHeight);
    postMat.uniforms.uResolution.value.set(
      Math.max(1, Math.round(cssWidth * pixelRatio)),
      Math.max(1, Math.round(cssHeight * pixelRatio)),
    );
  }

  /** The day turning the bloom up as the light goes. Lerped, never switched. */
  function setBloomStrength(strength) {
    bloom.strength = strength;
  }

  function setTier(next) {
    bloom.enabled = !!next.bloom;
    const samples = next.msaa || 0;
    if (composer.renderTarget1.samples !== samples) {
      composer.renderTarget1.samples = samples;
      composer.renderTarget2.samples = samples;
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
    }
  }

  function render(dt) {
    // Exposure lives on the renderer so there is one dial. The time of day
    // turns it; this pass only reads it, every frame, so the two can never
    // drift apart.
    postMat.uniforms.uExposure.value = renderer.toneMappingExposure;
    composer.render(dt);
  }

  function dispose() {
    composer.dispose();
    bloom.dispose();
    grade.dispose();
  }

  return {
    composer, renderPass, bloom, grade,
    render, setSize, setTier, setBloomStrength, dispose,
  };
}
