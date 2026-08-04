// The scene manager.
//
// Owns the renderer, assembles the world, and exposes a small surface to the
// rest of the game: push a view model in, get taps and minigame outcomes back.
// It never reads engine state directly and never decides any rule.

import * as THREE from 'three';
import { createEnv, makePostMaterial } from './shaders.js';
import { PALETTES, paletteAt } from './palette.js';
import { CAMERA } from './camera-config.js';
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

export function createView({ canvas, onTap, onDoubleTap, settings, debug = false }) {
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
    // Only when the debug harness is on. The contact sheet reads the canvas
    // back sixteen times in one synchronous burst, and a drawing buffer the
    // browser is free to discard between renders makes that a coin toss.
    // Everybody else pays nothing for it.
    preserveDrawingBuffer: !!debug,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // pass-through; see above
  renderer.setClearColor(0x0b0e12, 1);
  // Manual reset so renderer.info counts the whole frame (scene + post pass),
  // not just whatever was drawn last. The draw-call budget depends on it.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  // Every one of these comes from camera-config.js. There are no lens numbers
  // anywhere else in the renderer.
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

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

  // The grayscale QA pass lives in the post shader, so on a tier that ships
  // without post there would be nothing to put it in. Turning it on forces the
  // target into existence for as long as the debug toggle is held.
  let forcePost = false;
  const postOn = () => tier.post || forcePost;

  function ensureTarget(w, h) {
    if (!postOn()) { if (target) { target.dispose(); target = null; } return; }
    // The scene goes into this target, so this is where antialiasing has to
    // happen. The `antialias` flag on the renderer applies to the canvas'
    // default framebuffer, which the post path never draws into — every tier
    // with post enabled was therefore fully aliased no matter what it asked
    // for. Multisampling the target is the fix, and it is why the tiers carry
    // an `msaa` count now.
    const samples = tier.msaa || 0;
    if (target && target.width === w && target.height === h && target.samples === samples) return;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples,
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

  // Every colour the scene modules read, held as live THREE.Colors that are
  // lerped toward the target realm each frame. The list has to be complete:
  // whatever is missing here silently falls back to whatever hex the material
  // was constructed with, and the palette entry may as well not exist. That is
  // exactly what happened to `cloud`, `crest`, `crane`, `blossom` and `bark` —
  // authored per realm, wired nowhere, so the sea of cloud stayed the same
  // slate grey through all eight skies.
  const LIVE_COLORS = ['robe', 'trim', 'aura', 'accent', 'bark', 'blossom', 'cloud',
    'cloudCrest', 'crane'];
  const live = {
    ridges: PALETTES[0].ridges.map(() => new THREE.Color()),
    peaks: PALETTES[0].peaks.map(() => new THREE.Color()),
    sun: { color: new THREE.Color(), power: 0.6 },
  };
  for (const k of LIVE_COLORS) live[k] = new THREE.Color();
  const scratch = new THREE.Color();

  function pushLive(p, k) {
    for (const key of LIVE_COLORS) live[key].lerp(scratch.set(p[key]), k);
    p.ridges.forEach((c, i) => live.ridges[i].lerp(scratch.set(c), k));
    p.peaks.forEach((c, i) => live.peaks[i].lerp(scratch.set(c), k));
    live.sun.color.lerp(scratch.set(p.sun.color), k);
    live.sun.power += (p.sun.power - live.sun.power) * k;
    avatar.setPalette(live);
    sect.setPalette(live);
    scenery.setPalette(live);
    effects.setPalette(live);
  }

  /** The realm's own palette, clamped — the sky the game says we are under. */
  const realmPalette = () => PALETTES[Math.max(0, Math.min(PALETTES.length - 1, realmShown))];

  function setRealm(realm, instant = false) {
    if (realm === realmShown) return;
    realmShown = realm;
    // While the debug scrubber holds the sky, the game may still break through
    // a realm underneath it. Remember which one; do not repaint over the dial.
    if (timeOverride !== null) return;
    if (instant) {
      world.applyPalette(realmPalette(), true);
      pushLive(realmPalette(), 1);
      transition = 0;
    } else {
      transition = 1;
    }
  }

  /** Paint a palette on with no transition — used by the scrubber and by capture. */
  function paintNow(p) {
    world.applyPalette(p, true);
    pushLive(p, 1);
    transition = 0;
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

  // QA state. All three are inert unless the debug harness touches them.
  let timeOverride = null;   // 0..1 on the scrubber, or null for "the game decides"
  let poseOverride = null;   // a debug preset holding the camera
  let wantFraming = 'world'; // the framing the game last asked for
  let capturing = false;
  let fps = 60;

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
    // Repaint the new geometry with the sky we are actually under — which is
    // the scrubber's, if QA is holding one.
    if (timeOverride !== null) paintNow(paletteAt(timeOverride));
    else if (realmShown >= 0) { world.applyPalette(realmPalette(), true); pushLive(realmPalette(), 1); }
    if (vmCache) { avatar.sync(vmCache, RARITY_COLORS); sect.sync(vmCache); scenery.sync(vmCache); }
    setWireframe(wireframe);
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

    if (transition > 0 && realmShown >= 0 && timeOverride === null) {
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

    if (postOn() && target) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    } else {
      renderer.render(scene, camera);
    }

    // A capture is sixteen renders in one tick at a size nobody is playing at.
    // Feeding those frame times to the watchdog would have it demote the tier
    // on the strength of a screenshot.
    if (!capturing) {
      watchdog(dt, tierName);
      fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;
    }
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

  /* ------------------------------------------------------------- QA hooks */
  //
  // The debug panel is dev-only and loaded on demand, but the switches it
  // throws belong to the renderer, because the renderer is the only thing that
  // knows what a tier change or a scene rebuild has to do to them. Everything
  // below is a no-op until something asks.

  /** Luminance-only view of the finished frame. The primary QA instrument. */
  function setGrayscale(on) {
    postMat.uniforms.uGrayscale.value = on ? 1 : 0;
    const need = !!on;
    if (need !== forcePost) { forcePost = need; resize(); }
  }

  let wireframe = false;
  function setWireframe(on) {
    wireframe = !!on;
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      // Points and sprites have no wireframe, and asking for one on them
      // silently does nothing — worse, it makes the toggle look broken.
      for (const m of mats) if ('wireframe' in m) m.wireframe = wireframe;
    });
  }

  /** Hold the sky at a point on the 0→1 dial. `null` hands it back to the game. */
  function setTimeOfDay(t) {
    timeOverride = t === null || t === undefined ? null : Math.max(0, Math.min(1, t));
    paintNow(timeOverride === null
      ? (realmShown >= 0 ? realmPalette() : PALETTES[0])
      : paletteAt(timeOverride));
  }

  /** Hold the camera at a debug preset. `null` returns it to the game's framing. */
  function setPose(f) {
    poseOverride = f || null;
    rig.reset();
    if (poseOverride) rig.setPose(poseOverride, true);
    else rig.setFraming(wantFraming, true);
  }

  function stats() {
    const info = renderer.info.render;
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      fps,
      calls: info.calls,
      triangles: info.triangles,
      points: info.points,
      lines: info.lines,
      tier: tierName,
      framing: poseOverride ? 'debug' : wantFraming,
      width: cssWidth,
      height: cssHeight,
      aspect: cssWidth / cssHeight,
      bufferWidth: Math.round(buf.x),
      bufferHeight: Math.round(buf.y),
      grayscale: postMat.uniforms.uGrayscale.value > 0,
      wireframe,
      timeOfDay: timeOverride,
      realm: realmShown,
      pose: rig.pose,
    };
  }

  /**
   * Draw one frame at an exact pixel size and reference aspect, leaving it on
   * the canvas for the caller to read back. `dt = 0` so nothing animates: the
   * same call twice gives the same image.
   *
   * The caller must call `resize()` when it is done to put the view back.
   */
  function captureFrame(w, h, aspect = CAMERA.referenceAspect) {
    capturing = true;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    ensureTarget(w, h);
    avatar.materials.moteMat.uniforms.uPixelRatio.value = 1;
    render(0);
    capturing = false;
  }

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
    setFraming: (n, i) => {
      wantFraming = n;
      // A held debug preset outranks the game. Otherwise switching tabs or
      // starting a tribulation would yank the camera out from under a capture.
      if (!poseOverride) rig.setFraming(n, i);
    },
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
    CAMERA,
    /** Everything the debug harness drives. Inert until it does. */
    qa: { setGrayscale, setWireframe, setTimeOfDay, setPose, stats, captureFrame },
  };
}
