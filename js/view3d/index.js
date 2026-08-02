// The scene manager.
//
// Owns the renderer, assembles the world, and exposes a small surface to the
// rest of the game: push a view model in, get taps and minigame outcomes back.
// It never reads engine state directly and never decides any rule.

import * as THREE from 'three';
import { createEnv, makePostMaterial } from './shaders.js';
import { PALETTES } from './palette.js';
import { TIERS, resolveTier, createWatchdog } from './quality.js';
import { createWorld } from './world.js';
import { createAvatar } from './avatar.js';
import { createSect } from './sect.js';
import { createScenery } from './scenery.js';
import { createEffects, DUEL_ANCHOR, FORGE_ANCHOR } from './effects.js';
import { createCameraRig, FRAMINGS } from './camera.js';

const RARITY_COLORS = {
  mortal: '#8e9099', spirit: '#35c98e', earth: '#4aa3e0', heaven: '#b07ae8', immortal: '#e8b34b',
};

// This renderer is entirely authored: hand-written toon ramps, no PBR, no
// physical light units. Three's colour management would convert every palette
// hex into linear working space, and a custom ShaderMaterial gets no automatic
// linear->sRGB conversion on the way out — so the whole world would render at
// roughly 40% of the brightness it was painted at. Turning it off means the
// colours in palette.js are exactly the colours on screen.
THREE.ColorManagement.enabled = false;

export function createView({ canvas, onTap, onDoubleTap, settings }) {
  /* ------------------------------------------------------------- setup */

  let tierName = resolveTier(settings?.quality);
  let tier = TIERS[tierName];

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier.antialias,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: true,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // pass-through; see above
  renderer.setClearColor(0x0b0e12, 1);
  // Manual reset so renderer.info counts the whole frame (scene + post pass),
  // not just whatever was drawn last. The draw-call budget depends on it.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);

  const env = createEnv();
  // Rebuildable: a tier change swaps these out wholesale (see setQuality).
  let world = createWorld(env, tier);
  let avatar = createAvatar(env, tier);
  let sect = createSect(env, tier);
  let scenery = createScenery(env, tier);
  let effects = createEffects(env, tier);
  scene.add(world.group, avatar.group, sect.group, scenery.group, effects.group);

  /* --------------------------------------------------------- post stack */

  // One pass: paper, vignette, dissolve, flash. Anything more is a tax.
  const postScene = new THREE.Scene();
  const postCamera = new THREE.Camera();
  const postMat = makePostMaterial();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
  let target = null;

  function ensureTarget(w, h) {
    if (!tier.post) { if (target) { target.dispose(); target = null; } return; }
    if (target && target.width === w && target.height === h) return;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });
    postMat.uniforms.tDiffuse.value = target.texture;
    postMat.uniforms.uResolution.value.set(w, h);
  }

  /* ------------------------------------------------------------- resize */

  let cssWidth = 1, cssHeight = 1;
  function resize() {
    const parent = canvas.parentElement || document.body;
    cssWidth = Math.max(1, parent.clientWidth || window.innerWidth);
    cssHeight = Math.max(1, parent.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, tier.pixelRatio) * tier.renderScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssWidth, cssHeight, false);
    camera.aspect = cssWidth / cssHeight;
    camera.updateProjectionMatrix();
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    ensureTarget(Math.max(1, Math.floor(buf.x)), Math.max(1, Math.floor(buf.y)));
    avatar.materials.moteMat.uniforms.uPixelRatio.value = dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  /* -------------------------------------------------------------- camera */

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const rig = createCameraRig(camera, canvas, {
    onTap: (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      onTap?.({ x: e.clientX, y: e.clientY, ndc: pointerNdc.clone() });
    },
    onDoubleTap,
    reducedMotion: () => reduced,
  });

  /* ------------------------------------------------------------ palettes */

  let realmShown = -1;
  let transition = 0; // 1 -> 0 while a realm change settles
  const live = {
    robe: new THREE.Color(), trim: new THREE.Color(), aura: new THREE.Color(),
    accent: new THREE.Color(), ridges: PALETTES[0].ridges.map(() => new THREE.Color()),
  };

  function pushLive(p, k) {
    live.robe.lerp(new THREE.Color(p.robe), k);
    live.trim.lerp(new THREE.Color(p.trim), k);
    live.aura.lerp(new THREE.Color(p.aura), k);
    live.accent.lerp(new THREE.Color(p.accent), k);
    p.ridges.forEach((c, i) => live.ridges[i].lerp(new THREE.Color(c), k));
    avatar.setPalette(live);
    sect.setPalette(live);
    scenery.setPalette(live);
    effects.setPalette(live);
  }

  function setRealm(realm, instant = false) {
    if (realm === realmShown) return;
    realmShown = realm;
    const p = PALETTES[Math.max(0, Math.min(PALETTES.length - 1, realm))];
    if (instant) {
      world.applyPalette(p, true);
      pushLive(p, 1);
      transition = 0;
    } else {
      transition = 1;
    }
  }

  /* ----------------------------------------------------------- minigames */

  // Both timing games live here because they are animations; the engine still
  // owns every consequence. The window's *width* is the engine's probability,
  // and the marker moves at constant speed, so a tap lands inside exactly that
  // often. The picture and the maths are the same object.
  const minigame = { kind: null, marker: 0, speed: 0, window: 0, elapsed: 0, sweeps: 0 };

  function startTribulation(chance, speed) {
    minigame.kind = 'trib';
    minigame.marker = 0;
    minigame.speed = speed;
    minigame.window = chance;
    minigame.elapsed = 0;
    minigame.sweeps = 0;
    effects.beginTribulation(chance);
    rig.setFraming('trib');
  }

  function tribulationTap() {
    if (minigame.kind !== 'trib') return null;
    const pos = ((minigame.marker % 1) + 1) % 1;
    const hit = Math.abs(pos - 0.5) <= minigame.window / 2;
    minigame.kind = null;
    avatar.runeMat.uniforms.uFlash.value = 1;
    effects.endTribulation(hit);
    if (hit) postFlash('#ffe9a8', 0.75);
    else postFlash('#7a2f3a', 0.5);
    rig.setFraming('world');
    return { hit };
  }

  function startClash(round, windowFrac, speed) {
    minigame.kind = 'clash';
    minigame.marker = 0;
    minigame.speed = speed;
    minigame.window = windowFrac;
    minigame.elapsed = 0;
    minigame.sweeps = 0;
  }

  function clashTap() {
    if (minigame.kind !== 'clash') return null;
    const pos = ((minigame.marker % 1) + 1) % 1;
    const hit = pos >= 1 - minigame.window;
    minigame.kind = null;
    effects.setClash(pos, minigame.window, false);
    effects.clashImpact(hit);
    postFlash(hit ? '#e8b34b' : '#26303c', 0.35);
    return { hit };
  }

  function endClash() {
    minigame.kind = null;
    effects.setClash(0, 0, false);
  }

  /* --------------------------------------------------------------- post */

  let flash = 0;
  let flashDecay = 1;
  function postFlash(color, amount = 0.6) {
    postMat.uniforms.uFlashColor.value.set(color);
    flash = amount;
    flashDecay = 1.8;
  }

  let dissolve = 0;
  let dissolveDir = 0;
  function inkDissolve(dir) { dissolveDir = dir; }

  /* -------------------------------------------------------------- state */

  let reduced = !!settings?.reducedMotion;
  let clock = 0;
  let vmCache = null;
  const watchdog = createWatchdog((next) => setQuality(next));

  /** Free every geometry and material under a group before dropping it. */
  function disposeGroup(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) m.dispose();
    });
    scene.remove(root);
  }

  // Counts that are baked into geometry at construction time. Changing any of
  // them means the scene has to be rebuilt, not just re-sized.
  const GEOMETRY_KEYS = ['mistBands', 'ridgeLayers', 'qiMotes', 'sparks', 'disciples', 'floatSwords',
    'water', 'stars', 'spires', 'cloudDecks', 'plumDepth', 'blossoms', 'petals', 'cranes',
    'waterfall', 'bamboo', 'fireflies'];

  function rebuildScene() {
    for (const g of [world.group, avatar.group, sect.group, scenery.group, effects.group]) disposeGroup(g);
    world = createWorld(env, tier);
    avatar = createAvatar(env, tier);
    sect = createSect(env, tier);
    scenery = createScenery(env, tier);
    effects = createEffects(env, tier);
    scene.add(world.group, avatar.group, sect.group, scenery.group, effects.group);
    // Repaint the new geometry with the realm we are actually in.
    const p = PALETTES[Math.max(0, Math.min(PALETTES.length - 1, realmShown))];
    if (realmShown >= 0) { world.applyPalette(p, true); pushLive(p, 1); }
    if (vmCache) { avatar.sync(vmCache, RARITY_COLORS); sect.sync(vmCache); scenery.sync(vmCache); }
  }

  function setQuality(setting) {
    // Accepts 'auto', a tier name, undefined or nonsense — resolveTier always
    // lands on a real tier. Indexing TIERS directly here meant that choosing
    // Auto in Settings threw and left the renderer half-configured.
    const name = resolveTier(setting);
    if (name === tierName) return;
    const prev = tier;
    tierName = name;
    tier = TIERS[name];

    // Never rebuild out from under a set piece — it would drop the tribulation
    // or the duel mid-animation. Resolution still applies immediately.
    const geometryChanged = GEOMETRY_KEYS.some((k) => prev[k] !== tier[k]);
    if (geometryChanged && minigame.kind === null) rebuildScene();
    else if (geometryChanged) pendingRebuild = true;
    resize();
  }

  let pendingRebuild = false;

  function setReducedMotion(v) { reduced = !!v; }

  function sync(vm) {
    vmCache = vm;
    setRealm(vm.realm, realmShown === -1);
    avatar.sync(vm, RARITY_COLORS);
    sect.sync(vm);
    scenery.sync(vm);
    env.uDesat.value += ((vm.withered ? 0.75 : 0) - env.uDesat.value) * 0.12;
  }

  /* ------------------------------------------------------------- render */

  function render(dt) {
    clock += dt;
    env.uTime.value = clock;
    renderer.info.reset();

    if (transition > 0 && realmShown >= 0) {
      const p = PALETTES[realmShown];
      const k = Math.min(1, dt * 1.1);
      world.applyPalette(p, false, k);
      pushLive(p, k);
      transition = Math.max(0, transition - dt / 3);
      if (transition === 0) { world.applyPalette(p, true); pushLive(p, 1); }
    }

    rig.update(dt);
    world.update(dt, clock);
    avatar.update(dt, clock, reduced);
    sect.update(dt, clock);
    scenery.update(dt, clock, reduced);
    effects.update(dt, clock, camera);

    if (minigame.kind === 'trib') {
      minigame.elapsed += dt;
      const turns = (minigame.speed / (Math.PI * 2)) * dt;
      minigame.marker += turns;
      minigame.sweeps = Math.floor(minigame.marker);
      effects.setTribMarker(((minigame.marker % 1) + 1) % 1);
      world.setStorm(Math.min(1, minigame.elapsed * 1.4));
      // The sky alone is not enough: the ridges would stay lit while the
      // heavens go black. Take the light out of the whole frame.
      postMat.uniforms.uDarken.value = Math.min(0.5, minigame.elapsed * 0.7);
    } else {
      const storm = world.skyMat.uniforms.uStorm.value;
      if (storm > 0) world.setStorm(Math.max(0, storm - dt * 0.6));
      postMat.uniforms.uDarken.value = Math.max(0, postMat.uniforms.uDarken.value - dt * 1.2);
      avatar.runeMat.uniforms.uFlash.value = Math.max(0, avatar.runeMat.uniforms.uFlash.value - dt * 2);
    }

    if (minigame.kind === 'clash') {
      minigame.elapsed += dt;
      minigame.marker += (minigame.speed / (Math.PI * 2)) * dt;
      minigame.sweeps = Math.floor(minigame.marker);
      effects.setClash(((minigame.marker % 1) + 1) % 1, minigame.window, true);
    }

    if (pendingRebuild && minigame.kind === null) {
      pendingRebuild = false;
      rebuildScene();
    }

    if (flash > 0) flash = Math.max(0, flash - dt * flashDecay);
    postMat.uniforms.uFlash.value = flash;

    if (dissolveDir !== 0) {
      dissolve = THREE.MathUtils.clamp(dissolve + dt * dissolveDir * 1.15, 0, 1);
      if ((dissolveDir > 0 && dissolve >= 1) || (dissolveDir < 0 && dissolve <= 0)) dissolveDir = 0;
    }
    postMat.uniforms.uDissolve.value = dissolve;
    postMat.uniforms.uTime.value = clock;

    if (tier.post && target) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    } else {
      renderer.render(scene, camera);
    }

    watchdog(dt, tierName);
  }

  /* ------------------------------------------------------------ helpers */

  const tmpProj = new THREE.Vector3();
  /** World point -> CSS pixel coordinates, for DOM labels floating in-world. */
  function project(v) {
    tmpProj.copy(v).project(camera);
    return {
      x: (tmpProj.x * 0.5 + 0.5) * cssWidth,
      y: (-tmpProj.y * 0.5 + 0.5) * cssHeight,
      visible: tmpProj.z < 1,
    };
  }

  /** Where the qi column stands — the anchor for floating +N labels. */
  const tapAnchor = new THREE.Vector3(0, 1.6, 0);

  function dispose() {
    window.removeEventListener('resize', resize);
    rig.dispose();
    renderer.dispose();
    target?.dispose();
  }

  return {
    renderer, scene, camera, env, rig,
    get world() { return world; },
    get avatar() { return avatar; },
    get sect() { return sect; },
    get scenery() { return scenery; },
    get effects() { return effects; },
    render, sync, resize, dispose, project, tapAnchor,
    setFraming: (n, i) => rig.setFraming(n, i),
    get framing() { return rig.framing; },
    setQuality, setReducedMotion,
    get quality() { return tierName; },
    startTribulation, tribulationTap,
    startClash, clashTap, endClash,
    get minigame() { return minigame; },
    get postDissolve() { return postMat.uniforms.uDissolve.value; },
    ripple: (color) => effects.ripple(new THREE.Vector3(0, 0.35, 0), color),
    showForge: (on) => effects.showForge(on),
    revealArtifact: (rarity) => effects.revealArtifact(rarity, RARITY_COLORS[rarity] || '#8e9099'),
    hideReveal: () => effects.hideReveal(),
    showDuel: (on) => effects.showDuel(on),
    knockback: (won) => effects.knockback(won),
    clashImpact: (hit) => effects.clashImpact(hit),
    liftSoul: () => effects.liftSoul(),
    inkDissolve,
    postFlash,
    RARITY_COLORS,
    anchors: { duel: DUEL_ANCHOR, forge: FORGE_ANCHOR },
    FRAMINGS,
  };
}
