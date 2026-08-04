// The light rig. Three lights, and nothing else in the scene emits.
//
// ---------------------------------------------------------------------------
// Why there is no ambient light
//
// The picture was flat, and the reason was one line: a full-strength ambient
// term added to every surface regardless of which way it faced. Ambient light
// is the only light that cannot describe form — it lifts the shadow side by
// exactly as much as the lit side, so the difference between the two is the
// only thing carrying the shape, and once that difference is a fraction of the
// total the shape is gone. A landscape lit that way reads as coloured paper.
//
// So there is no AmbientLight here at all. The fill comes from a hemisphere —
// sky above, ground below — which is still cheap, still flat-ish, but *varies
// with the normal*, so a face turned up to the sky and a face turned down to
// the valley are different values before the sun says anything.
//
//   1. sun     a DirectionalLight, and the only caster. Its shadow camera is
//              fitted to the foreground island and nothing else: the range is
//              hundreds of units deep and a shadow map stretched over it has
//              no texels left for the thing the shadow is actually for, which
//              is the cultivator sitting on her shelf.
//   2. bounce  the HemisphereLight described above.
//   3. rim     a low DirectionalLight behind and above her, aimed at her. This
//              is what separates the figure from the rock she sits against,
//              and it is not decoration: at every sky but the two brightest,
//              her silhouette and the stone behind it are within a few levels
//              of each other, and no amount of key light fixes that because
//              the key is in front.
//
// The lights are real THREE lights — the sun genuinely renders the shadow map
// through renderer.shadowMap — and they are also the single source of truth
// for the hand-written shading in shaders.js: `apply()` writes the same
// direction, colour and intensity into the shared `env` uniforms that the ink
// materials read. One rig, two consumers, no chance of them disagreeing.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

/**
 * The foreground island: the shelf, its apron, the standing rocks and the
 * cultivator. Everything the shadow map is allowed to care about.
 */
export const ISLAND = {
  /** Centre of the shadow camera's frustum, in world units. */
  center: new THREE.Vector3(0, 0.2, 0),
  /** Side of the fitted square. The shelf is 25 across; this clears it. */
  extent: 30,
  /** How far up the sun stands. Only sets the near/far span, not the look. */
  distance: 34,
  /** Shadow map resolution. 30 units over 1024 texels is ~3cm on the shelf. */
  mapSize: 1024,
};

/** Where the rim light is aimed: her chest, not her feet. */
const RIM_TARGET = new THREE.Vector3(0, 0.95, 0);

/**
 * The rim light's direction, as a unit vector *toward* the light.
 *
 * Behind her and above, where "behind" means behind with respect to the hero
 * framing — the one camera the composition is authored for. It is opposite the
 * camera's yaw (0.62 rad, so the eye sits out at +x +z) and tilted up.
 */
const RIM_DIR = new THREE.Vector3(-0.58, 0.55, -0.79).normalize();

/** Intensities. Low for the rim: it is an edge, not a second key. */
const SUN_INTENSITY = 1.5;
const HEMI_INTENSITY = 0.35;
const RIM_INTENSITY = 0.9;

/**
 * Build the rig and wire it to the shared uniforms.
 *
 * Returns a group to add to the scene once, and `apply()` to push a palette's
 * lighting through it. The rig outlives a tier rebuild — it holds no geometry
 * and nothing about it is a quality setting.
 */
export function createLighting(env) {
  const group = new THREE.Group();
  group.name = 'lighting';

  /* ------------------------------------------------------------- 1. sun */

  const sun = new THREE.DirectionalLight(0xfff2dc, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(ISLAND.mapSize, ISLAND.mapSize);

  // Fitted tight to the island. An orthographic frustum this small over a
  // 1024 map is what makes a *contact* shadow possible — the dark wedge right
  // under the hem that says she is sitting on the rock rather than hovering a
  // few centimetres above it.
  const half = ISLAND.extent / 2;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = ISLAND.distance * 2;
  cam.updateProjectionMatrix();

  // Peter-panning versus acne, on a figure about 1.7 units tall. normalBias
  // does the heavy lifting because the robe is a lathe with near-vertical
  // walls, which is the geometry that acnes first at a grazing sun.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 1.8;
  // Full: an occluded surface loses the sun and nothing else. It still has the
  // hemisphere, which the shader adds separately, and that is what a shadow in
  // open air actually is — sky light with the sun taken out of it. Dialling
  // this down instead is how you get a shadow that reads as a smudge.
  sun.shadow.intensity = 1.0;

  sun.target.position.copy(ISLAND.center);
  group.add(sun, sun.target);

  /* --------------------------------------------------------- 2. bounce */

  const bounce = new THREE.HemisphereLight(0x333c46, 0x2b3038, HEMI_INTENSITY);
  group.add(bounce);

  /* ------------------------------------------------------------ 3. rim */

  const rim = new THREE.DirectionalLight(0xffe8cf, RIM_INTENSITY);
  rim.castShadow = false;
  rim.position.copy(RIM_TARGET).addScaledVector(RIM_DIR, 12);
  rim.target.position.copy(RIM_TARGET);
  group.add(rim, rim.target);

  /* -------------------------------------------------------------- wire */

  const sunDir = new THREE.Vector3();

  /**
   * Paint the rig from a palette's already-lerped lighting values, and push
   * the same numbers into the shared uniforms.
   *
   * `cur` is world.js's live colour bundle, so this runs at whatever rate the
   * realm transition is easing at and the lights follow the sky exactly.
   */
  function apply(cur) {
    // The sun. `cur.dir` points *at* the light, which is the convention the
    // ink shaders use, so the light stands that far along it.
    sunDir.copy(cur.dir).normalize();
    sun.position.copy(ISLAND.center).addScaledVector(sunDir, ISLAND.distance);
    sun.color.copy(cur.light);
    sun.intensity = SUN_INTENSITY * cur.sunPower;
    sun.target.position.copy(ISLAND.center);

    // The hemisphere. `ambient` is the sky's own fill, authored per realm; it
    // used to be sprayed on flat and is now the *upward* half of a gradient.
    bounce.color.copy(cur.ambient);
    bounce.groundColor.copy(cur.ground);

    // The rim. It keeps its authored geometry — a light aimed at her does not
    // move when the sun does — and takes the realm's own light colour, so the
    // moon rims cold and the sunset rims warm.
    rim.color.copy(cur.sunColor);

    env.uLightDir.value.copy(sunDir);
    env.uLightColor.value.copy(sun.color);
    env.uSunPower.value = sun.intensity;
    env.uHemiSky.value.copy(bounce.color);
    env.uHemiGround.value.copy(bounce.groundColor);
    env.uHemiIrradiance.value = bounce.intensity;
    env.uRimLightDir.value.copy(RIM_DIR);
    env.uRimLightColor.value.copy(rim.color);
    env.uRimLightPower.value = rim.intensity;
  }

  // Nothing here hands the depth map to the ink materials: they declare
  // `lights: true` and merge THREE.UniformsLib.lights, so the renderer uploads
  // `directionalShadowMap`, `directionalShadowMatrix` and the bias/radius
  // struct itself, every frame, from this light. Every knob set above is
  // therefore live — including `renderer.shadowMap.type`, which chooses the
  // filter inside three's own `getShadow()`.

  return { group, sun, bounce, rim, apply };
}
